import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initConfig, loadConfig, type QDHTConfig } from './config.js'

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
      port: 7777,
      dataDir: tmpDir,
    }
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(cfg))
    const loaded = await loadConfig(join(tmpDir, 'config.json'))
    expect(loaded.port).toBe(7777)
    expect(loaded.identity.privkey).toBe('a'.repeat(64))
    expect(loaded.peers).toEqual(['ws://localhost:7778'])
    expect(loaded.relays).toEqual(['wss://relay.example.com'])
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
})

describe('initConfig', () => {
  it('creates config with generated identity if file does not exist', async () => {
    const configPath = join(tmpDir, 'config.json')
    const cfg = await initConfig(configPath, tmpDir)
    expect(cfg.identity.privkey).toMatch(/^[0-9a-f]{64}$/)
    expect(cfg.port).toBe(7777)
    expect(cfg.peers).toEqual([])
  })

  it('returns existing config if file exists', async () => {
    const configPath = join(tmpDir, 'config.json')
    const existing: QDHTConfig = {
      identity: { privkey: 'c'.repeat(64) },
      peers: [],
      port: 8888,
      dataDir: tmpDir,
    }
    await writeFile(configPath, JSON.stringify(existing))
    const cfg = await initConfig(configPath, tmpDir)
    expect(cfg.port).toBe(8888)
  })
})
