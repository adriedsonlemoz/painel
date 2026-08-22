# Relatório de implementação — 1.0.158

## Escopo

Melhoria do fluxo **GitHub → Projeto → Artefatos** no aplicativo Android. O trabalho não altera imagens, ícones ou splash.

## Implementado

1. **Log por artefato** com estado do DownloadManager, motivo nativo, HTTP, bytes recebidos, identificador do download e falhas de abertura.
2. **Diagnóstico autenticado no backend** (`POST /api/github/artifacts/:artifactId/download-diagnostic`) que inspeciona o pacote do GitHub Actions somente quando solicitado pelo usuário.
3. Para artefatos classificados como APK, o diagnóstico confirma se o ZIP contém `.apk`, informa quantidade de arquivos/APKs e retorna uma amostra limitada dos nomes encontrados.
4. **Falha inline**: o card não dispara mais o toast genérico “Download falhou no Android (código ...)”; o detalhe fica no botão Log.
5. **Abertura Android corrigida**: valida conclusão do download, força MIME de APK quando aplicável, trata ausência de instalador e abre a configuração `Instalar apps desconhecidos` quando a permissão ainda não foi concedida.
6. `REQUEST_INSTALL_PACKAGES` é adicionado ao Manifest gerado pelo script de branding/Android.
7. Layout dos cards foi refeito para impedir que **Abrir** fique espremido ou sobreposto no celular.
8. Nome amigável de APK evita duplicação de versão/build/sufixo `.apk`.

## Segurança

- O Log não exibe `GITHUB_TOKEN` nem o ticket temporário de download.
- A inspeção do ZIP respeita os limites `AL_GITHUB_APK_MAX_ARCHIVE_BYTES`.
- A rota de diagnóstico exige autenticação e valida `owner`, `repo` e `artifactId`.

## Versão

Frontend, backend, manifesto, exemplo de ambiente e versão de exportação sincronizados em **1.0.158**.
