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
- **Projetos e GitHub** — gerenciamento GitHub-first, publicação por repositório/branch/pasta e vínculo opcional com Vercel/Render; pastas locais ficam como legado para VPS
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


## Central Cloudflare inteligente (1.0.84)

A integração Cloudflare usa duas superfícies separadas:

- **API Token + Account ID** para a REST API da conta.
- **R2 Access Key ID + Secret Access Key** para o endpoint S3 compatível do R2.

O endpoint S3 é derivado automaticamente como `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

Em **Admin → Cloudflare**, a aba **Recursos** consulta a API real e identifica quais produtos o token consegue acessar. O painel possui módulos para Zonas/DNS, R2, Workers, Pages, Workers KV, D1, Queues, Vectorize e AI Gateway. Operações de escrita só são confirmadas pela própria Cloudflare quando executadas.

O bucket usado pelo AL Sistemas pode ser selecionado em **Cloudflare → R2 Storage → Usar no AL**, evitando copiar nomes manualmente entre telas.

A Central não administra a criação/revogação de API Tokens da própria conta. Essa exclusão deliberada reduz o risco de uma credencial administrativa revogar a si mesma ou remover acesso crítico.

## ☁️ Produção principal — Vercel + Render + MongoDB

A partir da 1.0.83, o fluxo principal do AL Sistemas é:

```text
Vercel (frontend) → Render (backend/API) → MongoDB Atlas (dados + GridFS)
```

### Configuração externa mínima

**Render — backend**

| Variável | Obrigatória | Uso |
|---|---:|---|
| `MONGO_URI` | sim | Bootstrap e conexão com o MongoDB |
| `MONGO_DB_NAME` | não | Nome do banco; padrão `alsistemas` |
| `FRONTEND_URL` | não | Fallback de CORS durante uma primeira migração |
| `MEDIA_STORAGE` | não | `gridfs`, `cloudinary` ou `auto`; em Render o padrão é GridFS |

JWT, chave-mestra do cofre e estado de instalação passam a ter bootstrap persistente no MongoDB. Os segredos de bootstrap são armazenados selados; o servidor usa `MONGO_URI` para reconstruir o estado da instalação.

**Vercel — frontend**

| Variável | Obrigatória | Uso |
|---|---:|---|
| `VITE_API_URL` | sim | URL pública do Render terminando em `/api` |

Exemplo:

```env
VITE_API_URL=https://al-sistemas-api.onrender.com/api
```

### Migração do Termux para a nuvem

Antes de abandonar definitivamente o ambiente antigo, rode a versão 1.0.83 **uma vez** com o MongoDB atual conectado. Esse boot registra no MongoDB o bootstrap criptográfico já usado pelas credenciais salvas em **Integrações e APIs**.

Depois:

1. publique a 1.0.83 no GitHub;
2. deixe Render e Vercel criarem as novas releases;
3. abra **Admin → Central de Plataformas**;
4. selecione o projeto Vercel e o serviço Render que formam a produção;
5. use **Sincronizar URLs** e valide o diagnóstico.

Se essa etapa de migração for pulada, os usuários/notícias continuam no MongoDB, mas credenciais antigas criptografadas pela instalação anterior podem precisar ser cadastradas novamente.

### Setup e administrador

O MongoDB é a autoridade da instalação. Se o banco conectado já possui usuários, uma nova instância Render reconhece a instalação existente e **não abre novamente o Setup**. O wizard só aparece quando o banco realmente ainda não possui uma instalação administrativa.

### Integrações

Render, Vercel, GitHub, Gemini, OpenRouter, Cloudinary e demais integrações continuam centralizadas em **Admin → Integrações e APIs**. As telas consumidoras leem essa configuração; variáveis de ambiente são apenas bootstrap/fallback.

### Mídia e armazenamento

Em Render/Vercel, novas mídias do portal usam **MongoDB GridFS** por padrão, evitando depender do disco temporário da instância. Cloudinary continua suportado como opção quando configurado. URLs antigas do Cloudinary continuam válidas.

### Atualizar o portal

Em produção gerenciada, **Atualizações** não substitui arquivos dentro da instância Render/Vercel. O pacote é persistido antes da publicação:

```text
Enviar ZIP completo
→ validar versão, manifesto e SHA-256
→ armazenar o pacote no R2
→ registrar a release no MongoDB
→ publicar no GitHub
→ acompanhar o mesmo commit na Vercel e na Render
→ verificar produção
```

O navegador pode ser fechado depois que o pacote foi armazenado. No VPS, o atualizador local com staging/snapshot/rollback continua disponível como modo legado.

### MongoDB: Atlas ou VPS

O AL Sistemas 1.0.3 aceita MongoDB Atlas (`mongodb+srv://`) e MongoDB Community/self-hosted em VPS (`mongodb://`) sem alterar os modelos da aplicação. No setup, escolha o tipo de conexão e informe os campos correspondentes. O banco padrão é `alsistemas`; a URI final é montada/validada pelo backend e armazenada no cofre local criptografado. Uma URI personalizada continua disponível para Docker, redes privadas e cenários avançados.



### Persistência do Setup

Em Termux/VPS, o cofre local continua disponível em `~/.al-sistemas`. Em Render/Vercel, a 1.0.83 usa o MongoDB como autoridade da instalação: o estado do Setup e o material criptográfico necessário são persistidos de forma selada no banco.

Isso permite que uma nova instância Render reconheça o mesmo administrador e as mesmas Integrações sem depender do filesystem da instância.

### Atualizações do próprio sistema

O painel inclui **Admin → Desenvolvimento → Atualizações** para preparar pacotes versionados `alsistemas-X.Y.Z.zip`. Em Render/Vercel, o pacote validado fica no R2, o estado da release no MongoDB e o código publicado no GitHub; o painel acompanha Vercel e Render até a verificação da produção. Em VPS persistente, permanece disponível o motor local com staging, snapshot, migrations, health check e rollback.

### Fluxo editorial e capa jornalística (1.0.17)

O módulo de notícias suporta `Rascunho → Revisão → Agendada → Publicada → Arquivada`. Notícias agendadas são promovidas automaticamente quando a data/hora chega, sem exigir cron externo. Uma matéria publicada pode ser marcada como **Plantão/Urgente**, com validade opcional; enquanto válida, aparece em uma faixa no topo da home. A home usa os destaques editoriais para montar a manchete principal e chamadas secundárias em formato jornalístico.


### GitHub — conexão pelo painel

Em **Admin → Integrações e APIs → GitHub**, use preferencialmente um Fine-grained Personal Access Token (`github_pat_...`).
No GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
Restrinja o token aos repositórios necessários e conceda **Contents: Read and write**; Metadata permanece em leitura.
O AL Sistemas valida o token, identifica a conta e lista os repositórios permitidos. O repositório padrão é opcional.


### Atualizações: VPS ou produção gerenciada

Em **Admin → Desenvolvimento → Atualizações**, um pacote completo pode seguir dois fluxos:

- **VPS persistente (legado):** simulação, staging, snapshot, instalação e rollback local.
- **Render/Vercel:** validação → R2 → MongoDB → GitHub → acompanhamento Vercel/Render. O ZIP não depende do filesystem efêmero nem precisa permanecer preso ao navegador após o armazenamento.

Em Render/Vercel não existe instalação física sobre a instância em execução. O GitHub é a origem do código; R2 preserva o pacote e MongoDB preserva o estado da publicação.


### Compatibilidade de ambientes e sessão cloud (1.0.90)

O mesmo pacote continua funcionando em **Termux/VPS** e em **Vercel + Render**. No modo local/same-origin, a sessão administrativa permanece exclusivamente no cookie HttpOnly. Quando o frontend Vercel chama um backend Render em outro domínio, o AL mantém o cookie e recebe também um Bearer temporário de contingência. O frontend testa o cookie: se ele funcionar, descarta o Bearer; se for bloqueado, mantém o fallback somente no `sessionStorage` da aba.

Use **Admin → Infraestrutura → Ambientes** para comparar a versão do frontend com a versão real do backend, verificar SHAs de deploy, CORS, MongoDB, transporte da sessão e disponibilidade das integrações. Na Vercel, `VITE_API_URL` deve apontar para a URL pública do Render terminando em `/api`; alterações nessa variável exigem um novo deployment do frontend.

Em **GitHub → Editar detalhes**, o botão **Sugerir com IA** usa Gemini/OpenRouter já configurados em Integrações e APIs. A IA usa nome, linguagem, tópicos e README como contexto, preenche apenas a sugestão e nunca salva automaticamente no GitHub.

### GitHub-first para vários projetos (1.0.89)

O módulo **Admin → GitHub** não depende do cadastro em Projetos. Qualquer repositório acessível pelo token central pode ser administrado. Na seção **Publicar**, escolha um ZIP, confira explicitamente **repositório → branch → pasta** e só então crie o commit. A opção de substituição remove arquivos apenas dentro da pasta escolhida; o restante do repositório não é tocado.

O snapshot no R2 é opcional para esse fluxo. Depois do commit, o AL identifica vínculos do mesmo repositório com Vercel e Render e oferece acompanhamento/deploy quando aplicável. A tela também mostra a pasta raiz configurada na Vercel para facilitar monorepos como `/frontend` e `/backend`. Todas as chamadas usam as credenciais armazenadas em **Integrações e APIs**.

### Persistência das credenciais

As integrações GitHub, Cloudinary, Gemini, OpenRouter, Render, Vercel e demais APIs ficam criptografadas no MongoDB. A 1.0.83 introduz um bootstrap persistente selado para transportar de forma segura a chave-mestra entre uma instalação antiga e a hospedagem gerenciada.

Para uma migração sem perda das integrações, execute a 1.0.83 uma vez no ambiente antigo com o mesmo `MONGO_URI` antes do corte. Depois disso, o backend hospedado precisa apenas da URI do Mongo para recuperar o estado persistente.

### Ajuda para obter chaves de integrações

A tela **Admin → Integrações e APIs** inclui instruções e atalhos oficiais para MongoDB Atlas, Cloudinary, GitHub, Render, Vercel, Gemini e OpenRouter. Cada integração informa os dados esperados, onde gerar a credencial e como testá-la antes de uso.


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

## AL Sistemas 1.0.91 — GitHub em popups e publicação Wizard
- O gerenciador GitHub mantém a lista principal compacta; seções do repositório abrem em modal e não expandem o drawer.
- Publicar abre um assistente em etapas: ZIP → repositório → branch/pasta → segurança/R2 → vínculos cloud → revisão.
- O GitHub continua como destino principal; Vercel/Render aparecem somente quando vinculados ao repositório.


## AL Sistemas 1.0.92 — Diagnóstico inteligente de GitHub Actions

O painel GitHub mantém o ZIP de logs e adiciona resumo estrutural, análise por IA e sugestões de correção para cada execução. A IA usa apenas Gemini/OpenRouter configurados em Integrações e APIs, recebe trechos relevantes selecionados no backend e nunca altera workflows automaticamente.
