# 1.0.54

- Amplia **Erros e logs** para capturar falhas do backend HTTP, workers, RSS, GitHub e atualizador.
- Worker de atualização passa a registrar comando, PID, diretório, duração, silêncio sem saída e caudas de stdout/stderr.
- Processos externos demorados geram incidente diagnóstico antes do timeout; falhas/timeout entram automaticamente no monitor.
- Tela de Atualizações mostra o processo externo em execução e sua saída recente durante etapas como o build do frontend.
- Erros de workers são gravados em spool externo ao projeto e importados para o MongoDB assim que o backend estiver disponível.
- Monitor de erros ganha filtros/badges para Backend, Atualização, Worker, RSS e GitHub.
- Captura exceções HTTP 5xx, `unhandledRejection` e `uncaughtExceptionMonitor` do processo Node.

# 1.0.53

- Corrige definitivamente o primeiro envio para repositórios GitHub totalmente vazios.
- Inicializa o repositório pela Contents API antes de usar a Git Database API, conforme exigido pelo GitHub.
- O primeiro arquivo usado na inicialização é um arquivo real do projeto (preferencialmente README.md ou .gitignore).
- Após a inicialização, o worker sincroniza a árvore completa e conclui a publicação na branch escolhida.
- Branch personalizada também pode ser criada depois do commit inicial quando ainda não existe.

# 1.0.51

- Home mais editorial, com hierarquia de chamadas, Mais lidas e blocos por categoria sem repetir matérias já exibidas.
- Página de notícia renovada com lead, autoria, leitura, visualizações e notícias relacionadas.
- SEO por notícia com canonical, Open Graph, Twitter Cards, NewsArticle JSON-LD, autor/tags e metadados editoriais.
- Editor de notícias passa a permitir título/descrição SEO, autor e tags.
- Sitemap passa a listar apenas conteúdo publicado e usa slugs quando disponíveis.
- SEO global ganha URL pública configurável e dados estruturados da organização de notícias.

# 1.0.50

- Estabiliza a tela de Atualizações com polling serial, cancelável e protegido contra respostas após desmontagem.
- Evita concorrência entre múltiplas consultas do mesmo job.
- Protege o painel administrativo contra tradução automática que altera nós controlados pelo React.
- Agrupa erros idênticos ocorridos em até 60 segundos, registrando quantidade e última ocorrência.
- Adiciona deduplicação também no frontend para evitar tempestades de POST /api/erros.
- Impede o Error Boundary de registrar repetidamente a mesma falha durante o mesmo ciclo.
- Exibe quantidade, primeira e última ocorrência na administração de erros.

# 1.0.49

## RSS mais confiável
- Deduplicação reforçada por URL canônica, GUID e remoção de parâmetros de rastreamento.
- Pré-checagem de notícias já existentes antes do bulk insert.
- Resultado de importação padronizado com contagem real de duplicadas.
- Saúde por fonte: última tentativa, erro, falhas consecutivas, duração, itens encontrados e saldo do último ciclo.
- Painel RSS passa a exibir diagnóstico por fonte e resultados coerentes.

## 1.0.48 - 2026-08-09

- Corrige conflito de validação no GitHub: branch inexistente agora é aceita quando o token tem escrita.
- O painel informa explicitamente que a branch será criada automaticamente.
- O backend passa a ser a autoridade final sobre a possibilidade de criar a branch.

## 1.0.47 - 2026-08-09

- Adiciona em Atualizações a ação **Publicar versão atual no GitHub**, independente de pacote preparado.
- A origem da publicação pode ser a própria instalação ativa do AL Sistemas; a versão publicada pode ser igual à instalada.
- Exclui automaticamente `.env`, `node_modules`, uploads, backups, logs, cofres e estado interno do atualizador.
- Reutiliza o worker de publicação, acompanhamento por job, histórico e lock exclusivo do atualizador.
- A verificação GitHub passa a permitir primeira publicação em repositório vazio e criação de branch nova.
- Mantém a publicação por pacote completo para releases e o fluxo GitHub/Vercel já existente.

## 1.0.46 - 2026-08-09

- Corrige/mitiga tela branca no frontend após instalação/atualização no Termux.
- Adiciona guardião nativo de inicialização fora da árvore React: falhas precoces deixam diagnóstico visível em vez de tela vazia.
- Em localhost/127.0.0.1, remove Service Workers e caches antigos do AL Sistemas antes do boot para evitar chunks obsoletos após troca de versão.
- O overlay nativo só é removido depois do primeiro commit bem-sucedido do React.
- Mantém todas as melhorias de Vercel/Render e do atualizador da 1.0.45.

# Changelog

## 1.0.45

- Atualizador: comandos externos agora possuem timeout e são encerrados em caso de congelamento.
- Frontend: `vite optimize` deixa de fazer parte do build crítico; aquecimento passa a ser opcional e limitado a 20 segundos.
- Render: adiciona `render.yaml` para Blueprint do backend, com health check independente do MongoDB.
- Vercel/Render: remove fallbacks fixos para uma conta Render específica e reforça `VITE_API_URL` como configuração de deploy.
- Documentação: fluxo GitHub → Render + Vercel separado do atualizador local.

# 1.0.44

- Integrações e APIs: identificação automática da conta/origem quando o provedor permite.
- GitHub: login, nome e tentativa de obtenção do e-mail da conta autenticada.
- Vercel: identificação da conta autenticada usando a API oficial de usuário.
- MongoDB: exibição segura do usuário da URI, sem senha.
- Cloudinary: identificação pelo Cloud Name; APIs de IA sem endpoint de identidade passam a indicar essa limitação.
- Exportação `.env`: adicionada assinatura UTF-8 BOM e máscara ASCII para evitar mojibake (`IntegraÃ§Ãµes`, `â€¢`) em leitores que ignoram o charset HTTP.

# Changelog

## 1.0.43 — Atualizações incrementais com fallback para pacote completo

- Adiciona suporte a pacotes incrementais `alsistemas-update-X.Y.Z-to-A.B.C.zip`.
- Um incremental só pode ser instalado quando a versão atual corresponde exatamente à `baseVersion` declarada no manifesto.
- Incrementais gravam apenas arquivos novos/alterados e removem exclusivamente caminhos listados em `removed`, evitando que arquivos ausentes no ZIP sejam apagados.
- Snapshot, transação, rollback automático, health check e validação de staging continuam obrigatórios também para incrementais.
- O pré-check diferencia pacote completo de incremental e calcula alterações sem interpretar ausências do delta como remoções.
- O pacote completo continua sendo o formato de instalação limpa, recuperação e publicação GitHub/Vercel.
- Publicação GitHub/Vercel bloqueia pacote incremental para impedir uma árvore remota incompleta.
- A interface identifica o tipo de pacote e exibe a versão-base quando for incremental.

## 1.0.42 — Backup de integrações e publicação GitHub/Vercel mais segura

- Adiciona em **Integrações e APIs** download de backup em `.env` ou JSON.
- O backup sai mascarado por padrão; tokens/URI reais só entram quando o administrador marca explicitamente **Incluir valores secretos**.
- Exporta MongoDB, GitHub, Cloudinary, Groq/OpenAI/Gemini/Anthropic/OpenRouter/custom e Vercel quando configurados.
- Registra em auditoria quando uma exportação é realizada e se ela incluiu segredos.
- O fluxo **GitHub / Vercel** agora valida permissão de escrita no repositório e a existência da branch antes de publicar.
- Quando houver token Vercel, consulta os projetos vinculados ao repositório e mostra raiz/branch de produção quando disponíveis.
- A tela esclarece que a publicação é um commit/push no GitHub e que a Vercel realiza o deployment a partir desse push quando o projeto está conectado.

## 1.0.41

### Atualizador mais confiável em instalação limpa
- Adiciona diagnóstico estrutural antes da instalação: escrita na pasta do projeto, escrita no armazenamento externo, runtime Node.js, espaço livre, arquivos do motor e estratégia de reinício.
- O pré-check de cada pacote agora incorpora o diagnóstico do motor e bloqueia a instalação quando houver falha estrutural real.
- A recuperação de emergência é provisionada já na inicialização do módulo, fora da árvore substituída, inclusive antes da primeira atualização em uma instalação limpa.
- O painel de Atualizações ganhou um quadro de diagnóstico com verificações individuais, avisos e opção de testar novamente.
- Mantém o autoteste independente de recuperação e rollback, que continua validando restauração de arquivos, preservação de `.env`, trocas arquivo/diretório, liberação de lock e limpeza do marcador de recuperação.

## 1.0.40

- Corrige falso erro de integridade na criação de snapshots durante atualização com o sistema em execução.
- O snapshot passa a validar a cópia fechada e seus arquivos essenciais, evitando comparar o backup com uma árvore viva que pode mudar durante o hashing.
- Mantém todas as melhorias do módulo de ônibus introduzidas na 1.0.39.

## 1.0.39

- Módulo de ônibus reformulado no frontend público e administrativo.
- Linhas agora suportam código, descrição, embarque, contato, site, tarifa, duração estimada e avisos.
- Página pública com busca de linhas, próxima partida em até 7 dias, informações da viagem e estados de erro/recarregamento.
- Painel com indicadores, busca, ativação rápida, duplicação de linhas, presets de dias e melhor edição de horários.
- Backend com validação e saneamento dos dados, ordenação automática de horários e bloqueio de conflitos por dia/horário.
- Corrigida a permissão do menu de ônibus para usar `extras.gerenciar`, compatível com os perfis existentes.

## 1.0.38

- Home pública reorganizada para reduzir repetição de matérias entre Plantão, Capa, Últimas Notícias e Destaques.
- Capa passa a usar uma manchete principal e até 3 secundárias, preservando as escolhas editoriais configuradas.
- Últimas Notícias ganhou grade visual responsiva com cards maiores e imagens em destaque.
- A mesma notícia deixa de reaparecer em seções diferentes da Home normal.
- "Ver todas" agora abre corretamente a listagem completa de notícias com paginação.

## 1.0.37
- Endurece o módulo de atualização com bloqueio exclusivo: apenas uma instalação, rollback ou publicação GitHub pode executar por vez.
- Adiciona heartbeat do worker e detecção de operações abandonadas.
- Cria watchdog externo persistente em `~/.al-sistemas/updates/runtime`, independente dos arquivos que estão sendo substituídos.
- Se o worker de atualização morrer inesperadamente, o watchdog restaura automaticamente o snapshot e libera o lock.
- Adiciona recuperação pós-reinício: jobs interrompidos são detectados no boot e encaminhados ao recuperador externo.
- Cria `pending-recovery.json` antes da substituição e um comando de recuperação de emergência que funciona fora da árvore do projeto.
- Adiciona autoteste do motor de recuperação no painel e o script `npm run test:update`.
- O autoteste valida restauração do snapshot, remoção de arquivos novos, preservação de `.env`, troca arquivo↔diretório, liberação do lock e limpeza da recuperação pendente.
- A aplicação de arquivos deixa de apagar a árvore substituível inteira: passa a usar sincronização transacional arquivo a arquivo com cópia temporária e rename atômico.
- Registra journal de transação em `~/.al-sistemas/updates/transactions`.
- Trata corretamente mudanças estruturais em que um arquivo vira diretório ou um diretório vira arquivo.
- Jobs, histórico, locks e journals passam a usar escrita JSON atômica para reduzir risco de arquivos truncados após crash.
- O staging recebe manifesto SHA-256 da árvore; pré-check e worker verificam novamente esse manifesto antes de instalar.
- Se qualquer arquivo do staging mudar depois da validação, a instalação é bloqueada.
- Reforça a validação de ZIP contra path traversal, tipos de entrada incomuns, excesso de arquivos, arquivos individuais gigantes, expansão acima de 1 GB e taxa de compressão suspeita.
- Hashes de ZIP/staging passam a ser calculados em streaming para não carregar arquivos grandes inteiros na memória.
- O snapshot é verificado por manifesto antes de qualquer arquivo da instalação ser alterado; snapshots antigos só são invalidados depois dessa verificação.
- O pré-check passa a validar permissão de escrita, versão do Node.js e disponibilidade do MongoDB quando houver migrações.
- O health check padrão usa liveness barato e confirma também que a versão ativa do backend é exatamente a versão esperada.
- Em Termux com `node --watch`, se a nova versão voltar automaticamente, o atualizador reconhece isso e pode concluir sem exigir falso “reinício manual”.
- Comandos longos (`npm ci`, build, migrações, PM2/systemd) deixam de bloquear o event loop do worker; o heartbeat continua ativo durante essas etapas.
- Se dependências tiverem sido alteradas, rollback automático/manual também restaura a árvore de dependências da versão anterior usando o lockfile restaurado.
- O watchdog externo também tenta restaurar dependências quando uma falha ocorre depois de `npm`.
- Pacotes preparados antigos são podados automaticamente; por padrão são mantidos os 5 mais recentes (`AL_UPDATE_STAGE_KEEP`).
- Após atualização bem-sucedida, o staging utilizado é removido; journals/jobs antigos também têm retenção limitada.
- Bloqueia reinstalação de um pacote preparado cuja versão já não seja superior à instalada.
- A tela mostra operação ativa, manifesto do pacote, recuperação de emergência e impede ações concorrentes.
- Publicação GitHub também participa do lock/heartbeat para evitar commits concorrentes iniciados pelo painel.

## 1.0.36
- Adiciona Simulação / Pré-check obrigatório antes de instalar uma atualização local.
- O pré-check compara a instalação atual com o pacote e mostra arquivos novos, alterados, removidos e inalterados.
- Calcula espaço livre, tamanho estimado do snapshot, espaço de trabalho e reserva necessária antes da instalação.
- Classifica o risco da atualização em baixo, médio ou alto e bloqueia instalação quando falta espaço ou rollback de migração não é seguro.
- Mostra quais dependências realmente serão processadas e quais migrações de banco estão previstas.
- Ativa modo manutenção automaticamente antes de substituir arquivos e remove-o ao concluir ou fazer rollback.
- O portal público detecta o modo manutenção sem bloquear o carregamento normal quando o endpoint não responde.
- O marcador de manutenção possui autolimpeza contra jobs encerrados e estados abandonados após crash.
- Mantém por padrão os 3 snapshots mais recentes e remove automaticamente snapshots antigos para evitar crescimento ilimitado.
- A retenção pode ser ajustada por `AL_UPDATE_SNAPSHOT_KEEP`.
- Gera relatório final persistente do job com versão, duração, resultado, health check, dependências, migrações, arquivos previstos e erros.
- Ao retornar do monitor independente, a tela de Atualizações recupera o job e exibe automaticamente o relatório final.
- O backend repete o pré-check imediatamente antes de iniciar o worker, evitando instalar com uma simulação desatualizada.
- Corrige o monitor independente para importar explicitamente o servidor HTTP usado durante a atualização.

## 1.0.35
- Desacopla a atualização local do frontend/backend que estão sendo substituídos.
- Staging, snapshots, jobs e histórico passam a ficar fora da árvore do projeto em `~/.al-sistemas/updates` no Termux/VPS.
- Migra automaticamente o estado antigo de `backend/.al-sistemas/updates` quando necessário.
- O worker de atualização inicia um monitor HTTP independente antes de aplicar os arquivos.
- Ao confirmar uma instalação/rollback, o painel abre a página independente “Servidor sendo atualizado” antes da etapa de substituição.
- A página de monitoramento continua funcionando mesmo quando Vite ou `node --watch` reiniciam, mostrando percentual, etapa, backend/frontend e erros.
- Após a operação terminar e o frontend voltar a responder, o monitor retorna automaticamente para Admin → Atualizações.
- O painel persiste o ID do job no navegador e retoma a exibição do resultado depois da reconexão.
- Em VPS é possível expor o monitor por proxy configurando `AL_UPDATE_MONITOR_PUBLIC_URL`; no Termux o monitor usa uma porta local temporária.
- Mantém rollback automático executado pelo worker externo mesmo que o processo principal do AL Sistemas reinicie durante a atualização.

## 1.0.34
- Padroniza a ajuda de todas as integrações com instruções de obtenção das credenciais e links oficiais.
- MongoDB ganha links para criar conta Atlas e documentação oficial de conexão, além de passo a passo para obter a connection string.
- Cloudinary passa a explicar onde encontrar Cloud Name, API Key e API Secret, com link direto para a área de API Keys.
- Groq (IA padrão) ganha passo a passo, link direto para API Keys e formato esperado `gsk_...`.
- Anthropic, OpenAI, Gemini e OpenRouter ganham instruções próprias, links oficiais e exemplos/formato esperado das chaves.
- OpenRouter avisa para não usar Management API Key no campo de inferência.
- Provedor personalizado mantém orientação genérica, pois o local da chave depende do serviço escolhido.
- Links de ajuda ficam responsivos no mobile e abrem em nova aba.

## 1.0.33
- Corrige `Unsupported state or unable to authenticate data` ao reutilizar credenciais de uma instalação anterior.
- Credenciais persistidas no MongoDB deixam de depender do JWT_SECRET; passam a usar uma chave mestra estável.
- Credenciais legadas que ainda puderem ser abertas são migradas automaticamente para a nova criptografia.
- Credenciais antigas cuja chave foi perdida aparecem como “bloqueadas” e podem ser substituídas sem quebrar a tela.
- Em Termux/VPS, o cofre de bootstrap e `master.key` passam a ficar por padrão em `~/.al-sistemas`, fora da árvore do projeto.
- Migra automaticamente o cofre antigo de `backend/.al-sistemas` quando a chave correspondente estiver disponível.
- Limpar/refazer o setup não apaga mais `master.key`, preservando a capacidade de abrir GitHub, Cloudinary e APIs salvas no MongoDB.
- Melhora a tela de MongoDB com estado, provedor, banco, servidor e caminho do cofre persistente.
- Melhora Cloudinary e demais integrações com explicações de uso e aviso específico para credenciais bloqueadas.
- Adiciona Groq à tela de Integrações e identifica Groq como provedor padrão do assistente de IA.
- O teste de Groq agora valida ativamente a chave pela API; o status da IA considera credenciais salvas no MongoDB, não apenas `.env`.

## 1.0.32
- Adapta o módulo de Atualizações para ambientes serverless/Vercel.
- Detecta automaticamente a Vercel por variáveis do runtime e desativa “Instalar neste servidor”.
- Na Vercel, staging, jobs e arquivos temporários nunca são gravados dentro da árvore do projeto; usa-se apenas `/tmp` durante a requisição.
- O ZIP validado permanece no navegador até a publicação; não depende de staging persistente entre Functions.
- A publicação GitHub/Vercel reenvia o ZIP e executa validação, extração temporária, commit e limpeza na mesma requisição.
- O publicador GitHub pode executar no mesmo processo Node, sem depender de worker destacado em ambiente serverless.
- Termux/VPS preservam o fluxo existente de staging persistente, snapshots, instalação local, rollback e acompanhamento assíncrono.
- Na Vercel, a tela explica que histórico/rollback duráveis pertencem ao GitHub e aos deployments, não ao filesystem local da Function.

## 1.0.31
- Atualiza a orientação da integração GitHub para Personal Access Token (classic), adequado ao uso administrativo amplo do AL Sistemas.
- Adiciona link direto para criar e gerenciar tokens classic.
- Explica os escopos `repo`, `public_repo`, `workflow` e `delete_repo`, deixando claro que exclusão é opcional e de alto privilégio.
- Mantém compatibilidade com fine-grained PAT, mas deixa de recomendá-lo como padrão para a integração administrativa.
- Melhora a mensagem `Resource not accessible by personal access token`, indicando falta de permissão de publicação e a credencial recomendada.

## 1.0.30
- Corrige publicação GitHub em repositórios vazios.
- O publicador detecta `Git Repository is empty`, cria uma árvore sem base, o primeiro commit e a primeira branch automaticamente.
- Se a branch escolhida ainda não existir em um repositório com commits, usa a branch padrão como base e cria a nova branch ao final.
- A caixa de progresso passa a mostrar “Repositório vazio — preparando primeiro commit” quando esse cenário for detectado.

## 1.0.29
- Corrige a regressão de carregamento no Termux causada pela invalidação do cache do Vite em toda atualização.
- O cache do Vite volta a ser estável e só é invalidado quando dependências do frontend ou vite.config realmente mudam.
- Durante atualização no Termux, o build tenta pré-aquecer o cache do Vite para reduzir a espera no primeiro acesso.
- Atualizações passam a oferecer dois destinos: instalar neste servidor ou publicar pelo GitHub/Vercel.
- O modo GitHub lista os repositórios autorizados pela integração já configurada e usa a branch padrão do repositório.
- Permite publicar projeto completo, frontend em /frontend, frontend na raiz de um repositório dedicado à Vercel ou backend em /backend.
- A publicação cria blobs/árvore/commit no GitHub e atualiza a branch sem armazenar o token no arquivo do job.
- O progresso da publicação aparece na mesma caixa de acompanhamento da atualização e registra o commit no histórico.
- Arquivos persistentes e sensíveis (.env, .al-sistemas, uploads, backups, logs e node_modules) nunca são enviados pelo publicador.

## 1.0.28
- Substitui as confirmações padrão do navegador por modal visual do próprio AL Sistemas ao instalar atualização ou executar rollback.
- Adiciona box persistente de progresso da atualização com percentual e etapa atual.
- O worker registra etapas reais: backup, arquivos, cache, dependências, build, migrações, reinício, health check, conclusão e rollback automático.
- O histórico visual da operação mostra as últimas etapas concluídas e erros sem desaparecer após clicar em Instalar.
- O box também informa quando o ambiente exige reinício manual.

## 1.0.27
- Corrige o layout responsivo da tela Admin → Desenvolvimento → Atualizações.
- Impede estouro horizontal causado por nomes de arquivos, IDs de jobs, changelog e informações de reinício.
- No mobile, resumo de versão/reinício passa para uma coluna e ações de Instalar/Rollback ocupam largura adequada.
- Corrige o seletor de ZIP para não empurrar o layout lateralmente.
- Ajusta os cards do ambiente do servidor para 2 colunas no celular e 1 coluna em telas muito estreitas.

## 1.0.26
- Redesenha a conexão do GitHub em Admin → Integrações e APIs como assistente.
- “Testar e conectar” valida o token digitado antes de salvá-lo no cofre.
- Detecta automaticamente conta/usuário do GitHub; usuário ou organização deixam de ser campos obrigatórios.
- Lista todos os repositórios acessíveis pela credencial, com paginação da API.
- Repositório padrão passa a ser opcional; sem padrão, o usuário escolhe entre os repositórios autorizados quando necessário.
- Exibe diagnóstico de token, conta, repositórios acessíveis e capacidade de escrita da conta.
- Adiciona instruções na própria tela para criar um Fine-grained PAT e recomenda Contents: Read and write.
- Permite trocar o token, atualizar a lista de repositórios, salvar branch/preferência e desconectar a integração.

## 1.0.25
- O atualizador agora verifica a integridade física das dependências instaladas, não apenas mudanças no lockfile.
- Detecta instalações incompletas/corrompidas, incluindo arquivos essenciais do Tailwind/Vite/React.
- Quando o lockfile não mudou, repara somente os pacotes afetados e usa `npm install --prefer-offline`.
- Quando a árvore de dependências mudou, mantém reinstalação completa e prioriza o cache npm.
- A tela de Atualizações diferencia dependências íntegras, reparo e reinstalação.

## 1.0.24
- Padroniza globalmente o espaçamento responsivo do Admin.
- Define 14 px laterais no celular, 20 px em tablet e 24 px em desktop.
- Remove paddings duplicados de Integrações e APIs, Segurança e Atualizações.
- Corrige largura/box-sizing do conteúdo administrativo para evitar margens inconsistentes.

## 1.0.23
- Melhora o espaçamento lateral responsivo de Admin → Integrações e APIs, aproveitando melhor telas de celular e ajustando o cabeçalho dos cards.

## 1.0.22 — 09/08/2026

### Diagnóstico visual de inicialização do setup
- Adiciona diagnóstico visual progressivo quando o primeiro uso demora mais de ~700 ms.
- Exibe etapas separadas para frontend, resposta de `/api/setup/status`, redirecionamento e carregamento do módulo do assistente.
- Mede o tempo total HTTP e o tempo efetivamente gasto dentro do backend, permitindo separar lentidão de Vite/navegador/rede local de lentidão no servidor.
- O backend informa métricas seguras de boot (`servidor_ms`, uptime e PID), sem expor credenciais.
- O setup reaproveita o resultado do `FirstRunGuard` por até 30 segundos, eliminando uma segunda chamada redundante a `/api/setup/status`.
- O formulário inicial mantém um resumo de desempenho com botão **Copiar diagnóstico** para facilitar a investigação no Termux.
- O fallback do chunk `AdminSetup` também mostra cronômetro, permitindo identificar demora de processamento/carregamento do Vite.

## 1.0.21 — 09/08/2026

### Correções de primeiro uso, Vite/React e diagnóstico
- Corrige o primeiro uso: uma instalação sem `INSTALL_COMPLETED` agora redireciona para `/admin/setup` mesmo quando o usuário abre diretamente `/`.
- A checagem de setup continua local e não consulta MongoDB, preservando a otimização de desempenho da Home.
- O boot HTML verifica o setup antes de buscar configurações públicas, evitando `503` desnecessário numa instalação nova.
- Cache otimizado do Vite agora é isolado por versão (`.vite-X.Y.Z`) para impedir reaproveitamento de chunks antigos do React após atualizações.
- React e ReactDOM recebem aliases exatos para uma única instalação física no ambiente Vite/Termux.
- Atualizador limpa caches `.vite` e `.vite-*` durante update e rollback.
- Tela global de erro passa para tema claro, alinhado ao portal, e a tela `ROUTE_ERROR` ganha botão para copiar diagnóstico.
- Cópia do relatório possui fallback para ambientes onde `navigator.clipboard` não estiver disponível.
- `GET /` do backend agora retorna diagnóstico simples da API em vez de `404`.
- Backend não agenda reconexões inúteis quando o MongoDB ainda não foi configurado; aguarda o setup.
- Redis vazio não tenta mais `localhost:6379`; cache em memória é ativado diretamente.

## 1.0.20 — 09/08/2026

### Inicialização e desempenho
- Corrigida a causa do erro “O backend não respondeu em 10 segundos” durante conexão/reconexão do MongoDB Atlas.
- Desativado o buffer de comandos do Mongoose: enquanto o banco não está pronto, rotas dependentes respondem `503 DB_NOT_READY` imediatamente em vez de ficarem penduradas.
- Backend agora tenta reconectar ao MongoDB automaticamente com backoff, sem exigir reinício manual após falhas transitórias de rede/Atlas.
- GETs do frontend aguardam e repetem de forma curta/transparente quando recebem `DB_NOT_READY`.
- Publicação de notícias agendadas foi removida do caminho crítico de `GET /api/noticias` e passou para um agendador interno em background a cada 30 segundos.
- `GET /api/health` agora testa apenas o núcleo necessário para subida/rollback; integrações externas ficam em `/api/health/detalhado`.
- Adicionado liveness barato em `/api/health/live`, sem consultas a serviços externos.
- Cache de categorias foi deduplicado no navegador e adicionado no backend; consultas públicas de configurações/módulos usam objetos lean.

## 1.0.19 — 09/08/2026

### Usuários e segurança
- Sessões agora possuem versão vinculada ao usuário; tokens antigos deixam de valer após ações de segurança.
- Alterar senha, redefinir senha ou ativar/desativar uma conta revoga as sessões anteriores.
- Nova ação administrativa para encerrar todas as sessões de outro usuário.
- Nova ação para desbloquear manualmente contas bloqueadas por tentativas de login.
- O último superadministrador ativo não pode ser excluído, desativado ou perder acesso total.
- Edição de usuário agora valida conflito de email e existência do perfil de acesso.
- Tela de usuários mostra último acesso, última alteração de senha e indicador de quem nunca acessou.
- Corrigida a ordenação por último login para usar o campo real `ultimo_acesso`.

# Changelog

## 1.0.18 — 09/08/2026

### Desempenho do portal público
- Home e demais rotas públicas deixam de aguardar `/api/setup/status`.
- Autenticação passa a ser carregada sob demanda apenas em login/rotas protegidas.
- `/api/setup/status` deixa de contar coleções do MongoDB durante o boot e usa o estado local do setup.
- Configurações públicas ganham cache/deduplicação no frontend, evitando chamadas repetidas por Home, Navbar, Footer e metadados.
- A configuração carregada no boot HTML é reutilizada pelo React, eliminando uma segunda consulta imediata.
- A Home deixa de depender de um chunk lazy separado, reduzindo o waterfall de módulos na primeira abertura.
- Removido `React.StrictMode` do bootstrap para evitar execução duplicada de efeitos durante testes no Vite/Termux.
- Corrigida documentação interna antiga que descrevia o projeto como admin-only.

## 1.0.17 — Home jornalística, Plantão e fluxo editorial

- Home pública reformulada com capa jornalística: manchete principal e destaques secundários.
- Novo modo Plantão/Urgente com faixa no topo e validade opcional.
- Fluxo editorial ampliado para Rascunho → Revisão → Agendada → Publicada → Arquivada.
- Agendamento com publicação automática ao atingir a data/hora, sem depender de cron externo.
- Admin de notícias passa a exibir contagem/filtro de matérias agendadas e controles de plantão.
- Mantida compatibilidade com notícias e configurações já existentes.

# Changelog

## 1.0.16 — 2026-08-09

- Setup detecta uma instalação existente do AL Sistemas já no teste da conexão MongoDB.
- Em vez de falhar somente no fim com “Setup já foi realizado”, o assistente informa quantos usuários foram encontrados e bloqueia a criação de outro administrador.
- Adicionada opção para substituir a configuração local e reutilizar a instalação já existente no banco informado.
- Adicionada limpeza segura da configuração local: remove apenas o cofre e a chave de bootstrap, preservando MongoDB, uploads, backups, logs e histórico de atualizações.
- Operações de manutenção do setup em uma instalação local já concluída exigem autenticação.

## 1.0.15 — 2026-08-09

- Adicionado **Importar credenciais do MongoDB Atlas** na primeira etapa do setup.
- Aceita arquivos `.env`/texto com `MONGODB_URI`, `MONGODB_USERNAME` e `MONGODB_PASSWORD` (e aliases `MONGO_*`).
- Preenche automaticamente cluster, usuário e senha do Atlas; o nome do banco também é aproveitado quando estiver presente no arquivo.
- O arquivo de credenciais é processado localmente pelo navegador, sem upload ou persistência do arquivo bruto.
- A configuração só é gravada no cofre criptografado depois de **Testar e salvar conexão**.
- Mantido o fluxo manual para Atlas, MongoDB Community/VPS e URI avançada.

## 1.0.14 — 2026-08-09

- Limpa automaticamente `frontend/node_modules/.vite` após aplicar uma atualização.
- Preserva o restante de `node_modules` quando as dependências não mudam.
- Limpa o cache do Vite também após rollback de arquivos.
- Evita reutilização de chunks otimizados incompatíveis do React/Vite depois de uma troca de versão.

## 1.0.13 — Identidade pública no carregamento

- A tela **“Iniciando painel...”** foi substituída por um carregamento visualmente alinhado ao portal público, com fundo claro e verde da identidade atual.
- O texto passa a dizer **“Carregando portal de notícias...”**.
- Antes mesmo do React iniciar, o frontend consulta `/api/configuracoes` e usa `nome_site` como nome exibido no carregamento.
- **Admin → SEO → Identidade** agora mostra explicitamente **Nome público do portal**, permitindo alterar `nome_site` pelo painel.
- A navbar pública passa a usar o mesmo `nome_site` em vez de exibir “AL Sistemas” de forma fixa.
- `site_titulo` continua independente para SEO/título da aba, usando o nome público como fallback.
- “AL Sistemas” permanece como nome interno do produto e fallback técnico.

## 1.0.12 — Diagnóstico do ambiente de atualização

- Adicionada a seção **Ambiente do servidor** em Admin → Desenvolvimento → Atualizações.
- Detecta automaticamente Termux, Linux/VPS, versão do Node.js, arquitetura e o gerenciador de processo em uso.
- Quando executado no Termux, mostra um aviso específico explicando que upload/preparação do ZIP funcionam offline e que rede só é necessária quando houver mudança real de dependências.
- Esta versão foi criada como uma alteração pequena e visível para validar o fluxo de atualização 1.0.11 → 1.0.12 pelo próprio painel.


## 1.0.11 — Atualização do sistema via painel

- Nova área **Admin → Desenvolvimento → Atualizações**.
- Upload e validação de pacotes `alsistemas-X.Y.Z.zip` com conferência de produto e versão.
- Changelog exibido antes da instalação e extração sempre em staging temporário.
- Snapshot automático dos arquivos substituíveis antes de aplicar uma versão.
- Preservação de `.env`, `backend/.al-sistemas/`, uploads, backups, logs e outros dados persistentes.
- Comparação de `package-lock.json`/`package.json` para evitar `npm install` desnecessário.
- Suporte a migrations com `migrate-mongo` quando o pacote trouxer novas migrações.
- Estratégias de reinício `none`, PM2 e systemd, com health check e rollback automático.
- Histórico de operações e rollback manual por snapshots seguros.

## 1.0.10 — Navegação administrativa reorganizada

- Menu principal reduzido a cinco entradas: Dashboard, Conteúdo, Desenvolvimento, Infraestrutura e Administração.
- Todas as páginas e rotas existentes foram preservadas; apenas a navegação foi reagrupada por contexto.
- Drawer mobile agora funciona como acordeão: apenas um grupo fica aberto por vez.
- O grupo da rota atual é aberto automaticamente ao navegar.
- Corrigida a detecção de rota ativa para `/`, que podia marcar “Ver site” como ativo dentro do admin.
- Rótulos refinados para facilitar descoberta (ex.: Usuários e acessos, Aparência e temas, Configuração inicial).

## 1.0.9 — Correção de ciclo de vida do React

- Corrigido `TypeError: destroy is not a function` ao desmontar determinadas telas.
- `AdminIntegracoes` não passa mais função que retorna Promise diretamente ao `useEffect`.
- O fluxo de publicação de projeto agora devolve ao React apenas uma função de cleanup válida para fechar o EventSource.
- Revisão preventiva dos `useEffect` do frontend para evitar cleanup inválido.

# Changelog

## 1.0.8 — Atlas sem porta e setup claro

- Corrige o modo MongoDB Atlas para nunca adicionar, reaproveitar ou expor porta explícita em URIs `mongodb+srv://`.
- Sanitiza o campo de cluster do Atlas, aceitando hostname ou Connection String colada e removendo credenciais, caminho, query e `:27017` quando presentes.
- Mantém porta `27017` exclusivamente para MongoDB Community/VPS (`mongodb://`).
- Troca o instalador escuro por uma identidade clara com superfícies brancas, fundo suave, verde como ação e azul como informação.
- Redesenha também a tela de instalação concluída para usar a mesma identidade clara e melhorar a legibilidade no celular.

## 1.0.7 — Inicialização mais rápida

- Remove o bloqueio global do `AuthProvider`: o app não fica mais em branco aguardando `/api/auth/me`.
- Verificação de sessão e status do setup passam a acontecer em paralelo.
- Rotas privadas continuam protegidas e exibem estado de carregamento somente quando necessário.
- `FirstRunGuard` deixa de consultar `/api/setup/status` a cada mudança de rota.
- Diagnóstico pesado da tela de login deixa de executar automaticamente e passa a ser sob demanda.
- Adiciona splash inicial mínimo no HTML para existir feedback visual antes do React carregar.
- Fontes Google deixam de bloquear o primeiro paint e a lista de famílias/pesos foi reduzida.

## 1.0.5 — Persistência do setup e boot resiliente

## 1.0.6 - 2026-08-09

### Melhorias
- Nova experiência visual para erros globais, falhas de carregamento, indisponibilidade da API e páginas 404.
- Diagnóstico técnico ficou recolhível e pode ser copiado sem expor o stack por padrão.
- Ações contextuais de tentar novamente, recarregar, voltar e ir ao início.
- Erro de carregamento de módulo oferece limpeza de cache somente quando relevante.

### Correções
- Falha em `/api/setup/status` não é mais interpretada como instalação ausente; agora mostra indisponibilidade do servidor sem redirecionar para o setup.
- Página 404 deixa de usar layout improvisado e passa a seguir a identidade visual do sistema.


- Corrige redirecionamento indevido para `/admin/setup` quando o MongoDB ainda está reconectando.
- Adiciona marcador criptografado `INSTALL_COMPLETED` ao concluir a instalação.
- Torna o caminho padrão do cofre estável em `backend/.al-sistemas`, com migração do local legado quando possível.
- O servidor HTTP passa a abrir antes das conexões MongoDB/Redis/Cloudinary.
- Esclarece que o setup não gera `.env`; credenciais do bootstrap ficam no cofre local criptografado.


## 1.0.3 — MongoDB Atlas e VPS

- Setup permite escolher MongoDB Atlas, MongoDB Community em VPS ou URI avançada.
- Atlas usa cluster, usuário e senha; VPS usa host, porta, usuário, senha, authSource e TLS opcional.
- Nome do banco continua explícito, com padrão `alsistemas`.
- Credenciais estruturadas são transformadas em uma URI interna compatível com Mongoose e armazenadas no cofre criptografado.
- A configuração mantém compatibilidade com `mongodb+srv://` e `mongodb://`, Docker e URIs personalizadas.
- Metadados do provedor são preservados para diagnóstico e futuras migrações de infraestrutura.
## 1.0.2 — 2026-08-07

- Setup reorganizado em 6 etapas: Banco, Organização, Site, Administrador, Dados iniciais e Revisão.
- MongoDB agora usa explicitamente o banco `alsistemas` por padrão, evitando cair no database `test`.
- Nome do banco pode ser definido no próprio wizard.
- Seed de notícias passa a gerar slugs determinísticos e usar upsert, corrigindo `E11000 ... slug: null`.
- Organização e nome do site são persistidos mesmo quando o usuário opta por não importar dados de exemplo.
- Senha e confirmação ficam visíveis inicialmente no setup, com botão para ocultar/mostrar.

# Changelog

Todas as mudanças notáveis deste projeto são documentadas aqui.

## 1.0.1 — 2026-08-07 — Wizard: contraste e identidade visual

- Corrigido texto digitado invisível nos campos do wizard standalone.
- Inputs, labels e cartões deixam de depender das variáveis CSS do painel autenticado.
- Nova paleta escura coerente em azul profundo, verde de ação e azul informativo.
- Melhorado contraste de revisão, mensagens, botões e estados de foco/erro.
- Versão interna sincronizada para 1.0.1.

## 2026-08-07 — Novo wizard de instalação

- Redesenhado `/admin/setup` como wizard em 5 etapas: MongoDB, site, administrador, conteúdo e revisão.
- MongoDB agora é validado e testado antes de liberar o avanço.
- URI inválida não é mais persistida no cofre; mensagens de esquema inválido foram tornadas amigáveis.
- Campo da URI mostra o texto digitado e possui controle para mostrar/ocultar.
- Integrações opcionais foram removidas do caminho crítico da primeira instalação.


Formato baseado em [Conventional Commits](https://www.conventionalcommits.org/pt-br/).
