import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeypair } from '../identity/keys.js'
import { buildAnnouncement } from '../protocol/announcement.js'
import { signAnnouncement } from '../identity/signing.js'
import { SqliteNodeStorage } from './sqlite-node-storage.js'

let tmpRoot = ''

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-storage-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('SqliteNodeStorage', () => {
  it('exposes content and event repositories on the same storage boundary', async () => {
    const storage = new SqliteNodeStorage(tmpRoot)
    const keypair = generateKeypair()
    const loc = await storage.content.put(Buffer.from('hello storage'), { name: 'hello.txt', ttl: 3600 })
    const announcement = buildAnnouncement({
      pubkey: keypair.pubkey,
      qkey: loc.qkey,
      hash: loc.hash,
      sizeBytes: loc.sizeBytes,
      pieces: loc.totalPieces,
      pieceSize: loc.pieceSize,
      ttl: 3600,
      name: loc.name,
    })

    storage.events.upsert(signAnnouncement(announcement, keypair.privkey))

    expect(await storage.content.getIndex()).toHaveProperty(loc.qkey)
    expect(storage.events.loadAll()).toHaveLength(1)
    storage.close()
  })
})
