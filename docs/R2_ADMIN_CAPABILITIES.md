# Cloudflare R2 no AL Sistemas — matriz de capacidades (1.0.146)

Revisão feita em 20/08/2026 antes da expansão do Explorer R2.

## Arquitetura usada

O módulo separa responsabilidades para não expor credenciais administrativas no navegador:

- **Cloudflare REST API**: administração de buckets e configurações da conta, como criar/excluir bucket, CORS e acesso público/domínios.
- **R2 S3-compatible API**: operações de objetos, como listagem, HEAD/metadados, cópia, movimento, exclusão, download autenticado e assinatura temporária para upload direto.
- **Backend AL Sistemas**: guarda API Token, Access Key ID e Secret Access Key, aplica permissões e executa operações privilegiadas.
- **Frontend**: recebe somente dados necessários. Para upload direto, recebe uma URL PUT temporária e limitada a um único objeto; as credenciais S3 não são enviadas.

## O que já existia antes da 1.0.146

| Recurso | Situação anterior |
|---|---|
| Listar/criar/excluir buckets | Implementado |
| Listar objetos/prefixos | Implementado |
| Criar pasta lógica com `.keep` | Implementado |
| Upload e download | Implementado |
| Excluir um ou vários objetos | Implementado |
| Mover/renomear objeto | Implementado |
| HEAD/metadados básicos | Implementado |
| Uso aproximado por varredura | Implementado |
| Detectar domínio público `r2.dev`/custom domain | Implementado |
| Definir bucket padrão do AL | Implementado |

## O que a 1.0.146 adiciona

| Recurso | Implementação | Superfície |
|---|---|---|
| Responsividade total do R2 | Cards, cabeçalho, conta longa, toolbar e grids não estouram a viewport | Frontend |
| Excluir pasta | Remove todos os objetos de um prefixo após confirmação forte | S3 |
| Copiar/mover pasta | Recria chaves no prefixo de destino e opcionalmente remove a origem | S3 |
| Copiar arquivo | `CopyObject` no próprio R2 | S3 |
| Seleção múltipla | Excluir, copiar e mover até 250 arquivos por operação | S3/backend |
| Compartilhamento temporário | Token aleatório opaco, hash no MongoDB, expiração e revogação imediata | Backend + S3 |
| Link público permanente | Somente quando `r2.dev` ou custom domain estiver ativo | Cloudflare REST |
| Copiar link rápido | Público quando disponível; caso contrário cria link temporário revogável de 1 hora | Backend |
| Detalhes de objeto | Tipo, tamanho, caminho, bucket, data, ETag, Cache-Control, classe e acesso | S3 HEAD |
| Editar Content-Type/Cache-Control | `CopyObject` para a mesma chave com metadados substituídos | S3 |
| Pesquisa | Nome de arquivos e pastas na pasta atualmente carregada | Frontend |
| Ordenação | Mais recentes, mais antigos, A–Z, Z–A, tamanho e tipo | Frontend |
| Upload direto com progresso | URL PUT temporária de 15 min; progresso, velocidade, cancelar e repetir | S3 presigned PUT |
| Fallback de upload | Arquivos de até 50 MB continuam podendo usar o upload antigo pelo backend | Backend |
| Configurações do bucket | Geral, acesso, CORS, armazenamento e capacidades detectadas | REST + S3 |
| Ativar/desativar `r2.dev` | Controle pelo AL Sistemas com confirmação | Cloudflare REST |
| Custom domain | Listar, conectar e remover quando a conta/zona e o token permitirem | Cloudflare REST |
| CORS | Ler, gravar e remover política; atalho para origem do painel | Cloudflare REST |
| Classe de armazenamento padrão | Standard / Infrequent Access | Cloudflare REST |
| Lifecycle | Consulta/contagem somente; nenhuma edição simulada | Cloudflare REST |

## Pastas no R2

O R2 é um armazenamento de objetos plano. Não existem diretórios reais. O Explorer representa uma pasta por **prefixo** (`releases/android/`, por exemplo). Uma pasta vazia é mantida visível por um objeto `.keep`.

Ao excluir `releases/android/`, o backend primeiro lista os objetos cuja chave começa com esse prefixo, mostra quantidade/tamanho ao usuário e só então remove as chaves após confirmação. Para segurança, operações de pasta são bloqueadas se a varredura ultrapassar 10.000 objetos; isso evita uma exclusão gigantesca acidental a partir de uma ação de interface.

## Compartilhamento e segurança

O compartilhamento privado padrão **não entrega uma URL S3 pré-assinada de leitura ao destinatário**. O AL gera um token aleatório de 256 bits, guarda apenas o SHA-256 desse token no MongoDB e cria uma rota pública limitada ao objeto. Isso permite:

- validade de 1 hora a 30 dias;
- revogação imediata;
- geração de novo link;
- contagem/último acesso;
- nenhuma exposição de API Token, Access Key ID ou Secret Access Key no link compartilhado.

URLs S3 pré-assinadas permanecem restritas ao fluxo de **upload direto do administrador**, onde são temporárias, vinculadas a uma chave específica e usadas pelo próprio navegador. O bucket não precisa ficar público para isso.

Quando o bucket já possui `r2.dev` ou custom domain, a interface também oferece link público permanente e deixa essa diferença explícita.

## Uploads grandes

A 1.0.146 troca o caminho preferencial para upload direto navegador → R2, evitando carregar o arquivo inteiro na RAM do backend Render. O upload direto de uma única parte é limitado a 5 GiB; acima disso, o R2 exige multipart upload.

O módulo **ainda não implementa multipart/resume por partes**. Portanto:

- até 5 GiB: upload direto pode ser usado, condicionado ao CORS do bucket;
- até 50 MB: se o upload direto falhar, existe fallback pelo backend;
- acima de 50 MB: CORS deve estar correto para o upload direto;
- acima de 5 GiB: a interface informa a necessidade de multipart, sem fingir suporte.

## Pesquisa e download múltiplo

`ListObjectsV2` trabalha naturalmente com prefixo, não com busca textual global por substring. Por isso a pesquisa da 1.0.146 filtra os itens já carregados na pasta atual e informa quando há mais páginas. Uma busca global que varresse buckets grandes seria cara e lenta e não foi simulada.

Download múltiplo em ZIP também não foi colocado nesta versão. Gerar ZIP de muitos objetos no backend gratuito aumentaria consumo de RAM e poderia derrubar o serviço. O download individual permanece disponível; copiar/mover/excluir em lote ocorre no próprio R2 sem transferir os bytes pelo navegador.

## Permissões necessárias

### Cloudflare API Token

Para o gerenciamento completo do módulo, o token de conta precisa de permissão de escrita de R2 (equivalente a **Workers R2 Storage Write/Edit**). Somente leitura permite consultar buckets/configurações, mas não alterar CORS, domínio ou criar/excluir bucket.

Conectar um **custom domain** também depende de uma zona Cloudflare compatível. O AL tenta localizar automaticamente a zona pelo domínio; se a conta não possuir zonas ou o token não puder listá-las, a Cloudflare recusará a operação e o painel exibirá o erro real.

### R2 S3 credentials

Para objetos, são necessários **Access Key ID + Secret Access Key** com acesso de leitura e escrita ao(s) bucket(s) desejado(s). Elas permanecem no backend/cofre de integrações.

## Configurações não simuladas

O painel só oferece controles que possuem implementação real. Nesta versão permanecem fora da edição:

- multipart upload/resume acima de 5 GiB;
- edição visual de lifecycle rules;
- políticas avançadas que dependam de produtos fora do R2;
- recursos de WAF/cache/Bot Management de custom domain, que pertencem a outras áreas Cloudflare;
- download ZIP em lote no backend;
- busca textual global que exija varrer todos os objetos do bucket.

Essas limitações aparecem como capacidade/nota na interface em vez de botões sem efeito.
