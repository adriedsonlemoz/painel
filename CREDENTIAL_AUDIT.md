# Auditoria de credenciais e segredos — 1.0.148

## Escopo
Varredura do frontend e backend por credenciais, tokens, senhas, variáveis de ambiente e integrações externas. A versão recebida no ZIP declara internamente `1.0.145`; este trabalho foi feito **diretamente sobre esse ZIP**, sem recuperar ou misturar versões anteriores. A entrega foi numerada 1.0.148 para seguir a sequência informada pelo solicitante (estado esperado 1.0.147).

## Cofre do AL Sistemas (MongoDB)
`PlataformaCredencial` armazena segredos criptografados com AES-256-GCM. `credentialStore` usa a chave derivada do material do cofre local e mantém migração de credenciais antigas. O endpoint `/admin/integracoes/status` entrega apenas máscara/metadados. A revelação completa agora é sob demanda, individual, autenticada e com `Cache-Control: no-store`; o valor não vai em URL/query string e a auditoria registra somente o nome do campo, nunca o segredo.

| Integração | Identificador | Armazenamento/origem | Recuperação |
|---|---|---|---|
| GitHub | GITHUB_TOKEN | cofre MongoDB ou env | recuperável pelo backend; sob demanda |
| Render | RENDER_API_KEY | cofre MongoDB ou env | recuperável pelo backend; sob demanda |
| Vercel | VERCEL_TOKEN | cofre MongoDB ou env | recuperável pelo backend; sob demanda |
| Cloudflare | CF_API_TOKEN | cofre MongoDB ou env | recuperável pelo backend; sob demanda |
| Cloudflare R2 | CF_R2_ACCESS_KEY_ID / CF_R2_SECRET_ACCESS_KEY | JSON criptografado no cofre ou env | recuperável quando o AL Sistemas possui o valor |
| Cloudinary | cloud name / API key / API secret | JSON criptografado no cofre + metadados/env | recuperável quando armazenado pelo AL Sistemas |
| Gemini | GEMINI_API_KEY | cofre MongoDB ou env | recuperável pelo backend; sob demanda |
| OpenRouter | OPENROUTER_API_KEY | cofre MongoDB ou env | recuperável pelo backend; sob demanda |
| API Ninjas | API_NINJAS_KEY | cofre MongoDB ou env | recuperável pelo backend; sob demanda |
| API-Football | API_FOOTBALL_KEY | cofre MongoDB ou env | recuperável pelo backend; sob demanda |
| Resend | RESEND_API_KEY | cofre MongoDB ou env | recuperável pelo backend; sob demanda |
| MongoDB | MONGO_URI | cofre bootstrap local ou env | recuperável pelo backend; sob demanda |

## Segredos de sistema detectados fora da grade de integrações
A auditoria encontrou `JWT_SECRET`, `CREDENTIALS_MASTER_KEY`, `REDIS_URL`, `METRICS_TOKEN`, `SETUP_TOKEN`, `AL_GITHUB_PUBLISH_TOKEN` e `ADMIN_SENHA`. Eles agora aparecem em uma seção separada, mascarados, com origem e estado. A revelação é individual e somente quando o processo backend realmente possui o valor.

Outras configurações não secretas/operacionais detectadas incluem IDs, URLs, limites, flags e parâmetros de runtime (por exemplo `CF_ACCOUNT_ID`, `CF_R2_BUCKET`, `VERCEL_TEAM_ID`, `FRONTEND_URL`, `PUBLIC_SITE_URL`, `NEWSLETTER_FROM`, configurações de IA, RSS e update). Elas não são tratadas como segredo apenas por estarem em `process.env`.

## Vercel e Render
As listas de variáveis continuam mascaradas por padrão. A interface agora informa nome, ambientes/tipo, recurso selecionado, origem e se a resposta da API indica que o valor é recuperável. Visualizar/Copiar faz uma chamada individual ao backend, que consulta o provedor naquele momento. Se o provedor não devolver o valor original (ou devolver somente máscara), o backend retorna uma mensagem explícita orientando substituir/atualizar a variável; nunca transforma máscara em segredo real.

A Render e a Vercel podem alterar o comportamento de retorno de segredos conforme tipo de variável, API e permissões. Por isso a implementação decide pela **resposta real recebida**, e não presume que um valor mascarado seja recuperável.

## Testes de conexão existentes
A Central já testa GitHub, Cloudinary, Cloudflare/R2, Render, Vercel, Gemini, OpenRouter, API Ninjas, API-Football, Resend e MongoDB sem operação destrutiva. Cloudflare valida token/conta e, quando há credenciais S3, lista buckets. Os testes não retornam o segredo.

## Regras de exposição aplicadas
- máscara no carregamento inicial;
- revelação individual somente após ação explícita;
- autenticação/permissão administrativa herdada das rotas;
- `no-store` nas respostas de revelação;
- segredo fora de query string;
- nenhum `localStorage` para valores revelados;
- estado revelado é limpo ao ocultar, trocar/recarregar a lista ou desmontar o componente;
- copiar usa Clipboard API e toast `Copiado`;
- erros de revelação não incluem o valor secreto;
- auditoria grava apenas nome/origem da credencial.

## Diálogos nativos
A varredura encontrou confirmações nativas em Cloudflare/R2, Atualizações, Newsletter, revisão de notícia, Projeto/Plataformas, Projetos, Mídia e Variáveis. Nesta entrega esses pontos administrativos foram migrados para confirmações personalizadas assíncronas (`ConfirmModal` ou `confirmAction`), preservando a semântica das operações destrutivas. A busca final não encontrou chamadas ativas a `alert()`, `confirm()` ou `prompt()` no frontend administrativo; restam apenas comentários/documentação sobre a migração.
