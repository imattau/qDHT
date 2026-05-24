import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { generateKeypair } from '../core/identity/keys.js'

export interface QDHTConfig {
  identity: { privkey: string }
  peers: string[]
  relays?: string[]
  nip96Servers?: string[]
  quicPeers?: string[]
  quicListenPort?: number
  webPort?: number
  port: number
  dataDir: string
  bootstrapMode?: boolean
  maxPeers?: number
  listenAddress?: string
}

export interface ConfigOverrides {
  port?: number
  peers?: string[]
  relays?: string[]
  nip96Servers?: string[]
  quicPeers?: string[]
  quicListenPort?: number
  webPort?: number
  dataDir?: string
  bootstrapMode?: boolean
  maxPeers?: number
  listenAddress?: string
}

function validatePrivkey(privkey: unknown): string {
  if (typeof privkey !== 'string') {
    throw new Error('Config missing identity.privkey')
  }
  if (!/^[0-9a-f]{64}$/i.test(privkey)) {
    throw new Error('identity.privkey must be 64 hex chars')
  }
  return privkey.toLowerCase()
}

export function validateConfig(raw: unknown, path: string): QDHTConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Config at ${path} is not an object`)
  }

  const candidate = raw as Record<string, unknown>
  const identity = candidate.identity
  if (!identity || typeof identity !== 'object') {
    throw new Error('Config missing identity.privkey')
  }

  const peers = candidate.peers
  if (!Array.isArray(peers) || !peers.every((peer) => typeof peer === 'string')) {
    throw new Error('Config missing peers array')
  }

  const relays = candidate.relays
  if (relays !== undefined && (!Array.isArray(relays) || !relays.every((relay) => typeof relay === 'string'))) {
    throw new Error('Config relays must be an array of strings')
  }

  const nip96Servers = candidate.nip96Servers
  if (nip96Servers !== undefined && (!Array.isArray(nip96Servers) || !nip96Servers.every((server) => typeof server === 'string'))) {
    throw new Error('Config nip96Servers must be an array of strings')
  }

  const quicPeers = candidate.quicPeers
  if (quicPeers !== undefined && (!Array.isArray(quicPeers) || !quicPeers.every((peer) => typeof peer === 'string'))) {
    throw new Error('Config quicPeers must be an array of strings')
  }

  const quicListenPort = candidate.quicListenPort
  if (quicListenPort !== undefined && (typeof quicListenPort !== 'number' || !Number.isFinite(quicListenPort))) {
    throw new Error('Config quicListenPort must be a number')
  }

  const webPort = candidate.webPort
  if (webPort !== undefined && (typeof webPort !== 'number' || !Number.isFinite(webPort))) {
    throw new Error('Config webPort must be a number')
  }

  const port = candidate.port
  if (typeof port !== 'number' || !Number.isFinite(port)) {
    throw new Error('Config missing port')
  }

  const dataDir = candidate.dataDir
  if (typeof dataDir !== 'string' || dataDir.length === 0) {
    throw new Error('Config missing dataDir')
  }

  const bootstrapMode = candidate.bootstrapMode
  if (bootstrapMode !== undefined && typeof bootstrapMode !== 'boolean') {
    throw new Error('Config bootstrapMode must be a boolean')
  }

  const maxPeers = candidate.maxPeers
  if (maxPeers !== undefined) {
    if (typeof maxPeers !== 'number' || !Number.isInteger(maxPeers) || maxPeers <= 0) {
      throw new Error('Config maxPeers must be a positive integer')
    }
  }

  const listenAddress = candidate.listenAddress
  if (listenAddress !== undefined && typeof listenAddress !== 'string') {
    throw new Error('Config listenAddress must be a string')
  }

  return {
    identity: { privkey: validatePrivkey((identity as Record<string, unknown>).privkey) },
    peers,
    relays,
    nip96Servers,
    quicPeers,
    quicListenPort,
    webPort,
    port,
    dataDir,
    bootstrapMode: bootstrapMode as boolean | undefined,
    maxPeers: maxPeers as number | undefined,
    listenAddress: listenAddress as string | undefined,
  }
}

export async function loadConfig(configPath: string, overrides: ConfigOverrides = {}): Promise<QDHTConfig> {
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  const config = validateConfig(raw, configPath)
  if (overrides.port !== undefined) config.port = overrides.port
  if (overrides.peers !== undefined) config.peers = overrides.peers
  if (overrides.relays !== undefined) config.relays = overrides.relays
  if (overrides.nip96Servers !== undefined) config.nip96Servers = overrides.nip96Servers
  if (overrides.quicPeers !== undefined) config.quicPeers = overrides.quicPeers
  if (overrides.quicListenPort !== undefined) config.quicListenPort = overrides.quicListenPort
  if (overrides.webPort !== undefined) config.webPort = overrides.webPort
  if (overrides.dataDir !== undefined) config.dataDir = overrides.dataDir
  if (overrides.bootstrapMode !== undefined) config.bootstrapMode = overrides.bootstrapMode
  if (overrides.maxPeers !== undefined) config.maxPeers = overrides.maxPeers
  if (overrides.listenAddress !== undefined) config.listenAddress = overrides.listenAddress
  return config
}

export async function initConfig(configPath: string, defaultDataDir: string): Promise<QDHTConfig> {
  try {
    return await loadConfig(configPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw err
    }
  }

  const keypair = generateKeypair()
  const config: QDHTConfig = {
    identity: { privkey: keypair.privkey },
    peers: [],
    quicPeers: [],
    port: 7777,
    dataDir: defaultDataDir,
  }

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return config
}
