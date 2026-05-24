import { networkInterfaces } from 'node:os'

export function detectLocalHost(): string {
  const nets = networkInterfaces()
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address
      }
    }
  }
  return '127.0.0.1'
}

export function buildAdvertisedListenAddress(listenAddress: string | undefined, listenPort: number): string {
  if (listenAddress) {
    try {
      const url = new URL(listenAddress)
      url.port = String(listenPort)
      return url.toString()
    } catch {
      return listenAddress
    }
  }

  return `ws://${detectLocalHost()}:${listenPort}`
}
