# Revisão geral de segurança — AL Sistemas

## Sessão e cold start — 1.0.150

- O cookie HttpOnly continua sendo o transporte preferencial. O Bearer persistente só é usado como fallback quando frontend e backend estão em origens distintas e o navegador não aceita o cookie cross-site.
- “Manter conectado” no navegador persiste somente esse token de sessão em IndexedDB; **senha e segredos de integrações não são persistidos**.
- Sessões persistentes só são apagadas em falhas de autenticação confirmadas (401/403), não em timeout, erro de rede ou 503 de inicialização.
- No cold start, rotas protegidas não validam tokens antes da restauração do JWT persistente do MongoDB; durante a janela de bootstrap respondem 503 `AUTH_BOOTSTRAP_NOT_READY`.
- O upload do atualizador usa as mesmas rotinas centrais para invalidar sessão, evitando deixar um token persistente órfão após 401 legítimo.

## Endurecimento de credenciais — 1.0.149

- Revelação de segredos é individual, autenticada, permissionada e enviada somente em resposta `no-store`; o status inicial permanece mascarado.
- Cloudflare/R2 resolve cofre e ambiente por campo e não envia o conjunto de segredos ao frontend.
- `/api/setup/env-config` exige autenticação e `configuracoes.gerenciar` após instalação concluída.
- Máscaras de Vercel/Render/MongoDB/Cloudinary não são interpretadas como valor original.
- `METRICS_TOKEN` não é aceito por query string e tokens de redefinição de senha não são emitidos em logs de desenvolvimento.
- Valores revelados permanecem apenas em estado volátil da tela e são removidos ao ocultar/desmontar; não são persistidos em `localStorage`.

## Melhorias aplicadas nesta revisão

- Centro de Segurança em `/admin/seguranca`.
- Registro persistente de padrões repetidos de respostas 401, 403, 404 e 429.
- Pontuação preventiva baseada em configuração e alertas recentes.
- Triagem de eventos de segurança pelo painel.
- Tokens de redefinição de senha armazenados como SHA-256, não mais em texto puro.
- Sanitização recursiva do audit log para senha, token, secret, API key, cookies, Authorization e URI do MongoDB.
- Nenhum conteúdo de requisição é gravado pelo monitor de segurança.

## Pontos positivos encontrados

- JWT entregue em cookie HttpOnly.
- CORS com lista explícita de origens.
- Helmet, rate limit de login, bloqueio por tentativas e validação de senha.
- Cofre de credenciais com AES-256-GCM.
- Whitelist no editor de arquivos e proteção por autenticação/permissão.
- Auditoria administrativa e IDs de requisição.
- Uploads e operações administrativas separados em rotas próprias.

## Prioridade alta para a próxima etapa

1. Implementar autenticação em dois fatores com códigos de recuperação.
2. Criar tela de sessões/dispositivos e revogação individual.
3. Rotacionar JWT por sessão e registrar `jti` para revogação imediata.
4. Adicionar proteção CSRF explícita para cookies cross-site.
5. Aplicar permissões específicas em todas as rotas GitHub, projetos e infraestrutura; autenticação isolada é insuficiente.
6. Desativar Swagger em produção ou restringi-lo ao superadmin.
7. Exigir `METRICS_TOKEN` em produção, sem modo opcional.
8. Adicionar política CSP ajustada ao frontend e remover origens desnecessárias.
9. Definir retenção automática para logs de erro, auditoria e segurança.
10. Incluir varredura de dependências e segredos no GitHub Actions.

## Proposta do módulo antifurto de dados

### Prevenção

- Inventário de dados sensíveis por coleção, arquivo e integração.
- Classificação: público, interno, confidencial e segredo.
- Varredura de tokens, chaves privadas, senhas e URLs com credenciais em commits, ZIPs e uploads.
- Limites de exportação e download por usuário.
- Confirmação adicional para backups, exclusões e downloads em massa.
- Mascaramento de dados no frontend e no audit log.

### Detecção

- Alertas por volume anormal de leitura, download ou exportação.
- Detecção de muitos acessos negados, enumeração de rotas e troca incomum de IP/User-Agent.
- Comparação com comportamento habitual por usuário.
- Correlação entre login, alteração de credencial, backup e download.

### Resposta

- Revogar sessão suspeita.
- Bloquear temporariamente conta, IP ou operação de exportação.
- Rotacionar credenciais afetadas.
- Preservar evidências com hash e linha do tempo.
- Alertar por e-mail, Telegram ou webhook.

### Cuidados

O bloqueio automático deve começar em modo observação. Depois de calibrado, ações automáticas podem ser habilitadas por regra, evitando falsos positivos que bloqueiem o próprio administrador.
## IA — endurecimento 1.0.100
- Credenciais Gemini não são colocadas em query string; o adapter usa `x-goog-api-key`.
- Entradas externas passam por redator central antes do envio e README/RSS/logs são marcados como dados não confiáveis para reduzir prompt injection.
- Privacidade por classe de dados pode bloquear logs/conteúdo e mantém documentos MongoDB detalhados desabilitados por padrão.
- Telemetria de IA armazena somente metadados operacionais, sem prompt/resposta completos.
- Circuit breaker reduz repetição de chamadas após 429/401/403/5xx e o salvamento de uma nova credencial limpa o estado temporário do provedor.

