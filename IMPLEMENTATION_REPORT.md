
## 1.0.140 — GitHub e downloads Android

- O dashboard administrativo agora usa os repositórios retornados pela conta GitHub configurada.
- O módulo de commits ganhou busca, paginação, detalhe sob demanda, resumo de alterações e download do snapshot.
- ZIPs de código-fonte usam nome versionado (`projeto-versão.zip`) quando a versão é detectável.
- O APK recebe um plugin Capacitor local que integra o `DownloadManager` do Android e salva em `Downloads/AL-Sistemas`, com consulta de progresso e conclusão pela interface.
- Downloads públicos temporários são protegidos por tickets JWT curtos, sem expor `GITHUB_TOKEN`.
- Descrições dos cards de repositório deixam de ser truncadas e passam a definir a altura natural do card.

# Relatório de implementação — AL Sistemas

## Principais alterações
- Cofre local AES-256-GCM para MongoDB e segredos de bootstrap, com arquivos em modo restrito.
- Cofre criptografado no MongoDB para Cloudinary, GitHub e provedores de IA.
- Compatibilidade temporária com `.env`, sem obrigatoriedade do painel do Render.
- Página **Integrações e APIs** com status, cadastro, atualização, teste e remoção.
- Provedores de IA oficiais do núcleo: Google Gemini e OpenRouter, configurados pelo cofre central de Integrações e APIs.
- Geração de senhas fortes com 36 caracteres e cópia segura.
- Diagnóstico centralizado sem exposição de segredos.
- Reconexão do MongoDB após atualização.
- Auditoria das alterações e controle pela permissão `configuracoes.gerenciar`.
- Regras ampliadas de `.gitignore` para cofres, chaves, certificados, backups e credenciais.

## Configurações mínimas
- O sistema gera localmente `.al-sistemas/master.key` quando `CREDENTIALS_MASTER_KEY` não existir.
- Em hospedagem efêmera, monte `.al-sistemas/` em volume persistente ou forneça `CREDENTIALS_MASTER_KEY` estável.
- `FRONTEND_URL`, `PORT` e `NODE_ENV` podem permanecer no ambiente por não serem segredos críticos.

## Credenciais que precisam ser recriadas externamente
- A credencial MongoDB presente no arquivo `atlas-credentials.env.txt` está exposta e deve ser revogada no MongoDB Atlas.
- Verifique o histórico Git e os logs para Cloudinary, GitHub e APIs de IA; recrie qualquer chave encontrada.

## Riscos remanescentes
- Sem volume persistente, a chave local pode ser perdida em redeploy e tornar o cofre ilegível.
- O núcleo de IA usa adapters únicos, fila/prioridades, retry/backoff, circuit breaker, timeout total, JSON Schema, redator de segredos, cache, streaming/jobs e telemetria sem armazenar prompts/respostas completas.
- A invalidação global de sessões exige uma versão de sessão persistida por usuário; a estrutura atual ainda usa JWT simples.
- Rotas legadas de Cloudflare ainda consultam variáveis de ambiente e devem ser migradas em uma etapa específica.

## IA — validação estrutural 1.0.100
- `aiCore.test.js` cobre schema, redator, circuit breaker e seleção de contexto.
- `aiProviders.test.js` verifica autenticação Gemini em `x-goog-api-key` e parâmetros estruturados do OpenRouter.
- Integrações e APIs reutiliza o mesmo adapter dos módulos, evitando diferenças entre teste e uso real.
- Controles de privacidade bloqueiam documentos MongoDB detalhados por padrão.

## Testes
- Sintaxe Node validada para os novos módulos e servidor.
- Build completo não pôde ser executado porque o registry do ambiente retornou HTTP 404 ao instalar `yocto-queue`.
- Após instalar dependências em registry funcional: `npm ci && npm test` no backend; `npm ci && npm run build` no frontend.

## Descrição do GitHub (até 350 caracteres)
AL Sistemas é uma plataforma modular de gerenciamento com integrações seguras, automações, administração de projetos, monitoramento, backups e inteligência artificial. Centraliza APIs, credenciais criptografadas e diagnósticos em uma interface moderna, responsiva e preparada para expansão.

## Reforma visual 1.0.126
- Design System ampliado com `DSStatGrid`, `DSStatCard` compacto e `DSActionCard`.
- `ConfirmModal` global foi refeito em cima de `DSModal`, portanto confirmações passam a respeitar tema e centralização.
- Dashboard removeu acentos estruturais arbitrários e usa o branding do portal + estados semânticos.
- Usuários recebeu métricas compactas, filtros na cor do tema e melhor distribuição das ações no mobile.
- Backup agora prioriza resumo, deixa coleções recolhíveis e organiza criar/importar em layout responsivo.
- Ônibus e Eventos exibem três métricas compactas lado a lado no celular e usam cabeçalhos do Design System.
- Claro, Escuro, Oceano e Rosa agora fornecem `--adm-success` como token semântico.
