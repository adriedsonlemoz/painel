# Correções para execução local

- Frontend configurado para `http://127.0.0.1:3001/api`.
- Backend aceita frontend em `127.0.0.1` e `localhost`.
- Cliente HTTP possui timeout de 10 segundos e mensagens claras de conexão.
- Arquivos `.env` locais incluídos para uso direto no Termux.
- O Manager corrigido aguarda o backend responder antes de abrir o frontend.

## Execução pelo Manager

Escolha **Executar sistema** para iniciar backend e frontend juntos.
O frontend será aberto somente quando o backend estiver disponível.
