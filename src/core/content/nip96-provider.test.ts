import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Nip96Provider, NotSupportedError, UploadError } from './nip96-provider.js'

describe('Nip96Provider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is upload-only', async () => {
    const provider = new Nip96Provider({ serverUrl: 'https://nip96.example/upload' })
    expect(provider.schemes).toEqual([])
    expect(provider.supports('https://example.com')).toBe(false)
    await expect(provider.getPiece({ url: 'https://example.com', pieceIndex: 0, pieceSize: 1, totalSize: 1 }))
      .rejects.toBeInstanceOf(NotSupportedError)
  })

  it('uploads via multipart form and parses nip94 url/hash tags', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        nip94_event: {
          tags: [
            ['url', 'https://cdn.example/file.bin'],
            ['x', 'abc123'],
          ],
        },
      }),
    })

    const provider = new Nip96Provider({ serverUrl: 'https://nip96.example/upload' })
    const result = await provider.upload(Buffer.from('hello'), { name: 'hello.txt', mime: 'text/plain' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://nip96.example/upload')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(Array.from(form.keys())).toContain('file')
    expect(result).toEqual({
      qkey: 'abc123',
      hash: 'abc123',
      url: 'https://cdn.example/file.bin',
    })
  })

  it('throws UploadError on bad response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const provider = new Nip96Provider({ serverUrl: 'https://nip96.example/upload' })
    await expect(provider.upload(Buffer.from('hello'), { name: 'hello.txt', mime: 'text/plain' }))
      .rejects.toBeInstanceOf(UploadError)
  })
})
