'use strict';
const $=id=>document.getElementById(id);
const demo=window.FIRE_DEMO===true||new URLSearchParams(location.search).get('demo')==='1';
let eventData,person,busy=false,attemptId,clockOffset=0,connectionHealthy=false,eventChanged=false;
const sample={id:'demo',title:'2026학년도 하반기 교직원 소방안전교육',event_date:'2026-11-24',sessions:['[1차] 10:00~11:00','[2차] 14:00~15:00'],privacy_notice:'수집·이용 주체 및 문의처: 아주대학교 시설팀 (내선 2087)\n수집 항목: 이름, 사번, 소속, 이메일, 교육 시간, 출석 등록 일시\n목적: 교육 출석 등록 및 참여 명단 관리\n보유 기간: 교육 종료 후 1개월\n동의하지 않으면 온라인 출석 등록이 어렵습니다.',registration_mode:'open',session_windows:[],is_open:true};
function dateLabel(value){return new Date(value+'T00:00:00+09:00').toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'short'});}
function attendanceMessage(message){
  if(message.includes('이미 신청한 경우'))return '이미 출석을 등록하셨다면 내 출석 내역 확인에서 확인해 주세요. 수정은 시설팀 내선 2087로 문의해 주세요.';
  return message.replaceAll('신청서','출석 등록 페이지').replaceAll('신청','출석 등록').replaceAll('접수','출석 등록');
}
async function rpc(name,data){
  const url=new URL(window.APP_CONFIG.appsScriptUrl);
  if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!url.pathname.endsWith('/exec'))throw new Error('출석 등록 페이지 연결 설정을 확인해 주세요.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
  try{
    const options={credentials:'omit',mode:'cors',cache:'no-store',redirect:'follow',referrerPolicy:'no-referrer',signal:controller.signal};
    if(name==='current_training'){url.searchParams.set('api','training');url.searchParams.set('_',Date.now().toString());}
    else if(name==='register_training'||name==='lookup_registration'){options.method='POST';options.headers={'Content-Type':'text/plain;charset=UTF-8'};options.body=JSON.stringify({action:name,data});}
    else throw new Error('허용되지 않은 요청입니다.');
    const response=await fetch(url.href,options);if(!response.ok)throw new Error('서버 연결을 확인해 주세요. 시설팀 내선 2087로 문의해 주세요.');
    let result;try{result=await response.json();}catch{throw new Error('출석 등록 페이지 연결을 준비 중입니다. 잠시 후 새로고침해 주세요.');}
    if(!result.ok)throw new Error(attendanceMessage(result.error||'요청을 처리하지 못했습니다.'));
    return result.data;
  }catch(error){if(error.name==='AbortError')throw new Error('응답이 지연되었습니다. 다시 누르면 같은 출석 내역을 중복 저장하지 않고 확인합니다.');throw error;}
  finally{clearTimeout(timer);}
}
function setMessage(value){$('message').textContent=value;}
function availableSessions(data,now){
  if(data.registration_mode==='open')return data.sessions;
  if(data.registration_mode!=='auto'||data.schedule_error)return [];
  return (data.session_windows||[]).filter(w=>now>=Date.parse(w.opens_at)&&now<Date.parse(w.closes_at)).map(w=>w.session);
}
function applyAvailability(){
  if(!eventData)return;
  const allowed=connectionHealthy&&!eventChanged?availableSessions(eventData,Date.now()+clockOffset):[];
  $('enter').disabled=!allowed.length;$('submit').disabled=busy||!allowed.length;
  document.querySelectorAll('input[name=session]').forEach(input=>{input.disabled=!allowed.includes(input.value);if(input.disabled)input.checked=false;input.closest('label').style.opacity=input.disabled?'.55':'1';});
  if(!$('success').hidden)return;
  let text='';
  if(eventChanged)text='교육 정보가 변경되었습니다. 페이지를 새로고침해 주세요.';
  else if(!connectionHealthy)text='연결 상태를 확인 중입니다. 잠시 후 새로고침해 주세요.';
  else if(eventData.registration_mode==='closed')text='현재 출석 등록을 받지 않습니다.';
  else if(eventData.schedule_error)text='등록 시간표를 확인 중입니다. 시설팀 내선 2087로 문의해 주세요.';
  else if(!allowed.length)text='현재 출석 등록 시간이 아닙니다. 교육 당일의 등록 가능 시간을 확인해 주세요.';
  $('banner').hidden=!text&&!demo;$('banner').textContent=demo?'화면 미리보기 · 입력 내용은 저장되거나 전송되지 않습니다.':text;
}
function renderTraining(){
  $('title').textContent=eventData.title.split('|').map(s=>s.trim()).join('\n');document.title=eventData.title.replace(/\s*\|\s*/g,' ')+' · 출석 등록';
  $('date').textContent=dateLabel(eventData.event_date);$('times').textContent=eventData.sessions.join(' · ');$('privacy').textContent=eventData.privacy_notice;
  $('registration-hours').textContent=(eventData.session_windows||[]).length?'출석 등록 가능 시간 · 교육 당일 (한국시간)\n'+eventData.session_windows.map((w,i)=>(i+1)+'차 '+w.start_time+'~'+w.end_time).join(' / '):'';
  const existing=Array.from(document.querySelectorAll('input[name=session]')).map(el=>el.value);
  if(JSON.stringify(existing)!==JSON.stringify(eventData.sessions)){
    $('session-options').replaceChildren();eventData.sessions.forEach((session,index)=>{const label=document.createElement('label');label.className='session';const input=document.createElement('input');input.type='radio';input.name='session';input.value=session;input.required=true;input.id='session-'+index;label.append(input,document.createTextNode(session));$('session-options').append(label);});
  }
  applyAvailability();
}
let refreshing=false;
async function refreshTraining(){
  if(refreshing)return;refreshing=true;
  try{
    const data=demo?sample:await rpc('current_training',{});if(!data)throw new Error('교육 정보가 없습니다.');
    if(eventData&&eventData.id!==data.id){eventChanged=true;applyAvailability();return;}
    if(eventData&&eventData.privacy_notice!==data.privacy_notice)$('consent').checked=false;
    const serverMs=Date.parse(data.server_time);if(Number.isFinite(serverMs))clockOffset=serverMs-Date.now();
    eventData=data;connectionHealthy=true;renderTraining();
  }catch(error){connectionHealthy=false;if(!eventData)setMessage('교육 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');applyAvailability();}
  finally{refreshing=false;}
}
$('identity').addEventListener('submit',e=>{
  e.preventDefault();applyAvailability();if($('enter').disabled)return;
  const employee=$('employee').value.trim(),name=$('name').value.trim();
  if(!employee||!name){setMessage('사번과 이름을 모두 입력해 주세요.');return;}
  if(!/^\d{9}$/.test(employee)){setMessage('사번은 숫자 9자리로 입력해 주세요.');return;}
  person={employee,name};attemptId=crypto.randomUUID();$('greeting').textContent=name;$('identity').hidden=true;$('registration').hidden=false;$('step1').classList.remove('active');$('step2').classList.add('active');setMessage('');$('department').focus();
});
$('back').addEventListener('click',()=>{$('registration').hidden=true;$('identity').hidden=false;$('step1').classList.add('active');$('step2').classList.remove('active');setMessage('');$('employee').focus();});
$('registration').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;applyAvailability();if($('submit').disabled)return;
  const department=$('department').value.trim(),selected=document.querySelector('input[name=session]:checked');
  if(!person||!department||!selected||!$('consent').checked){setMessage('필수 항목을 모두 입력해 주세요.');return;}
  busy=true;$('submit').disabled=true;$('submit').textContent='등록 중…';setMessage('');
  try{
    const payload={p_event_id:eventData.id,p_employee_id:person.employee,p_name:person.name,p_department:department,p_email:$('email').value.trim(),p_session:selected.value,p_consent:true,p_request_id:attemptId};
    const result=demo?{created_at:new Date().toISOString()}:await rpc('register_training',payload);
    $('registration').hidden=true;$('steps').hidden=true;$('success').hidden=false;$('banner').hidden=true;
    $('receipt-name').textContent=person.name+' · '+department;$('receipt-date').textContent=dateLabel(eventData.event_date);$('receipt-session').textContent=selected.value;$('receipt-time').textContent=new Date(result.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
    if(demo){$('success-title').textContent='출석 등록 화면 체험이 끝났습니다.';$('success-description').textContent='미리보기이므로 실제 출석 내역은 저장되지 않았습니다.';}
    $('success').focus();$('identity').reset();$('registration').reset();person=null;
  }catch(error){setMessage(error.message);void refreshTraining();}
  finally{busy=false;$('submit').textContent='출석 등록하기 →';applyAvailability();}
});
$('reset').addEventListener('click',()=>{$('success').hidden=true;$('identity').hidden=false;$('steps').hidden=false;$('step1').classList.add('active');$('step2').classList.remove('active');person=null;attemptId=null;setMessage('');applyAvailability();$('employee').focus();});
$('lookup').addEventListener('click',async()=>{
  const employee=$('employee').value.trim(),name=$('name').value.trim();
  if(!employee||!name){setMessage('사번과 이름을 입력해 주세요.');return;}
  if(!/^\d{9}$/.test(employee)){setMessage('사번은 숫자 9자리로 입력해 주세요.');return;}
  if(demo){setMessage('미리보기에서는 실제 출석 내역을 조회하지 않습니다.');return;}
  setMessage('확인 중…');$('lookup').disabled=true;
  try{const r=await rpc('lookup_registration',{p_employee_id:employee,p_name:name});setMessage(r?'출석 내역\n'+r.name+'\n'+dateLabel(r.event_date)+'\n'+r.session+'\n출석 등록 일시: '+new Date(r.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'출석 내역이 없어요.\n사번과 이름을 다시 확인해 주세요.');}
  catch(error){setMessage(error.message);}finally{$('lookup').disabled=false;}
});
void refreshTraining();setInterval(applyAvailability,1000);
if(!demo){setInterval(()=>{if(!document.hidden)void refreshTraining();},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshTraining();});}
