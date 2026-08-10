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
| Build Command | `npm ci --omit=dev` |
| Start Command | `node src/server.js` |
| Plan | Free |

> ⚡ Se preferir usar o `render.yaml` incluso no projeto:
> No dashboard → **New → Blueprint** → selecione o repositório.
> O Render lerá o arquivo automaticamente e pré-preencherá os campos.

### 3.2 Variáveis de ambiente

Na aba **Environment**, adicione todas estas variáveis:

```env
NODE_ENV=production
MONGO_URI=mongodb+srv://<usuario>:<senha>@cluster0.xxxxx.mongodb.net/al-sistemas?retryWrites=true&w=majority
JWT_SECRET=<gere com: openssl rand -hex 64>
JWT_EXPIRES_IN=7d
CLOUDINARY_CLOUD_NAME=<seu cloud name>
CLOUDINARY_API_KEY=<sua api key>
CLOUDINARY_API_SECRET=<sua api secret>
FRONTEND_URL=https://SEU-PROJETO.vercel.app
AI_PROVIDER=groq
GROQ_API_KEY=<sua key em console.groq.com>
AI_MAX_TOKENS=1000
GITHUB_TOKEN=<seu Personal Access Token>
GITHUB_USER=<seu usuário GitHub>
```

> **Redis é opcional.** O backend detecta automaticamente a ausência do Redis
> e usa cache em memória como fallback. Se quiser Redis real (persiste entre
> restarts), crie um banco gratuito no Upstash e adicione `REDIS_URL`.

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
| Install Command | `npm ci` |

### 4.2 Variáveis de ambiente

Em **Settings → Environment Variables**:

```env
VITE_API_URL=https://alsistemas-backend.onrender.com/api
VITE_APP_NAME=AL Sistemas
VITE_APP_TAGLINE=Painel de Gerenciamento
VITE_APP_VERSION=1.0.45
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

Após saber a URL do Vercel, atualize no Render:
```
FRONTEND_URL=https://SEU-PROJETO.vercel.app
```
O backend usa essa variável para liberar o CORS. Sem isso, o frontend
receberá erro de bloqueio nas requisições.

Para testar Preview Deployments da Vercel em URLs `*.vercel.app`, você pode definir `ALLOW_VERCEL_PREVIEWS=true` no Render. Mantenha `false` em produção se não precisar dos previews administrativos.

---

## 6. Primeiro acesso — criar o usuário admin

Após o backend estar no ar, crie o admin via seed:

**Pelo Shell do Render** (aba Shell no serviço):
```bash
ADMIN_EMAIL=admin@seudominio.com ADMIN_SENHA=SuaSenhaForte123 node seed.js
```

Ou adicione as variáveis no dashboard e rode:
```bash
node seed.js
```

Depois acesse `/login` no frontend e entre com as credenciais criadas.

---

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
Após configurar domínio no Vercel, atualize `FRONTEND_URL` no Render com o novo domínio.

---

## 10. Checklist antes de ir a produção

- [ ] `JWT_SECRET` gerado com `openssl rand -hex 64` (mínimo 16 chars, validado pelo Zod)
- [ ] `ADMIN_SENHA` é uma senha forte e única
- [ ] Nenhum `.env` real está commitado no repositório (verificar com `git status`)
- [ ] `FRONTEND_URL` no Render aponta para a URL real do Vercel
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
