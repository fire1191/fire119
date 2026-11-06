// 이 코드는 신청관리 스프레드시트에 연결된 Apps Script에서 실행합니다.
// 웹 방문자가 호출할 수 있는 업무 함수는 currentTraining, registerTraining뿐입니다.
const SHEET_ID = '1UX9CVlKfbV-XgInlxpDLvqK-ERvqyHzjPG-IXwuDblw';
const SITE_URL = 'https://leg2900-arch.github.io/fire-safety/';
const HEADERS_ = ['접수번호','교육ID','교육명','교육일자','이름','사번','소속','이메일','참여시간','신청일시','개인정보 안내','동의여부','요청ID'];

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.demo = e && e.parameter && e.parameter.demo === '1';
  return t.evaluate().setTitle('교직원 소방안전교육 신청')
    .addMetaTag('viewport','width=device-width, initial-scale=1');
}
function db_() { return SpreadsheetApp.openById(SHEET_ID); }
function config_() {
  const rows = db_().getSheetByName('교육설정').getRange('A2:B7').getValues();
  const c = {}; rows.forEach(function(row) { c[row[0]] = row[1]; });
  const date = c['교육일자'] instanceof Date
    ? Utilities.formatDate(c['교육일자'],'Asia/Seoul','yyyy-MM-dd') : String(c['교육일자']).trim();
  const sessions = String(c['참여시간']).split('\n').map(function(s){return s.trim();}).filter(Boolean);
  if (!c['교육ID'] || !String(c['교육명']).trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !sessions.length || sessions.length>10 || new Set(sessions).size!==sessions.length) {
    throw new Error('교육 설정을 확인해 주세요. 시설팀 내선 2087로 문의해 주세요.');
  }
  return {id:String(c['교육ID']),title:String(c['교육명']),event_date:date,sessions:sessions,
    privacy_notice:String(c['개인정보 안내']),is_open:String(c['접수상태']).trim()==='접수중'};
}
function currentTraining() { return config_(); }
function literal_(value) { return /^[=+\-@]/.test(value) ? "'"+value : value; }
function text_(value,max,label) {
  if(typeof value !== 'string') throw new Error(label+'을(를) 입력해 주세요.');
  const v=value.trim();
  if(!v || v.length>max || /[\x00-\x1f\x7f]/.test(v)) throw new Error(label+' 형식과 길이를 확인해 주세요.');
  return v;
}
function key_(employee) { return employee.normalize('NFKC').toUpperCase(); }
function responseSheet_() {
  const s=db_().getSheetByName('신청명단');
  if(!s || JSON.stringify(s.getRange(1,1,1,13).getValues()[0])!==JSON.stringify(HEADERS_)) throw new Error('신청 명단의 열 구성이 변경되었습니다. 담당자에게 문의해 주세요.');
  return s;
}
function registerTraining(p) {
  if(!p || p.p_consent!==true) throw new Error('개인정보 안내 확인 및 동의가 필요합니다.');
  const employee=text_(p.p_employee_id,30,'사번'),name=text_(p.p_name,50,'이름');
  const dept=text_(p.p_department,100,'소속'),email=text_(p.p_email,254,'이메일');
  const session=text_(p.p_session,100,'참여 시간'),eventId=text_(p.p_event_id,80,'교육 ID');
  const requestId=text_(p.p_request_id,80,'요청 ID');
  if(!/^[0-9a-f-]{36}$/i.test(requestId)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('요청 정보와 이메일 형식을 확인해 주세요.');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000)) throw new Error('신청이 몰리고 있습니다. 잠시 후 다시 눌러 주세요.');
  try {
    const sheet=responseSheet_(),last=sheet.getLastRow();
    const rows=last>1?sheet.getRange(2,1,last-1,13).getValues():[];
    for(let i=0;i<rows.length;i++) {
      const r=rows[i];
      if(String(r[12])===requestId) {
        if(String(r[1])===eventId&&String(r[4])===name&&String(r[5])===employee&&String(r[6])===dept&&String(r[7])===email&&String(r[8])===session) {
          return {created_at:new Date(r[9]).toISOString()};
        }
        throw new Error('전송 내용이 변경되었습니다. 처음부터 다시 신청해 주세요.');
      }
    }
    const t=config_();
    if(!t.is_open || t.id!==eventId) throw new Error('접수가 마감되었거나 교육이 변경되었습니다. 페이지를 다시 열어 주세요.');
    if(t.privacy_notice.length<20||t.privacy_notice.indexOf('[게시 전 수정 필요]')>=0) throw new Error('개인정보 안내를 준비 중입니다. 담당자에게 문의해 주세요.');
    if(t.sessions.indexOf(session)<0) throw new Error('신청 가능한 참여 시간을 선택해 주세요.');
    if(rows.some(function(r){return String(r[1])===eventId&&key_(String(r[5]))===key_(employee);})) throw new Error('접수 상태를 확인해 주세요. 이미 신청한 경우 시설팀 내선 2087로 문의해 주세요.');
    const now=new Date(),row=last+1;
    if(row>sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),100);
    const values=[Utilities.getUuid(),t.id,t.title,new Date(t.event_date+'T00:00:00+09:00'),name,employee,dept,email,session,now,t.privacy_notice,'동의',requestId];
    sheet.getRange(row,1,1,13).setNumberFormat('@').setValues([values.map(function(v){return typeof v==='string'?literal_(v):v;})]);
    sheet.getRange(row,4).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(row,10).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    SpreadsheetApp.flush();
    return {created_at:now.toISOString()};
  } finally { lock.releaseLock(); }
}

// 아래 관리자 기능은 끝에 _가 있어 google.script.run으로 호출할 수 없습니다.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('소방교육 관리')
    .addItem('현재 교육 엑셀 내려받기','exportCurrent_')
    .addSeparator().addItem('접수 열기','openRegistration_').addItem('접수 마감','closeRegistration_')
    .addItem('다음 교육 준비','nextTraining_')
    .addItem('신청 페이지 열기','showLink_').addToUi();
}
function setup_() {
  const ss=db_();ss.setSpreadsheetTimeZone('Asia/Seoul');
  responseSheet_();config_();onOpen();
  SpreadsheetApp.getUi().alert('연결 준비 완료. 웹 앱 배포 후 GitHub 연결 주소를 설정하세요. 현재 접수상태는 교육설정 탭에서 확인할 수 있습니다.');
}
function status_(value) {
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try { db_().getSheetByName('교육설정').getRange('B7').setValue(value);SpreadsheetApp.flush(); }
  finally { lock.releaseLock(); }
}
function openRegistration_() {
  const t=config_();
  if(t.privacy_notice.length<20||t.privacy_notice.indexOf('[게시 전 수정 필요]')>=0) throw new Error('교육설정 탭에서 개인정보 안내문을 먼저 확정해 주세요.');
  status_('접수중');SpreadsheetApp.getUi().alert('접수를 열었습니다.');
}
function closeRegistration_() { status_('마감');SpreadsheetApp.getUi().alert('접수를 마감했습니다.'); }
function nextTraining_() {
  const ui=SpreadsheetApp.getUi(),c=config_();
  if(c.is_open) { ui.alert('현재 교육 접수를 먼저 마감해 주세요.');return; }
  const title=ui.prompt('다음 교육','교육 제목을 입력하세요.',ui.ButtonSet.OK_CANCEL);if(title.getSelectedButton()!==ui.Button.OK)return;
  const date=ui.prompt('교육 날짜','YYYY-MM-DD 형식으로 입력하세요.',ui.ButtonSet.OK_CANCEL);if(date.getSelectedButton()!==ui.Button.OK)return;
  if(!title.getResponseText().trim()||!/^\d{4}-\d{2}-\d{2}$/.test(date.getResponseText()))throw new Error('제목과 날짜 형식을 확인해 주세요.');
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {const s=db_().getSheetByName('교육설정');s.getRange('B2:B4').setValues([[Utilities.getUuid()],[literal_(title.getResponseText().trim())],[new Date(date.getResponseText()+'T00:00:00+09:00')]]);s.getRange('B4').setNumberFormat('yyyy-mm-dd');s.getRange('B7').setValue('마감');SpreadsheetApp.flush();}
  finally{lock.releaseLock();}
  ui.alert('새 교육을 준비했습니다. 교육설정 탭에서 시간과 개인정보 안내를 확인하고 접수를 열어 주세요. 이전 명단은 그대로 보관됩니다.');
}
function showLink_() { SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput('<p><a href="'+SITE_URL+'" target="_blank" rel="noopener">소방교육 신청 페이지 열기</a></p>'),'신청 페이지'); }
function exportCurrent_() {
  const t=config_(),s=responseSheet_(),last=s.getLastRow();
  const rows=last>1?s.getRange(2,1,last-1,13).getValues():[];
  const data=rows.filter(function(r){return String(r[1])===t.id;}).map(function(r,i){return {'번호':i+1,'교육명':String(r[2]),'교육 일자':Utilities.formatDate(new Date(r[3]),'Asia/Seoul','yyyy-MM-dd'),'이름':String(r[4]),'사번':String(r[5]),'소속':String(r[6]),'이메일':String(r[7]),'참여 시간':String(r[8]),'신청 일시 (한국 시간)':Utilities.formatDate(new Date(r[9]),'Asia/Seoul','yyyy-MM-dd HH:mm:ss'),'개인정보 동의':String(r[11])};});
  const json=JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const html='<!doctype html><html lang="ko"><head><base target="_top"><script src="'+SITE_URL+'vendor/xlsx.full.min.js"></script></head><body style="font:14px sans-serif;padding:20px"><h3>현재 교육 신청 명단</h3><p>교육일: '+t.event_date+' · '+data.length+'명</p><button id="download" disabled style="padding:12px">엑셀 내려받기 (.xlsx)</button><p id="status">준비 중…</p><script>const rows='+json+';const b=document.getElementById("download"),s=document.getElementById("status");if(window.XLSX){b.disabled=false;s.textContent="아래 버튼으로 현재 교육 명단만 내려받습니다.";}else{s.textContent="엑셀 도구를 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요.";}b.onclick=()=>{const w=XLSX.utils.book_new();const headers=["번호","교육명","교육 일자","이름","사번","소속","이메일","참여 시간","신청 일시 (한국 시간)","개인정보 동의"];const sh=XLSX.utils.json_to_sheet(rows,{header:headers});sh["!cols"]=[6,45,14,18,18,25,35,25,30,18].map(wch=>({wch}));XLSX.utils.book_append_sheet(w,sh,"신청 명단");XLSX.writeFile(w,"소방교육-신청명단-'+t.event_date+'.xlsx");s.textContent="내려받기를 요청했습니다.";};</script></body></html>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(450).setHeight(260),'엑셀 내려받기');
}
