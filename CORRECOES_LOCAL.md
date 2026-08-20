# Correções para execução local

- Frontend configurado para `http://127.0.0.1:3001/api`.
- Backend aceita frontend em `127.0.0.1` e `localhost`.
- Cliente HTTP possui timeout de 10 segundos e mensagens claras de conexão.
- Arquivos `.env` locais incluídos para uso direto no Termux.
- O Manager corrigido aguarda o backend responder antes de abrir o frontend.

## Execução pelo Manager

Escolha **Executar sistema** para iniciar backend e frontend juntos.
O frontend será aberto somente quando o backend estiver disponível.

## 1.0.126 — visual e responsividade
- Não recriar cards de métrica inline: usar `DSStatGrid` + `DSStatCard`.
- Não criar confirmação com overlay/Tailwind local: usar `ConfirmModal`/`DSModal`.
- Cores estruturais devem vir de `--adm-accent`; vermelho/âmbar/verde/azul ficam reservados a estados semânticos.
- Para três métricas compactas no celular, usar `mobileColumns={3}`; o CSS responsivo agora respeita essa configuração.
## 1.0.149 — credenciais
- A Central Cloudflare revela o valor efetivamente configurado somente sob demanda; o campo “novo valor” não representa mais a credencial salva.
- Fallbacks `CF_*` locais continuam reconhecidos por campo.
- O Setup continua livre para a instalação inicial, mas a manutenção de credenciais exige sessão administrativa após a instalação.

