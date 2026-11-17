'use strict';
const main=document.getElementById('main'),view=document.getElementById('view'),loginPanel=document.getElementById('loginPanel'),profile=document.getElementById('profile'),role=document.getElementById('role'),live=document.getElementById('live');
let actor=null, activeAttendance=null;
function hasUnsavedAttendance() {
  if (!activeAttendance) return false;
  const { draft, saved } = activeAttendance;
  return Object.keys(draft).length !== Object.keys(saved).length
    || Object.entries(draft).some(([id, mark]) => mark !== saved[id]);
}
function confirmDiscardAttendance() {
  return !hasUnsavedAttendance()
    || window.confirm('Existem marcações não salvas. Deseja sair da chamada e descartar essas alterações?');
}
function lockAttendanceControls() {
  const controls = [document.getElementById('logout'), ...view.querySelectorAll('[data-student], #backBtn')];
  const previous = controls.map(control => ({ control, disabled: control.disabled }));
  controls.forEach(control => { control.disabled = true; });
  return () => previous.forEach(({ control, disabled }) => { control.disabled = disabled; });
}
window.addEventListener('beforeunload', event => {
  if (!hasUnsavedAttendance()) return;
  event.preventDefault();
  event.returnValue = '';
});
const fmt=(d)=>d.split('-').reverse().join('/');
const escapeHtml=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){
  const res=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});
  const data=await res.json();
  if(!res.ok)throw new Error(data.error||`Erro ${res.status}`);
  return data;
}
function alertMessage(message,isError=false){live.hidden=false;live.textContent=message;live.className='status'+(isError?' error':'');live.focus?.();}
function clearMessage(){live.hidden=true;live.textContent='';}
function render(html){clearMessage();view.innerHTML=html;view.hidden=false;loginPanel.hidden=true;profile.hidden=false;role.textContent=actor.display;main.focus();}
async function renderMenu(){
  const currentActor = actor;
  const meetings=await api('/api/encounters');
  if (actor !== currentActor) return;
  if(actor.role!=='educadora')return renderReport();
  activeAttendance = null;
  render(`<div class="topline"><div><h1>Menu inicial — Chamadas</h1><p>Bem-vinda! Selecione a oficina para registrar ou corrigir a frequência.</p></div><span class="badged">Perfil: Educadora</span></div><section><h2>Encontros da Turma Ipiranga</h2><div class="tilegrid">${meetings.map(e=>`<article class="tile"><h2>${escapeHtml(e.workshop)}</h2><div>${escapeHtml(e.className)}</div><div class="meta">${fmt(e.date)} · ${e.time}</div><span class="badged ${e.status==='Concluída'?'done':''}">${e.status}</span><button data-meeting="${e.id}" class="primary">${e.status==='Concluída'?'Reabrir chamada':'Abrir chamada'}</button></article>`).join('')}</div></section>`);
  view.querySelectorAll('[data-meeting]').forEach(button => {
    button.addEventListener('click', () => {
      renderAttendance(button.dataset.meeting).catch(error => {
        if (actor !== currentActor || !button.isConnected) return;
        alertMessage('Não foi possível abrir a chamada. ' + error.message, true);
      });
    });
  });
}
async function renderAttendance(id){
  const currentActor = actor;
  const d=await api(`/api/encounters/${encodeURIComponent(id)}/attendance`);
  if (actor !== currentActor) return;
  const state = { draft: { ...d.attendance }, saved: { ...d.attendance } };
  activeAttendance = state;
  const e=d.encounter;
  render(`<div class="topline"><div><h1>Registrar chamada — ${escapeHtml(e.workshop)}</h1><p>${escapeHtml(e.className)} · ${fmt(e.date)} · ${escapeHtml(e.time)}</p></div><button id="backBtn">Voltar ao menu</button></div><section class="panel"><p class="warning">Selecione Presente ou Ausente para cada participante antes de salvar.</p><div id="roster">${d.students.map(s=>`<div class="student"><strong>${escapeHtml(s.name)}</strong><div class="choices" role="group" aria-label="Presença de ${escapeHtml(s.name)}"><button class="choice present" data-student="${s.id}" data-choice="presente" aria-pressed="${state.draft[s.id]==='presente'}">✓ Presente</button><button class="choice absent" data-student="${s.id}" data-choice="ausente" aria-pressed="${state.draft[s.id]==='ausente'}">✕ Ausente</button></div></div>`).join('')}</div><div class="toolbar"><button id="saveCall" class="primary">Salvar chamada</button><span id="counter" aria-live="polite"></span></div></section>`);
  const backButton = document.getElementById('backBtn');
  backButton.addEventListener('click', () => {
    if (!confirmDiscardAttendance()) return;
    const unlock = lockAttendanceControls();
    renderMenu().catch(error => {
      if (actor !== currentActor || !backButton.isConnected) return;
      alertMessage('Não foi possível voltar ao menu. ' + error.message, true);
    }).finally(unlock);
  });
  const count = () => {
    const pending = hasUnsavedAttendance() ? ' · Alterações não salvas' : '';
    document.getElementById('counter').textContent = `${Object.keys(state.draft).length} de ${d.students.length} participantes marcados${pending}`;
  };
  count();
  document.querySelectorAll('[data-student]').forEach(btn=>btn.addEventListener('click',()=>{
    state.draft[btn.dataset.student]=btn.dataset.choice;
    document.querySelectorAll(`[data-student="${btn.dataset.student}"]`).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.choice===btn.dataset.choice)));
    count();
  }));
  const save=async()=>{
    if(Object.keys(state.draft).length!==d.students.length){alertMessage('Marque Presente ou Ausente para todos os participantes.',true);return;}
    const submitted = { ...state.draft };
    const btn=document.getElementById('saveCall');btn.disabled=true;
    try{
      const result=await api(`/api/encounters/${id}/attendance`,{method:'PUT',body:JSON.stringify(submitted)});
      if (actor !== currentActor || activeAttendance !== state || !btn.isConnected) return;
      state.saved = submitted;
      count();
      alertMessage(hasUnsavedAttendance()
        ? 'Chamada salva. Há novas alterações que ainda precisam ser salvas.'
        : `${result.message}. Todas as marcações foram confirmadas pelo servidor.`);
      btn.textContent='Atualizar chamada';
    } catch(e){
      if (actor !== currentActor || activeAttendance !== state || !btn.isConnected) return;
      alertMessage('Salvamento não confirmado. Tente novamente quando a conexão voltar. '+e.message,true);
      btn.textContent='Tentar novamente';
    } finally{btn.disabled=false;}
  };
  document.getElementById('saveCall').addEventListener('click',save);
}
async function renderReport(filters={classId:'ipiranga',start:'2026-11-10',end:'2026-11-16'}){
  const params=new URLSearchParams(filters), data=await api('/api/report?'+params);
  render(`<div class="topline"><div><h1>Resumo de frequência</h1><p>Consulte as presenças e faltas por turma e período.</p></div><span class="badged">Perfil: Coordenação</span></div><section class="panel"><h2>Filtros de consulta</h2><form id="reportForm" class="filters"><div><label for="classId">Turma</label><select id="classId"><option value="ipiranga">Turma Ipiranga</option></select></div><div><label for="start">Data inicial</label><input type="date" id="start" value="${filters.start}" required></div><div><label for="end">Data final</label><input type="date" id="end" value="${filters.end}" required></div><button class="primary" type="submit">Aplicar filtros</button></form></section><div class="metrics"><div class="tile"><strong>${data.present}</strong>Presenças</div><div class="tile"><strong>${data.absent}</strong>Faltas</div><div class="tile"><strong>${data.percent}%</strong>Frequência geral</div></div><section class="panel"><h2>Turma Ipiranga — ${data.encounters} encontros concluídos</h2>${data.encounters?`<div class="tablewrap"><table><thead><tr><th>Participante</th><th>Presenças</th><th>Faltas</th><th>Frequência</th><th>Ação</th></tr></thead><tbody>${data.participants.map(p=>`<tr><td>${escapeHtml(p.name)}</td><td>${p.present}</td><td>${p.absent}</td><td>${data.encounters?Math.round(p.present/data.encounters*100):0}%</td><td><button data-history="${p.id}">Ver histórico</button></td></tr>`).join('')}</tbody></table></div><div id="details" aria-live="polite"></div>`:'<p class="warning">Não existem chamadas concluídas no período selecionado.</p>'}</section>`);
  document.getElementById('reportForm').addEventListener('submit',ev=>{ev.preventDefault();renderReport({classId:document.getElementById('classId').value,start:document.getElementById('start').value,end:document.getElementById('end').value}).catch(e=>alertMessage(e.message,true));});
  view.querySelectorAll('[data-history]').forEach(b=>b.addEventListener('click',()=>{
    const p=data.participants.find(x=>x.id===b.dataset.history);
    document.getElementById('details').innerHTML=`<div class="history"><h2>Histórico de ${escapeHtml(p.name)}</h2>${p.history.map(h=>`<p>${fmt(h.date)} · ${escapeHtml(h.time)} · ${escapeHtml(h.workshop)} — <strong>${h.situation==='presente'?'✓ Presente':'✕ Ausente'}</strong></p>`).join('')}</div>`;
  }));
}
async function setActor(data) {
  actor = data;
  if (actor.role === 'educadora') await renderMenu();
  else await renderReport();
  if (actor === data) document.getElementById('password').value = '';
}
const demoProfile = document.getElementById('username');
const demoPassword = document.getElementById('password');
function prefillDemoPassword() {
  demoPassword.value = demoProfile.value === 'educadora' ? 'DemoEducadora123!' : 'DemoCoordenacao123!';
}
demoProfile.addEventListener('change', prefillDemoPassword);
document.getElementById('loginForm').addEventListener('submit',async ev=>{ev.preventDefault();try{const data=await api('/api/login',{method:'POST',body:JSON.stringify({username:document.getElementById('username').value,password:document.getElementById('password').value})});await setActor(data);}catch(e){alertMessage(e.message,true);}});
const logoutButton = document.getElementById('logout');
logoutButton.addEventListener('click', async () => {
  if (!confirmDiscardAttendance()) return;
  const unlock = lockAttendanceControls();
  try {
    await api('/api/logout', { method: 'POST' });
    actor = null;
    activeAttendance = null;
    view.hidden = true;
    profile.hidden = true;
    loginPanel.hidden = false;
    clearMessage();
    prefillDemoPassword();
    demoProfile.focus();
  } catch (error) {
    alertMessage('Não foi possível sair. ' + error.message, true);
  } finally {
    unlock();
  }
});
api('/api/me').then(setActor).catch(()=>{});
