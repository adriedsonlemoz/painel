import { api } from './http.js'

export const portalContentService = {
  home() { return api('/portal-content/home', { timeoutMs: 20000 }) },
  weather() { return api('/portal-content/weather', { timeoutMs: 15000 }) },
  football() { return api('/portal-content/football', { timeoutMs: 15000 }) },
  rssWorld() { return api('/portal-content/rss-world', { timeoutMs: 20000 }) },
  horoscope(sign) { return api(`/portal-content/horoscope?sign=${encodeURIComponent(sign)}`, { timeoutMs: 25000 }) },
}
