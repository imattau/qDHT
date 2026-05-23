import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpProvider } from './http-provider.js'
import type { PieceDescriptor } from './provider.js'

const descriptor: PieceDescriptor = {
  url: 'https://example.com/file',
  pieceIndex: 2,
  pieceSize: 512 * 1024,
  totalSize: 3 * 512 * 1024,
}

describe('HttpProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('supports http and https urls', () => {
    const provider = new HttpProvider()
    expect(provider.schemes).toEqual(['http', 'https'])
    expect(provider.supports('https://example.com/file')).toBe(true)
    expect(provider.supports('http://example.com/file')).toBe(true)
    expect(provider.supports('file:///local/path')).toBe(false)
  })

  it('getPiece sends Range header and returns Buffer', async () => {
    const pieceData = Buffer.from('hello piece')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 206,
      arrayBuffer: async () => pieceData.buffer.slice(
        pieceData.byteOffset,
        pieceData.byteOffset + pieceData.byteLength,
      ),
    })

    const provider = new HttpProvider()
    const result = await provider.getPiece(descriptor)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.com/file')
    expect(init.headers).toMatchObject({ Range: 'bytes=1048576-1572863' })
    expect(result.toString()).toBe('hello piece')
  })

  it('accepts 200 response as well as 206', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0),
    })

    const provider = new HttpProvider()
    await expect(provider.getPiece(descriptor)).resolves.toBeInstanceOf(Buffer)
  })

  it('throws on non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })

    const provider = new HttpProvider()
    await expect(provider.getPiece(descriptor)).rejects.toThrow('HTTP 404')
  })

  it('getPieceStream returns response.body', async () => {
    const fakeStream = {} as ReadableStream<Uint8Array>
    fetchMock.mockResolvedValue({
      ok: true,
      status: 206,
      body: fakeStream,
    })

    const provider = new HttpProvider()
    const stream = await provider.getPieceStream!(descriptor)
    expect(stream).toBe(fakeStream)
  })
})
