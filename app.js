(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const cfg = window.TINCHECK_CONFIG || {};

  const state = {
    bridgeReady: false,
    bridgeWindow: null,
    bridgeOrigin: '',
    pending: new Map(),
    seq: 0,

    view: 'home',
    panel: null,
    image: null,
    lastResult: null,

    cameraStream: null,

    speaking: false,
    preferredVoice: null,

    micStream: null,
    audioContext: null,
    audioSource: null,
    audioProcessor: null,
    audioBuffers: [],
    recordStart: 0,
    recordTimer: null,
    recordAutoStop: null,
    recordStopping: false
  };

  const screens = {
    home: $('homeScreen'),
    loading: $('loadingScreen'),
    result: $('resultScreen')
  };

  const panels = {
    text: $('textPanel'),
    voice: $('voicePanel'),
    camera: $('cameraPanel'),
    image: $('imagePanel')
  };

  init();

  function init() {
    history.replaceState({ tc: 'home' }, '', location.pathname + location.search);
    initBridge();
    bindEvents();
    initVoices();
    renderView('home');
  }

  /* ===== BACKEND BRIDGE: NESTED IFRAME SAFE ===== */

  function initBridge() {
    const url = String(cfg.BACKEND_URL || '').trim();

    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(url)) {
      setTimeout(() => showError(
        'homeError',
        'TinCheck chưa được nối với máy chủ. Hãy kiểm tra BACKEND_URL trong config.js.'
      ), 250);
      return;
    }

    state.bridgeReady = false;
    state.bridgeWindow = null;
    state.bridgeOrigin = '';

    const sep = url.includes('?') ? '&' : '?';
    $('backendBridge').src = url + sep + 'mode=bridge&v=' + Date.now();

    window.addEventListener('message', event => {
      const msg = event.data || {};

      const googleOrigin =
        event.origin === 'https://script.google.com' ||
        /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com$/i.test(event.origin);

      if (msg.type === 'tincheck-bridge-ready') {
        if (!googleOrigin) return;

        // Apps Script HtmlService nằm trong iframe lồng.
        // event.source chính là cửa sổ Bridge thật sự bên trong Google.
        state.bridgeWindow = event.source;
        state.bridgeOrigin = event.origin;
        state.bridgeReady = true;
        hideError('homeError');
        return;
      }

      if (msg.type !== 'tincheck-response' || !msg.requestId) return;
      if (!state.bridgeWindow || event.source !== state.bridgeWindow) return;

      const item = state.pending.get(msg.requestId);
      if (!item) return;

      state.pending.delete(msg.requestId);
      clearTimeout(item.timer);

      if (msg.ok) item.resolve(msg.result);
      else item.reject(new Error(msg.error || 'Máy chủ TinCheck trả lỗi.'));
    });

    setTimeout(() => {
      if (!state.bridgeReady) {
        showError(
          'homeError',
          'TinCheck chưa kết nối được máy chủ. Vui lòng tải lại trang rồi thử lại.'
        );
      }
    }, 10000);
  }

  function backendCall(action, payload, timeoutMs = 120000) {
    if (!state.bridgeReady || !state.bridgeWindow) {
      return Promise.reject(new Error('TinCheck chưa kết nối được máy chủ.'));
    }

    const requestId = 'tc_' + Date.now() + '_' + (++state.seq);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(requestId);
        reject(new Error('TinCheck xử lý quá lâu. Vui lòng thử lại.'));
      }, timeoutMs);

      state.pending.set(requestId, { resolve, reject, timer });

      const targetOrigin =
        state.bridgeOrigin && state.bridgeOrigin !== 'null'
          ? state.bridgeOrigin
          : '*';

      state.bridgeWindow.postMessage({
        type: 'tincheck-request',
        requestId,
        action,
        payload
      }, targetOrigin);
    });
  }

  /* ===== VIEW + BACK ===== */

  function hideAllPanels() {
    Object.values(panels).forEach(x => x.classList.add('hidden'));
  }

  function renderView(view, panel = null) {
    stopSpeaking();

    if (panel !== 'camera') stopCamera();
    if (panel !== 'voice') stopRecording(false);

    Object.values(screens).forEach(x => x.classList.add('hidden'));
    hideAllPanels();

    state.view = view;
    state.panel = panel;

    if (view === 'result') {
      screens.result.classList.remove('hidden');
    } else if (view === 'loading') {
      screens.loading.classList.remove('hidden');
    } else {
      screens.home.classList.remove('hidden');
      if (panel && panels[panel]) panels[panel].classList.remove('hidden');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openPanel(panel) {
    history.pushState({ tc: 'panel', panel }, '', '#' + panel);
    renderView('home', panel);
  }

  function showResultWithSafeBack(result) {
    state.lastResult = result;
    renderResult(result);

    // Biến entry hiện tại thành HOME rồi thêm RESULT.
    // Vì vậy nút Back vật lý từ kết quả luôn quay về TinCheck Home,
    // không văng khỏi web ngay.
    history.replaceState({ tc: 'home' }, '', location.pathname + location.search);
    history.pushState({ tc: 'result' }, '', '#ket-qua');

    renderView('result');
  }

  window.addEventListener('popstate', event => {
    const s = event.state || { tc: 'home' };

    if (s.tc === 'result') {
      renderView('result');
      return;
    }

    if (s.tc === 'panel' && s.panel) {
      renderView('home', s.panel);

      if (s.panel === 'camera') startCamera(false);
      return;
    }

    renderView('home');
  });

  /* ===== EVENTS ===== */

  function bindEvents() {
    $('textBtn').addEventListener('click', () => {
      hideError('homeError');
      openPanel('text');
      setTimeout(() => $('textInput').focus(), 80);
    });

    $('voiceBtn').addEventListener('click', () => {
      hideError('homeError');
      openPanel('voice');
      startRecording();
    });

    $('speakAgainBtn').addEventListener('click', () => startRecording());
    $('stopRecordBtn').addEventListener('click', () => stopRecording(true));

    $('cameraBtn').addEventListener('click', () => {
      hideError('homeError');
      openPanel('camera');
      startCamera(true);
    });

    $('takePhotoBtn').addEventListener('click', capturePhoto);
    $('closeCameraBtn').addEventListener('click', () => history.back());

    $('galleryBtn').addEventListener('click', () => {
      hideError('homeError');
      $('galleryInput').value = '';
      $('galleryInput').click();
    });

    $('galleryInput').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        state.image = await compressImage(file);
        $('imagePreview').src = state.image.dataUrl;
        openPanel('image');
      } catch (err) {
        showError('homeError', err.message || 'Không đọc được ảnh.');
      }
    });

    $('chooseAgainBtn').addEventListener('click', () => {
      state.image = null;
      $('galleryInput').value = '';
      $('galleryInput').click();
    });

    $('checkImageBtn').addEventListener('click', () => {
      if (!state.image) {
        showError('homeError', 'Vui lòng chọn hoặc chụp ảnh trước.');
        return;
      }

      analyze({
        mode: 'image',
        imageBase64: state.image.base64,
        mimeType: state.image.mimeType,
        inputSource: 'image'
      });
    });

    $('checkTextBtn').addEventListener('click', () => {
      const text = $('textInput').value.trim();

      if (!text) {
        showError('homeError', 'Vui lòng dán nội dung hoặc đường link cần kiểm tra.');
        return;
      }

      analyze({ mode: 'text', text, inputSource: 'text' });
    });

    $('confirmVoiceBtn').addEventListener('click', () => {
      const text = $('voiceTranscript').textContent.trim();

      if (!text) {
        showError('homeError', 'TinCheck chưa có lời nói để kiểm tra.');
        return;
      }

      analyze({ mode: 'text', text, inputSource: 'voice' });
    });

    $('listenBtn').addEventListener('click', toggleSpeech);
    $('shareBtn').addEventListener('click', shareToFamily);

    [
      ['whyBtn', 'whyPanel'],
      ['sourceBtn', 'sourcePanel'],
      ['detailBtn', 'detailPanel']
    ].forEach(([b, p]) => {
      $(b).addEventListener('click', () => $(p).classList.toggle('hidden'));
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopCamera();
        if (state.panel === 'voice') stopRecording(false);
      }
    });
  }

  /* ===== CAMERA ===== */

  async function startCamera(showErrors = true) {
    stopCamera();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (showErrors) showError(
        'homeError',
        'Trình duyệt này chưa hỗ trợ mở camera trực tiếp. Bạn có thể dùng “Chọn ảnh có sẵn”.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      state.cameraStream = stream;
      $('cameraVideo').srcObject = stream;
      await $('cameraVideo').play();
    } catch (err) {
      if (showErrors) showError(
        'homeError',
        'Không mở được camera. Hãy cho phép quyền Camera trong trình duyệt rồi thử lại.'
      );
    }
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(t => t.stop());
      state.cameraStream = null;
    }

    if ($('cameraVideo')) $('cameraVideo').srcObject = null;
  }

  function capturePhoto() {
    const video = $('cameraVideo');

    if (!state.cameraStream || !video.videoWidth || !video.videoHeight) {
      showError('homeError', 'Camera chưa sẵn sàng. Vui lòng thử lại.');
      return;
    }

    const longSide = Math.max(video.videoWidth, video.videoHeight);
    const scale = Math.min(1, 1280 / longSide);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

    canvas.getContext('2d', { alpha: false })
      .drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.74);

    state.image = {
      dataUrl,
      mimeType: 'image/jpeg',
      base64: dataUrl.split(',')[1]
    };

    stopCamera();
    $('imagePreview').src = dataUrl;

    history.replaceState({ tc: 'panel', panel: 'image' }, '', '#image');
    renderView('home', 'image');
  }

  async function compressImage(file) {
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error('Tệp đã chọn không phải hình ảnh.');
    }

    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);

    const longSide = Math.max(img.width, img.height);
    const shortSide = Math.min(img.width, img.height);
    const ratio = longSide / Math.max(1, shortSide);
    const maxLong = ratio >= 1.75 ? 1800 : 1280;
    const scale = Math.min(1, maxLong / longSide);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));

    canvas.getContext('2d', { alpha: false })
      .drawImage(img, 0, 0, canvas.width, canvas.height);

    const compressed = canvas.toDataURL('image/jpeg', 0.74);

    return {
      dataUrl: compressed,
      mimeType: 'image/jpeg',
      base64: compressed.split(',')[1]
    };
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('Không đọc được ảnh.'));
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Ảnh không hợp lệ.'));
      img.src = src;
    });
  }

  /* ===== MICRO ===== */

  async function startRecording() {
    await stopRecording(false);
    resetVoiceUi();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('homeError', 'Trình duyệt này chưa hỗ trợ micro trực tiếp.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      state.micStream = stream;
      state.audioBuffers = [];
      state.recordStopping = false;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      state.audioContext = ctx;
      if (ctx.state === 'suspended') await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      state.audioSource = source;
      state.audioProcessor = processor;

      processor.onaudioprocess = e => {
        const input = e.inputBuffer.getChannelData(0);
        state.audioBuffers.push(new Float32Array(input));

        const output = e.outputBuffer.getChannelData(0);
        output.fill(0);
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      state.recordStart = Date.now();
      $('recordingBox').classList.remove('hidden');
      $('stopRecordBtn').classList.remove('hidden');

      updateRecordTimer();

      state.recordTimer = setInterval(updateRecordTimer, 250);
      state.recordAutoStop = setTimeout(
        () => stopRecording(true),
        Number(cfg.MAX_RECORD_SECONDS || 25) * 1000
      );
    } catch (err) {
      showError(
        'homeError',
        'Không mở được micro. Hãy cho phép quyền Micro trong trình duyệt rồi thử lại.'
      );
    }
  }

  function updateRecordTimer() {
    const max = Number(cfg.MAX_RECORD_SECONDS || 25);
    const elapsed = Math.min(max, Math.floor((Date.now() - state.recordStart) / 1000));
    $('recordingTimer').textContent = fmt(elapsed) + ' / ' + fmt(max);
  }

  async function stopRecording(transcribe) {
    if (state.recordStopping) return;
    state.recordStopping = true;

    clearInterval(state.recordTimer);
    clearTimeout(state.recordAutoStop);
    state.recordTimer = null;
    state.recordAutoStop = null;

    const chunks = state.audioBuffers.slice();
    const ctx = state.audioContext;
    const sourceRate = ctx ? ctx.sampleRate : 48000;

    if (state.audioProcessor) {
      try { state.audioProcessor.disconnect(); } catch (_) {}
      state.audioProcessor.onaudioprocess = null;
      state.audioProcessor = null;
    }

    if (state.audioSource) {
      try { state.audioSource.disconnect(); } catch (_) {}
      state.audioSource = null;
    }

    if (state.micStream) {
      state.micStream.getTracks().forEach(t => t.stop());
      state.micStream = null;
    }

    if (ctx) {
      try { await ctx.close(); } catch (_) {}
      state.audioContext = null;
    }

    $('recordingBox').classList.add('hidden');
    $('stopRecordBtn').classList.add('hidden');

    if (!transcribe) {
      state.recordStopping = false;
      return;
    }

    if (!chunks.length) {
      state.recordStopping = false;
      showError('homeError', 'TinCheck chưa thu được âm thanh. Vui lòng nói lại.');
      return;
    }

    $('transcribingBox').classList.remove('hidden');

    try {
      const merged = mergeFloat32(chunks);
      const down = downsample(merged, sourceRate, 16000);
      const wav = encodeWav(down, 16000);
      const audioBase64 = arrayBufferToBase64(wav);

      const result = await backendCall(
        'transcribeAudio',
        { audioBase64, mimeType: 'audio/wav' },
        65000
      );

      $('voiceTranscript').textContent = result.text || '';
      $('transcribingBox').classList.add('hidden');
      $('transcriptConfirm').classList.remove('hidden');
    } catch (err) {
      $('transcribingBox').classList.add('hidden');
      showError('homeError', err.message || 'Không nhận diện được giọng nói.');
    } finally {
      state.recordStopping = false;
    }
  }

  function resetVoiceUi() {
    hideError('homeError');
    $('recordingBox').classList.add('hidden');
    $('stopRecordBtn').classList.add('hidden');
    $('transcribingBox').classList.add('hidden');
    $('transcriptConfirm').classList.add('hidden');
    $('voiceTranscript').textContent = '';
  }

  function mergeFloat32(chunks) {
    const total = chunks.reduce((n, x) => n + x.length, 0);
    const out = new Float32Array(total);
    let off = 0;

    chunks.forEach(x => {
      out.set(x, off);
      off += x.length;
    });

    return out;
  }

  function downsample(buffer, inputRate, outputRate) {
    if (outputRate >= inputRate) return buffer;

    const ratio = inputRate / outputRate;
    const length = Math.round(buffer.length / ratio);
    const out = new Float32Array(length);

    let o = 0;
    let i = 0;

    while (o < length) {
      const next = Math.round((o + 1) * ratio);
      let sum = 0;
      let count = 0;

      for (let j = i; j < next && j < buffer.length; j++) {
        sum += buffer[j];
        count++;
      }

      out[o] = count ? sum / count : 0;
      o++;
      i = next;
    }

    return out;
  }

  function encodeWav(samples, sampleRate) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buf);

    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let off = 44;
    for (let i = 0; i < samples.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return buf;
  }

  function writeAscii(view, offset, text) {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, Math.min(i + chunk, bytes.length))
      );
    }

    return btoa(binary);
  }

  function fmt(seconds) {
    return String(Math.floor(seconds / 60)).padStart(2, '0') +
      ':' +
      String(seconds % 60).padStart(2, '0');
  }

  /* ===== ANALYSIS ===== */

  async function analyze(payload) {
    hideError('homeError');
    hideError('resultError');
    stopSpeaking();
    stopCamera();
    await stopRecording(false);

    // Ghi nhớ người dùng đang kiểm tra từ đâu để nếu lỗi thật sự
    // thì trả họ về đúng chỗ, không quăng về màn Home.
    const inputSource = String(payload && payload.inputSource || '').toLowerCase();
    const returnPanel =
      inputSource === 'text' ? 'text' :
      inputSource === 'voice' ? 'voice' :
      inputSource === 'image' ? 'image' :
      (state.panel || null);

    renderView('loading');

    try {
      const result = await backendCall('analyzeInput', payload, 120000);

      // CHỈ khi đã có kết quả thật sự mới dọn ô nhập.
      // Vì vậy quay lại từ màn kết quả luôn là một lượt kiểm tra mới, ô trống.
      if (inputSource === 'text' && $('textInput')) {
        $('textInput').value = '';
      }

      if (inputSource === 'voice' && $('voiceTranscript')) {
        $('voiceTranscript').textContent = '';
      }

      // Ảnh giữ trong state đến khi result render xong; sau đó mới bỏ
      // để lần kiểm tra tiếp theo không dính ảnh cũ.
      if (inputSource === 'image') {
        state.image = null;
        if ($('galleryInput')) $('galleryInput').value = '';
      }

      hideError('homeError');
      showResultWithSafeBack(result);

    } catch (err) {
      // Nếu retry nội bộ vẫn thất bại, KHÔNG xóa nội dung.
      // Trả đúng về panel cũ để người dùng chỉ cần bấm lại.
      renderView('home', returnPanel);

      const raw = String(err && err.message || '');
      const friendly =
        /chưa đọc được kết quả AI/i.test(raw)
          ? 'TinCheck đang gặp lỗi tạm thời khi đọc kết quả. Nội dung vẫn còn, vui lòng bấm kiểm tra lại.'
          : (raw || 'TinCheck chưa xử lý được nội dung. Nội dung vẫn còn, vui lòng thử lại.');

      showError('homeError', friendly);
    }
  }

  /* ===== RESULT ===== */

  const riskUi = {
    VERIFIED: { cls: 'risk-low', icon: '✅', level: 'ĐÃ XÁC MINH' },
    LOW: { cls: 'risk-low', icon: '🟢', level: 'CHƯA THẤY DẤU HIỆU ĐÁNG LO' },
    REVIEW: { cls: 'risk-review', icon: '🟠', level: 'CẦN KIỂM TRA THÊM' },
    HIGH: { cls: 'risk-high', icon: '🔴', level: 'CẢNH BÁO NGUY CƠ CAO' },
    INSUFFICIENT: { cls: 'risk-insufficient', icon: '🔵', level: 'CHƯA ĐỦ THÔNG TIN' }
  };

  function renderResult(r) {
    const ui = riskUi[r.risk] || riskUi.INSUFFICIENT;

    $('riskCard').className = 'risk-card ' + ui.cls;
    $('riskIcon').textContent = ui.icon;
    $('riskLevel').textContent = ui.level;
    $('riskHeadline').textContent = r.headline || '';

    const title = document.querySelector('.do-now-card h2');
    if (title) {
      title.textContent =
        r.risk === 'VERIFIED' ? 'Thông tin đã đối chiếu' :
        r.risk === 'LOW' ? 'Bạn có thể lưu ý' :
        r.risk === 'HIGH' ? 'Dừng lại và làm ngay' :
        r.risk === 'INSUFFICIENT' ? 'TinCheck cần thêm gì?' :
        'Bạn nên làm ngay';
    }

    const card = document.querySelector('.do-now-card');
    card.classList.remove('safe-card', 'info-card', 'warning-card');
    card.classList.add(
      (r.risk === 'VERIFIED' || r.risk === 'LOW')
        ? 'safe-card'
        : r.risk === 'INSUFFICIENT'
          ? 'info-card'
          : 'warning-card'
    );

    const why = $('whyBtn').querySelector('span:first-child');
    why.textContent =
      r.risk === 'INSUFFICIENT'
        ? '🔎 TinCheck còn thiếu thông tin gì?'
        : (r.risk === 'VERIFIED' || r.risk === 'LOW')
          ? '🔎 Vì sao TinCheck đánh giá như vậy?'
          : '🔎 Vì sao TinCheck cảnh báo?';

    const showShare = ['HIGH', 'REVIEW', 'INSUFFICIENT'].includes(r.risk);
    $('shareBtn').classList.toggle('hidden', !showShare);

    const actions = Array.isArray(r.actions) ? r.actions : [];
    $('actionList').innerHTML = actions.length
      ? actions.map(a => {
          const item = typeof a === 'string' ? { code: 'OTHER', text: a } : a;
          return `
            <div class="action-row">
              <span class="action-ico">${actionIcon(item.code)}</span>
              <span>${esc(item.text || '')}</span>
            </div>`;
        }).join('')
      : `
        <div class="action-row">
          <span class="action-ico">ℹ️</span>
          <span>${r.risk === 'VERIFIED' ? 'Thông tin đã được đối chiếu với nguồn chính thức.' : r.risk === 'LOW' ? 'Hiện chưa có lưu ý đặc biệt.' : 'Hãy cung cấp thêm thông tin hoặc kiểm tra nguồn trước khi quyết định.'}</span>
        </div>`;

    const reasons = Array.isArray(r.reasons) ? r.reasons : [];
    $('whyPanel').innerHTML = reasons.length
      ? reasons.map(x => `
          <div class="reason-row">
            <span>${reasonIcon(x.code)}</span>
            <span><strong>${esc(x.title)}</strong><br>${esc(x.detail)}</span>
          </div>`).join('')
      : '<div>Chưa có đủ dấu hiệu để giải thích chi tiết.</div>';

    const grounding = r.grounding || {};
    const hasGroundingSources = Array.isArray(grounding.sources) && grounding.sources.length > 0;
    renderGrounding(grounding);
    $('sourceBtn').classList.toggle('hidden', !hasGroundingSources);

    const imageDetailLine = String(r.inputMode || '').toLowerCase() === 'image'
      ? `<div class="detail-line">🖼️ <strong>Hình ảnh / chỉnh sửa:</strong> ${esc(r.syntheticAssessment || 'Chưa đủ cơ sở để đánh giá')}</div>`
      : '';

    const sourceDetailLine = hasGroundingSources && r.sourceAssessment
      ? `<div class="detail-line">🌐 <strong>Nguồn tin:</strong> ${esc(r.sourceAssessment)}</div>`
      : '';

    $('detailPanel').innerHTML = `
      ${sourceDetailLine}
      ${imageDetailLine}
      <div class="detail-line">${r.risk === 'HIGH' ? '⚠️' : 'ℹ️'} <strong>Hành động cần lưu ý:</strong> ${esc(r.intentAssessment || 'Chưa đánh giá')}</div>`;

    $('whyPanel').classList.add('hidden');
    $('sourcePanel').classList.add('hidden');
    $('detailPanel').classList.add('hidden');

    state.speaking = false;
    $('listenLabel').innerHTML = 'NGHE<br>KẾT QUẢ';
  }

  function renderGrounding(g) {
    const hasSources = Array.isArray(g.sources) && g.sources.length > 0;
    if (!hasSources) {
      $('sourcePanel').innerHTML = '';
      return;
    }

    let html = '';

    if (g.statusLabel) {
      html += `<div class="evidence-summary"><strong>${esc(g.statusLabel)}</strong></div>`;
    }

    if (g.summary) {
      html += `<div class="evidence-summary">${esc(g.summary)}</div>`;
    }

    if (Array.isArray(g.sources) && g.sources.length) {
      html += g.sources.map(s => {
        let domain = '';
        try { domain = s.domain || new URL(s.url).hostname; } catch (_) {}

        const name = s.displayName || s.title || s.url;
        const trust = s.whyTrusted || domain;

        return `
          <a class="source-link"
             href="${attr(s.url)}"
             target="_blank"
             rel="noopener noreferrer">
            🌐 <strong>${esc(name)}</strong>
            ${s.title && s.title !== name ? `<br>${esc(s.title)}` : ''}
            ${trust ? `<br><small>${esc(trust)}</small>` : ''}
          </a>`;
      }).join('');
    }

    $('sourcePanel').innerHTML = html;
  }

  function actionIcon(code) {
    const map = {
      DO_NOT_PAY: '💰',
      DO_NOT_SHARE_OTP: '🔐',
      DO_NOT_SHARE_PASSWORD: '🔐',
      DO_NOT_OPEN_LINK: '🔗',
      DO_NOT_INSTALL_APP: '📲',
      STOP_INTERACTION: '🛑',
      VERIFY_OFFICIAL_CHANNEL: '🏛️',
      CHECK_OFFICIAL_SOURCE: '🔎',
      DO_NOT_SHARE: '📣',
      DO_NOT_SELF_MEDICATE: '💊',
      DO_NOT_STOP_TREATMENT: '🩺',
      CONSULT_HEALTH_PROFESSIONAL: '👩‍⚕️',
      KEEP_EVIDENCE: '📌',
      ASK_TRUSTED_PERSON: '☎️',
      OTHER: 'ℹ️'
    };
    return map[code] || 'ℹ️';
  }

  function reasonIcon(code) {
    const map = {
      MONEY_TRANSFER: '💰', ADVANCE_FEE: '💰', WITHDRAWAL_FEE: '💰',
      OTP_REQUEST: '🔐', PASSWORD_REQUEST: '🔐', PERSONAL_DATA_REQUEST: '🪪',
      SUSPICIOUS_LINK: '🔗', URGENCY_PRESSURE: '⏰', UNKNOWN_SOURCE: '👤',
      IMPERSONATION: '🎭', INSTALL_UNKNOWN_APP: '📲', REMOTE_ACCESS: '📱',
      PRIZE_REWARD: '🎁', HIGH_RETURN: '📈', KEEP_SECRET: '🤫',
      SHARE_URGENCY: '📣', AI_OR_EDIT_ANOMALY: '✨', UNSUPPORTED_CLAIM: '❓',
      MEDICAL_CURE_ALL: '💊', MEDICAL_UNVERIFIED_CLAIM: '🩺',
      STOP_TREATMENT_ADVICE: '⛔', PRODUCT_WARNING: '⚠️'
    };
    return map[code] || '⚠️';
  }

  /* ===== SPEECH ===== */

  function initVoices() {
    if (!('speechSynthesis' in window)) return;

    const choose = () => {
      const voices = speechSynthesis.getVoices();
      state.preferredVoice =
        voices.find(v => /^vi(-|_)/i.test(v.lang || '')) ||
        voices.find(v => /vietnam/i.test(v.name || '')) ||
        null;
    };

    choose();
    speechSynthesis.addEventListener?.('voiceschanged', choose);
  }

  function toggleSpeech() {
    if (state.speaking) {
      stopSpeaking();
      return;
    }

    const r = state.lastResult;
    if (!r) return;

    if (!('speechSynthesis' in window)) {
      showError('resultError', 'Thiết bị này chưa hỗ trợ đọc kết quả thành tiếng.');
      return;
    }

    const text = String(
      r.speechText ||
      `${$('riskLevel').textContent}. ${$('riskHeadline').textContent}`
    ).trim();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN';
    u.rate = 0.88;
    u.pitch = 1;
    if (state.preferredVoice) u.voice = state.preferredVoice;

    u.onend = u.onerror = () => {
      state.speaking = false;
      $('listenLabel').innerHTML = 'NGHE<br>KẾT QUẢ';
    };

    speechSynthesis.cancel();
    state.speaking = true;
    $('listenLabel').innerHTML = 'DỪNG<br>ĐỌC';
    speechSynthesis.speak(u);
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    state.speaking = false;
    if ($('listenLabel')) $('listenLabel').innerHTML = 'NGHE<br>KẾT QUẢ';
  }

  /* ===== SHARE / ZALO ===== */

  async function shareToFamily() {
    const r = state.lastResult;
    if (!r || !['HIGH', 'REVIEW', 'INSUFFICIENT'].includes(r.risk)) return;

    const text = normalizeShareText(r.shareText);

    if (!text) {
      showError('resultError', 'TinCheck chưa tạo được nội dung gửi người thân.');
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({
          text
        });
        return;
      }

      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        showToast('Đã sao chép nội dung. Hãy mở Zalo, chọn người thân và dán để gửi.');
        return;
      }

      throw new Error('share-not-supported');
    } catch (err) {
      if (err && err.name === 'AbortError') return;

      try {
        await fallbackCopy(text);
        showToast('Đã sao chép nội dung. Hãy mở Zalo, chọn người thân và dán để gửi.');
      } catch (_) {
        showError(
          'resultError',
          'Thiết bị chưa mở được bảng chia sẻ. Bạn có thể sao chép nội dung kết quả và gửi qua Zalo.'
        );
      }
    }
  }

  function normalizeShareText(value) {
    return String(value || '')
      .replace(/\\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function fallbackCopy(text) {
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();

      const ok = document.execCommand('copy');
      ta.remove();

      ok ? resolve() : reject(new Error('copy-failed'));
    });
  }

  /* ===== HELPERS ===== */

  function showError(id, msg) {
    const el = $(id);
    el.textContent = msg || 'Đã có lỗi. Vui lòng thử lại.';
    el.classList.remove('hidden');
  }

  function hideError(id) {
    const el = $(id);
    el.textContent = '';
    el.classList.add('hidden');
  }

  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add('hidden'), 4200);
  }

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function attr(v) {
    return esc(v);
  }
})();
