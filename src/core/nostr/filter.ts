import { type NostrEvent } from './event.js'
import { getTag } from './tags.js'

export interface NostrFilter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  [tag: `#${string}`]: string[] | number | undefined
}

export function matchesFilter(event: NostrEvent, filter: NostrFilter): boolean {
  const signed = event as NostrEvent & { id?: string }

  if (filter.ids !== undefined) {
    if (!signed.id || !filter.ids.some((prefix) => signed.id!.startsWith(prefix))) {
      return false
    }
  }

  if (filter.authors !== undefined) {
    if (!filter.authors.some((prefix) => event.pubkey.startsWith(prefix))) {
      return false
    }
  }

  if (filter.kinds !== undefined && !filter.kinds.includes(event.kind)) {
    return false
  }

  if (filter.since !== undefined && event.created_at < filter.since) {
    return false
  }

  if (filter.until !== undefined && event.created_at > filter.until) {
    return false
  }

  for (const key of Object.keys(filter)) {
    if (!key.startsWith('#')) {
      continue
    }
    const values = (filter as Record<string, string[] | number | undefined>)[key]
    if (!Array.isArray(values)) {
      continue
    }

    const tagName = key.slice(1)
    const hasMatch = event.tags.some((tag) => tag[0] === tagName && tag[1] !== undefined && values.includes(tag[1]))
    if (!hasMatch) {
      return false
    }
  }

  return true
}
