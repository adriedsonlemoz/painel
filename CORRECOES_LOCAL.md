## 1.0.155 — Infraestrutura e leitura no celular

- `Ambientes` foi incorporado à Central de `Infraestrutura`; a URL antiga redireciona para a aba correspondente.
- Estados de MongoDB/GitHub/Vercel/Render/R2/CORS usam o diagnóstico real e não campos legados ausentes.
- Métricas avançadas ficam recolhidas e a limpeza de cache foi movida para Manutenção.
- A escala tipográfica administrativa foi ampliada e tamanhos hardcoded abaixo de 11/12 px foram normalizados.
- Tema claro ganhou maior contraste no texto secundário.
- Cloudflare/R2 e Projetos/Deploys receberam ajustes específicos de legibilidade, idioma e ações touch.
- Nenhuma imagem foi alterada.

## 1.0.154 — Ícone AL e splash

- Novo ícone AL aprovado integrado como fonte única da identidade.
- Launcher/roundIcon/Adaptive Icon atualizados para Android.
- Splash Android e abertura web usam a mesma imagem integral, sem deformação.
- PWA e Apple Touch Icon atualizados.
- Cache estático elevado para `alsistemas-v5`.

# Correções para execução local

## 1.0.153 — UX de atualização e cold start administrativo

- Fluxo guiado de atualização padronizado do pacote à produção.
- Percentual GitHub usa progresso real; Vercel/Render usam estados reais e confirmação final.
- Tela concluída compacta e com ação **Aplicar atualização agora**.
- Administração informa cold start/servidor, sessão e abertura do painel em vez de spinner vazio.
- Nenhum asset de imagem foi alterado.

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
## 1.0.150 — portal, Plantão e sessão cloud
- Nome longo do portal não aumenta mais a largura da página no celular.
- O aviso de contingência fica no rodapé e deixa de ocupar o topo do site.
- Plantões têm 6 h por padrão e no máximo 24 h; registros antigos sem prazo deixam de ficar permanentes.
- Em Vercel → Render, “Manter conectado” preserva o Bearer fallback no navegador e cold starts não invalidam a sessão por timeout/503.
- O backend só aceita rotas protegidas depois de restaurar o JWT persistente do Mongo.
## 1.0.151 — cache-first e cold start
- O portal público abre a partir do snapshot/cache sem esperar o backend.
- Cache local: 10 min de frescor e 24 h de retenção máxima por padrão.
- Render acorda em segundo plano por até 90 s; login acompanha o tempo sem falso erro aos 3–6 s.
- `/status/` diferencia aplicação Render iniciando de indisponibilidade real e mostra idade do snapshot.
## 1.0.152 — ícone e splash Android
- A nova marca AL substitui o asset anterior no PWA e no APK.
- O launcher usa mipmaps por densidade, `roundIcon` e Adaptive Icon; não depende mais de um único drawable genérico.
- A splash mantém proporção 1:1 e centraliza a imagem, evitando stretch e desfoque.
- O script de branding valida o PNG aprovado antes de alterar o projeto Android gerado pelo Capacitor.

