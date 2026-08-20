# Relatório de implementação — 1.0.142

## Workflows

A visualização de logs foi movida para modal de tela ampla, especialmente no celular. O conteúdo é interpretado sem alterar o texto original: timestamps compactos, tipos de linha, grupos `##[group]` / `##[endgroup]`, erros e contexto. A aba Log completo renderiza no máximo 500 linhas por vez e permite carregar blocos seguintes, enquanto a cópia preserva o texto completo sanitizado.

A visualização Erros identifica indicadores comuns de GitHub Actions, npm, Gradle, Java e códigos de saída. A seção com falha é aberta automaticamente na visão Etapas. Jobs mostram status, nome e duração juntos, além da contagem de etapas e etapa falha quando disponível.

## Sessão administrativa

O login passou a enviar a preferência `manter_conectado`. Quando desativada, o cookie do navegador é de sessão. Quando ativada, o backend mantém a sessão por até 7 dias. Em ambientes cross-origin que rejeitam cookies, o APK pode persistir apenas o Bearer de sessão através do plugin `ALSecureSession`, protegido por Android Keystore e AES/GCM. A senha nunca é armazenada.

No navegador Web não é gravado Bearer persistente em localStorage; o mecanismo preferencial continua sendo cookie HttpOnly. Logout e respostas 401 limpam token temporário e token nativo persistente.

## Compatibilidade

As rotas, funções de workflows, downloads, artefatos, análise por IA e autenticação existentes foram preservadas. O endpoint de log inline passou de 200 KB para teto defensivo de 4 MB para manter acesso ao log bruto, enquanto a interface controla a quantidade renderizada.
