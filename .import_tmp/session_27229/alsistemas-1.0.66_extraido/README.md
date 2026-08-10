# ⚙️ AL Sistemas — Painel de Gerenciamento

Sistema completo de gerenciamento de conteúdo, projetos, infraestrutura e integrações.  
Stack: **React + Vite + Tailwind** (frontend) · **Node.js + Express + MongoDB + Cloudinary** (backend)

---

## 🌐 URLs de produção

| Serviço   | URL                                         |
|-----------|---------------------------------------------|
| Frontend  | https://alsistemas.vercel.app               |
| Backend   | https://alsistemas.onrender.com             |
| API       | https://alsistemas.onrender.com/api         |
| APK       | GitHub → Actions → Artifacts                |

---

## ✨ Funcionalidades

- **Painel admin** com multi-tema (light, dark, ocean, rose)
- **Gestão de notícias** com editor Markdown, categorias e badges coloridos
- **Módulo GitHub** — visualização de repositórios e commits em tempo real
- **Projetos locais** — sync e acompanhamento de projetos internos
- **IA Assistant** — integração com Groq (llama-3.3) para análise de conteúdo
- **RSS Importer** — importação automática de feeds com scheduler
- **Infraestrutura** — monitoramento de MongoDB, Cloudinary e Redis pelo painel
- **Backup & Restore** — exportação e restauração de dados via interface
- **Audit Log** — registro de todas as ações dos usuários
- **Newsletter** — gestão de assinantes
- **App Android** — build via Capacitor + GitHub Actions

---

## 📁 Estrutura do projeto

```
alsistemas/
├── backend/          → Servidor Node.js (Express + MongoDB + Cloudinary)
│   ├── .env          → Credenciais (não commitar)
│   ├── render.yaml   → Blueprint de deploy no Render (vars já preenchidas)
│   ├── seed.js       → Cria admin e dados iniciais
│   └── src/
│       ├── server.js
│       ├── config/   → MongoDB, Cloudinary, env (Zod)
│       ├── models/   → Mongoose schemas
│       ├── routes/   → auth, noticias, categorias, fontes, upload, extras…
│       ├── middleware/ → auth JWT, upload Cloudinary, audit log…
│       └── utils/    → cache Redis, logger pino
├── frontend/         → React + Vite + Tailwind
│   ├── .env          → VITE_API_URL (aponta para o Render)
│   ├── capacitor.config.ts → Config do app Android
│   └── src/
│       ├── services/ → cliente HTTP centralizado + módulos por domínio
│       ├── context/  → AuthContext · ThemeContext (multi-skin)
│       ├── themes/   → tokens.js + dark / light / ocean / rose
│       ├── styles/   → base.css · public.css · admin.css
│       ├── components/admin/ui/ → AdminIcon (50+ SVGs) · ForcaSenha
│       ├── pages/    → Home, Login, Eventos, HorárioÔnibus…
│       └── pages/admin/ → Dashboard, Noticias, Categorias, GitHub, Projetos…
└── render.yaml       → Deploy com 1 clique no Render
```

---

## 🚀 Rodando local (desenvolvimento)

### Pré-requisitos

- Node.js v18+
- Conta no [MongoDB Atlas](https://cloud.mongodb.com) (gratuita)
- Conta no [Cloudinary](https://cloudinary.com) (gratuita)

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # preencha com suas credenciais
npm run seed           # cria admin + dados iniciais
npm run dev            # http://localhost:3001
```

### 2. Frontend

```bash
cd frontend
npm install
# Para dev local: edite .env e troque VITE_API_URL por http://localhost:3001/api
npm run dev            # http://localhost:5173
```

### Credenciais padrão

- **Email:** admin@al-sistemas.com
- **Senha:** admin123

---

## ☁️ Deploy em produção

### Backend — Render

Use o `render.yaml` incluído na raiz do repositório:

1. No Render: **New → Blueprint** → conecte o repositório
2. Clique em **Apply** — todas as variáveis já estão preenchidas

Ou configure manualmente no painel **Environment**:

| Variável                | Valor                                      |
|-------------------------|--------------------------------------------|
| `NODE_ENV`              | `production`                               |
| `FRONTEND_URL`          | `https://alsistemas.vercel.app`            |
| `MONGO_URI`             | string de conexão do MongoDB Atlas         |
| `JWT_SECRET`            | chave secreta longa (mín. 64 caracteres)   |
| `CLOUDINARY_CLOUD_NAME` | cloud name do Cloudinary                   |
| `CLOUDINARY_API_KEY`    | API key do Cloudinary                      |
| `CLOUDINARY_API_SECRET` | API secret do Cloudinary                   |
| `GROQ_API_KEY`          | chave da API Groq                          |
| `GITHUB_TOKEN`          | Personal Access Token do GitHub            |

### Frontend — Vercel

| Variável       | Valor                                       |
|----------------|---------------------------------------------|
| `VITE_API_URL` | `https://alsistemas.onrender.com/api`       |

### APK Android

O APK debug é gerado automaticamente via GitHub Actions a cada push na `main`.  
Consulte o [CAPACITOR.md](./CAPACITOR.md) para build manual.

---

## ⚠️ Plano gratuito do Render

O serviço "adormece" após 15 minutos sem uso — a primeira requisição pode levar 30–60 s.  
Use o [UptimeRobot](https://uptimerobot.com) para pingar `/api/health` a cada 14 minutos e manter sempre ativo.

## Cofre interno de integrações

O painel de Setup pode armazenar Render, Vercel, GitHub, Groq e Anthropic de forma criptografada no MongoDB. Para que as credenciais sobrevivam a trocas de hospedagem, mantenha apenas `MONGO_URI`, `JWT_SECRET` e, preferencialmente, uma `CREDENTIALS_MASTER_KEY` longa e estável no ambiente de inicialização. Valores secretos nunca são devolvidos ao navegador; o painel mostra apenas estado, origem e data da última atualização.

## Central segura de configurações

O AL Sistemas possui uma central em **Administração → Integrações e APIs**. O MongoDB e os segredos essenciais de inicialização são armazenados no cofre local criptografado `.al-sistemas/`; as demais credenciais são criptografadas no MongoDB. Variáveis `.env` continuam disponíveis apenas como fallback temporário de migração.

### Migração do ambiente antigo

1. Faça backup do banco e do ambiente atual.
2. Execute `npm run migrate:secure-config` no backend.
3. Reinicie e valide MongoDB, autenticação e integrações no diagnóstico.
4. Somente depois remova as variáveis antigas da hospedagem.
5. Revogue e recrie qualquer credencial que já tenha aparecido em arquivos, logs ou commits.

## Primeira configuração sem `.env`

Ao iniciar sem configuração, o frontend redireciona automaticamente para `/admin/setup`.
Apenas a URI do MongoDB Atlas e a conta administradora são obrigatórias. O `JWT_SECRET`
é gerado automaticamente e salvo no cofre criptografado `.al-sistemas/`. Cloudinary,
GitHub, IA e demais integrações podem ser configurados posteriormente no painel.

### MongoDB: Atlas ou VPS

O AL Sistemas 1.0.3 aceita MongoDB Atlas (`mongodb+srv://`) e MongoDB Community/self-hosted em VPS (`mongodb://`) sem alterar os modelos da aplicação. No setup, escolha o tipo de conexão e informe os campos correspondentes. O banco padrão é `alsistemas`; a URI final é montada/validada pelo backend e armazenada no cofre local criptografado. Uma URI personalizada continua disponível para Docker, redes privadas e cenários avançados.



### Persistência do setup (1.0.5)
O wizard não gera um arquivo `.env`. As credenciais de bootstrap são armazenadas criptografadas em `backend/.al-sistemas/bootstrap.vault.json`, protegido por `backend/.al-sistemas/master.key` (ou por `CREDENTIALS_MASTER_KEY` quando fornecida pelo ambiente). O estado `INSTALL_COMPLETED` é persistido no mesmo cofre para que uma reconexão momentânea do MongoDB não reabra o instalador. Variáveis de ambiente continuam suportadas para configuração de infraestrutura/deploy.

### Atualizações do próprio sistema

O painel inclui **Admin → Desenvolvimento → Atualizações** para preparar e instalar pacotes versionados `alsistemas-X.Y.Z.zip`. O fluxo valida identidade/versão, mostra changelog, cria snapshot, preserva dados persistentes, evita reinstalação desnecessária de dependências, suporta migrations e pode reiniciar via PM2/systemd com health check e rollback automático.

### Fluxo editorial e capa jornalística (1.0.17)

O módulo de notícias suporta `Rascunho → Revisão → Agendada → Publicada → Arquivada`. Notícias agendadas são promovidas automaticamente quando a data/hora chega, sem exigir cron externo. Uma matéria publicada pode ser marcada como **Plantão/Urgente**, com validade opcional; enquanto válida, aparece em uma faixa no topo da home. A home usa os destaques editoriais para montar a manchete principal e chamadas secundárias em formato jornalístico.


### GitHub — conexão pelo painel

Em **Admin → Integrações e APIs → GitHub**, use preferencialmente um Fine-grained Personal Access Token (`github_pat_...`).
No GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
Restrinja o token aos repositórios necessários e conceda **Contents: Read and write**; Metadata permanece em leitura.
O AL Sistemas valida o token, identifica a conta e lista os repositórios permitidos. O repositório padrão é opcional.


### Atualizações: servidor local ou GitHub/Vercel

Em **Admin → Desenvolvimento → Atualizações**, um pacote `alsistemas-X.Y.Z.zip` pode seguir dois destinos:

- **Instalar neste servidor**: fluxo tradicional para Termux/VPS, com snapshot, dependências, migrações, reinício e health check.
- **GitHub / Vercel**: usa a integração GitHub configurada em **Admin → Integrações e APIs → GitHub**, lista os repositórios autorizados e cria um commit na branch escolhida.

No modo GitHub existem destinos para projeto completo, somente `frontend/`, frontend na raiz de um repositório dedicado ou somente `backend/`. Arquivos persistentes e credenciais locais não são publicados. Se o repositório estiver conectado a um projeto Vercel, o push pode acionar o deployment conforme a configuração Git da Vercel.


#### Comportamento em Vercel

Quando o backend detecta o runtime Vercel, **Instalar neste servidor** é desativado. O filesystem da Function não é usado como armazenamento permanente de atualização. Ao validar um ZIP, o navegador mantém o arquivo selecionado; ao escolher **GitHub / Vercel**, o pacote é reenviado e processado temporariamente em `/tmp` dentro da mesma requisição. Após o commit no GitHub, os arquivos temporários são removidos.

Em Termux/VPS, o comportamento continua persistente: staging, snapshots, histórico local, instalação e rollback permanecem disponíveis.


### Persistência das credenciais e reinstalação

A partir da 1.0.33, em Termux/VPS, o cofre de bootstrap fica por padrão em `~/.al-sistemas`, fora da pasta do projeto. Assim, apagar e reinstalar `~/Painel` não remove automaticamente a URI do MongoDB nem a chave mestra usada para abrir credenciais armazenadas no banco.

As integrações GitHub, Cloudinary, Groq e demais APIs continuam armazenadas criptografadas no MongoDB. A chave de criptografia fica localmente no servidor (ou em `CREDENTIALS_MASTER_KEY` no ambiente). O MongoDB é uma exceção: sua URI precisa existir localmente ou no ambiente, pois ela é necessária antes que o sistema consiga acessar o próprio banco.

O provedor padrão do assistente de IA é **Groq**, com Anthropic como alternativa configurável.


### Ajuda para obter chaves de integrações

A tela **Admin → Integrações e APIs** inclui instruções e atalhos oficiais para MongoDB Atlas, Cloudinary, Groq, Anthropic, OpenAI, Gemini e OpenRouter. Cada integração informa os dados esperados, onde gerar a credencial e como testá-la antes de uso.


### Monitor independente durante atualização local

No Termux/VPS, o estado do atualizador fica em `~/.al-sistemas/updates`, fora da instalação que está sendo substituída. Antes de aplicar arquivos, o worker inicia um monitor independente. O navegador sai temporariamente do React/Vite e acompanha esse monitor, evitando `ERR_HTTP_RESPONSE_CODE_FAILURE` quando o servidor de desenvolvimento reinicia.

Por padrão, no Termux o monitor usa `127.0.0.1` em uma porta temporária. Em VPS atrás de proxy/reverse proxy, defina `AL_UPDATE_MONITOR_PUBLIC_URL` para a URL pública encaminhada ao monitor.


### Pré-check, manutenção e retenção de snapshots

A partir da 1.0.36, **Instalar neste servidor** executa uma simulação obrigatória antes de iniciar o worker. Ela compara arquivos, verifica dependências/migrações e estima espaço de disco para snapshot e trabalho temporário. Uma atualização de risco alto pode ser bloqueada automaticamente.

Durante a substituição dos arquivos, o portal público entra em **modo manutenção**. O estado é mantido em `~/.al-sistemas/updates/maintenance.json` e possui autolimpeza defensiva.

O atualizador mantém por padrão os **3 snapshots mais recentes**. Ajuste com `AL_UPDATE_SNAPSHOT_KEEP`. Cada job concluído recebe um `finalReport` com duração, health check, dependências, migrações e resultado da operação.


### Motor de atualização endurecido (1.0.37)

O atualizador local utiliza estado externo em `~/.al-sistemas/updates`, lock exclusivo, heartbeat, manifesto SHA-256 do staging, snapshot verificado e aplicação transacional arquivo a arquivo. Instalação, rollback e publicação GitHub não podem disputar o mesmo motor ao mesmo tempo.

Antes de alterar arquivos, um watchdog é copiado para `~/.al-sistemas/updates/runtime`. Se o worker morrer, ele restaura o snapshot. Um marcador `pending-recovery.json` também é gravado para permitir recuperação após reinício do aparelho/VPS.

Se uma queda de energia deixar uma atualização pendente e o AL Sistemas não iniciar, use o comando exibido em **Admin → Desenvolvimento → Atualizações → Recuperação de emergência**. No caminho padrão, ele equivale a:

`node ~/.al-sistemas/updates/runtime/recoverPending.cjs ~/.al-sistemas/updates`

O backend também verifica automaticamente jobs abandonados a cada 30 segundos e no boot. O autoteste do mecanismo pode ser executado pelo painel ou com:

`cd backend && npm run test:update`

O pré-check valida espaço, permissões, Node.js, dependências, migrações, MongoDB e integridade do staging. ZIPs também passam por limites contra traversal/zip bomb. Por padrão são mantidos 3 snapshots (`AL_UPDATE_SNAPSHOT_KEEP`) e 5 stagings preparados (`AL_UPDATE_STAGE_KEEP`).
