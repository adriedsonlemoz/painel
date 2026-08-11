import type { CapacitorConfig } from '@capacitor/cli'

const hostedUrl = String(process.env.CAPACITOR_WEB_URL || '').trim()

const config: CapacitorConfig = {
  appId: 'com.alsistemas.painel',
  appName: 'AL Sistemas',
  webDir: 'dist',
  server: hostedUrl
    ? { url: hostedUrl, cleartext: false }
    : { cleartext: false },
}

export default config
