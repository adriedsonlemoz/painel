# 🚀 Deploy — Render (Backend) + Vercel (Frontend)

## Arquitetura

```
GitHub ──push──► Render  → Backend Node.js  (api.seudominio.com)
                 Vercel  → Frontend Vite     (seudominio.com)
                 MongoDB Atlas               (banco de dados)
                 Cloudinary                  (upload de imagens)
                 Redis Upstash (opcional)    (cache)
```

---

## 1. Pré-requisitos — crie as contas antes de começar

| Serviço | URL | Plano gratuito |
|---|---|---|
| MongoDB Atlas | https://cloud.mongodb.com | ✅ 512 MB |
| Cloudinary | https://cloudinary.com | ✅ 25 créditos/mês |
| Render | https://render.com | ✅ (spin-down após 15 min sem acesso) |
| Vercel | https://vercel.com | ✅ ilimitado para projetos pessoais |
| Redis Upstash | https://upstash.com | ✅ 10.000 req/dia — **opcional** |

---

## 2. MongoDB Atlas

1. Crie uma conta → **Create a cluster** → escolha o tier gratuito (M0).
2. Em **Database Access**: crie um usuário com a role `readWrite`.
3. Em **Network Access**: adicione `0.0.0.0/0` (necessário para o Render acessar).
4. Clique em **Connect → Drivers** e copie a connection string:
   ```
   mongodb+srv://<usuario>:<senha>@cluster0.xxxxx.mongodb.net/al-sistemas?retryWrites=true&w=majority
   ```
5. Guarde essa string — ela será o valor de `MONGO_URI`.

---

## 3. Backend no Render

### 3.1 Criar o serviço

1. Acesse https://dashboard.render.com → **New → Web Service**
2. Conecte seu repositório GitHub e selecione-o
3. Preencha os campos:

| Campo | Valor |
|---|---|
| Name | `alsistemas-backend` |
| **Root Directory** | `backend` |
| Runtime | Node |
| Build Command | `npm install --omit=dev --no-audit --no-fund` |
| Start Command | `node src/server.js` |
| Plan | Free |

> ⚡ Se preferir usar o `render.yaml` incluso no projeto:
> No dashboard → **New → Blueprint** → selecione o repositório.
> O Render lerá o arquivo automaticamente e pré-preencherá os campos.

### 3.2 Variáveis de ambiente

### Credenciais no painel (1.0.149+)

Cloudflare/R2, GitHub, Vercel, Render e demais integrações devem preferencialmente ser cadastradas em **Admin → Integrações e APIs**. Variáveis de ambiente continuam válidas como fallback de migração. A interface não recebe todos os segredos no carregamento: cada valor recuperável é solicitado individualmente ao backend somente quando o administrador escolhe **Visualizar** ou **Copiar**.

Na Vercel/Render, uma variável pode estar configurada e ainda assim não ser recuperável. O painel respeita a resposta/tipo fornecido pelo provedor e nunca substitui uma máscara pelo suposto valor original.



Para uma instalação já migrada para a 1.0.83, o único segredo externo obrigatório no Render é:

```env
MONGO_URI=mongodb+srv://<usuario>:<senha>@cluster0.xxxxx.mongodb.net/al-sistemas?retryWrites=true&w=majority
```

`MONGO_DB_NAME=alsistemas` é opcional. JWT, estado do Setup e chave-mestra das Integrações são reconstruídos pelo bootstrap persistente do MongoDB. Render, Vercel, GitHub, Gemini, OpenRouter, Cloudinary e demais credenciais ficam em **Integrações e APIs**.

Se estiver fazendo o primeiro corte sem ter executado a 1.0.83 no ambiente antigo, `FRONTEND_URL` pode ser usado temporariamente como fallback de CORS.

#### Ajustes opcionais do motor de IA (1.0.100+)

As chaves Gemini/OpenRouter continuam no cofre de **Integrações e APIs**. Somente parâmetros operacionais opcionais precisam de variáveis de ambiente quando você quiser sobrescrever os padrões:

```env
AI_TIMEOUT_MS=20000
AI_OPERATION_TIMEOUT_MS=45000
AI_CONCURRENCY=2
AI_MAX_QUEUE=100
AI_CIRCUIT_FAILURES=3
AI_CIRCUIT_COOLDOWN_MS=60000
```

Em Render, os padrões são adequados para começar. Aumente concorrência somente se a cota dos provedores suportar; reduzir concorrência costuma ser melhor para contas gratuitas.

### 3.3 Health check e auto-deploy

- O Render deve monitorar `/api/health/live`, que testa somente se o processo HTTP está vivo e não derruba o serviço por uma oscilação temporária do MongoDB.
- Marque **Auto-Deploy** para que cada push na `main` atualize o backend.
- Anote a URL gerada, ex: `https://alsistemas-backend.onrender.com`

---

## 4. Frontend no Vercel

### 4.1 Importar o projeto

1. Acesse https://vercel.com/new
2. Importe o mesmo repositório GitHub
3. Configure:

| Campo | Valor |
|---|---|
| **Root Directory** | `frontend` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install --no-audit --no-fund` |

### 4.2 Variáveis de ambiente

Em **Settings → Environment Variables**:

```env
VITE_API_URL=https://alsistemas-backend.onrender.com/api

### Sessão administrativa Vercel → Render (1.0.90)

O backend continua emitindo cookie HttpOnly. Como `*.vercel.app` e `*.onrender.com` são sites diferentes e alguns navegadores podem bloquear cookies de terceiros, o AL também entrega um token Bearer temporário **somente no login cross-origin**. O frontend testa imediatamente se o cookie foi aceito: quando funciona, descarta o Bearer e continua só no HttpOnly; quando é bloqueado, mantém o fallback em `sessionStorage`. Termux/VPS same-origin não recebe esse token.

Depois do deploy, abra **Admin → Infraestrutura → Ambientes**. A tela deve mostrar:
- origem Vercel autorizada no CORS;
- API do build apontando para o Render + `/api`;
- versão do frontend igual à versão do backend;
- transporte de sessão `bearer` no caso em que o fallback cloud estiver em uso, ou `cookie` quando o navegador aceitou o cookie.

VITE_APP_NAME=AL Sistemas
VITE_APP_TAGLINE=Painel de Gerenciamento
VITE_APP_VERSION=1.0.131
VITE_APP_ENV=production
VITE_MODULE_PORTAL=true
VITE_MODULE_GITHUB=true
```

> ⚠️ Variáveis `VITE_*` são embutidas no bundle durante o build.
> Qualquer alteração requer um **redeploy** (Deployments → Redeploy).

### 4.3 Roteamento SPA

O arquivo `frontend/vercel.json` já está configurado:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```
Não altere — ele garante que rotas como `/admin/dashboard` funcionem
após recarregar a página.

---

## 5. Conectar backend ↔ frontend (CORS)

Na 1.0.83, abra **Admin → Central de Plataformas → Conectar produção** e selecione:

- o projeto Vercel do frontend;
- o serviço Render do backend;
- a URL pública do portal.

O backend passa a sincronizar as origens da conta Vercel conectada. `FRONTEND_URL` continua aceito apenas como fallback para a primeira migração ou para uma origem externa que ainda não esteja cadastrada.

`ALLOW_VERCEL_PREVIEWS=true` continua opcional quando você deseja permitir previews `*.vercel.app`.

---

## 6. Setup e administrador

Se `MONGO_URI` aponta para um banco **já usado pelo AL Sistemas**, os usuários existentes são detectados automaticamente e o Setup não é reaberto.

Se o banco estiver vazio, abra o frontend e conclua `/admin/setup`; o primeiro administrador será criado pelo wizard.

### Migração da instalação existente

Antes do corte definitivo Termux → Render/Vercel, execute a 1.0.83 uma vez no ambiente antigo com o mesmo `MONGO_URI`. Esse boot migra o bootstrap criptográfico para o MongoDB de forma selada. Depois publique a mesma versão no GitHub.


## 7. Migrations do banco (se necessário)

Para aplicar migrations pendentes pelo Shell do Render:
```bash
npm run migrate
npm run migrate:status   # verifica quais foram aplicadas
```

---

## 8. Otimizações de performance

### Backend (Render)

| O que | Solução |
|---|---|
| Evitar spin-down no plano free | Configure um ping a cada 14 min via [UptimeRobot](https://uptimerobot.com) apontando para `/api/health` |
| Cache persistente entre restarts | Adicione `REDIS_URL` do Upstash |
| Compressão Brotli | Já ativo via `compression()` — sem configuração adicional |
| Logs estruturados | Pino já configurado — visíveis na aba Logs do Render |

### Frontend (Vercel)

| O que | Solução |
|---|---|
| Cache de assets estáticos | Vite gera hashes nos nomes dos arquivos; Vercel aplica `max-age=31536000` automaticamente |
| Service Worker | `public/sw.js` com versionamento automático por build |
| Build mais rápido | Vite já usa esbuild internamente — sem configuração adicional |

---

## 9. Domínio personalizado

**Vercel:** Settings → Domains → Add Domain
**Render:** Settings → Custom Domains → Add Custom Domain

Ambos emitem certificado TLS (HTTPS) automaticamente via Let's Encrypt.
Após configurar um novo domínio no Vercel, use **Central de Plataformas → Sincronizar URLs**.

---

## 10. Checklist antes de ir a produção

- [ ] Nenhum `.env` real está commitado no repositório (verificar com `git status`)
- [ ] Projeto Vercel e serviço Render conectados em **Central de Plataformas**
- [ ] `VITE_API_URL` no Vercel aponta para a URL real do Render + `/api`
- [ ] MongoDB Network Access configurado (0.0.0.0/0 ou IPs fixos do Render)
- [ ] Auto-Deploy habilitado no Render e no Vercel

## Deploy contínuo recomendado: GitHub → Render + Vercel

Para produção em nuvem, o atualizador local não deve tentar substituir arquivos dentro do Render ou da Vercel. O fluxo recomendado é:

1. Publicar o pacote completo no repositório GitHub pelo módulo **Atualizações → GitHub / Vercel**.
2. O **Render** acompanha a branch do backend e cria um novo deploy do serviço Node.
3. A **Vercel** acompanha a mesma branch com Root Directory `frontend` e cria o novo frontend.
4. Pacotes incrementais continuam exclusivos do atualizador em servidores persistentes (Termux/VPS).

O `render.yaml` da raiz já configura o backend com health check em `/api/health/live`. Na Vercel, configure obrigatoriamente `VITE_API_URL` com a URL pública do backend Render terminando em `/api`.

## Atualização via painel (VPS)

A partir da versão 1.0.11, o AL Sistemas possui **Admin → Desenvolvimento → Atualizações**.
O atualizador trabalha em duas etapas: primeiro valida/extrai o pacote em staging; depois, mediante ação explícita do administrador, cria snapshot e aplica os arquivos.

Variáveis opcionais para VPS:

```env
AL_UPDATE_RESTART_STRATEGY=pm2
AL_UPDATE_PM2_NAME=al-sistemas
AL_UPDATE_SYSTEMD_SERVICE=al-sistemas.service
AL_UPDATE_HEALTH_URL=http://127.0.0.1:3001/api/health/live
```

`AL_UPDATE_RESTART_STRATEGY` aceita `none`, `pm2` ou `systemd`. Em `systemd`, a tarefa de atualização é iniciada com `systemd-run` para permanecer fora da unidade principal durante o reinício. O usuário do serviço precisa de permissão para executar o restart configurado.

Dados persistentes como `.env`, `backend/.al-sistemas/`, uploads, backups e logs não são substituídos. Snapshots de versão ficam em `backend/.al-sistemas/updates/snapshots/` e o histórico em `backend/.al-sistemas/updates/history.json`.

### GitHub / publicação Wizard (1.0.91)
- A publicação GitHub-first agora usa wizard modal e preserva o fluxo cloud R2/GitHub/Vercel/Render introduzido nas versões anteriores.


### Diagnóstico de GitHub Actions (1.0.92)

A análise de logs é feita no backend usando o token GitHub do cofre central. O ZIP completo continua disponível. Gemini/OpenRouter são opcionais: o resumo estrutural funciona sem IA; diagnóstico e sugestão exigem ao menos um provedor ativo em Integrações e APIs.


### Acompanhamento cloud do atualizador (1.0.94)

No fluxo gerenciado, o painel separa R2, GitHub, Vercel e Render. O upload exibe progresso real; após o commit, a Central consulta as APIs de Vercel e Render até confirmar a produção. O progresso geral não chega a 100% apenas pelo commit.

### Publicação GitHub/R2 (1.0.93)

O Wizard mostra o progresso de upload do ZIP. Com snapshot R2 habilitado, o pacote é salvo em `projects/<owner>/<repo>/snapshots/<branch>/` antes do commit. Após o upload chegar a 100%, o backend ainda valida/descompacta e publica no GitHub.

### Central online de diagnóstico (1.0.95)

Em Vercel + Render, use **Admin → Erros e logs** para acompanhar ocorrências do AL, GitHub Actions, Vercel, Render e MongoDB. As credenciais continuam centralizadas em Integrações e APIs. Logs externos são consultados sob demanda e não são duplicados integralmente no MongoDB. O diagnóstico VPS fica preparado para ativação futura; o diagnóstico Termux continua disponível como legado.


### SEO e diagnóstico externo (1.0.96)

SEO é persistido no MongoDB e confirmado após a escrita. Em produção cloud, ocorrências externas podem ser acompanhadas localmente pelo AL com estados e notas sem apagar ou alterar logs/deploys nas plataformas.


## Página de status independente e fallback público (1.0.143+)

A página de monitoramento fica no próprio frontend Vercel e não depende do backend Render:

- `https://SEU-FRONTEND.vercel.app/status/` — interface de status.
- `https://SEU-FRONTEND.vercel.app/api/status` — JSON bruto da checagem.
- `https://SEU-FRONTEND.vercel.app/api/news-fallback` — snapshot público usado como contingência.

### 1. Backend / Cloudflare R2

O backend usa o R2 já configurado no painel e cria automaticamente:

`alsistemas/fallback/public-snapshot-v1.json`

Por padrão, a cópia é renovada a cada 5 minutos e após alterações editoriais importantes. Variáveis opcionais no backend:

```env
PUBLIC_SNAPSHOT_INTERVAL_MS=300000
PUBLIC_SNAPSHOT_NEWS_LIMIT=250
```

O bucket precisa ter uma URL pública configurada em `CF_R2_PUBLIC_URL`.

### 2. Vercel

Em **Project → Settings → Environment Variables**, configure uma das opções:

```env
CF_R2_PUBLIC_URL=https://seu-dominio-publico-r2
```

ou a URL completa:

```env
NEWS_FALLBACK_URL=https://seu-dominio-publico-r2/alsistemas/fallback/public-snapshot-v1.json
```

Depois faça um novo deploy do frontend para a Function receber a variável. `NEWS_FALLBACK_URL` tem prioridade quando as duas forem definidas.

### 3. Serviços monitorados

Sem configuração adicional, `/status/` testa AL Sistemas API e GuiaDoA. Para personalizar:

```env
STATUS_SERVICES_JSON=[{"id":"al-sistemas-api","name":"AL Sistemas API","url":"https://al-sistemas-api.onrender.com/api/health/live","provider":"Render"},{"id":"guiadoa","name":"GuiaDoA","url":"https://guiadoa-agrq.onrender.com/","provider":"Render"}]
```

### 4. Ordem de contingência do portal

1. API principal no Render.
2. Snapshot R2 através de `/api/news-fallback` na Vercel.
3. Último snapshot salvo pelo navegador/Service Worker.

O painel administrativo continua exigindo o backend e nunca usa dados antigos para operações de escrita.
## URL pública R2 automática (1.0.144+)

Com um API Token Cloudflare que possua acesso de leitura ao R2, abra **Cloudflare / R2 → R2 Storage** e clique em **Usar no AL** no bucket desejado. O AL Sistemas consulta automaticamente `domains/custom` e `domains/managed`, salva a melhor URL pública disponível e a exibe para copiar. Isso reduz a necessidade de preencher `CF_R2_PUBLIC_URL` manualmente; na Vercel, mantenha a variável quando o fallback serverless precisar acessar diretamente o R2.


## Gerenciar variáveis pelo próprio AL Sistemas (1.0.145+)

Depois de conectar Vercel e Render em **Integrações e APIs**, abra **Projetos e Deploys → Variáveis**. A central usa as APIs oficiais para criar, atualizar ou remover Environment Variables sem expor os tokens no frontend. Use **Salvar sem deploy** para apenas persistir a configuração ou **Salvar + deploy** para publicar imediatamente.

Para o fallback do portal, **Cloudflare → R2** oferece **Aplicar na Vercel**, que define `CF_R2_PUBLIC_URL` no frontend principal e inicia um redeploy automaticamente.
