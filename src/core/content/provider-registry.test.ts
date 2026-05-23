import { describe, expect, it } from 'vitest'
import { FilesystemProvider } from './filesystem-provider.js'
import { HttpProvider } from './http-provider.js'
import { ContentProviderRegistry } from './provider-registry.js'

describe('ContentProviderRegistry', () => {
  it('auto-registers FilesystemProvider and HttpProvider', () => {
    const registry = new ContentProviderRegistry()
    expect(registry.all()[0]).toBeInstanceOf(FilesystemProvider)
    expect(registry.all()[1]).toBeInstanceOf(HttpProvider)
    expect(registry.getForUrl('https://example.com')).toBeInstanceOf(HttpProvider)
    expect(registry.getForUrl('file:///tmp/example')).toBeInstanceOf(FilesystemProvider)
  })

  it('register appends providers and all() returns a shallow copy', () => {
    const registry = new ContentProviderRegistry()
    const custom = {
      schemes: ['https'],
      supports: (url: string) => url.startsWith('https://example.com/custom'),
      getPiece: async () => Buffer.from('x'),
    }
    registry.register(custom)
    expect(registry.all()).toContain(custom)

    const snapshot = registry.all()
    snapshot.pop()
    expect(registry.all()).toHaveLength(3)
  })
})
