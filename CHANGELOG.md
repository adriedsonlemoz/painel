# Changelog

## 1.0.129 — Publicação GitHub resiliente e sem estouro de limite

- Corrige o falso diagnóstico de permissão quando o GitHub responde `403` por limite secundário de gravação.
- Publicação por ZIP passa a comparar SHA Git de cada arquivo antes de gravar e reutiliza arquivos inalterados.
- Arquivos de texto são enviados em lote pela criação da árvore Git, reduzindo drasticamente requisições mutativas.
- Binários e arquivos grandes continuam usando blobs, agora com pacing e retry automático respeitando `Retry-After`/rate-limit.
- Log ao vivo registra `ADD`, `MOD`, `SKIP` e `DEL` por arquivo, além de pausas solicitadas pelo GitHub.
- Erros da API preservam endpoint, mensagem real, request id e dados de rate limit para diagnóstico correto.
- Resultado final separa alterados, inalterados, blobs explícitos e remoções.

## 1.0.128 — Wizard de atualização e modo reparo

- Atualizações passam a abrir em um wizard profissional centralizado com cinco etapas: **Pacote → Revisão → Proteção → Instalação → Concluído**.
- Upload do ZIP possui porcentagem própria; a revisão mostra versão atual → pacote, módulos encontrados, arquivos, tamanho, migrações e alterações reais antes de qualquer escrita.
- Snapshot/backup ganha etapa dedicada. Em ambiente gerenciado, a preservação no R2 fica separada da sincronização GitHub.
- Instalação local passa a publicar no job o arquivo atual, progresso de arquivos e log vivo com **ADD / MOD / DEL**.
- Sincronização GitHub também informa arquivo atual, porcentagem e entradas ADD/MOD/DEL, inclusive remoções.
- Pacote **completo** da mesma versão passa a ser aceito para reparo. O pré-check usa SHA-256 integral arquivo por arquivo e só permite continuar quando encontra diferenças reais ou dependências a reparar.
- Se a versão for igual e tudo já estiver íntegro, o sistema informa que não há reparo necessário e cancela a reinstalação; versões anteriores permanecem bloqueadas.
- Stepper, estados semânticos, modal central e tela final usam os tokens de Claro, Escuro, Oceano e Rosa.

## 1.0.126 — Componentes estruturais, Dashboard e módulos compactos

- Amplia o Design System com `DSStatGrid`, `DSStatCard` compacto e `DSActionCard`, permitindo que páginas definam significado sem escolher layout/cor manualmente.
- `ConfirmModal` global passa a reutilizar `DSModal`, eliminando o popup branco/Tailwind que ignorava os temas do painel.
- Dashboard passa a usar o nome configurado do portal, métricas do Design System e apenas acentos do tema/estados semânticos, removendo trilhos roxo, ciano e azul arbitrários.
- Usuários e acessos recebe cabeçalho/abas padronizados, cinco métricas compactas, filtros com a cor do tema e confirmação de exclusão centralizada.
- A cor configurável do Perfil continua como metadado visual, mas deixa de controlar a estrutura principal do card de usuário.
- Backup deixa de exibir uma grande grade de coleções: mostra Documentos, Coleções e Backups em resumo compacto; detalhes ficam recolhíveis. Criação e importação usam duas colunas no desktop e uma no celular.
- Ônibus e Eventos passam a exibir três métricas compactas lado a lado também no celular, reduzindo fortemente a rolagem inicial.
- Pesquisa de ônibus é incorporada a uma barra compacta e as listas de Ônibus/Eventos ganham espaçamento responsivo menor.
- Todos os temas passam a fornecer token semântico de sucesso (`--adm-success`).

## 1.0.125 — Fundação visual, branding e login

- Centraliza a identidade pública em `BrandingContext`: nome do portal, título, favicon e demais dados passam a vir da configuração pública já usada pelo site.
- Login deixa de exibir `SaaS Admin` e passa a mostrar o nome real do portal com o subtítulo **Painel administrativo**.
- Títulos das páginas administrativas passam a seguir `Página | Nome do portal`, preservando **AL Sistemas** apenas como nome técnico do produto.
- `ThemeProvider` passa a envolver toda a experiência e publica os tokens no `:root`, fazendo login, toasts, modais e portals respeitarem Claro, Escuro, Oceano e Rosa.
- Aviso global de nova versão do Service Worker passa para um componente React tematizado e é posicionado para não cobrir os campos do login no teclado móvel.
- `DSModal` passa a renderizar no `body` e permanece centralizado também no celular; a confirmação de logout já usa esse padrão.
- Tela de login é reconstruída com superfícies, bordas, foco, botões e diagnóstico compatíveis com o Design System; o diagnóstico fica fechado por padrão e mantém o probe leve de conectividade.
- Experiência global de erro e detalhes técnicos passa a consumir os tokens do tema.

## 1.0.124 — Integrações e Cloudflare Explorer

- Redesenha os cards de Integrações e APIs no padrão visual da Central de Atualizações e mantém os modais centralizados também no celular.
- Reorganiza o Diagnóstico da IA com estado do motor, provedores, fila, latência, cooldowns e uso dos últimos 7 dias.
- Corrige definitivamente o Cloudinary para usar as credenciais do cofre central, inclusive ao testar uma credencial ainda não salva e ao abrir a galeria.
- Moderniza a Central Cloudflare com resumo de conta, planos/assinaturas quando permitidos pela API, zonas e armazenamento R2.
- Transforma o R2 em um Explorer: múltiplos uploads, arrastar e soltar, pastas lógicas, prévia de imagens/vídeo/áudio, download autenticado, renomear/mover e exclusão em lote.
- Mantém DNS, SSL, firewall, analytics, Workers, Page Rules e demais produtos dentro da engrenagem de ferramentas avançadas.

## 1.0.122 — Central de Projetos e Deploys

- Vercel e Render deixam de ser tratados apenas como uma dupla fixa e passam a alimentar uma central de múltiplos projetos.
- Recursos são vinculados automaticamente pelo repositório GitHub; o projeto principal continua identificado como **Painel**.
- Cada projeto ganhou página própria com visão geral, deploys, variáveis mascaradas, logs sob demanda e análise de saúde.
- A central resume projetos online, em deploy e com problemas, além de exibir alertas por projeto.
- O Painel mantém configuração própria para definir frontend Vercel + backend Render e continua exibindo MongoDB/CORS/runtime na página detalhada.
- Navegação renomeada para **Projetos e Deploys**.
- Frontend, backend, Setup, exportação e manifesto sincronizados em **1.0.122**.

## 1.0.121 — Primeiro commit unificado no módulo GitHub
- Corrige a opção **GitHub → Publicar projeto** quando o repositório escolhido está totalmente vazio.
- A publicação inicializa o repositório com um arquivo real pela **Contents API** antes de usar a Git Database API, evitando `409 Git Repository is empty.`.
- O primeiro `PUT /contents` não força uma branch ainda inexistente; o GitHub cria a branch padrão e, se o usuário escolheu outra branch, ela é criada a partir desse commit inicial.
- O restante do pacote é publicado imediatamente usando o SHA/tree do primeiro commit, sem depender de uma reconsulta da branch recém-criada.
- Mantém Mesclar/Substituir, Snapshot R2, metadados e AuditLog no mesmo fluxo, agora com inicialização segura do primeiro commit.
- Frontend, backend, Setup, exportação e manifesto sincronizados em **1.0.121**.

## 1.0.120 — Conteúdo editorial completo e RSS corrigido
- Corrige o erro de RSS em que Fonte/Categoria existentes chegavam como `_id` e o formulário enviava valores vazios. A API também passa a devolver `id` explícito para Categorias e Fontes.
- Cadastro de feed sugerido pode criar/vincular automaticamente a Fonte editorial e a Categoria padrão quando ainda não existem.
- A lista de RSS sugeridos é validada ao vivo antes de aparecer e mantém apenas feeds gerais confiáveis na lista-base.
- Importação RSS salva primeiro os rascunhos e deixa cópia de imagens para R2 e IA em background, reduzindo a sensação de travamento.
- Nova/Editar Notícia recebe seções minimizáveis, atalhos de seção, autosave, histórico/restauração, responsáveis, revisor e comentários internos.
- Assistente editorial ganha ações lado a lado para revisão, lead, completar campos, títulos, SEO, classificação, enxugar texto, melhorar conteúdo e itens para checagem humana.
- Categorias e Fontes passam a ter metadados editoriais completos, imagens/logos no R2, contadores e mesclagem segura.
- Biblioteca de Mídia centraliza arquivos usados pelo Conteúdo, aceita uploads R2 e identifica/remove objetos órfãos com confirmação.
- Eventos recebem capa R2, categoria, endereço/mapa, organizador, contato, ingresso, preço, horário final, recorrência, destaque, agendamento, arquivamento automático e JSON-LD `Event`.
- Newsletter evolui para campanhas com seleção de notícias, prévia, teste, agendamento, envio via Resend e exportação global dos assinantes.
- Home e Módulos ganham compositor visual com drag-and-drop, origem por categoria, quantidade, visibilidade, prévia mobile/desktop e Hero armazenado no R2.
- SEO editorial passa a respeitar canonical, imagem OG e noindex; alterações de slug preservam URLs antigas por redirecionamento. Categorias usam seus próprios campos SEO/OG.
- Central de Qualidade detecta conteúdo sem imagem/fonte/alt, plantão vencido, SEO incompleto, RSS com erro/origem inválida, possível mojibake e duplicatas.
- Métricas editoriais passam a mostrar desempenho por categoria, fonte e feed RSS, origem manual/RSS, buscas internas, newsletter e notícias sem views.

## 1.0.119 — Primeiro envio para repositório GitHub vazio
- Corrige o fluxo **GitHub → Publicar projeto** quando o repositório escolhido ainda não possui nenhum commit.
- Respostas `409 Git Repository is empty.` passam a ser reconhecidas como repositório novo, sem abortar a publicação.
- O publicador reutiliza a mesma estratégia já usada pelo módulo Atualizações: inicializa o repositório com um arquivo real via Contents API e depois sincroniza o pacote completo via blobs/tree/commit.
- A primeira publicação passa a aceitar também uma branch diferente da branch padrão: a branch é criada automaticamente a partir do commit inicial.
- Mantém snapshot R2, validação do ZIP, modos Mesclar/Substituir, metadados e AuditLog no mesmo fluxo.

## 1.0.118 — RSS integrado ao Conteúdo, R2 e fluxo editorial

- Fonte RSS vinculada a uma Fonte editorial real; vários feeds podem compartilhar a mesma Fonte.
- Categoria padrão obrigatória por feed, com migração de dados antigos.
- Home deixou de consultar RSS externo diretamente e passa a exibir somente matérias RSS já publicadas.
- `/rss` público agora filtra apenas conteúdo publicado e informa MIME/tamanho de capa quando disponível.
- Capas RSS podem ser espelhadas no Cloudflare R2 em `alsistemas/noticias/rss/<fonte>/AAAA/MM/`.
- Charset, UTF-8 e mojibake normalizados durante importação e reprocessamento.
- IA editorial executada em background após a importação; título fica desativado por padrão.
- Administração RSS redesenhada com cards compactos, detalhes sob demanda e formulário curto.
- Fonte e Categoria podem ser criadas diretamente do formulário RSS.
- Proteções de SSRF, rede privada, redirect, TLS normal e limite de XML/imagens adicionadas.
- Exclusão de feed preserva as notícias e remove a referência RSS órfã; Fontes/Categorias em uso por RSS não podem ser excluídas.


## 1.0.117 — Editor de notícias integrado ao Conteúdo e Cloudflare R2

- Tela **Nova/Editar notícia** redesenhada para ocupar menos espaço no celular: status compacto, identificação direta e um único conjunto de ações por tamanho de tela.
- **Categoria passa a ser obrigatória** para notícias do portal. Uma migração cria **Geral** e classifica automaticamente notícias antigas que estavam sem categoria.
- Categoria e Fonte ficam ligadas aos respectivos gerenciadores, com criação rápida sem sair do editor e proteção contra exclusão enquanto estiverem em uso.
- Importações RSS sem categoria passam a usar **Geral**, mantendo o módulo Conteúdo consistente.
- Imagens de capa passam a ser enviadas especificamente ao **Cloudflare R2**, usando as credenciais e o bucket definidos em **Integrações e APIs**, sem configuração duplicada no editor.
- O R2 organiza as capas pelo prefixo `alsistemas/noticias/capas/AAAA/MM/`; quando não há URL pública de bucket, o backend fornece uma rota pública de leitura restrita às imagens de notícias.
- Capa ganha metadados editoriais e técnicos: texto alternativo, legenda, crédito, link da fonte, storage, chave R2, MIME, tamanho, dimensões e nome original.
- Trocar ou remover uma capa de uma notícia salva também remove o arquivo persistido anterior, evitando acúmulo desnecessário.
- Editor Markdown foi compactado e modernizado, com barra de ferramentas rolável no celular, H2/H3, listas, citação, link, separador, prévia e contagem de palavras/caracteres.
- Assistente editorial de IA foi separado por tarefa: revisão não altera campos; completar sugere resumo/SEO/categoria/tags; títulos podem ser aplicados individualmente; melhoria de texto retorna um corpo revisado antes da substituição.
- IA recebe a categoria e a fonte atuais como contexto, mas a fonte é somente leitura e nunca é criada ou trocada automaticamente.
- Portal público usa o novo texto alternativo da imagem e exibe legenda/crédito com link da fonte quando informado.
- Frontend, backend, Setup, backup/exportação e manifesto sincronizados em **1.0.117**.

## 1.0.116 — Notícias mais compactas e profissionais

- Página **Notícias** simplificada para priorizar a lista de conteúdo.
- Removido o bloco redundante de abas **Notícias / Categorias / Fontes** da página; Categorias e Fontes continuam acessíveis pelas rotas próprias do painel.
- Removido o segundo botão **Nova notícia**: agora existe apenas um no cabeçalho.
- Busca, status e categoria foram agrupados em uma barra de filtros compacta.
- No celular, os cards ficaram menores e com hierarquia visual mais clara: título, status/categoria, data/views e ações principais.
- **Editar** e **Publicar/Despublicar** ficam visíveis; **Ver no site** e **Excluir** ficam no menu de três pontos.
- Frontend, backend, Setup, backup/exportação e manifesto sincronizados em **1.0.116**.

## 1.0.115 — Resumo final compacto da atualização

- Ao terminar uma atualização, o modal troca automaticamente do acompanhamento detalhado para um resumo compacto.
- A tela final mostra apenas a versão anterior → nova versão, as mudanças da versão e o botão **Fechar**.
- Porcentagem, barra de progresso, etapas, Job ID, tempo total e relatório técnico não aparecem mais após a conclusão.
- O changelog do pacote acompanha o job para permanecer disponível no resumo mesmo depois que o pacote preparado é consumido.
- Frontend, backend, Setup, backup/exportação e manifesto sincronizados em **1.0.115**.

## 1.0.114 — Central de erros simplificada

- Central do repositório (GitHub) no celular: cards em 2 colunas com ícone ao lado do texto, fonte maior (título ~13.5px, descrição ~10.5px) em vez do grid apertado de 3 colunas com texto minúsculo.
- Central de Atualizações no celular: ícones dos quadrados maiores e com mais espaçamento interno.

## 1.0.109 — Menu lateral com acordeão de verdade e ajustes finos

- No celular, tocar em Conteúdo/Portal/Publicação/Sistema no menu lateral agora expande as opções ali mesmo (sanfona), em vez de navegar para a central em cards.
- Ordem do menu (celular e desktop): Dashboard primeiro, depois os grupos, e Atualizações / Erros e logs por último.
- Cards das centrais no celular voltam ao layout ícone + texto lado a lado, com espaçamento mais enxuto.

## 1.0.108 — Cards das centrais maiores no mobile

- Nas centrais do celular (Conteúdo, Portal, Publicação, Sistema), os cards passam a ter layout vertical em quadrados, ocupando 2x2 na tela, com ícone e texto (título e descrição) maiores e mais legíveis.

## 1.0.107 — Menu do Admin em painel sanfona

- Os grupos Conteúdo, Portal, Publicação e Sistema do menu do Admin agora expandem em um painel logo abaixo da barra ao serem clicados, empurrando o conteúdo da página para baixo — substitui o dropdown flutuante centralizado usado até a 1.0.106.
- Dashboard, Atualizações e Erros e logs seguem soltos no nível principal do menu, fora de qualquer grupo/submenu.

## 1.0.106 — Navegação administrativa e publicação GitHub mais compactas

- Menu do Admin reorganizado: Dashboard, Atualizações e Erros e logs ficam no nível principal; o antigo grupo Desenvolvimento foi removido.
- Novas centrais em cards para Conteúdo, Portal, Publicação e Sistema reduzem listas longas no menu mobile sem mudar as rotas existentes.
- Wizard de Publicar projeto no GitHub foi centralizado e redesenhado para telas pequenas, com cabeçalho/ações fixos e corpo rolável.
- Seleção de ZIP passa a usar cartão visual, lê metadados do pacote no navegador e compara versão atual do repositório com a versão enviada quando disponível.
- Branch, pasta, modo, snapshot, repositório, versões e plataformas aparecem em grades compactas de colunas na revisão final.
- Depois do envio, o Wizard troca para um dashboard detalhado de pacote, validação, R2 e GitHub; falhas ficam no próprio fluxo com opção de revisar/tentar novamente.
- A tela final consolida commit, arquivos, snapshot e vínculos Vercel/Render em cards compactos.
- Novo componente base `AdminWizard` prepara a padronização dos demais assistentes do sistema.

## 1.0.104 — Recuperação do atualizador cloud e destino GitHub seguro

- Corrigida a causa do estado infinito **Aguardando commit**: a publicação cloud agora detecta o repositório/branch realmente vinculados à Vercel e Render antes de enviar qualquer arquivo.
- Em produção gerenciada, o repositório GitHub padrão global deixa de ser aceito silenciosamente como destino da atualização; se ele não for o repositório de produção, a publicação é bloqueada.
- Depois do push, o AL verifica o SHA no GitHub, relê `al-sistemas.json` daquele commit e confirma a versão antes de iniciar o acompanhamento de Vercel/Render.
- Releases em `publishing` sem commit recebem timeout e passam para **Publicação interrompida**, preservando o pacote no R2 para nova tentativa.
- Deploys que não reconhecem o SHA ou ficam em construção além do prazo passam para **Ação necessária** em vez de permanecer indefinidamente em 0%.
- O monitor ganha ações de recuperação: **Reconsultar**, **Tentar deploy novamente**, **Publicar novamente do R2** e **Encerrar acompanhamento**.
- Se um commit estiver em um repositório diferente daquele usado pela produção, a release passa para **Destino incorreto** e explica a divergência em vez de continuar aguardando.
- O pacote armazenado no R2 continua sendo a fonte de recuperação, evitando reenviar o ZIP após falhas de publicação/acompanhamento.
- Diagnóstico GitHub passa a classificar falha exclusiva em `Upload Artifact`/APK como aviso de entrega do artefato quando o build em si concluiu.
- Diagnóstico Render prioriza o serviço principal configurado e reduz falsos avisos de serviços antigos/desativados.
- Atualizador local/VPS tenta `npm install` como recuperação quando `npm ci` falha especificamente por lockfile desatualizado/incompatível.
- IA corrige o modelo Gemini detectado como indisponível no diagnóstico: configurações antigas em `gemini-2.5-flash` migram em tempo de execução para `gemini-3.5-flash-lite`; Gemini 3.x não recebe mais parâmetros de amostragem descontinuados.
- OpenRouter força roteamento para modelos compatíveis também no fallback JSON, reduzindo respostas estruturadas inválidas no `openrouter/free`.
- Frontend, backend, Setup, backup/exportação e manifesto sincronizados em **1.0.104**.

## 1.0.103 — Novo projeto GitHub, R2 corrigido e assistentes compactos

- A página principal do GitHub ganha **Novo projeto GitHub**, independente de uma pasta local do módulo Projetos.
- O novo fluxo é um assistente centralizado em **6 telas curtas**: Projeto → Detalhes → Arquivos → Revisão → Commit → Pronto, pensado para caber também em celulares pequenos.
- O assistente permite escolher conta pessoal/organização, nome, público/privado, descrição, homepage, Issues, Projects, Wiki e Discussions antes de criar o repositório.
- Depois de criar o repositório vazio, o usuário escolhe **R2** ou **GridFS**, envia o ZIP com progresso real e o backend descompacta/prepara os arquivos antes de qualquer commit.
- A revisão mostra quantidade/prévia de arquivos, branch, pasta exata no GitHub e mensagem do commit; o botão de primeiro commit só aparece depois dessa conferência.
- Repositórios completamente vazios podem receber o primeiro commit e a branch escolhida é criada automaticamente quando necessário.
- O navegador R2 da Cloudflare e a listagem R2 em Projetos foram corrigidos para mostrar objetos realmente enviados, usando S3 compatível com paginação e fallback REST compatível.
- Projetos armazenados no R2 podem ser usados diretamente como fonte do commit, sem exigir cópia local persistente no Render.
- Commit e sincronização do módulo Projetos passam de `EventSource` puro para **streaming autenticado por fetch/POST**, permitindo o Bearer de fallback Vercel → Render e corrigindo a falsa mensagem de perda de conexão.
- O endpoint GET/SSE antigo continua disponível como compatibilidade para Termux/VPS.
- O atualizador cloud passa a exibir **uma única etapa central por tela**: Atualização/R2 → GitHub → Vercel → Render. A próxima etapa assume a tela automaticamente.
- O monitor do atualizador foi compactado para telas pequenas e deixou de gerar notificações grandes para sucessos rotineiros; erros e avisos importantes permanecem destacados.
- Manifesto, frontend, backend, Setup e backup/exportação foram sincronizados em **1.0.103**.

## 1.0.102 — GitHub mobile, README e correções de produção

- GitHub corrige definitivamente a Central do Repositório para **3 cards por linha no celular**, removendo a regra global que ainda forçava 2 colunas.
- **Visão geral** volta a carregar o README renderizado ao abrir o card.
- **Baixar projeto** e **Publicar** deixam de parecer a mesma ação: download permanece no cabeçalho e Publicar fica como ferramenta própria da Central.
- Workflows recebem ações mobile compactas e estados traduzidos para português.
- Build Android fixa Capacitor 6.2.1 + tar 6.2.1, usa Node 22 e envia ao Vite a versão real do package.json.
- Render configura `trust proxy` em produção gerenciada; deploy antigo desativado deixa de contaminar o diagnóstico quando o serviço atual está saudável.
- O teste de sessão Vercel → Render deixa de produzir o 401 deliberado depois do login e preserva o fallback Bearer.

## 1.0.101 — GitHub alinhado ao Design System da Central

- O painel interno de cada repositório passa a usar cards inspirados na Central de Atualizações, com ícone, título e descrição curta.
- No mobile, a navegação mantém **3 cards por linha**, sem retornar ao seletor vertical e sem abrir conteúdo embaixo da grade.
- As ações foram organizadas em **Projeto**, **Código** e **Automação e produção**; cada opção continua abrindo em modal/drawer próprio.
- O topo recebe um card de estado **GitHub conectado**, exibindo repositório e branch atual.
- O espaço vazio abaixo dos comandos foi substituído por um resumo de **Branch, Linguagem, Tamanho e Último push**.
- **Excluir repositório** saiu da grade principal e foi movido para `⋮ Mais`, preservando a confirmação existente.
- **Baixar projeto** e **Publicar** permanecem no cabeçalho; integrações GitHub/R2/Vercel/Render e o Wizard de publicação não tiveram lógica alterada.
- Manifesto do atualizador, frontend, backend, Setup e backup/exportação foram sincronizados em **1.0.101**.

## 1.0.100 — Motor central de IA robusto e observável

- Gemini e OpenRouter passam a usar adapters únicos compartilhados por todos os módulos, eliminando testes/chamadas duplicadas com comportamentos diferentes.
- Fila global de IA com prioridades evita que RSS e tarefas de fundo disputem cota com ações manuais; concorrência e tamanho máximo da fila são configuráveis.
- Retry com backoff, respeito a `Retry-After`, circuit breaker/cooldown e timeout total da operação tornam o fallback Gemini → OpenRouter previsível em 429, 5xx e lentidão de rede.
- Gemini deixa de enviar chave na URL e usa somente `x-goog-api-key`.
- Perfis `Assistente`, `Rápido`, `Editorial`, `SEO`, `Diagnóstico`, `RSS` e `Tradução` controlam prioridade, temperatura, contexto, saída e cache; instruções editoriais personalizadas não contaminam diagnóstico/tradução.
- Respostas estruturadas são validadas localmente contra JSON Schema mesmo após fallback para JSON simples, rejeitando objetos incompletos antes de chegar aos módulos.
- Contexto passa a trabalhar com orçamento aproximado de tokens; logs preservam regiões próximas a erro/falha/stack trace em vez de simples cortes por caracteres.
- Redator central mascara tokens, Bearer/JWT, credenciais R2/AWS, MongoDB e outros padrões antes de qualquer envio à IA; conteúdo de README/RSS/logs é encapsulado como dado não confiável.
- Controles de privacidade em Integrações definem quais classes de dados podem chegar à IA; documentos MongoDB detalhados permanecem desativados por padrão.
- `AiUsage` registra somente metadados de uso (provedor, tarefa, latência, tokens, fallback, cache, erro e custo quando conhecido), sem gravar prompt/resposta; painel mostra resumo dos últimos dias.
- Cache por hash reaproveita diagnósticos/descrições/análises idênticos até expirar; botão/ação nova continua podendo gerar nova operação quando o conteúdo muda.
- Health superficial deixa de consultar Gemini/OpenRouter externamente em cada atualização do Dashboard; diagnóstico profundo continua disponível sob demanda.
- Assistente ganha streaming real e cancelamento; análises grandes de GitHub Actions usam jobs persistentes com progresso, consulta posterior e cancelamento.
- Lista de modelos expõe contexto/suporte a saída estruturada quando os provedores informam a capacidade.
- Nova suíte de testes cobre schema, redator, circuit breaker, seleção de contexto e headers/adapters de Gemini/OpenRouter.
- Produção Vercel/Render e modos VPS/Termux legado permanecem compatíveis.

## 1.0.99 — Home editorial, RSS limpo e núcleo de IA estabilizado

- Home passa a abrir com o carrossel de até 3 destaques; o Plantão urgente fica logo abaixo e os quatro atalhos locais permanecem na mesma linha no mobile.
- Editorias extras de Últimas Notícias deixam de aumentar a página e passam a abrir em popup/bottom-sheet; espaçamentos verticais foram compactados.
- Brasil e Mundo preserva a fonte real dos feeds e recebe acabamento editorial mais limpo.
- Matérias RSS renderizam HTML sanitizado corretamente, enquanto cards usam resumo em texto puro e deixam de expor tags HTML.
- Sanitizador RSS remove publicidade/rastreamento e blocos repetitivos como `Leia Mais`, `Veja também` e relacionados.
- Admin RSS ganha **Reprocessar notícias**, reaplicando a limpeza às importações já salvas no MongoDB sem perder origem, URL ou datas.
- Núcleo de IA oficial passa a ser somente **Gemini + OpenRouter**, com timeout, fallback automático e erros registrados na Central de Diagnóstico.
- SEO, análise editorial e análise de logs usam saída JSON estruturada quando suportada, reduzindo falhas por respostas inválidas.
- Login, Health, Dashboard e Infraestrutura deixam de procurar Groq/Anthropic e refletem os provedores realmente configurados.
- Integrações e APIs ganha **Diagnóstico da IA** com teste de conexão, texto e JSON estruturado para cada provedor.
- Falhas de IA passam a poder aparecer/filtar na Central de Erros como origem `IA · Gemini/OpenRouter`.
- Vercel/Render continuam sendo o fluxo principal de produção; VPS/Termux legado permanecem compatíveis.

## 1.0.98 — Exportação completa de diagnóstico e atualização cloud por etapas

- Central de Erros e logs ganha exportação ZIP unificada de AL Sistemas, GitHub Actions, Vercel, Render e MongoDB, incluindo triagem e detalhes disponíveis, com mascaramento de padrões comuns de segredos.
- A seleção de um ZIP no atualizador passa a ler localmente o manifesto `al-sistemas.json` e mostrar a próxima versão e seu changelog antes do upload.
- Pacotes iguais ou inferiores à versão instalada são sinalizados antecipadamente na interface; a validação oficial do backend continua sendo a autoridade final.
- Monitor cloud passa a usar quatro cards sequenciais: Atualização principal/R2 → GitHub → Vercel → Render, cada um com barra e porcentagem própria.
- Estados técnicos de Vercel/Render deixam de aparecer crus e são apresentados em português.
- O progresso geral só representa a soma real das etapas; GitHub em 100% não significa produção concluída.
- O botão Fechar sai do rodapé dos monitores; após conclusão/falha, o fechamento fica disponível pelo X do topo.
- Fluxo local de VPS/Termux é preservado.

## 1.0.97

- **Home editorial mais compacta:** os destaques passam a formar um carrossel com exatamente 3 notícias, troca automática, indicadores e gesto lateral no celular.
- **Atalhos locais restaurados:** História, Belezas naturais, Ônibus e Eventos voltam para uma única linha com 4 colunas no mobile.
- **Últimas Notícias sem excesso de categorias:** a Home mostra apenas as categorias principais e recolhe as demais em `Mais`, evitando várias linhas antes das notícias.
- **Brasil e Mundo por RSS real:** o backend consulta as fontes RSS ativas, deduplica links, ordena por publicação e monta uma seção editorial; os cards externos manuais continuam apenas como fallback quando não houver RSS disponível.
- **Previsão do tempo:** novo serviço backend consulta Open-Meteo, resolve a cidade quando latitude/longitude não forem informadas, mantém cache e entrega condição atual, sensação, umidade, vento, chuva e próximos dias.
- **Futebol ao vivo / jogos de hoje:** integração opcional com API-Football via chave central, com cache curto para partidas ao vivo, cache do dia e filtros de ligas/prioridade configuráveis.
- **Horóscopo opcional:** integração com API Ninjas, carregada somente quando o visitante escolhe um signo; tradução pt-BR pode reutilizar Gemini/OpenRouter já configurados em Integrações e APIs.
- **Integrações centralizadas:** API Ninjas e API-Football entram em Integrações e APIs com teste de credencial, Mostrar/Ocultar, parâmetros próprios e participação no backup/importação `.env`.
- **Configuração editorial:** Admin → Módulos ganha `Tempo + Esportes` para ativar clima, Brasil e Mundo/RSS, futebol e horóscopo, além de cidade, coordenadas opcionais e quantidade de dias da previsão.
- **Compatibilidade preservada:** Vercel + Render continuam o foco de produção online, sem remover suporte legado a VPS/Termux e sem expor chaves das novas APIs no frontend.

## 1.0.96

- **SEO corrigido de verdade:** a tela agora usa endpoints dedicados de SEO, aceitando `seo.gerenciar` ou `configuracoes.gerenciar`, sem afrouxar as demais configurações do sistema.
- **Persistência confirmada:** depois de salvar, o backend relê o MongoDB e devolve os valores; o frontend compara campo a campo antes de mostrar sucesso e sincroniza cache/bootstrap público.
- **Nova interface SEO:** seções em cards compactos que abrem em popup/bottom-sheet, prévia disponível no celular e estado claro de alterações não salvas, salvando e salvo.
- **IA no SEO:** Gemini/OpenRouter de Integrações e APIs pode auditar a configuração e sugerir título, descrição e palavras-chave; nada é salvo automaticamente.
- **Triagem externa:** GitHub, Vercel, Render e MongoDB agora aceitam estados locais `Novo`, `Acompanhando`, `Revisado` e `Silenciado`, mesmo que o erro continue existindo na origem.
- **Notas e acompanhamento:** ocorrências externas podem receber nota local persistida no MongoDB; detalhes também ganham reconsulta da origem, link para a plataforma e análise IA.
- **Ações em massa:** seleção de ocorrências externas passa a aceitar triagem em lote; a antiga limitação de status apenas para registros internos do AL foi removida.

## 1.0.95

- **Central online de diagnóstico:** a antiga tela Erros e logs foi reestruturada para reduzir ruído visual e priorizar produção online.
- **Fontes unificadas:** AL Sistemas, GitHub Actions, Vercel, Render e MongoDB aparecem na mesma Central, sem exigir configuração duplicada.
- **Logs sob demanda:** falhas recentes de GitHub/Vercel/Render são descobertas pelas APIs oficiais e os detalhes são carregados somente ao abrir uma ocorrência.
- **MongoDB:** conexão, ping e métricas do banco entram no diagnóstico; falhas são destacadas como ocorrência crítica.
- **IA central:** qualquer ocorrência suportada pode ser analisada por Gemini/OpenRouter configurados em Integrações e APIs; a IA apenas diagnostica e sugere próximos passos.
- **Interface limpa:** limpeza de registros foi movida para a engrenagem, filtros para popup e seleção em massa para barra flutuante.
- **Cloud primeiro:** Produção cloud é o modo principal do assistente; Termux continua legado e VPS fica preparado para uso futuro.

## 1.0.94

- Atualizador cloud ganha progresso real durante o upload do ZIP, incluindo percentual e bytes enviados; depois de 100% o painel informa que o backend está validando e armazenando a release no R2.
- O seletor nativo de arquivo foi substituído visualmente por uma área compacta `Selecionar pacote` + `Enviar e preparar`, mantendo o input de arquivo acessível internamente.
- O acompanhamento de produção passa a ser dividido em quatro cards: **R2**, **GitHub**, **Vercel** e **Render**.
- R2 mostra armazenamento da release; GitHub mostra publicação/commit e SHA; Vercel e Render mostram estados vindos das APIs das próprias plataformas.
- O commit GitHub deixa de marcar a atualização geral como 100%. O progresso global só conclui quando Vercel estiver READY e Render estiver live/succeeded/deployed.
- A Central exibe a última hora de consulta das APIs, links para commit/produção quando disponíveis e mantém erros associados à etapa que falhou.
- Mensagens antigas que orientavam acompanhar a Vercel manualmente foram substituídas pelo acompanhamento automático no próprio atualizador.
- Termux/VPS continuam usando o fluxo local existente, sem remoção de funcionalidades.

## 1.0.93

- Cloudflare R2 passa a ser o foco da tela Cloudflare; recursos avançados foram movidos para uma engrenagem/modal.
- Resumo compacto de uso do R2 e métricas por bucket.
- Upload R2 com progresso real e atualização automática da listagem após concluir.
- Wizard GitHub exibe progresso real do ZIP e estado de processamento após o upload.
- Snapshot R2 fica habilitado por padrão para novas publicações GitHub, mas permanece opcional.
- Snapshots ficam em `projects/<conta>/<repositorio>/snapshots/<branch>/`.
- Compatibilidade com Termux/VPS e fluxo cloud Vercel/Render preservada.

## 1.0.92
- GitHub Actions: cada execução passa a ter quatro ações no mesmo ponto do painel: `Resumo`, `Analisar IA`, `Sugestão` e `ZIP`.
- `Resumo` é determinístico e não consome IA: contabiliza jobs, etapas concluídas, falhas, ignoradas e mostra exatamente quais etapas falharam.
- `Analisar IA` busca os logs dos jobs diretamente no backend, prioriza jobs com falha, seleciona linhas de erro/exception/warning e contexto adjacente e consulta Gemini/OpenRouter configurados em Integrações e APIs.
- A análise retorna erro principal, etapa, causa provável, evidências, itens que funcionaram, avisos e próximos passos; nenhuma alteração é aplicada automaticamente.
- `Sugestão` usa o mesmo conjunto real de logs, mas pede à IA correções propostas, arquivos prováveis, nível de risco e como validar depois.
- Logs são tratados como entrada não confiável para evitar prompt injection; a instrução da IA também exige ocultar possíveis segredos/tokens.
- O ZIP completo de logs continua disponível e independente da IA para backup, compartilhamento ou análise externa.
- O popup de análise é responsivo e os controles de run reorganizam no mobile para evitar vazamento horizontal.
- Auditoria registra somente metadados da análise (repositório, run, modo e provedor), sem armazenar o conteúdo integral dos logs.

## 1.0.91
- GitHub: todas as opções da Ponte de Comando passam a abrir em popup/modal próprio; nenhum card de Visão geral, Organização, Análise, Arquivos, Commits, Releases, Artefatos, Workflows, Secrets ou manutenção injeta conteúdo abaixo da grade.
- A grade de comandos permanece visível e compacta, com 3 cards por linha no mobile. Ao fechar uma seção, o usuário volta à mesma Ponte de Comando.
- O botão/card Publicar deixa de abrir uma página comprida e passa a iniciar um Wizard modal interativo.
- Wizard de publicação dividido em 6 etapas: selecionar ZIP, escolher repositório, definir branch/pasta, opções de substituição e snapshot R2, conferir Vercel/Render e revisão final.
- Nenhum commit é criado antes da tela final de revisão; o destino exato repositório → branch → pasta permanece visível antes da confirmação.
- Publicação continua independente do módulo Projetos e reutiliza exclusivamente as credenciais de Integrações e APIs.
- R2 continua opcional para snapshots; Vercel/Render continuam opcionais e só aparecem quando houver vínculo detectado com o GitHub escolhido.
- Após o commit, o Wizard apresenta resultado, SHA, snapshot R2 e ações de deploy Render quando disponíveis; projetos Vercel ligados por Git continuam usando o fluxo de deploy do commit.
- Termux/VPS e o modo local legado permanecem suportados sem alteração das regras de publicação existentes fora do módulo GitHub.

## 1.0.90
- Autenticação Vercel + Render deixa de depender exclusivamente de cookie cross-site: o cookie HttpOnly continua sendo tentado e, somente quando frontend e backend estão em origens diferentes, o login recebe um Bearer de sessão temporário como fallback.
- No login cloud, o frontend testa primeiro se o cookie cross-site foi aceito. Se funcionar, descarta o Bearer e continua no cookie HttpOnly; se o navegador bloquear o cookie, mantém o Bearer apenas no sessionStorage da aba, com validade reduzida (12h por padrão). Termux/VPS nunca recebem esse fallback.
- Middleware de autenticação passa a priorizar Authorization Bearer quando ele estiver explicitamente presente, evitando que um cookie cross-site antigo invalide uma sessão cloud nova.
- Cliente HTTP central e uploads/downloads administrativos passam a anexar automaticamente o fallback Bearer quando necessário, mantendo credentials=include para compatibilidade com cookie.
- Service Worker deixa de armazenar respostas de autenticação e APIs administrativas sensíveis, reduzindo risco de sessão/401 antigo reaparecer depois de um novo deploy.
- Tela de login recupera o Diagnóstico de conexão com botão Executar diagnóstico e mantém um probe leve automático para indicar rapidamente se a API está acessível.
- Diagnóstico do login agora identifica modo same-origin ou Vercel → Render, informa a estratégia de sessão e usa mensagens CORS compatíveis com a Central de Plataformas atual.
- Novo menu Admin → Infraestrutura → Ambientes verifica runtime, origem do frontend, URL da API do build, CORS, MongoDB, transporte da sessão e disponibilidade das integrações GitHub, Vercel, Render e R2 sem expor segredos.
- Ambientes compara a versão compilada do frontend com a versão real do backend em execução e alerta quando Vercel e Render estão em releases diferentes; também exibe os SHAs de build/deploy quando disponíveis.
- Build Vite passa a incorporar a versão do frontend diretamente do package.json e o SHA Git da Vercel, evitando depender apenas de VITE_APP_VERSION para diagnosticar a release publicada.
- GitHub → Editar detalhes ganha Sugerir com IA. A sugestão usa exclusivamente Gemini/OpenRouter configurados em Integrações e APIs, analisa dados reais do repositório/README e nunca salva automaticamente: o usuário revisa antes de gravar no GitHub.
- A instrução de IA trata README como conteúdo não confiável e ignora comandos encontrados dentro dele, usando-o apenas como contexto factual do projeto.
- Downloads autenticados do GitHub (projeto, commits, logs e artefatos), uploads administrativos e backup foram adaptados ao transporte híbrido para continuarem funcionando quando o navegador restringe cookies entre vercel.app e onrender.com.
- Termux e VPS permanecem suportados: cookie HttpOnly, rotas, instalação física e atualizador local continuam ativos sem exigir Bearer cloud ou mudanças de configuração.
- Pacote completo 1.0.90 inclui integralmente o GitHub-first 1.0.89, atualizador cloud R2 → GitHub → Vercel/Render e todas as melhorias anteriores.

## 1.0.89
- GitHub: removido o seletor vertical de seções dentro do repositório. A navegação volta a usar cards compactos e permanentes; no mobile são 3 cards por linha e cada toque troca somente a seção exibida.
- Visão geral foi condensada: Dados no GitHub e Informações do repositório ficam lado a lado, com Branch, Linguagem, Tamanho, Último push, Stars, Forks, Issues e data apresentados de forma compacta.
- README continua usando o HTML GFM renderizado pelo GitHub, agora dentro de uma área de documentação própria e mais limpa.
- Botão `ZIP` foi renomeado para `Baixar projeto`; o AL continua gerando/baixando o zipball do branch/commit pelo backend autenticado.
- `Salvar em Projetos` deixa de ser a ação principal do módulo GitHub. A nova área `Publicar` funciona sem qualquer pasta local e aceita um ZIP escolhido no aparelho/PC.
- Nova publicação GitHub-first permite selecionar qualquer repositório acessível pelo token, a branch de destino e a pasta exata dentro do repositório (`/`, `frontend`, `backend` ou outra).
- O destino fica visível antes do commit como `repositório → branch → pasta`; antes de gravar, um modal confirma arquivo, repositório, branch, pasta, modo de substituição e uso de snapshot R2.
- Modo padrão mescla/atualiza os arquivos. A opção de substituição apaga somente arquivos antigos dentro da pasta escolhida e preserva o restante do repositório.
- Upload ZIP é processado no backend sem depender de Projeto local; `.git`, `node_modules` e entradas inseguras/path traversal são descartados, com limites de arquivo, quantidade e tamanho descompactado.
- Repositórios vazios recebem a primeira publicação pela branch padrão via inicialização segura; depois disso o fluxo normal de árvore/commit assume as publicações seguintes.
- Publicação usa exclusivamente o `GITHUB_TOKEN` armazenado em Integrações e APIs; nenhuma credencial paralela foi criada.
- Snapshot no Cloudflare R2 é opcional antes do commit e usa as mesmas credenciais R2 de Integrações e APIs, armazenando os pacotes em `projects/<owner>/<repo>/snapshots/...`.
- Metadados internos de cada repositório guardam a última preferência de publicação: repositório, branch, pasta e uso de snapshot R2.
- Verificação de deploy foi generalizada para múltiplos projetos: Vercel continua procurando todos os projetos ligados ao repositório e a Render passa a procurar todos os serviços compatíveis, não apenas o serviço principal do AL Sistemas.
- Na área Publicar, vínculos Vercel mostram `rootDirectory`/branch de produção e vínculos Render mostram serviço/branch. Após um commit, é possível iniciar na Render um deploy do mesmo SHA.
- Projeto local permanece apenas como metadado opcional/legado de VPS; não é requisito para gerenciar, baixar ou publicar repositórios GitHub.
- Pacote completo 1.0.89 inclui integralmente o atualizador cloud persistente da 1.0.88 e todas as melhorias visuais/R2/GitHub anteriores.

## 1.0.88
- Central de Plataformas corrige a distinção entre domínio público da Vercel e URL única de deployment. O portal passa a usar exclusivamente um domínio associado ao projeto, preferindo o `<projeto>.vercel.app` estável ou domínio de produção verificado.
- A URL técnica do deployment atual continua visível para diagnóstico, mas não é mais usada em `site_url`, botão Abrir portal ou origem pública.
- Ao abrir/sincronizar a Central, configurações antigas de `productionOrigin` que apontavam para deployment são autocorrigidas e `site_url` é atualizado com o domínio canônico.
- `Sincronizar URLs` reconstrói as origens CORS em memória, evitando que uma URL antiga permaneça autorizada até reiniciar o backend.
- Domínios Vercel vinculados a branch não entram automaticamente no CORS de produção; previews continuam disponíveis somente quando `ALLOW_VERCEL_PREVIEWS=true`.
- Atualizador de produção gerenciada migra de ZIP temporário/request para fluxo persistente `R2 → GitHub → Vercel + Render`.
- O ZIP é validado uma única vez no upload e armazenado no bucket R2 configurado em Integrações e APIs em `updates/<versão>/<sha>-<arquivo>`.
- Novo registro persistente de releases cloud no MongoDB guarda SHA-256, objeto R2, changelog, repositório, branch, commit GitHub, estado Vercel/Render e conclusão da produção.
- Publicação baixa o ZIP do R2 para diretório temporário, revalida o pacote e confere o SHA-256 antes de qualquer alteração no GitHub.
- GitHub continua usando exclusivamente `GITHUB_TOKEN` do cofre de Integrações e APIs; não foi criado token paralelo no atualizador.
- Vercel e Render também reutilizam as credenciais e recursos principais selecionados em Integrações/Central de Plataformas.
- Após o push, o AL acompanha o commit exato nas duas plataformas e só marca a release como concluída quando Vercel está Ready e Render está Live/implantada.
- Quando o serviço Render não usa auto deploy, o atualizador pode solicitar um deploy do SHA exato publicado no GitHub.
- Falta de vínculo de projeto Vercel ou serviço Render passa a aparecer como `deploy-blocked`, sem perder o ZIP já armazenado no R2.
- Tela de Atualizações permite retomar e publicar versões que já estão no R2, sem exigir que o navegador mantenha o arquivo selecionado ou faça um segundo upload.
- Teste do armazenamento R2 agora realiza uma operação S3 real de listagem no bucket, em vez de considerar conectado apenas porque os campos estão preenchidos.
- Instalação local, snapshots de arquivos, watchdog e rollback físico permanecem disponíveis apenas como modo legado para VPS/servidor persistente.
- Pacote completo 1.0.88 inclui integralmente as mudanças GitHub 1.0.87, reforma visual 1.0.86 e R2/Cloudflare 1.0.85.

## 1.0.87
- GitHub: corrigido o drawer de detalhes no celular. O nome e o caminho do repositório não são mais comprimidos pelos botões de ação.
- ZIP, Salvar em Projetos e Fechar passam a ocupar uma linha de ações própria no mobile.
- Cards mantêm Branch, Tamanho e Último push na mesma linha em telas pequenas; removido o “Atualizado …” redundante do rodapé.
- A ponte de comando do repositório vira seletor compacto no celular, evitando uma grade alta antes do conteúdo.
- Nova edição de descrição e homepage diretamente no GitHub via API oficial, sem criar um segundo token: a credencial vem do cofre de Integrações e APIs.
- Perfil GitHub conectado pode editar nome, e-mail público, empresa, localização, site/blog, bio, disponibilidade para contratação e Twitter/X.
- Avatar do perfil é exibido no painel; como a API REST de perfil não oferece upload de avatar, a ação Alterar foto abre a configuração oficial do GitHub.
- README deixa de ser texto cru/truncado e passa a usar HTML renderizado pelo GitHub Markup/GFM, com estilo responsivo para tabelas, imagens, código, listas e links.
- Cabeçalho da conta foi compactado e os quatro indicadores (repositórios visíveis, públicos, privados e atividade) permanecem lado a lado no celular.
- Integrações e APIs passa a explicar as permissões `Profile: write` e `Administration: write` para tokens fine-grained, além dos escopos equivalentes em token classic.
- Cliente central GitHub atualizado para REST API `2026-03-10`; token continua exclusivamente no backend e é carregado primeiro do cofre de Integrações.
- Pacote completo mantém integralmente R2 Storage/Cloudflare e a reforma visual das versões 1.0.85/1.0.86.

## 1.0.86
- Revisão visual ampla do painel e do portal público, sem alterar as regras de negócio: tipografia compactada, grids responsivos e contenção de largura para telas pequenas.
- Design System administrativo passa a usar uma escala tipográfica menor e o modal padrão se adapta ao celular como bottom-sheet/tela compacta, preservando os temas existentes.
- GitHub e Integrações usam grade 3 colunas no desktop, 2 no tablet e 1 no celular; detalhes longos deixam de aumentar a lista verticalmente.
- Projetos, Erros, Eventos, Ônibus, Fontes e MongoDB movem detalhes/edição/gerenciamento para modais ou drawers, mantendo as mesmas ações e serviços.
- MongoDB e Newsletter ganham apresentação em cards no celular para evitar tabelas vazando horizontalmente.
- Cloudflare, Sistema/Infraestrutura, Monitor, Usuários, Segurança e Assistente de IA recebem ajustes de tamanho e responsividade.
- Portal público reduz títulos exagerados, reorganiza tópicos/categorias e remove dependência de rolagem horizontal nas faixas principais.
- Fontes visuais foram alinhadas às famílias realmente carregadas pelo projeto: Nunito, Geist e Fraunces.
- Esta versão completa também inclui integralmente os ajustes da 1.0.85.

## 1.0.85
- Integrações → Cloudflare passa a apresentar duas abas visuais: `Cloudflare API` e `R2 Storage`, sem remover ou substituir os campos REST existentes.
- A aba `R2 Storage` concentra Access Key ID, Secret Access Key, endpoint, bucket e preferências R2 usando o mesmo cofre seguro já existente.
- Credenciais R2 permanecem separadas do Cloudflare API Token REST e campos sensíveis mantêm controle Mostrar/Ocultar.
- Exportação/backup `.env` preserva `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`, `CF_R2_BUCKET`, `CF_R2_PUBLIC_URL` e `CF_R2_ENDPOINT`.
- Backup JSON de Integrações registra a versão de origem do pacote para facilitar restauração e diagnóstico.

## 1.0.84
- Cloudflare em Integrações e APIs foi redesenhada separando corretamente API Token REST de Access Key ID + Secret Access Key do R2/S3.
- Endpoint R2 S3 é calculado automaticamente pelo Account ID e passa a ser incluído em exportação/importação de configurações.
- Teste Cloudflare valida token/conta pela REST API e, separadamente, testa de verdade as credenciais R2 usando ListBuckets via S3.
- Suporte a Account API Token: verificação tenta primeiro /accounts/{account_id}/tokens/verify e mantém fallback para token de usuário.
- Central Cloudflare ganhou autodetecção de capacidades reais para Zonas/DNS, R2, Workers, Pages, Workers KV, D1, Queues, Vectorize e AI Gateway.
- Nova aba Recursos permite listar e criar Pages, KV, D1, Queues, Vectorize e AI Gateway conforme a permissão real do token.
- Pages mostra deployments; KV, D1, Queues, Vectorize, AI Gateway e Pages possuem ações tipadas de exclusão com confirmação.
- R2 permite escolher um bucket existente como bucket padrão do AL Sistemas diretamente na lista, sem digitar o nome em Integrações.
- Visão Geral Cloudflare mostra endpoint S3, chaves mascaradas, validação S3 e quantidade de buckets acessíveis.
- O painel não tenta administrar API Tokens/identidade da conta, evitando revogar a própria credencial administrativa por engano.


## 1.0.83
- Render/Docker/GitHub Actions deixam de usar npm ci porque o pacote distribuído não contém package-lock; passam a usar npm install sem audit/fund.
- Workflow Android passa a usar VITE_API_URL e CAPACITOR_WEB_URL configuráveis por GitHub Variables, sem editar capacitor.config.ts com sed.
- Central de Plataformas redesenhada como central de produção Vercel → Render → MongoDB.
- Render: leitura mascarada de variáveis, atualização de variável, deploy, deploy sem cache, restart, rollback, cancelamento e logs pelo painel.
- Vercel: leitura mascarada de variáveis e logs de build dos deployments pelo painel.
- Produção conectável: projeto Vercel e serviço Render passam a definir URLs, diagnóstico e CORS.
- CORS aprende as origens da Vercel conectada e corrige o bloqueio observado em paineliguanews.vercel.app.
- Setup usa o MongoDB como autoridade: banco com usuários existentes não reabre o wizard em uma nova instância Render.
- JWT e chave-mestra do cofre ganham bootstrap persistente selado no MongoDB; MONGO_URI pode ser a única configuração obrigatória do backend após migração.
- Uploads de mídia usam GridFS por padrão em plataforma gerenciada; Cloudinary permanece opcional.
- Atualizações em Render/Vercel usam ZIP temporário no navegador → GitHub → deploy, sem staging ou instalação local persistente.
- Diagnóstico Termux deixa de registrar CHANGELOG/documentação como se fossem logs de erro.


## 1.0.82
- Publicação GitHub em Termux/VPS agora prefere Git nativo, enviando o diff compactado em vez de criar um blob HTTP para cada arquivo.
- Se Git nativo não estiver disponível ou falhar, o publicador alterna automaticamente para a API GitHub existente.
- O job registra o motor usado e o diff real: novos, alterados e removidos.
- Publicação sem mudanças termina sem criar commit desnecessário.
- Corrigido workflow Android: capacitor.config.ts agora existe e pode receber a URL da Vercel antes do npx cap sync.
- Confirmado pelo novo log que npm ci está saudável: 418 pacotes instalados em cerca de 5 segundos; o erro atual do APK era exclusivamente a ausência de capacitor.config.ts.


## 1.0.81
- Dashboard administrativo redesenhado do zero como Central Editorial do Portal de Notícias.
- Conteúdo passa a ser a informação principal, com última publicação, publicadas, rascunhos, eventos e alertas.
- Projetos passam para a segunda área da hierarquia, preparados visualmente para Termux e futura migração a VPS.
- APIs deixam de aparecer como etiquetas de fornecedores; o Dashboard passa a mostrar funções operacionais: Núcleo, Banco, Cache, Mídia, Publicação, IA e Rede.
- Nova área Atenção transforma contadores em ações compreensíveis e navegáveis.
- Atividade administrativa e notícias recentes foram reorganizadas em painéis de leitura rápida.
- Usuários deixam de dominar o Dashboard e passam a uma área contextual de equipe.
- Layout responsivo prioriza celular, sem grids horizontais ou cards estreitos.

## 1.0.80
- Fluxo de atualização contínuo: depois de enviar e validar o ZIP, o pré-check de instalação abre automaticamente.
- `Instalar` foi promovido para a Central, ao lado de `Publicar`; a ação GitHub/Vercel duplicada foi removida dos cards de versões preparadas.
- Staging redesenhado como `Versões prontas`, com Release Brief e leitura imediata do que mudou.
- Central passa a exibir versões de Backend, Frontend, Node.js, npm, React, Vite, Express e Mongoose.
- Ambiente passa a mostrar React Router, Termux e estado do MongoDB.
- `Monitor externo` foi renomeado conceitualmente para `Canal independente`; se ainda estiver iniciando, o painel acompanha o job e tenta transferir automaticamente quando ele responder.
- Vite usa `node_modules/.vite-<versão>`. Em Termux, o atualizador preserva o cache da versão ativa em vez de apagá-lo durante a execução.
- Não foi adicionado nenhum comando global para matar processos Node; timeouts continuam encerrando somente subprocessos criados pelo próprio atualizador.
- Base preparada para instalação limpa da versão 1.0.80.


## 1.0.79
- Pacotes preparados agora possuem ação `Excluir versão`, com confirmação antes de remover o staging.
- Snapshots agora possuem ação `Excluir`, separada de `Rollback`.
- Modais móveis da Central de Atualizações, Integrações e Categorias deixaram o padrão bottom-sheet e permanecem centralizados.
- Pré-check de pacote completo agora explica a aplicação diferencial e mostra arquivos iguais, gravações reais, remoções e artefatos locais preservados.
- `.import_tmp`, `.logs`, `.pids`, `.manager.lock` e `.manager.conf` ficam fora da árvore gerenciada pelo atualizador.
- Adicionado manifesto de propriedade em `~/.al-sistemas/updates/managed-files.json`; futuras remoções de pacote completo ficam limitadas aos arquivos realmente gerenciados pelo AL Sistemas.
- Snapshots futuros preservam o manifesto de propriedade para rollback/recovery coerentes.


## 1.0.78
- Corrigido `Cannot read properties of null (reading 'useContext')` observado após atualização com Vite ainda ativo no Termux.
- Atualizações que modificam `frontend/package.json` passam a invalidar o cache `frontend/node_modules/.vite`.
- A 1.0.78 força uma limpeza inicial do cache ao ser aplicada sobre a 1.0.77.
- RouterErrorScreen identifica inconsistência de React/React Router e tenta uma única recuperação automática com recarga completa.
- O parâmetro técnico de recuperação é removido da URL após o boot.
- O redesign em popups da Central de Atualizações foi preservado sem alterações nas regras de instalação.


## 1.0.77
- Módulo Atualizações redesenhado como uma central compacta de comandos.
- Progresso/porcentagem de atualização agora abre em popup próprio, como a publicação GitHub/Vercel.
- Ambiente e diagnóstico foram movidos para popup.
- Autoteste pós-instalação e seus resultados foram movidos para popup.
- Pacotes preparados, snapshots, histórico e recuperação de emergência foram movidos para painéis próprios.
- Página principal agora exibe apenas versão, status, atalhos e resumo do runtime.
- Nenhuma rota, endpoint ou regra de instalação/rollback/publicação foi alterada; mudança focada em interface e organização.
- Layout móvel mantém grade compacta em duas colunas para reduzir rolagem.

## 1.0.76
- Corrigido `EBADENGINE` no Termux com Node 26 / npm 11.
- Backend e frontend agora exigem apenas Node >=20 e npm >=10, sem teto artificial.
- Removido `packageManager: npm@10`, evitando fixação desnecessária do gerenciador.
- Alteração de `engines` não é mais tratada como mudança de dependências; portanto, não força `npm install` sozinha.
- Diagnóstico do atualizador reconhece `termux` como estratégia válida.
- Recuperação do backend no Termux permanece habilitada quando o Manager continua em execução.

## 1.0.74
- Central GitHub: listagem redesenhada com cards mais informativos e responsivos.
- Cards exibem público/privado, branch principal, tamanho, último push, licença, permissões e métricas.
- Repositórios sem descrição recebem um resumo técnico automático.
- Identificação leve reconhece AL Sistemas e sua versão, projetos full-stack, Node.js, frontend, backend, web e CLI.
- Reconhecimento de configurações Vercel, Render, Railway e Docker.
- Cabeçalho da conta mostra visão geral dos repositórios e atividade.
- Filtros reorganizados e filtro de repositórios arquivados corrigido.
- Orientação de credencial GitHub centralizada em Integrações e APIs.

## 1.0.73
- GitHub redesenhado como Central GitHub, com ponte de comando organizada por Projeto, Código, Automação e Manutenção.
- Gerenciador de arquivos recebeu visual novo, navegação responsiva e hierarquia mais clara.
- Nova ação “Analisar resíduos” identifica conteúdo local publicado por engano sem apagar nada automaticamente.
- Limpeza segura exige confirmação LIMPAR e remove todos os resíduos detectados em um único commit.
- Detecção cobre .import_tmp, .logs, .pids, .manager.lock/.manager.conf, node_modules, .env, caches e arquivos temporários.
- Código-fonte, documentação, .github/workflows e demais itens legítimos ficam protegidos da limpeza automática.

## 1.0.72
- Nova tela de inicialização do portal, com identidade visual tecnológica e minimalista.
- Splash nativo aparece antes do React, evitando tela branca durante o boot.
- Anel de inicialização, progresso discreto e sequência CONFIGURAÇÃO → SERVIÇOS → CONTEÚDO → ONLINE.
- Nome configurado do portal passa a substituir o nome padrão também durante a inicialização.
- Respeita prefers-reduced-motion e foi ajustado para telas pequenas.
- Mantida a proteção nativa contra falhas de inicialização.

## 1.0.71
- Removidos lockfiles antigos de frontend e backend para impedir falhas por tarballs removidos no npm.
- Vercel e Render passam a instalar pela faixa estável compatível declarada em cada package.json.
- Registry público do npm definido explicitamente nos dois módulos.
- Compatibilidade declarada: Node 20–22 e npm 10–11.
- Pré-check de publicação rejeita dependências alpha, beta, RC, canary, nightly, experimental e next.
- Sincronização GitHub remove lockfiles antigos que já tenham sido publicados.


## 1.0.70
- Removido o `frontend/package-lock.json` obsoleto que prendia o deploy da Vercel a `typed-array-byte-offset@1.0.5` indisponível.
- O frontend passa a instalar dependências compatíveis diretamente do `package.json` (`npm install`) quando não houver lockfile.
- Publicação GitHub/Vercel ganhou pré-validação de lockfiles antes do upload.
- Bloqueia lockfiles com tarball conhecido como inválido, registry local/interno ou referências não portáveis.
- O pré-check informa quando o frontend será publicado sem lockfile.
- Node mínimo do frontend documentado como 20+ e gerenciador indicado como npm 10.

## 1.0.69
- Publicação GitHub/Vercel tratada como módulo próprio dentro de Atualizações.
- Filtro de publicação ampliado para ignorar node_modules, .env, .import_tmp, .logs, .pids, arquivos locais do Manager, caches, logs e cofres.
- Próxima publicação remove automaticamente do repositório resíduos locais enviados por versões anteriores.
- Progresso informa quantos arquivos serão publicados e quantos itens locais foram ignorados.
- Módulo GitHub ganhou aba Arquivos com navegação por pastas e listagem da branch.
- Arquivos e pastas podem ser apagados do GitHub com confirmação; exclusão de pasta é consolidada em um único commit.
- .gitignore raiz reforçado com regras de runtime/local para proteger publicações feitas também fora do painel.

## 1.0.68
- Corrigido crash em Atualizações ao acessar `repositories.length` quando a lista ainda não existe.
- Publicação GitHub/Vercel agora acompanha o progresso em popup dedicado, sem inserir caixas de progresso no fluxo da página.
- Popup de publicação mostra progresso, etapas recentes, commit final e só permite fechamento normal após conclusão/erro.
- Melhorado o comportamento responsivo do acompanhamento de publicação em celulares.
- Reduzida a repetição visual da timeline de upload para deixar a operação mais legível.

## 1.0.67
- Central de Integrações passa a incluir Render e Vercel com instruções, teste, salvar/remover e identidade da conta.
- Render e Vercel consumidos pelos módulos de Infraestrutura/Plataformas a partir do mesmo cofre central.
- Removida a edição duplicada de credenciais Vercel na página Plataformas; ela agora aponta para Integrações e APIs.
- Admin Setup deixa de manter um segundo cofre de APIs e redireciona para a Central de Integrações.
- Exportação/importação inclui Render API Key, Vercel Token e Team ID para migração entre celular, VPS, Render e Vercel.
- Diagnóstico central passa a considerar Render e Vercel.
- Estrutura preparada para adicionar futuras integrações Google (Search Console, Analytics e AdSense) sem duplicar credenciais em outros módulos.

## 1.0.66
- Setup ganhou fluxo de migração por backup de Integrações e APIs.
- O backup pode preencher a URI/banco MongoDB automaticamente quando contém segredos.
- Gemini, OpenRouter, GitHub, Cloudflare/R2, Cloudinary e Vercel são recriptografados para o novo aparelho/servidor.
- A adoção de banco MongoDB já existente também restaura as integrações do backup no mesmo fluxo.
- Exportação JSON agora inclui versão do formato e indicador de compatibilidade de migração.
- O fluxo foi pensado para Termux/celular, VPS e Vercel sem exigir recadastro manual das APIs.

## 1.0.64
- Corrigida a listagem de repositórios do GitHub: removida a combinação inválida de `type` com `affiliation`.
- GitHub agora usa a credencial central de Integrações e APIs como fonte única para listar repositórios.
- Adicionado Cloudflare à Central de Integrações, com instruções, API Token, Account ID e credenciais do R2.
- Módulo Cloudflare passa a carregar credenciais do cofre/MongoDB, mantendo `CF_*` apenas como fallback.
- Projetos → Cloudflare R2 passa a consumir a mesma configuração central de Cloudflare.
- Exportar/Importar configurações agora inclui Cloudflare e R2.
- Confirmado que Projetos → GridFS usa a conexão MongoDB principal e não requer uma segunda API/credencial.
- Confirmado o uso central de Gemini/OpenRouter pelo Assistente, editor de Notícias e enriquecimento opcional do RSS.

## 1.0.63
- Integrações/APIs redesenhada como central visual de cards, dois por linha.
- Cada integração agora abre em modal próprio com ações Salvar, Testar, Remover e Fechar.
- Removido o fluxo de configuração que abria formulários abaixo da listagem.
- Área de backup simplificada para Exportar, Importar e Gerar senha.
- Exportar abre popup para escolher .env ou JSON e decidir se inclui valores secretos.
- Importar aceita backups .env e JSON e ignora valores mascarados para preservar credenciais existentes.
- Mantidos apenas Gemini e OpenRouter como provedores de IA visíveis/diagnosticados.
- Melhorias específicas de responsividade para celular, incluindo modal em formato bottom-sheet.

## 1.0.60 — Agenda de Eventos integrada ao portal
- Página pública de Eventos redesenhada seguindo a linguagem editorial, cards, tipografia e cores da página inicial.
- Agenda agrupada por mês, primeiro evento em destaque, detalhes em modal responsivo e estados claros de erro/vazio.
- Backend de Eventos agora persiste `tipoEntrada` e valida título, descrição, data, horário, local e cor.
- Rotas administrativas ganharam validação de IDs, atualização com `runValidators` e retorno 404 ao excluir item inexistente.
- Painel de Eventos ganhou resumo de próximos/publicados/passados, status publicado/oculto, formulário responsivo e prévia.
- Versões internas sincronizadas para 1.0.60.

## 1.0.59 — IA editorial, SEO auditável e carregamento público renovado
- Gemini e OpenRouter agora podem ser priorizados no painel, com modelo, limite, temperatura e instruções editoriais.
- Assistente editorial no formulário de notícias: resumo, títulos, SEO, categoria/tags e análise de qualidade.
- RSS ganhou enriquecimento opcional por IA com limite de itens por ciclo e fallback seguro.
- SEO ganhou auditoria/pontuação das configurações essenciais.
- Tela pública de boot não exibe mais AL Sistemas; usa skeleton editorial e identidade do portal.
- Home usa skeleton de notícias durante carregamento.

# 1.0.58

- Adicionado Autoteste pós-instalação em Atualizações.
- Verifica backend, MongoDB, sincronização de versões, arquivos essenciais, permissões de gravação, health check, RSS, portal e integrações GitHub/Vercel quando configuradas.
- Diagnóstico completo pode ser copiado pelo painel para facilitar análise de falhas.


## 1.0.57

- Termux: atualização local simplificada para substituir arquivos e recarregar a interface, sem build de produção no fluxo normal.
- Painel de Atualizações recarrega automaticamente uma única vez após conclusão bem-sucedida.
- Notificações do sistema redesenhadas: maiores, mais visíveis e com duração ampliada.
- Erros permanecem por mais tempo e oferecem ação para copiar a mensagem.
- Todas as notificações podem ser fechadas manualmente.

## 1.0.56

- Atualizador: no Termux, o build de produção do frontend é dispensado por padrão para evitar quedas durante `vite build`.
- O build continua normal em Vercel/CI/servidores e pode ser forçado no Termux com `AL_UPDATE_BUILD_FRONTEND=true`.
- O job registra quando o build foi pulado por ambiente Termux.

# 1.0.55

- RSS: novas fontes passam por teste obrigatório antes de serem salvas.
- RSS: feeds com HTTP 404/410 são desativados automaticamente para evitar falhas repetidas no scheduler.
- RSS: lista de fontes sugeridas revisada, priorizando feeds ativos e editorias úteis.
- Portal: navegação pública reorganizada com acesso direto a Todas as notícias, Categorias e Eventos.
- Portal: acesso ao painel administrativo renovado e mais visível no desktop e mobile.

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
