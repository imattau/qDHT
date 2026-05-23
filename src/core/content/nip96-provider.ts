import { type ContentMeta, type ContentProvider, type ContentLocation, type PieceDescriptor } from './provider.js'

export class NotSupportedError extends Error {
  constructor(message = 'operation not supported') {
    super(message)
    this.name = 'NotSupportedError'
  }
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadError'
  }
}

export interface Nip96ProviderOptions {
  serverUrl: string
}

export class Nip96Provider implements ContentProvider {
  readonly schemes: string[] = []

  constructor(private readonly opts: Nip96ProviderOptions) {}

  supports(_url: string): boolean {
    return false
  }

  async getPiece(_descriptor: PieceDescriptor): Promise<Buffer> {
    throw new NotSupportedError('NIP-96 provider is upload-only')
  }

  async upload(data: Buffer, meta: Pick<ContentMeta, 'name' | 'mime'>): Promise<ContentLocation> {
    const form = new FormData()
    form.append('file', new Blob([data], { type: meta.mime }), meta.name)

    // TODO(nip98): attach Authorization header.
    const response = await fetch(this.opts.serverUrl, {
      method: 'POST',
      body: form,
    })

    if (!response.ok) {
      throw new UploadError(`NIP-96 upload failed with HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
      status?: string
      nip94_event?: { tags?: string[][] }
    }

    if (payload.status !== 'success') {
      throw new UploadError('NIP-96 response status was not success')
    }

    const tags = payload.nip94_event?.tags ?? []
    const url = tags.find((tag) => tag[0] === 'url')?.[1]
    const hash = tags.find((tag) => tag[0] === 'x')?.[1]
    if (!url || !hash) {
      throw new UploadError('NIP-96 response missing url or x tag')
    }

    return {
      qkey: hash,
      hash,
      url,
    }
  }
}
