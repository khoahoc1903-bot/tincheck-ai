(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { image:null,lastResult:null,speaking:false,recognition:null,inputMode:'none',voiceFinal:'' };
  const screens={home:$('homeScreen'),loading:$('loadingScreen'),result:$('resultScreen')};
  const panels={text:$('textPanel'),voice:$('voicePanel'),image:$('imagePanel')};
  const chooser=$('inputActions');
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition||null;

  function showScreen(name){
    Object.values(screens).forEach(x=>x&&x.classList.add('hidden'));
    screens[name]&&screens[name].classList.remove('hidden');
    window.scrollTo({top:0,behavior:'smooth'});
  }

  // TinCheck chỉ dùng nút Back cứng / gesture Back của điện thoại.
  // Mỗi lượt kiểm tra chỉ tạo 1 mốc history nội bộ:
  // HOME -> WORK/RESULT. Vì RESULT thay thế WORK nên bấm Back 1 lần
  // luôn quay về HOME và xóa dữ liệu, không hiện nút quay lại riêng.
  function ensureHomeHistory(){
    const st=history.state||{};
    if(!st.tincheck){
      history.replaceState({tincheck:'home'},'',location.pathname+location.search);
    }
  }
  function enterWorkHistory(mode){
    const st=history.state||{};
    if(st.tincheck==='work'){
      history.replaceState({tincheck:'work',mode},'', '#nhap');
      return;
    }
    if(st.tincheck==='result'){
      history.replaceState({tincheck:'work',mode},'', '#nhap');
      return;
    }
    history.pushState({tincheck:'work',mode},'', '#nhap');
  }
  function enterResultHistory(){
    const st=history.state||{};
    if(st.tincheck==='work'||st.tincheck==='result'){
      history.replaceState({tincheck:'result'},'', '#ket-qua');
    }else{
      history.pushState({tincheck:'result'},'', '#ket-qua');
    }
  }
  function hideError(id){const b=$(id);if(!b)return;b.textContent='';b.classList.add('hidden')}
  function showError(id,msg){const b=$(id);if(!b)return;b.textContent=friendlyError(msg);b.classList.remove('hidden');b.scrollIntoView({behavior:'smooth',block:'nearest'})}
  function friendlyError(msg){
    const s=String(msg||'').trim();
    if(/Jina|Gemini|UrlFetch|HTTP\s*\d+|\b422\b|\b429\b|\b503\b|RESOURCE_EXHAUSTED|UNAVAILABLE|fetch|network|socket/i.test(s)) return 'TinCheck chưa kiểm tra được nguồn lúc này. Vui lòng thử lại sau một lát.';
    if(/xử lý quá lâu|timeout|timed out/i.test(s)) return 'TinCheck chưa hoàn tất kiểm tra. Vui lòng thử lại.';
    return s||'TinCheck đang gặp lỗi tạm thời. Vui lòng thử lại.';
  }
  function hidePanels(){Object.values(panels).forEach(p=>p&&p.classList.add('hidden'));hideError('homeError')}
  function stopRecognition(){if(state.recognition){try{state.recognition.abort()}catch(e){}state.recognition=null}}
  function openMode(mode,manageHistory=true){
    stopRecognition();hidePanels();chooser&&chooser.classList.add('hidden');state.inputMode=mode;
    if(manageHistory)enterWorkHistory(mode);
    const p=panels[mode];if(p){p.classList.remove('hidden');setTimeout(()=>p.scrollIntoView({behavior:'smooth',block:'start'}),60)}
    if(mode==='text')setTimeout(()=>$('textInput')&&$('textInput').focus(),120);
  }
  function resetHome(){
    stopRecognition();stopSpeaking();state.inputMode='none';state.image=null;state.voiceFinal='';state.lastResult=null;
    hidePanels();chooser&&chooser.classList.remove('hidden');
    if($('textInput'))$('textInput').value='';if($('voiceTranscript'))$('voiceTranscript').value='';
    if($('imagePreview'))$('imagePreview').removeAttribute('src');
    if($('cameraInput'))$('cameraInput').value='';if($('galleryInput'))$('galleryInput').value='';
    showScreen('home');
  }
$('textBtn').addEventListener('click',()=>openMode('text'));
  $('cameraBtn').addEventListener('click',()=>{$('cameraInput').click()});
  $('galleryBtn').addEventListener('click',()=>{$('galleryInput').click()});
  $('cameraInput').addEventListener('change',e=>handleImageFile(e.target.files&&e.target.files[0]));
  $('galleryInput').addEventListener('change',e=>handleImageFile(e.target.files&&e.target.files[0]));

  async function handleImageFile(file){
    if(!file)return;if(!file.type.startsWith('image/')){showError('homeError','Tệp đã chọn không phải hình ảnh.');return}
    try{const compressed=await compressImageForTinCheck(file);state.image=compressed;$('imagePreview').src=compressed.dataUrl;openMode('image')}
    catch(e){showError('homeError','Không đọc được ảnh. Vui lòng thử ảnh khác.')}
  }
  function compressImageForTinCheck(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>{const img=new Image();img.onerror=reject;img.onload=()=>{let w=img.width,h=img.height;const long=Math.max(w,h),short=Math.min(w,h),ratio=long/Math.max(1,short);const max=ratio>=1.75?1800:1280,scale=Math.min(1,max/long);w=Math.max(1,Math.round(w*scale));h=Math.max(1,Math.round(h*scale));const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{alpha:false});ctx.drawImage(img,0,0,w,h);const dataUrl=c.toDataURL('image/jpeg',.76);resolve({dataUrl,mimeType:'image/jpeg',base64:dataUrl.split(',')[1]})};img.src=r.result};r.readAsDataURL(file)})}
  $('chooseAgainBtn').addEventListener('click',()=>{state.image=null;$('galleryInput').value='';$('galleryInput').click()});
  $('checkImageBtn').addEventListener('click',()=>{if(!state.image){showError('homeError','Vui lòng chọn hoặc chụp ảnh trước.');return}analyze({mode:'image',imageBase64:state.image.base64,mimeType:state.image.mimeType})});
  $('checkTextBtn').addEventListener('click',()=>{const text=$('textInput').value.trim();if(!text){showError('homeError','Vui lòng nhập nội dung cần kiểm tra.');return}analyze({mode:'text',text})});

  $('voiceBtn').addEventListener('click',startVoice);
  $('speakAgainBtn').addEventListener('click',startVoice);
  function startVoice(){
    hideError('homeError');openMode('voice');const status=$('voiceStatus'),box=$('voiceTranscript');box.value='';state.voiceFinal='';
    if(!Recognition){status.textContent='Trình duyệt này chưa hỗ trợ nhận giọng nói nhanh. Hãy dùng Dán nội dung hoặc Chụp ảnh.';showError('homeError','Thiết bị này chưa hỗ trợ nhận giọng nói nhanh.');return}
    const rec=new Recognition();state.recognition=rec;rec.lang='vi-VN';rec.interimResults=true;rec.continuous=false;rec.maxAlternatives=1;
    status.textContent='🎤 Đang nghe... Bạn cứ nói tự nhiên.';let finalText='';
    rec.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=String(e.results[i][0].transcript||'').trim();if(!t)continue;if(e.results[i].isFinal)finalText+=(finalText?' ':'')+t;else interim+=(interim?' ':'')+t}box.value=(finalText||interim).trim()};
    rec.onerror=e=>{const er=String(e&&e.error||'');state.recognition=null;if(er==='not-allowed'||er==='service-not-allowed'){status.textContent='Micro đang bị chặn. Hãy cho phép quyền micro rồi bấm NÓI LẠI.'}else{status.textContent='TinCheck chưa nghe rõ. Bấm NÓI LẠI để thử lại.'}};
    rec.onend=()=>{state.recognition=null;const t=(finalText||box.value||'').trim();if(t){state.voiceFinal=t;box.value=t;status.textContent='TinCheck đã nghe xong. Bạn có thể sửa chữ nếu cần rồi bấm KIỂM TRA.'}else if(!/bị chặn|chưa nghe rõ/i.test(status.textContent)){status.textContent='TinCheck chưa nghe rõ. Bấm NÓI LẠI để thử lại.'}};
    try{rec.start()}catch(e){state.recognition=null;status.textContent='Không thể mở micro lúc này. Bấm NÓI LẠI để thử lại.'}
  }
  $('confirmVoiceBtn').addEventListener('click',()=>{const text=$('voiceTranscript').value.trim();if(!text){showError('homeError','TinCheck chưa nghe rõ nội dung. Vui lòng nói lại.');return}analyze({mode:'text',text})});

  function getBackendUrl(){
    const c=window.TINCHECK_CONFIG||{};
    return String(c.APPS_SCRIPT_URL||c.BACKEND_URL||c.WEB_APP_URL||c.backendUrl||c.appsScriptUrl||c.scriptUrl||c.url||'').trim();
  }
  function uid(){return (crypto&&crypto.randomUUID)?crypto.randomUUID():('tc_'+Date.now()+'_'+Math.random().toString(36).slice(2))}
  function rpc(action,payload,timeoutMs){return new Promise((resolve,reject)=>{
    const url=getBackendUrl();if(!url){reject(new Error('Chưa cấu hình địa chỉ kết nối TinCheck.'));return}
    const requestId=uid(),token=uid()+uid(),frameName='tc_frame_'+requestId.replace(/[^a-zA-Z0-9_]/g,'');
    const iframe=document.createElement('iframe');iframe.name=frameName;iframe.style.display='none';iframe.setAttribute('aria-hidden','true');document.body.appendChild(iframe);
    const form=document.createElement('form');form.method='POST';form.action=url;form.target=frameName;form.style.display='none';
    const fields={tc_request_id:requestId,tc_channel_token:token,tc_origin:location.origin,tc_action:action,tc_payload:JSON.stringify(payload||{})};
    Object.entries(fields).forEach(([k,v])=>{const i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;form.appendChild(i)});document.body.appendChild(form);
    let done=false;const cleanup=()=>{window.removeEventListener('message',onMessage);clearTimeout(timer);try{form.remove()}catch(e){}setTimeout(()=>{try{iframe.remove()}catch(e){}},100)};
    const onMessage=e=>{const d=e.data;if(!d||d.type!=='tincheck-response'||d.requestId!==requestId||d.channelToken!==token)return;done=true;cleanup();if(d.ok)resolve(d.result);else reject(new Error(d.error||'TinCheck đang gặp lỗi tạm thời.'))};window.addEventListener('message',onMessage);
    const timer=setTimeout(()=>{if(done)return;cleanup();reject(new Error('TinCheck xử lý quá lâu. Vui lòng thử lại.'))},timeoutMs||90000);
    form.submit();
  })}

  async function analyze(payload){
    hideError('homeError');hideError('resultError');stopSpeaking();showScreen('loading');
    const title=$('loadingTitle'),note=$('loadingNote');title.textContent='TinCheck đang kiểm tra...';note.textContent='Đang đọc nội dung và đối chiếu nguồn khi cần.';
    const slowTimer=setTimeout(()=>{if(!screens.loading.classList.contains('hidden'))note.textContent='TinCheck đang đối chiếu nguồn. Một số nguồn có thể phản hồi chậm hơn bình thường.'},22000);
    try{const result=await rpc('analyzeInput',payload,90000);clearTimeout(slowTimer);state.lastResult=result;renderResult(result);enterResultHistory();showScreen('result')}
    catch(e){clearTimeout(slowTimer);showScreen('home');if(state.inputMode==='voice')openMode('voice',false);else if(state.inputMode==='image'&&state.image)openMode('image',false);else if(state.inputMode==='text')openMode('text',false);showError('homeError',e&&e.message?e.message:String(e))}
  }

  const riskUi={VERIFIED:{cls:'risk-low',icon:'✅',level:'ĐÃ XÁC MINH'},HIGH:{cls:'risk-high',icon:'🔴',level:'NGUY CƠ CAO'},REVIEW:{cls:'risk-review',icon:'🟠',level:'CẦN KIỂM TRA THÊM'},LOW:{cls:'risk-low',icon:'🟢',level:'CHƯA THẤY DẤU HIỆU ĐÁNG LO'},INSUFFICIENT:{cls:'risk-insufficient',icon:'🔵',level:'CHƯA ĐỦ THÔNG TIN'}};
  function renderResult(r){
    const ui=riskUi[r.risk]||riskUi.INSUFFICIENT,card=$('riskCard');card.className='risk-card '+ui.cls;$('riskIcon').textContent=ui.icon;$('riskLevel').textContent=ui.level;$('riskHeadline').textContent=r.headline||'';
    const t=document.querySelector('.do-now-card h2');if(t)t.textContent=r.risk==='VERIFIED'?'Thông tin đã đối chiếu':r.risk==='LOW'?'Bạn có thể lưu ý':r.risk==='HIGH'?'Dừng lại và làm ngay':r.risk==='INSUFFICIENT'?'TinCheck cần thêm gì?':'Bạn nên làm ngay';
    const share=['HIGH','REVIEW'].includes(r.risk);$('shareBtn').classList.toggle('hidden',!share);$('shareBtn').textContent='💬 MỞ ZALO GỬI NGƯỜI THÂN';
    const actions=Array.isArray(r.actions)?r.actions:[];$('actionList').innerHTML=actions.length?actions.map(a=>{const x=typeof a==='string'?{code:'OTHER',text:a}:a;return `<div class="action-row"><span class="action-ico">${actionIcon(x.code)}</span><span>${esc(x.text||'')}</span></div>`}).join(''):'<div class="action-row"><span class="action-ico">ℹ️</span><span>Hãy kiểm tra thêm trước khi quyết định.</span></div>';
    const reasons=Array.isArray(r.reasons)?r.reasons:[];$('whyPanel').innerHTML=reasons.length?reasons.map(x=>`<div class="reason-row"><span>${reasonIcon(x.code)}</span><span><strong>${esc(x.title||'')}</strong><br>${esc(x.detail||'')}</span></div>`).join(''):'<div>Chưa có thêm giải thích.</div>';
    renderGrounding(r.grounding||{});$('detailPanel').innerHTML=`<div class="detail-line">🌐 <strong>Nguồn tin:</strong> ${esc(r.sourceAssessment||'Chưa đánh giá')}</div><div class="detail-line">🖼️ <strong>Hình ảnh / chỉnh sửa:</strong> ${esc(r.syntheticAssessment||'Chưa đánh giá')}</div><div class="detail-line">ℹ️ <strong>Hành động cần lưu ý:</strong> ${esc(r.intentAssessment||'Chưa đánh giá')}</div>`;
    $('listenLabel').innerHTML='NGHE<br>KẾT QUẢ';state.speaking=false;
  }
  function renderGrounding(g){let html='';if(g.statusLabel)html+=`<div class="evidence-summary"><strong>${esc(g.statusLabel)}</strong></div>`;if(g.summary)html+=`<div class="evidence-summary">${esc(g.summary)}</div>`;if(Array.isArray(g.sources)&&g.sources.length){html+=g.sources.map(s=>{let domain='';try{domain=s.domain||new URL(s.url).hostname}catch(e){};const display=s.displayName||s.title||s.url;return `<a class="source-link" href="${attr(s.url)}" target="_blank" rel="noopener noreferrer">🌐 <strong>${esc(display)}</strong>${s.title&&s.title!==display?`<br>${esc(s.title)}`:''}${domain?`<br><small>${esc(domain)}</small>`:''}</a>`}).join('')}else if(g.evidenceStatus==='NO_EVIDENCE')html+='<div>Chưa tìm thấy nguồn trực tiếp đủ mạnh để xác minh nội dung này.</div>';else if(g.evidenceStatus==='SEARCH_ERROR')html+='<div>TinCheck chưa đối chiếu được nguồn lúc này.</div>';else if(g.evidenceStatus==='NOT_SEARCHED')html+='<div>Trường hợp này chưa cần tra cứu web.</div>';$('sourcePanel').innerHTML=html}
  function actionIcon(c){return ({DO_NOT_PAY:'💰',DO_NOT_SHARE_OTP:'🔐',DO_NOT_SHARE_PASSWORD:'🔐',DO_NOT_OPEN_LINK:'🔗',DO_NOT_INSTALL_APP:'📲',STOP_INTERACTION:'🛑',VERIFY_OFFICIAL_CHANNEL:'🏛️',CHECK_OFFICIAL_SOURCE:'🔎',DO_NOT_SHARE:'📣',DO_NOT_SELF_MEDICATE:'💊',DO_NOT_STOP_TREATMENT:'🩺',CONSULT_HEALTH_PROFESSIONAL:'👩‍⚕️',KEEP_EVIDENCE:'📌',ASK_TRUSTED_PERSON:'☎️',OTHER:'ℹ️'})[c]||'ℹ️'}
  function reasonIcon(c){return ({MONEY_TRANSFER:'💰',ADVANCE_FEE:'💰',WITHDRAWAL_FEE:'💰',OTP_REQUEST:'🔐',PASSWORD_REQUEST:'🔐',PERSONAL_DATA_REQUEST:'🪪',SUSPICIOUS_LINK:'🔗',URGENCY_PRESSURE:'⏰',UNKNOWN_SOURCE:'👤',IMPERSONATION:'🎭',INSTALL_UNKNOWN_APP:'📲',REMOTE_ACCESS:'📱',PRIZE_REWARD:'🎁',HIGH_RETURN:'📈',KEEP_SECRET:'🤫',SHARE_URGENCY:'📣',AI_OR_EDIT_ANOMALY:'✨',UNSUPPORTED_CLAIM:'❓',MEDICAL_CURE_ALL:'💊',MEDICAL_UNVERIFIED_CLAIM:'🩺',STOP_TREATMENT_ADVICE:'⛔',PRODUCT_WARNING:'⚠️'})[c]||'⚠️'}

  $('listenBtn').addEventListener('click',()=>{if(state.speaking){stopSpeaking();return}const r=state.lastResult;if(!r)return;if(!('speechSynthesis'in window)){showError('resultError','Thiết bị này chưa hỗ trợ đọc kết quả thành tiếng.');return}const u=new SpeechSynthesisUtterance(r.speechText||`${$('riskLevel').textContent}. ${$('riskHeadline').textContent}`);u.lang='vi-VN';u.rate=.9;u.pitch=1;u.onend=u.onerror=()=>{state.speaking=false;$('listenLabel').innerHTML='NGHE<br>KẾT QUẢ'};state.speaking=true;$('listenLabel').innerHTML='DỪNG<br>ĐỌC';speechSynthesis.cancel();speechSynthesis.speak(u)});
  function stopSpeaking(){if('speechSynthesis'in window)speechSynthesis.cancel();state.speaking=false;if($('listenLabel'))$('listenLabel').innerHTML='NGHE<br>KẾT QUẢ'}

  $('shareBtn').addEventListener('click',async()=>{const r=state.lastResult;if(!r)return;const text=r.shareText||[riskUi[r.risk]?.level||'KẾT QUẢ TINCHECK',r.headline||'',...(r.actions||[]).slice(0,2).map(a=>'• '+(typeof a==='string'?a:a.text))].join('\n');try{if(navigator.share)await navigator.share({title:'TinCheck AI',text,url:location.href.split('#')[0]});else{await navigator.clipboard.writeText(text);showError('resultError','Đã sao chép nội dung. Mở Zalo và dán để gửi người thân.')}}catch(e){if(e&&e.name!=='AbortError')showError('resultError','Chưa mở được chức năng chia sẻ. Vui lòng thử lại.')}});
  [['whyBtn','whyPanel'],['sourceBtn','sourcePanel'],['detailBtn','detailPanel']].forEach(([b,p])=>$(b).addEventListener('click',()=>$(p).classList.toggle('hidden')));
  window.addEventListener('popstate',()=>{
    // Back cứng/gesture Back: quay về màn hình chọn cách kiểm tra và xóa dữ liệu.
    resetHome();
  });

  ensureHomeHistory();
  function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
  function attr(v){return esc(v)}
})();
