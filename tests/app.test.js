'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const { once } = require('node:events');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {makeApp}=require('../src/app');
const { isValidAttendance } = require('../src/attendance');
let server,root,base;
async function request(route,method='GET',data=null,cookie='',baseUrl=base) {
  const response=await fetch(baseUrl+route,{method,headers:{...(data!==null?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:data!==null?JSON.stringify(data):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(username,password,baseUrl=base) {const r=await request('/api/login','POST',{username,password},'',baseUrl);assert.equal(r.status,200);assert.ok(r.cookie);return r.cookie;}
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
test('chamada exige turma com participantes', () => {
  assert.equal(isValidAttendance({}, []), false);
});
test('envios inválidos não sobrescrevem uma chamada salva', async () => {
  const ed = await login('educadora', 'DemoEducadora123!');
  const endpoint = '/api/encounters/lei-12/attendance';
  const before = await request(endpoint, 'GET', null, ed);
  assert.equal(before.status, 200);
  const { davi, ...otherMarks } = before.data.attendance;
  assert.equal(davi, 'presente');

  for (const marks of [
    { ...otherMarks, desconhecido: 'presente' },
    { ...before.data.attendance, davi: 'justificado' },
  ]) {
    const rejected = await request(endpoint, 'PUT', marks, ed);
    assert.equal(rejected.status, 400);
    const after = await request(endpoint, 'GET', null, ed);
    assert.equal(after.status, 200);
    assert.deepEqual(after.data.attendance, before.data.attendance);
  }
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

test('chamada continua salva após reiniciar o servidor', async t => {
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semeadores-persistencia-'));
  const dbPath = path.join(databaseDir, 'database.json');
  const endpoint = '/api/encounters/art-16/attendance';
  const marks = { ana: 'presente', bruno: 'ausente', clara: 'presente', davi: 'ausente' };
  let instance;

  async function closeServer() {
    if (!instance?.listening) return;
    const closed = once(instance, 'close');
    instance.close();
    await closed;
  }

  t.after(async () => {
    try {
      await closeServer();
    } finally {
      fs.rmSync(databaseDir, { recursive: true, force: true });
    }
  });

  async function openSession() {
    ({ server: instance } = makeApp({ dbPath }));
    await once(instance.listen(0, '127.0.0.1'), 'listening');
    const url = `http://127.0.0.1:${instance.address().port}`;
    const cookie = await login('educadora', 'DemoEducadora123!', url);
    return { url, cookie };
  }

  const first = await openSession();
  const saved = await request(endpoint, 'PUT', marks, first.cookie, first.url);
  assert.equal(saved.status, 200);
  await closeServer();

  const reopened = await openSession();
  const response = await request(endpoint, 'GET', null, reopened.cookie, reopened.url);
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.attendance, marks);
});
