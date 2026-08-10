import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.alsistemas.painel',
  appName: 'AL Sistemas',
  webDir: 'dist',
  server: {
    // O workflow de APK habilita esta URL para o WebView hospedado.
    // url: 'https://alsistemas.vercel.app',
    cleartext: false,
  },
}

export default config
