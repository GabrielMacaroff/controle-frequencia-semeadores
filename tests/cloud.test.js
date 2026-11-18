'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
let worker;

before(async () => { worker = (await import('../src/cloud-worker.mjs')).default; });

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', file), 'utf8'));
  }
  t.after(() => sqlite.close());
  return {
    sqlite,
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return sqlite.prepare(sql).get(...params) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() { sqlite.prepare(sql).run(...params); return { success: true }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

async function request(db, route, method = 'GET', data, cookie = '') {
  const response = await worker.fetch(new Request('https://demo.example' + route, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: data === undefined ? undefined : JSON.stringify(data),
  }), { DB: db });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
}

async function login(db, username) {
  const password = username === 'educadora' ? 'DemoEducadora123!' : 'DemoCoordenacao123!';
  const result = await request(db, '/api/login', 'POST', { username, password });
  assert.equal(result.status, 200);
  return result.cookie;
}

test('nuvem: endpoint de saúde verifica o banco e sinaliza falha', async t => {
  const db = database(t);
  const up = await request(db, '/api/health');
  assert.equal(up.status, 200);
  assert.equal(up.data.status, 'UP');
  assert.equal(up.data.database, 'UP');
  const down = await request({ prepare() { throw new Error('Banco fora do ar'); } }, '/api/health');
  assert.equal(down.status, 503);
  assert.equal(down.data.status, 'DOWN');
});

test('nuvem: sessões exigem credenciais, respeitam papéis e expiram', async t => {
  const db = database(t);
  assert.equal((await request(db, '/api/encounters')).status, 401);
  assert.equal((await request(db, '/api/login', 'POST', { username: 'educadora', password: 'errada' })).status, 401);
  const ed = await login(db, 'educadora');
  const co = await login(db, 'coordenacao');
  assert.equal((await request(db, '/api/encounters/jud-16/attendance', 'GET', undefined, co)).status, 403);
  assert.equal((await request(db, '/api/report?classId=ipiranga&start=2026-11-10&end=2026-11-16', 'GET', undefined, ed)).status, 403);
  db.sqlite.exec('UPDATE sessions SET expires_at = 0');
  assert.equal((await request(db, '/api/me', 'GET', undefined, ed)).status, 401);
});

test('nuvem: chamadas, correções e relatório persistem no D1', async t => {
  const db = database(t);
  const ed = await login(db, 'educadora');
  const co = await login(db, 'coordenacao');
  const endpoint = '/api/encounters/jud-16/attendance';
  const marks = { ana: 'presente', bruno: 'presente', clara: 'ausente', davi: 'presente' };
  assert.equal((await request(db, endpoint, 'PUT', marks, ed)).status, 200);
  assert.deepEqual((await request(db, endpoint, 'GET', undefined, ed)).data.attendance, marks);
  const reportPath = '/api/report?classId=ipiranga&start=2026-11-10&end=2026-11-16';
  const report = await request(db, reportPath, 'GET', undefined, co);
  assert.equal(report.data.present, 6);
  assert.equal(report.data.absent, 2);
  assert.equal(report.data.percent, 75);
  assert.equal((await request(db, endpoint, 'PUT', { ...marks, clara: 'presente' }, ed)).status, 200);
  assert.equal((await request(db, reportPath, 'GET', undefined, co)).data.present, 7);
  await request(db, '/api/logout', 'POST', undefined, ed);
  assert.equal((await request(db, '/api/me', 'GET', undefined, ed)).status, 401);
  const next = await login(db, 'educadora');
  assert.equal((await request(db, endpoint, 'GET', undefined, next)).data.attendance.clara, 'presente');
});

test('nuvem: entradas inválidas preservam a chamada existente', async t => {
  const db = database(t);
  const ed = await login(db, 'educadora');
  const endpoint = '/api/encounters/lei-12/attendance';
  const baseline = (await request(db, endpoint, 'GET', undefined, ed)).data.attendance;
  for (const marks of [null, [], { ana: 'presente' }, { ...baseline, clara: 'justificado' }]) {
    assert.equal((await request(db, endpoint, 'PUT', marks, ed)).status, 400);
    assert.deepEqual((await request(db, endpoint, 'GET', undefined, ed)).data.attendance, baseline);
  }
  const co = await login(db, 'coordenacao');
  assert.equal((await request(db, '/api/report?classId=ipiranga&start=2026-02-30&end=2026-11-16', 'GET', undefined, co)).status, 400);
});
