export const IS_VERCEL = Boolean(
  process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION
)

export const IS_RENDER = Boolean(
  process.env.RENDER ||
  process.env.RENDER_SERVICE_ID ||
  process.env.RENDER_INSTANCE_ID ||
  String(process.env.AL_MANAGED_HOST || '').toLowerCase() === 'render'
)

export const IS_TERMUX = Boolean(
  process.env.TERMUX_VERSION ||
  String(process.env.PREFIX || '').includes('com.termux')
)

export const IS_MANAGED_PLATFORM = IS_VERCEL || IS_RENDER

export function runtimeLabel() {
  if (IS_RENDER) return 'Render'
  if (IS_VERCEL) return 'Vercel'
  if (IS_TERMUX) return 'Termux'
  if (process.platform === 'linux') return 'Linux/VPS'
  return process.platform
}
