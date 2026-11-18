import seed from './seed.js';
import attendance from './attendance.js';

const { DEMO_USERS, cloneInitialData } = seed;
const { isValidAttendance } = attendance;
const assets = typeof __STATIC_ASSETS__ === 'undefined' ? {} : __STATIC_ASSETS__;
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self' https://chatgpt.com https://chat.openai.com",
};

function json(status, value, extra = {}) {
  return Response.json(value, { status, headers: { ...headers, ...extra } });
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

async function readObject(request) {
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        fail(413, 'Corpo muito grande.');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes) || '{}'); }
  catch { fail(400, 'JSON inválido.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'O corpo deve ser um objeto JSON.');
  return data;
}

function sessionCookie(request) {
  return request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('demo_session='))?.slice(13) || '';
}

async function tokenHash(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function currentUser(request, db) {
  const token = sessionCookie(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT role, display FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await tokenHash(token), Date.now()).first();
}

async function readData(db) {
  const data = cloneInitialData();
  for (const [id, marks] of Object.entries(data.calls)) {
    await db.prepare('INSERT OR IGNORE INTO calls (encounter_id, marks, updated_at) VALUES (?, ?, ?)')
      .bind(id, JSON.stringify(marks), Date.now()).run();
  }
  const result = await db.prepare('SELECT encounter_id, marks FROM calls').all();
  data.calls = Object.fromEntries(result.results.map(row => [row.encounter_id, JSON.parse(row.marks)]));
  return data;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function handleApi(request, env, url) {
  const db = env.DB;
  if (!db) throw new Error('Binding DB indisponível.');
  const pathname = url.pathname;
  if (pathname === '/api/health' && request.method === 'GET') {
    await db.prepare('SELECT COUNT(*) AS calls FROM calls').first();
    return json(200, { status: 'UP', database: 'UP', storage: 'Cloudflare D1', service: 'controle-frequencia-semeadores', version: '0.2.0', checkedAt: new Date().toISOString() });
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json(403, { error: 'Origem não permitida.' });
  }
  if (pathname === '/api/login' && request.method === 'POST') {
    const data = await readObject(request);
    const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
    const user = Object.hasOwn(DEMO_USERS, username) ? DEMO_USERS[username] : null;
    if (!user || data.password !== user.password) return json(401, { error: 'Credenciais de demonstração inválidas.' });
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    const hash = await tokenHash(token);
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()),
      db.prepare('INSERT INTO sessions (token_hash, role, display, expires_at) VALUES (?, ?, ?, ?)')
        .bind(hash, user.role, user.display, Date.now() + 7200000),
    ]);
    return json(200, { role: user.role, display: user.display }, {
      'Set-Cookie': `demo_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=7200`,
    });
  }
  if (pathname === '/api/logout' && request.method === 'POST') {
    const token = sessionCookie(request);
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await tokenHash(token)).run();
    return json(200, { ok: true }, { 'Set-Cookie': 'demo_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
  }
  const user = await currentUser(request, db);
  if (!user) return json(401, { error: 'Faça login para continuar.' });
  if (pathname === '/api/me' && request.method === 'GET') return json(200, user);

  if (pathname === '/api/encounters' && request.method === 'GET') {
    const data = await readData(db);
    return json(200, data.encounters.map(encounter => ({ ...encounter, status: data.calls[encounter.id] ? 'Concluída' : 'Pendente' })));
  }
  const match = pathname.match(/^\/api\/encounters\/([a-z0-9-]+)\/attendance$/);
  if (match) {
    if (user.role !== 'educadora') return json(403, { error: 'Apenas educadoras podem acessar chamadas.' });
    const data = await readData(db);
    const encounter = data.encounters.find(item => item.id === match[1]);
    if (!encounter) return json(404, { error: 'Encontro não encontrado.' });
    const students = data.students.filter(student => student.classId === encounter.classId);
    if (request.method === 'GET') return json(200, { encounter, students, attendance: data.calls[encounter.id] || {} });
    if (request.method === 'PUT') {
      const submitted = await readObject(request);
      if (!isValidAttendance(submitted, students)) return json(400, { error: 'Marque Presente ou Ausente para todos os participantes.' });
      await db.prepare('INSERT INTO calls (encounter_id, marks, updated_at) VALUES (?, ?, ?) ON CONFLICT(encounter_id) DO UPDATE SET marks = excluded.marks, updated_at = excluded.updated_at')
        .bind(encounter.id, JSON.stringify(submitted), Date.now()).run();
      return json(200, { message: 'Chamada salva', encounterId: encounter.id });
    }
  }
  if (pathname === '/api/report' && request.method === 'GET') {
    if (user.role !== 'coordenacao') return json(403, { error: 'Apenas a coordenação pode consultar frequência.' });
    const classId = url.searchParams.get('classId');
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');
    if (classId !== 'ipiranga' || !validDate(start) || !validDate(end) || start > end) return json(400, { error: 'Informe turma e período válidos.' });
    const data = await readData(db);
    const encounters = data.encounters.filter(item => item.classId === classId && item.date >= start && item.date <= end && data.calls[item.id])
      .sort((a, b) => a.date.localeCompare(b.date));
    const participants = data.students.filter(student => student.classId === classId).map(student => {
      const history = encounters.map(item => ({ workshop: item.workshop, date: item.date, time: item.time, situation: data.calls[item.id][student.id] }));
      const present = history.filter(item => item.situation === 'presente').length;
      return { id: student.id, name: student.name, present, absent: history.length - present, history };
    });
    const present = participants.reduce((total, student) => total + student.present, 0);
    const absent = participants.reduce((total, student) => total + student.absent, 0);
    return json(200, { encounters: encounters.length, present, absent, percent: present + absent ? Math.round(present / (present + absent) * 100) : 0, participants });
  }
  return json(404, { error: 'Recurso não encontrado.' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Método não permitido.' });
      const asset = assets[url.pathname === '/' ? '/index.html' : url.pathname === '/status' ? '/status.html' : url.pathname];
      if (!asset) return json(404, { error: 'Página não encontrada.' });
      return new Response(request.method === 'HEAD' ? null : asset.body, { headers: { ...headers, 'Content-Type': asset.type } });
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_failed', path: url.pathname, status: error.status || 503 }));
      if (url.pathname === '/api/health') return json(503, { status: 'DOWN', database: 'DOWN', checkedAt: new Date().toISOString() });
      return json(error.status || 503, { error: error.status ? error.message : 'Serviço temporariamente indisponível. Tente novamente.' });
    }
  },
};
