'use strict';

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
module.exports = { DEMO_USERS, cloneInitialData };
