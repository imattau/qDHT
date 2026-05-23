import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { generateKeypair } from '../core/identity/keys.js'

export interface QDHTConfig {
  identity: { privkey: string }
  peers: string[]
  relays?: string[]
  port: number
  dataDir: string
}

export interface ConfigOverrides {
  port?: number
  peers?: string[]
  relays?: string[]
  dataDir?: string
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

  const port = candidate.port
  if (typeof port !== 'number' || !Number.isFinite(port)) {
    throw new Error('Config missing port')
  }

  const dataDir = candidate.dataDir
  if (typeof dataDir !== 'string' || dataDir.length === 0) {
    throw new Error('Config missing dataDir')
  }

  return {
    identity: { privkey: validatePrivkey((identity as Record<string, unknown>).privkey) },
    peers,
    relays,
    port,
    dataDir,
  }
}

export async function loadConfig(configPath: string, overrides: ConfigOverrides = {}): Promise<QDHTConfig> {
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  const config = validateConfig(raw, configPath)
  if (overrides.port !== undefined) config.port = overrides.port
  if (overrides.peers !== undefined) config.peers = overrides.peers
  if (overrides.relays !== undefined) config.relays = overrides.relays
  if (overrides.dataDir !== undefined) config.dataDir = overrides.dataDir
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
    port: 7777,
    dataDir: defaultDataDir,
  }

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return config
}
