# Relatório de implementação — 1.0.151

## Portal cache-first, Render em segundo plano e monitor público

- Fluxo público invertido para cache/snapshot primeiro e API ao vivo depois, sem tela de wake bloqueando visitantes.
- Snapshot local revalidado em segundo plano, com 10 min de frescor e descarte persistente após 24 h por padrão.
- Coordenador único de wake do Render por até 90 s: `/health/live` acorda/confirma o processo HTTP e `/health/ready` libera leituras ao vivo somente após Mongo + bootstrap persistente estarem prontos.
- Home e serviços públicos evitam rajadas de chamadas ao backend durante cold start e se atualizam silenciosamente após o wake.
- Bootstrap HTML não expõe AL Sistemas no portal público e usa a configuração pública do snapshot para identidade visual.
- Login mostra contador de despertar/preparação e só restaura a sessão depois da readiness real responder.
- Navbar usa BrandingContext e título público menor.
- Página `/status/` redesenhada e monitor aprimorado para diferenciar `starting` de `offline`, além de informar frescor/idade do snapshot.
- Nenhuma imagem/ícone foi alterado.

# Relatório de implementação — 1.0.150

## Build, portal mobile, contingência, Plantão e autenticação

- Corrigido o erro que interrompeu o deploy Vercel da 1.0.149: `await` não fica mais dentro do callback síncrono de um setter React.
- Navbar pública reorganizada com `min-width: 0`, área flexível e truncamento do nome/subtítulo, evitando estouro no Android.
- `PublicFallbackBanner` foi removido do topo do layout e incorporado ao rodapé em estilo discreto e não técnico.
- Plantão ganhou prazo editorial consistente no formulário, API, consulta pública, snapshot de contingência e página aberta: 6 h padrão / 24 h máximo.
- O scheduler encerra plantões vencidos e limpa registros legados sem `urgente_ate` depois de 6 h.
- Sessão web persistente foi implementada para o Bearer de fallback cross-origin usando IndexedDB; senha nunca é persistida.
- A restauração de sessão diferencia erro definitivo (401/403) de indisponibilidade transitória. Cold start/rede/503 preservam o token e entram em reconexão automática.
- O backend bloqueia temporariamente rotas normais com 503 até `ensurePersistentBootstrap()` restaurar o JWT persistente após o Mongo conectar, eliminando a janela de falso 401 no restart do Render.
- O bypass de disponibilidade da rota de Atualizações foi removido para que ela não autentique com bootstrap temporário.
- Nenhum asset de imagem/ícone foi alterado.
- Validação final: 162 arquivos frontend sem erro na checagem contextual de sintaxe/`await`, 136 arquivos backend em `node --check`, 803 imports relativos resolvidos, checks de efeitos/temas aprovados e self-test do atualizador 8/8. Como o registry npm não respondeu neste ambiente, o `vite build`, ESLint e Jest completos ficam para o CI/deploy.

# Relatório de implementação — 1.0.149

## Auditoria completa de credenciais e correção Cloudflare/R2

- Corrigido o fluxo de revelação na Central Cloudflare: o valor salvo é buscado individualmente no backend; o campo de edição continua vazio e serve apenas para substituição.
- Cloudflare API Token e credenciais R2 S3 possuem estado, origem, Visualizar/Ocultar/Copiar e teste independente.
- Cofre criptografado e variáveis `CF_*` são resolvidos por campo, preservando instalações legadas sem duplicar segredos no banco ao salvar metadados.
- MongoDB/Cloudinary deixam de revelar apenas a máscara do campo legado e usam o inspetor de credencial real.
- Setup de manutenção protegido após instalação; Vercel/Render passam a distinguir segredos recuperáveis e protegidos.
- Revisão de logs e transporte de segredos remove token de métricas de query string e evita token de reset em log.
- Validações estáticas cobrem backend, JSX e imports; build/lint/testes dependentes de pacotes não foram executados porque `node_modules` não está presente e a instalação expirou.

---

# Relatório de implementação — 1.0.145

## Variáveis Vercel + Render via API

- Central independente em `/admin/plataformas/variaveis`.
- CRUD completo de variáveis nos dois provedores.
- Valores mascarados na saída do backend; credenciais de API não chegam ao navegador.
- Vercel com targets production/preview/development e suporte a variável sensível.
- Salvar + deploy para Vercel e Render.
- R2 pode aplicar `CF_R2_PUBLIC_URL` diretamente no projeto Vercel principal e salvar no serviço Render principal.

# Relatório de implementação — 1.0.144

## Cloudflare R2 — URL pública automática

A Central Cloudflare consulta os endpoints oficiais de domínios do R2 para o bucket escolhido em **Usar no AL**. O painel prefere domínio personalizado habilitado/ativo e usa o domínio `r2.dev` habilitado como alternativa. A URL encontrada é persistida em `r2PublicUrl`, exibida na aba R2 com ações **Verificar**, **Copiar** e **Abrir**, e pode ser usada como `CF_R2_PUBLIC_URL` na Vercel.

## MongoDB — índices

A rota `GET /api/admin/infraestrutura/mongodb/colecoes/:nome/indices` deixou de chamar `Collection.getIndexes()`, indisponível na Collection nativa usada pelo Mongoose 8. A leitura agora usa `listIndexes().toArray()` e mantém o formato esperado pela interface.

## Central de Erros — cópia individual

Cada erro possui botão **Copiar** ao lado das ações da linha. A cópia inclui mensagem, tipo, status, ocorrências, data, rota/URL, fingerprint, dados adicionais e stack. Exportar todos e apagar registros continuam disponíveis.

---

# Histórico da implementação — 1.0.143

## Status independente na Vercel

Foi adicionada uma página estática em `/status/` e a Vercel Function `/api/status`. A página não depende do backend principal: testa os serviços configurados diretamente, consulta a API oficial do Statuspage do Render e informa HTTP, latência e incidentes não resolvidos. Os defaults incluem API do portal e GuiaDoA; `STATUS_SERVICES_JSON` permite substituir ou acrescentar serviços sem alterar o código.

## Contingência pública do portal

O backend gera `alsistemas/fallback/public-snapshot-v1.json` no Cloudflare R2. O snapshot contém somente dados já públicos do portal: notícias publicadas, categorias, configurações públicas, módulos, tópicos, notícias externas, eventos futuros e linhas de ônibus ativas. Ele é atualizado após alterações editoriais importantes, no boot e periodicamente (5 minutos por padrão).
Uma whitelist explícita impede que responsáveis, revisores, comentários internos, autosave e chaves internas de mídia sejam copiados para o JSON público.

Quando a API principal falha, as leituras públicas usam automaticamente: **API Render → snapshot R2 via Vercel → cache do navegador**. Rotas administrativas nunca usam o snapshot para escrita ou para mascarar falhas do backend. Um banner informa quando o portal está em modo contingência e mostra a data da cópia usada.

## Índices Mongoose

Foram removidas as declarações duplicadas `index: true` de `BuscaTermo.termo` e `MidiaAsset.public_id`. Os índices únicos de schema foram preservados, eliminando os warnings sem alterar as regras de unicidade.

## Configuração necessária

No backend, o R2 continua usando a configuração existente. Na Vercel, basta definir `NEWS_FALLBACK_URL` com a URL pública completa do snapshot ou definir `CF_R2_PUBLIC_URL`, a partir da qual a função monta o caminho automaticamente. A página `/status/` funciona mesmo sem essa variável; nesse caso ela apenas sinaliza que o snapshot ainda não foi conectado à Vercel.

---

# Histórico da implementação — 1.0.142

## Workflows

A visualização de logs foi movida para modal de tela ampla, especialmente no celular. O conteúdo é interpretado sem alterar o texto original: timestamps compactos, tipos de linha, grupos `##[group]` / `##[endgroup]`, erros e contexto. A aba Log completo renderiza no máximo 500 linhas por vez e permite carregar blocos seguintes, enquanto a cópia preserva o texto completo sanitizado.

A visualização Erros identifica indicadores comuns de GitHub Actions, npm, Gradle, Java e códigos de saída. A seção com falha é aberta automaticamente na visão Etapas. Jobs mostram status, nome e duração juntos, além da contagem de etapas e etapa falha quando disponível.

## Sessão administrativa

O login passou a enviar a preferência `manter_conectado`. Quando desativada, o cookie do navegador é de sessão. Quando ativada, o backend mantém a sessão por até 7 dias. Em ambientes cross-origin que rejeitam cookies, o APK pode persistir apenas o Bearer de sessão através do plugin `ALSecureSession`, protegido por Android Keystore e AES/GCM. A senha nunca é armazenada.

No navegador Web não é gravado Bearer persistente em localStorage; o mecanismo preferencial continua sendo cookie HttpOnly. Logout e respostas 401 limpam token temporário e token nativo persistente.

## Compatibilidade

As rotas, funções de workflows, downloads, artefatos, análise por IA e autenticação existentes foram preservadas. O endpoint de log inline passou de 200 KB para teto defensivo de 4 MB para manter acesso ao log bruto, enquanto a interface controla a quantidade renderizada.
