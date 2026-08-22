# Revisão de segurança — 1.0.156

## Controles implementados

- **Identidade:** 2FA TOTP, códigos de recuperação com hash, sessão por `jti`, novo dispositivo/IP e revogação individual/global.
- **Sessão web:** JWT continua assinado pelo segredo persistente; requisições mutáveis autenticadas por cookie usam token CSRF vinculado ao JWT e validação Origin/Referer. Sessões anteriores à 1.0.156 permanecem compatíveis pela validação de origem até novo login.
- **Ações críticas:** step-up com senha e 2FA quando ativo; token temporário de 10 minutos vinculado à sessão. Credenciais, backups, usuários/perfis, sessões, alteração da própria senha e variáveis de produção foram cobertos. O frontend usa modal próprio, sem diálogos nativos do navegador.
- **Incidentes:** agregação por fingerprint, estados de investigação, responsável, observação, ação tomada e relatório forense.
- **Detecção:** janelas HTTP em Redis/fallback local, enumeração de rotas sensíveis, credential stuffing, ataque distribuído a uma conta, novos dispositivos/IPs e rajadas de ações sensíveis.
- **Resposta:** modos observar/alertar/proteger. Bloqueio automático não é disparado por qualquer evento alto; somente eventos marcados explicitamente como bloqueáveis podem bloquear IP.
- **Alertas:** Webhook, Telegram e SMTP/e-mail com segredo no cofre, severidade mínima e cooldown. Webhooks exigem HTTPS e rejeitam hosts locais/privados literais.
- **Supply chain:** scanner de segredos antes de publicação, auditoria de dependências e workflow GitHub Actions para push/PR.
- **Exposição:** Swagger pode ficar protegido por autenticação/permissão ou totalmente desativado em produção; respostas de Segurança não devolvem segredos TOTP, SMTP, Telegram ou Webhook.
- **Retenção:** `SecurityEvent`, `SecuritySession` e `AuditLog` possuem expiração/TTL; política define os prazos de eventos e auditoria.

## Limites conhecidos

- Redis é recomendado quando houver mais de uma instância. Sem Redis, janelas de detecção e bloqueios temporários vivem apenas no processo atual.
- A auditoria de dependências no painel depende de `package-lock.json` disponível no runtime; o workflow de CI instala as dependências antes de rodar `npm audit` e cobre esse cenário.
- Detecção de localização trabalha com IP/dispositivo observado pelo backend; não é feita geolocalização externa do usuário.
- Passkeys/WebAuthn permanecem evolução futura; a 1.0.156 entrega TOTP + recuperação.

---

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

## Pendências futuras depois da 1.0.156

As prioridades históricas de 2FA, sessões por `jti`, CSRF, Swagger protegido, retenção e varredura de supply chain foram absorvidas pela 1.0.156. As evoluções que continuam deliberadamente futuras são **Passkeys/WebAuthn**, geolocalização de IP opcional e correlação avançada entre múltiplas instâncias quando Redis não estiver disponível. A política CSP continua fornecida pelo Helmet e deve permanecer alinhada às origens realmente usadas em produção.

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

