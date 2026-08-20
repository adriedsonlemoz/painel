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

Foi adicionada uma página estática em `/status/` e a Vercel Function `/api/status`. A página não depende do backend principal: testa os serviços configurados diretamente, consulta a API oficial do Statuspage do Render e informa HTTP, latência e incidentes não resolvidos. Os defaults incluem AL Sistemas API e GuiaDoA; `STATUS_SERVICES_JSON` permite substituir ou acrescentar serviços sem alterar o código.

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
