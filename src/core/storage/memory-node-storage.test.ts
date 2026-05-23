import { describe, expect, it } from 'vitest'
import { generateKeypair } from '../identity/keys.js'
import { buildAnnouncement } from '../protocol/announcement.js'
import { signAnnouncement } from '../identity/signing.js'
import { MemoryNodeStorage } from './memory-node-storage.js'

describe('MemoryNodeStorage', () => {
  it('stores content and events without SQLite', async () => {
    const storage = new MemoryNodeStorage()
    const keypair = generateKeypair()
    const loc = await storage.content.put(Buffer.from('hello memory storage'), { name: 'hello.txt', ttl: 3600 })
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
    expect(await storage.content.getPiece(loc.hash, 0)).toBeInstanceOf(Buffer)
    expect(storage.events.loadAll()).toHaveLength(1)
    storage.close()
  })
})
