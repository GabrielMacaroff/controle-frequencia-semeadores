'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {makeApp}=require('../src/app');
let server,root,base;
async function request(route,method='GET',data=null,cookie='') {
  const response=await fetch(base+route,{method,headers:{...(data!==null?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:data!==null?JSON.stringify(data):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(username,password) {const r=await request('/api/login','POST',{username,password});assert.equal(r.status,200);return r.cookie;}
before(async()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'semeadores-test-'));const app=makeApp({dbPath:path.join(root,'data.json')});server=app.server;await new Promise(resolve=>server.listen(0,resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
test('recursos privados exigem sessão',async()=>{const r=await request('/api/encounters');assert.equal(r.status,401);});
test('login recusa senha inválida',async()=>{const r=await request('/api/login','POST',{username:'educadora',password:'errada'});assert.equal(r.status,401);});
test('login recusa corpos JSON que não são objetos', async () => {
  for (const body of ['null', '[]', '42']) {
    const response = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /objeto JSON/);
  }
});
test('controle de acesso por função',async()=>{
  const ed=await login('educadora','DemoEducadora123!'),co=await login('coordenacao','DemoCoordenacao123!');
  assert.equal((await request('/api/report?classId=ipiranga&start=2026-11-10&end=2026-11-16','GET',null,ed)).status,403);
  assert.equal((await request('/api/encounters/jud-16/attendance','GET',null,co)).status,403);
});
test('chamada exige exatamente uma marcação por participante',async()=>{
  const ed=await login('educadora','DemoEducadora123!');
  const invalid=await request('/api/encounters/jud-16/attendance','PUT',{ana:'presente'},ed);
  assert.equal(invalid.status,400);
  assert.match(invalid.data.error,/Marque Presente/);
});
test('salvar e corrigir chamada reflete no resumo',async()=>{
  const ed=await login('educadora','DemoEducadora123!');
  const co=await login('coordenacao','DemoCoordenacao123!');
  const marks={ana:'presente',bruno:'presente',clara:'ausente',davi:'presente'};
  assert.equal((await request('/api/encounters/jud-16/attendance','PUT',marks,ed)).status,200);
  const saved=await request('/api/encounters/jud-16/attendance','GET',null,ed);
  assert.deepEqual(saved.data.attendance,marks);
  const report=await request('/api/report?classId=ipiranga&start=2026-11-10&end=2026-11-16','GET',null,co);
  assert.equal(report.data.encounters,2);assert.equal(report.data.present,6);assert.equal(report.data.absent,2);assert.equal(report.data.percent,75);
  const clara=report.data.participants.find(p=>p.id==='clara');
  assert.equal(clara.history.find(x=>x.workshop==='Judô').situation,'ausente');
  const changed={...marks,clara:'presente'};
  assert.equal((await request('/api/encounters/jud-16/attendance','PUT',changed,ed)).status,200);
  const updated=await request('/api/report?classId=ipiranga&start=2026-11-10&end=2026-11-16','GET',null,co);
  assert.equal(updated.data.present,7);assert.equal(updated.data.absent,1);
});
test('relatório rejeita datas impossíveis e períodos invertidos', async () => {
  const co = await login('coordenacao', 'DemoCoordenacao123!');
  const invalidPeriods = [
    ['2026-11-00', '2026-11-16'],
    ['2026-02-28', '2026-02-29'],
    ['2026-11-10', '2026-13-01'],
    ['2026-11-16', '2026-11-10'],
  ];
  for (const [start, end] of invalidPeriods) {
    const params = new URLSearchParams({ classId: 'ipiranga', start, end });
    const report = await request(`/api/report?${params}`, 'GET', null, co);
    assert.equal(report.status, 400);
    assert.equal(report.data.error, 'Informe turma e período válidos.');
  }

  const leapDay = await request('/api/report?classId=ipiranga&start=2028-02-29&end=2028-02-29', 'GET', null, co);
  assert.equal(leapDay.status, 200);
});
test('período sem chamadas apresenta relatório vazio',async()=>{
  const co=await login('coordenacao','DemoCoordenacao123!');
  const r=await request('/api/report?classId=ipiranga&start=2026-12-01&end=2026-12-31','GET',null,co);
  assert.equal(r.status,200);assert.equal(r.data.encounters,0);assert.equal(r.data.percent,0);
});
