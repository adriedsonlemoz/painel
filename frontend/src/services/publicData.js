import { isBackendReady } from './backendWake.js'
import {
  isPublicFallbackEligible,
  isPublicPortalRoute,
  markPrimaryApiAvailable,
  snapshotCollection,
} from './publicFallback.js'

export function shouldServeSnapshotFirst() {
  return isPublicPortalRoute() && !isBackendReady()
}

export async function readPublicCollection(name, fallback, liveLoader) {
  if (shouldServeSnapshotFirst()) {
    try {
      return await snapshotCollection(name, fallback, { markActive: false })
    } catch {
      // Sem cache/snapshot: a API ao vivo ainda é a última alternativa.
    }
  }

  try {
    const value = await liveLoader()
    if (isPublicPortalRoute()) markPrimaryApiAvailable()
    return value
  } catch (error) {
    if (!isPublicPortalRoute() || !isPublicFallbackEligible(error)) throw error
    return snapshotCollection(name, fallback, { markActive: true }).catch(() => { throw error })
  }
}
