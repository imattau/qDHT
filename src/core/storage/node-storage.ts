import type { ContentIndexRepository } from './content-repository.js'
import type { NostrEventRepository } from './event-repository.js'

export interface NodeStorage {
  content: ContentIndexRepository
  events: NostrEventRepository
  close(): void
}
