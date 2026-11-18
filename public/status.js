'use strict';
const checkButton = document.getElementById('checkNow');
async function checkHealth() {
  checkButton.disabled = true;
  const startedAt = performance.now();
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    document.getElementById('httpStatus').textContent = response.status;
    const data = await response.json();
    if (!response.ok || data.status !== 'UP' || data.database !== 'UP') throw new Error('Verificação de saúde falhou.');
    document.getElementById('healthStatus').textContent = '● UP — Serviço disponível';
    document.getElementById('healthStatus').className = 'health-up';
    document.getElementById('healthMessage').textContent = 'A aplicação respondeu e a consulta ao armazenamento persistente foi concluída com sucesso.';
    document.getElementById('databaseStatus').textContent = data.database;
    document.getElementById('storageName').textContent = data.storage;
  } catch {
    document.getElementById('healthStatus').textContent = '● DOWN — Falha de disponibilidade';
    document.getElementById('healthStatus').className = 'health-down';
    document.getElementById('healthMessage').textContent = 'A disponibilidade não pôde ser confirmada. Consulte o histórico externo para investigar a interrupção.';
    document.getElementById('databaseStatus').textContent = 'Indisponível';
  } finally {
    document.getElementById('responseTime').textContent = `${Math.round(performance.now() - startedAt)} ms`;
    document.getElementById('checkedAt').textContent = 'Última verificação em ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (Brasília)';
    checkButton.disabled = false;
  }
}
checkButton.addEventListener('click', checkHealth);
checkHealth();
setInterval(checkHealth, 60000);
