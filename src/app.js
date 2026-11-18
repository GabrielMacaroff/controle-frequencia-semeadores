'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { isValidAttendance } = require('./attendance');

const DEMO_USERS = {
  educadora: { password: 'DemoEducadora123!', role: 'educadora', display: 'Educadora' },
  coordenacao: { password: 'DemoCoordenacao123!', role: 'coordenacao', display: 'Coordenação' },
};
const INITIAL_DATA = {
  students: [
    { id: 'ana', name: 'Ana M.', classId: 'ipiranga' },
    { id: 'bruno', name: 'Bruno R.', classId: 'ipiranga' },
    { id: 'clara', name: 'Clara S.', classId: 'ipiranga' },
    { id: 'davi', name: 'Davi L.', classId: 'ipiranga' },
  ],
  encounters: [
    { id: 'jud-16', classId: 'ipiranga', className: 'Turma Ipiranga', workshop: 'Judô', date: '2026-11-16', time: '14:00' },
    { id: 'art-16', classId: 'ipiranga', className: 'Turma Ipiranga', workshop: 'Arte', date: '2026-11-16', time: '16:00' },
    { id: 'lei-12', classId: 'ipiranga', className: 'Turma Ipiranga', workshop: 'Leitura', date: '2026-11-12', time: '14:00' },
  ],
  calls: {
    'lei-12': { ana: 'presente', bruno: 'ausente', clara: 'presente', davi: 'presente' },
  },
};

function cloneInitialData() { return structuredClone(INITIAL_DATA); }
function storeAt(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(cloneInitialData(), null, 2));
  return {
    read() { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); },
    update(transform) {
      const data = this.read();
      const result = transform(data);
      const temp = `${dbPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(data, null, 2));
      fs.renameSync(temp, dbPath);
      return result;
    },
  };
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function send(res, status, data, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(JSON.stringify(data));
}
function parseCookies(header='') { return Object.fromEntries(header.split(';').map(p=>p.trim().split('=')).filter(a=>a.length===2)); }
function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function makeApp({ dbPath = path.join(os.tmpdir(), 'semeadores-frequencia-demo', 'database.json'), publicDir=path.join(__dirname,'../public') } = {}) {
  const store = storeAt(dbPath);
  const sessions = new Map();
  async function body(req) {
    let raw='';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 32_768) { const err=new Error('Corpo muito grande'); err.status=413; throw err; }
    }
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      const err = new Error('JSON inválido');
      err.status = 400;
      throw err;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      const err = new Error('O corpo da requisição deve ser um objeto JSON.');
      err.status = 400;
      throw err;
    }
    return data;
  }
  function sessionFrom(req) {
    const token = parseCookies(req.headers.cookie).demo_session;
    return sessions.get(token);
  }
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      if (pathname.startsWith('/api/')) {
        if (pathname === '/api/login' && req.method === 'POST') {
          const data = await body(req);
          const username = typeof data.username==='string' ? data.username.toLowerCase().trim() : '';
          const user = DEMO_USERS[username];
          if (!user || typeof data.password !== 'string' || data.password !== user.password) return send(res, 401, { error: 'Credenciais de demonstração inválidas.' });
          const token = crypto.randomBytes(32).toString('hex');
          sessions.set(token, { role: user.role, display: user.display });
          return send(res,200,{ role:user.role, display:user.display }, { 'Set-Cookie': `demo_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200` });
        }
        const user = sessionFrom(req);
        if (pathname==='/api/logout' && req.method==='POST') {
          const token = parseCookies(req.headers.cookie).demo_session;
          sessions.delete(token);
          return send(res,200,{ok:true},{'Set-Cookie':'demo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
        }
        if (!user) return send(res,401,{error:'Faça login para continuar.'});
        if (pathname==='/api/me' && req.method==='GET') return send(res,200,user);
        if (pathname==='/api/encounters' && req.method==='GET') {
          const data=store.read();
          return send(res,200,data.encounters.map(e=>({ ...e, status:data.calls[e.id]?'Concluída':'Pendente' })));
        }
        const match = pathname.match(/^\/api\/encounters\/([a-z0-9-]+)\/attendance$/);
        if (match) {
          if (user.role !== 'educadora') return send(res, 403, { error: 'Apenas educadoras podem acessar chamadas.' });
          const encounterId = match[1];
          const data = store.read();
          const encounter = data.encounters.find(entry => entry.id === encounterId);
          if (!encounter) return send(res, 404, { error: 'Encontro não encontrado.' });
          const students = data.students.filter(student => student.classId === encounter.classId);

          if (req.method === 'GET') {
            return send(res, 200, { encounter, students, attendance: data.calls[encounterId] || {} });
          }
          if (req.method === 'PUT') {
            const submitted = await body(req);
            if (students.length === 0) {
              return send(res, 400, { error: 'Esta turma não tem participantes para registrar a chamada.' });
            }
            if (!isValidAttendance(submitted, students)) {
              return send(res, 400, { error: 'Marque Presente ou Ausente para todos os participantes.' });
            }
            store.update(current => { current.calls[encounterId] = submitted; });
            return send(res, 200, { message: 'Chamada salva', encounterId });
          }
        }
        if (pathname==='/api/report' && req.method==='GET') {
          if (user.role!=='coordenacao') return send(res,403,{error:'Apenas a coordenação pode consultar frequência.'});
          const classId=url.searchParams.get('classId'), start=url.searchParams.get('start'), end=url.searchParams.get('end');
          if (classId !== 'ipiranga' || !isCalendarDate(start) || !isCalendarDate(end) || start > end) {
            return send(res, 400, { error: 'Informe turma e período válidos.' });
          }
          const data=store.read();
          const encounters=data.encounters.filter(e=>e.classId===classId && e.date>=start && e.date<=end && data.calls[e.id]).sort((a,b)=>a.date.localeCompare(b.date));
          const result=data.students.filter(s=>s.classId===classId).map(s=>{
            const history=encounters.map(e=>({workshop:e.workshop,date:e.date,time:e.time,situation:data.calls[e.id][s.id]}));
            const present=history.filter(h=>h.situation==='presente').length;
            return {id:s.id,name:s.name,present,absent:history.length-present,history};
          });
          const totalPresent=result.reduce((n,x)=>n+x.present,0), totalAbsent=result.reduce((n,x)=>n+x.absent,0);
          return send(res,200,{encounters:encounters.length,present:totalPresent,absent:totalAbsent,percent:totalPresent+totalAbsent?Math.round(totalPresent/(totalPresent+totalAbsent)*100):0,participants:result});
        }
        return send(res,404,{error:'Recurso não encontrado.'});
      }
      if (req.method!=='GET') return send(res,405,{error:'Método não permitido.'});
      let file = pathname==='/'? 'index.html' : pathname.replace(/^\//,'');
      if (!['index.html','app.js','styles.css'].includes(file)) return send(res,404,{error:'Página não encontrada.'});
      const content = fs.readFileSync(path.join(publicDir,file));
      res.writeHead(200,{'Content-Type':mime[path.extname(file)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
      return res.end(content);
    } catch(err) {
      return send(res,err.status||500,{error:err.status?err.message:'Falha inesperada do servidor.'});
    }
  };
  return { server:http.createServer(handler),store };
}
module.exports={makeApp,cloneInitialData};
