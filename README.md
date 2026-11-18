# Sistema de Controle de Frequência — Núcleo Semeadores do Bem

MVP acadêmico para registro de presença nas oficinas e consulta de frequência por turma e período.

> **Atenção:** aplicação demonstrativa, com usuários, senhas e participantes inventados. Não utilizar em produção nem cadastrar dados pessoais reais. A autenticação de demonstração não é adequada para implantação real.

## Requisitos

- Node.js 22.13 ou superior.
- A execução local usa módulos nativos. A preparação do artefato de nuvem usa esbuild, e as migrações D1 são geradas com Drizzle Kit.

## Executar

```bash
npm start
```

Abra `http://localhost:3000`.

**Contas de demonstração (somente ambiente local):**

| Perfil | Usuário | Senha de demonstração |
|---|---|---|
| Educadora | `educadora` | `DemoEducadora123!` |
| Coordenação | `coordenacao` | `DemoCoordenacao123!` |

Na tela inicial, selecione um perfil. O campo de senha é preenchido automaticamente para facilitar a demonstração; credenciais reais nunca devem funcionar dessa maneira.

## Fluxo principal

1. Entrar como **Educadora**, abrir o encontro de **Judô — 16/11/2026, 14h**, marcar Ana, Bruno e Davi como presentes e Clara como ausente; salvar. Também é possível reabrir e corrigir a chamada.
2. Sair e entrar como **Coordenação**; consultar a **Turma Ipiranga de 10 a 16/11/2026**. Após salvar a chamada de Judô, o relatório apresenta 6 presenças, 2 faltas e 75% de frequência.
3. Selecionar **Ver histórico** no registro de Clara para identificar a falta em Judô. Um período sem chamadas concluídas apresenta mensagem de estado vazio.

O aplicativo mantém os dados em `data/database.json` (criado automaticamente no primeiro início). Para reiniciar a demonstração, pare o servidor e exclua esse arquivo local. Não publique os dados gerados.

## Testar

```bash
npm test
npm run check
```

Os testes verificam autorização, login inválido, validação da chamada, gravação, correção, relatório e período sem dados. A configuração em `.github/workflows/ci.yml` executa os testes em pushes e pull requests da branch `main`.

## Publicação e monitoramento

A versão de nuvem usa um Cloudflare Worker publicado pelo Sites, com chamadas e sessões persistidas em Cloudflare D1. A API preserva os caminhos usados pela interface. As contas e os participantes continuam demonstrativos.

- Aplicação: https://controle-frequencia-semeadores.macaroff.chatgpt.site
- Painel de disponibilidade: https://controle-frequencia-semeadores.macaroff.chatgpt.site/status
- Endpoint de saúde: `/api/health`, que responde `UP` e HTTP 200 após consultar o banco, ou `DOWN` e HTTP 503 em caso de falha.
- Verificação externa: `.github/workflows/monitor.yml`, agendada aproximadamente a cada 30 minutos e disponível também para execução manual. Uma falha deixa o job vermelho e registra `DOWN` no resumo da execução.

O painel consulta o endpoint de saúde a cada 60 segundos enquanto estiver aberto. As verificações do GitHub Actions continuam agendadas quando a página está fechada. Os horários do agendador podem sofrer atrasos da plataforma.

Para preparar o artefato, execute `npm ci --ignore-scripts` e `npm run build`. O código de nuvem está em `src/cloud-worker.mjs`, a declaração do banco em `db/schema.ts` e as migrações em `drizzle/`. As sessões em nuvem expiram no servidor após duas horas, e o banco armazena somente o hash do token de sessão.

## Estrutura

```text
src/app.js               Servidor HTTP, regras de negócio, sessão de demonstração e armazenamento
src/server.js            Inicialização do servidor
public/index.html        Estrutura da interface
public/styles.css        Layout responsivo, contraste e foco
public/app.js            Navegação, chamadas e consulta de frequência
tests/app.test.js        Testes automatizados de integração
.github/workflows/ci.yml Integração contínua no GitHub Actions
```

## Requisitos e limitações

- **RF01–RF04:** menu por perfil e atalhos pertinentes; cadastros e gestão de encontros são previstos para fases futuras.
- **RF05–RF06:** lançamento e correção de presença por encontro, com validação de todos os participantes.
- **RF07:** resumo com filtros de turma e período e histórico de ausências.
- **RNF04:** textos de estado, rótulos permanentes, foco visível, controles com altura mínima de 44px e layout responsivo.
- **RNF03:** o carregamento inferior a três segundos ainda precisa de medição em dispositivos representativos.
- **RNF01–RNF02:** a checagem de papel é feita também no servidor, mas **a autenticação ainda é demonstrativa**: sessões apenas em memória, sem proteção completa para produção, armazenamento JSON local e credenciais públicas intencionais.
- A primeira versão não inclui cadastro real, operação multiusuário segura, backup, autenticação de produção, recuperação de senha nem auditoria de alterações. Não utilizar com dados de menores ou pessoas reais.
- A falha de conexão é tratada na interface preservando as marcações enquanto a página estiver aberta. Para testar, desligue temporariamente a rede apenas no ambiente local, sem afetar outros usuários.

## Próximas etapas da Experiência Prática III

- Registrar commits semânticos, por exemplo `feat: adicionar registro de chamada` e `test: validar resumo de frequência`.
- Criar branch `feature/aperfeicoar-chamada`, abrir pull request e documentar auto-revisão.
- Acompanhar a execução da CI no GitHub Actions e registrar evidência real.
- Realizar pelo menos duas rodadas reais de teste com representantes externos, mediante consentimento, e registrar melhorias implementadas após feedback.
