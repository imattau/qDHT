import { join } from 'node:path'
import { ContentStore } from '../../node/content-store.js'
import { NostrSqliteStore } from '../nostr/sqlite-store.js'
import type { NodeStorage } from './node-storage.js'

export class SqliteNodeStorage implements NodeStorage {
  readonly content: ContentStore
  readonly events: NostrSqliteStore

  constructor(dataDir: string) {
    this.content = new ContentStore(dataDir)
    this.events = new NostrSqliteStore(join(dataDir, 'qdht.sqlite'))
  }

  close(): void {
    this.content.close()
    this.events.close()
  }
}
