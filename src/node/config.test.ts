import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nsecEncode } from 'nostr-tools/nip19'
import { generateKeypair } from '../core/identity/keys.js'
import { buildDefaultConfig, generateSessionIdentity, initConfig, loadConfig, privkeyFromNsec, type QDHTConfig } from './config.js'

let tmpDir = ''

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qdht-config-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('loads a valid config file', async () => {
    const cfg: QDHTConfig = {
      identity: { privkey: 'a'.repeat(64) },
      peers: ['ws://localhost:7778'],
      relays: ['wss://relay.example.com'],
      nip96Servers: ['https://nip96.example.com/upload'],
      quicPeers: ['quic://localhost:8888'],
      quicListenPort: 8888,
      localDiscovery: true,
      localDiscoveryPort: 45555,
      webPort: 8080,
      port: 7777,
      dataDir: tmpDir,
    }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(cfg))
    const loaded = await loadConfig(join(tmpDir, 'config.json'))
    expect(loaded.port).toBe(7777)
    expect(loaded.identity.privkey).toBe('a'.repeat(64))
    expect(loaded.peers).toEqual(['ws://localhost:7778'])
    expect(loaded.relays).toEqual(['wss://relay.example.com'])
    expect(loaded.nip96Servers).toEqual(['https://nip96.example.com/upload'])
    expect(loaded.quicPeers).toEqual(['quic://localhost:8888'])
    expect(loaded.quicListenPort).toBe(8888)
    expect(loaded.localDiscovery).toBe(true)
    expect(loaded.localDiscoveryPort).toBe(45555)
    expect(loaded.webPort).toBe(8080)
  })

  it('throws on missing identity.privkey', async () => {
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify({ port: 7777, peers: [], dataDir: tmpDir }))
    await expect(loadConfig(join(tmpDir, 'config.json'))).rejects.toThrow('identity.privkey')
  })

  it('throws on invalid privkey length', async () => {
    const bad = { identity: { privkey: 'abc' }, peers: [], port: 7777, dataDir: tmpDir }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(bad))
    await expect(loadConfig(join(tmpDir, 'config.json'))).rejects.toThrow('64 hex')
  })

  it('applies CLI overrides for port', async () => {
    const cfg: QDHTConfig = {
      identity: { privkey: 'b'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
    }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(cfg))
    const loaded = await loadConfig(join(tmpDir, 'config.json'), { port: 9000 })
    expect(loaded.port).toBe(9000)
  })

  it('throws on invalid relays array', async () => {
    const bad = { identity: { privkey: 'd'.repeat(64) }, peers: [], relays: [1, 2], port: 7777, dataDir: tmpDir }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(bad))
    await expect(loadConfig(join(tmpDir, 'config.json'))).rejects.toThrow('relays')
  })

  it('throws on invalid nip96Servers array', async () => {
    const bad = { identity: { privkey: 'e'.repeat(64) }, peers: [], nip96Servers: [1, 2], port: 7777, dataDir: tmpDir }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(bad))
    await expect(loadConfig(join(tmpDir, 'config.json'))).rejects.toThrow('nip96Servers')
  })

  it('throws on invalid quicPeers array', async () => {
    const bad = { identity: { privkey: 'f'.repeat(64) }, peers: [], quicPeers: [1, 2], port: 7777, dataDir: tmpDir }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(bad))
    await expect(loadConfig(join(tmpDir, 'config.json'))).rejects.toThrow('quicPeers')
  })

  it('throws on invalid quicListenPort', async () => {
    const bad = { identity: { privkey: '1'.repeat(64) }, peers: [], quicListenPort: 'abc', port: 7777, dataDir: tmpDir }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(bad))
    await expect(loadConfig(join(tmpDir, 'config.json'))).rejects.toThrow('quicListenPort')
  })

  it('throws on invalid webPort', async () => {
    const bad = { identity: { privkey: '2'.repeat(64) }, peers: [], webPort: 'abc', port: 7777, dataDir: tmpDir }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(bad))
    await expect(loadConfig(join(tmpDir, 'config.json'))).rejects.toThrow('webPort')
  })

  it('throws on invalid localDiscovery flag', async () => {
    const bad = { identity: { privkey: '3'.repeat(64) }, peers: [], localDiscovery: 'yes', port: 7777, dataDir: tmpDir }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(bad))
    await expect(loadConfig(join(tmpDir, 'config.json'))).rejects.toThrow('localDiscovery')
  })

  it('throws on invalid localDiscoveryPort', async () => {
    const bad = { identity: { privkey: '4'.repeat(64) }, peers: [], localDiscoveryPort: 'abc', port: 7777, dataDir: tmpDir }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(bad))
    await expect(loadConfig(join(tmpDir, 'config.json'))).rejects.toThrow('localDiscoveryPort')
  })
})

describe('bootstrapMode and maxPeers', () => {
  it('accepts bootstrapMode: true without maxPeers', async () => {
    const cfg = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
      bootstrapMode: true,
    }
    await writeFile(join(tmpDir, 'cfg-bsm.json'), JSON.stringify(cfg))
    const loaded = await loadConfig(join(tmpDir, 'cfg-bsm.json'))
    expect(loaded.bootstrapMode).toBe(true)
    expect(loaded.maxPeers).toBeUndefined()
  })

  it('accepts maxPeers as a positive integer', async () => {
    const cfg = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
      bootstrapMode: true,
      maxPeers: 500,
    }
    await writeFile(join(tmpDir, 'cfg-mp.json'), JSON.stringify(cfg))
    const loaded = await loadConfig(join(tmpDir, 'cfg-mp.json'))
    expect(loaded.maxPeers).toBe(500)
  })

  it('throws on maxPeers: 0', async () => {
    const cfg = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
      maxPeers: 0,
    }
    await writeFile(join(tmpDir, 'cfg-mp0.json'), JSON.stringify(cfg))
    await expect(loadConfig(join(tmpDir, 'cfg-mp0.json'))).rejects.toThrow('maxPeers')
  })

  it('throws on maxPeers: 1.5 (non-integer)', async () => {
    const cfg = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
      maxPeers: 1.5,
    }
    await writeFile(join(tmpDir, 'cfg-mpf.json'), JSON.stringify(cfg))
    await expect(loadConfig(join(tmpDir, 'cfg-mpf.json'))).rejects.toThrow('maxPeers')
  })

  it('applies bootstrapMode override from ConfigOverrides', async () => {
    const cfg = {
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 7777,
      dataDir: tmpDir,
    }
    await writeFile(join(tmpDir, 'cfg-bsov.json'), JSON.stringify(cfg))
    const loaded = await loadConfig(join(tmpDir, 'cfg-bsov.json'), { bootstrapMode: true, maxPeers: 100 })
    expect(loaded.bootstrapMode).toBe(true)
    expect(loaded.maxPeers).toBe(100)
  })
})

describe('initConfig', () => {
  it('creates config with generated identity if file does not exist', async () => {
    const configPath = join(tmpDir, 'config.json')
    const cfg = await initConfig(configPath, tmpDir)
    expect(cfg.identity.privkey).toMatch(/^[0-9a-f]{64}$/)
    expect(cfg.port).toBe(7777)
    expect(cfg.peers).toEqual([])
    expect(cfg.quicPeers).toEqual([])
    expect(cfg.localDiscovery).toBeUndefined()
  })

  it('returns existing config if file exists', async () => {
    const configPath = join(tmpDir, 'config.json')
    const existing: QDHTConfig = {
      identity: { privkey: 'c'.repeat(64) },
      peers: [],
      quicPeers: [],
      port: 8888,
      dataDir: tmpDir,
    }
    await writeFile(configPath, JSON.stringify(existing))
    const cfg = await initConfig(configPath, tmpDir)
    expect(cfg.port).toBe(8888)
  })
})

describe('nsec helpers', () => {
  it('parses nsec back to the original private key', () => {
    const keypair = generateKeypair()
    const nsec = nsecEncode(Buffer.from(keypair.privkey, 'hex'))
    expect(privkeyFromNsec(nsec)).toBe(keypair.privkey)
  })

  it('generates a printable session identity', () => {
    const identity = generateSessionIdentity()
    expect(identity.privkey).toMatch(/^[0-9a-f]{64}$/)
    expect(identity.nsec).toMatch(/^nsec1/)
    expect(privkeyFromNsec(identity.nsec)).toBe(identity.privkey)
  })

  it('builds a default config with the supplied private key', () => {
    const cfg = buildDefaultConfig('a'.repeat(64), tmpDir)
    expect(cfg.identity.privkey).toBe('a'.repeat(64))
    expect(cfg.peers).toEqual([])
    expect(cfg.quicPeers).toEqual([])
    expect(cfg.dataDir).toBe(tmpDir)
  })
})
