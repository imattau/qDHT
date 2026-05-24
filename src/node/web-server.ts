import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { ContentLocation, PutMeta } from '../core/storage/content-repository.js'
import type { PeerInfo, ReplicaInfo, SearchAnnouncementsOptions } from './qdht-node.js'
import type { ResolvedRoute } from '../core/discovery/reachability.js'
import type { QDHTRequestResponsePayload } from '../core/protocol/request.js'

export interface WebNodeApi {
  status(): {
    pubkey: string
    port: number
    dataDir: string
    peerCount: number
    peers: PeerInfo[]
  }
  listPeers(): PeerInfo[]
  listReplicas(key: string): Promise<ReplicaInfo[]>
  searchIdentity(identityRef: string, timeoutMs?: number): Promise<ResolvedRoute | null>
  searchAnnouncements(query: string, options?: SearchAnnouncementsOptions): Promise<QDHTRequestResponsePayload | null>
  put(data: Buffer, meta: PutMeta): Promise<ContentLocation>
  fetchContent(key: string, timeoutMs?: number): Promise<Buffer>
  getContent(key: string): Promise<Buffer | null>
  getAnnouncementInfo(qkey: string): {
    hash: string
    totalPieces: number
    pieceSize: number
    sourceUrl?: string
    name?: string
    mime?: string
  } | null
}

interface ApiResponse {
  [key: string]: unknown
}

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
}

function json(res: ServerResponse, status: number, payload: ApiResponse): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(JSON.stringify(payload))
}

function text(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function safeResolve(rootDir: string, pathname: string): string | null {
  const cleanPath = pathname === '/' ? '/index.html' : pathname
  const resolved = resolve(rootDir, `.${cleanPath}`)
  const normalizedRoot = resolve(rootDir)
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}/`)) {
    return null
  }
  return resolved
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  let printable = 0
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      printable += 1
    }
  }
  return printable / sample.length > 0.85
}

export class NodeWebServer {
  private server: Server | null = null
  private resolvedPort: number | null = null

  constructor(
    private readonly node: WebNodeApi,
    private readonly webPort: number,
    private readonly rootDir = resolve(process.cwd(), 'web'),
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return
    }

    const startPort = this.webPort
    const maxPort = 65535
    function* portSequence(): Generator<number> {
      if (startPort === 0) {
        yield 0
        return
      }
      for (let port = startPort; port <= maxPort; port += 1) {
        yield port
      }
    }

    for (const port of portSequence()) {
      const attempt = await new Promise<{ server: Server; port: number } | null>((resolve, reject) => {
        const server = createServer((req, res) => {
          void this.handleRequest(req, res).catch((err) => {
            const message = err instanceof Error ? err.message : String(err)
            if (!res.headersSent) {
              json(res, 500, { error: message })
              return
            }
            res.destroy()
          })
        })
        const cleanup = (): void => {
          server.removeAllListeners('listening')
          server.removeAllListeners('error')
        }
        server.once('listening', () => {
          cleanup()
          const address = server.address()
          const resolved = typeof address === 'object' && address ? address.port : port
          resolve({ server, port: resolved })
        })
        server.once('error', (err: NodeJS.ErrnoException) => {
          cleanup()
          server.close(() => {
            if (err.code === 'EADDRINUSE') {
              resolve(null)
              return
            }
            reject(err)
          })
        })
        server.listen(port, '127.0.0.1')
      })

      if (!attempt) {
        continue
      }

      this.server = attempt.server
      this.resolvedPort = attempt.port
      return
    }

    throw new Error(`Unable to bind web server starting at port ${startPort}`)
  }

  async close(): Promise<void> {
    if (!this.server) {
      return
    }
    const server = this.server
    this.server = null
    this.resolvedPort = null
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  port(): number | null {
    return this.resolvedPort
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase()
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      })
      res.end()
      return
    }

    if (url.pathname === '/api/status') {
      json(res, 200, {
        ...this.node.status(),
        webPort: this.port(),
      })
      return
    }

    if (url.pathname === '/api/peers') {
      json(res, 200, { peers: this.node.listPeers() })
      return
    }

    if (url.pathname === '/api/replicas') {
      const key = url.searchParams.get('key')
      if (!key) {
        json(res, 400, { error: 'missing key' })
        return
      }
      const replicas = await this.node.listReplicas(key)
      json(res, 200, { replicas })
      return
    }

    if (url.pathname === '/api/search') {
      const query = url.searchParams.get('query') ?? ''
      const type = (url.searchParams.get('type') ?? 'content') as 'identity' | 'content' | 'route' | 'replica'
      const timeoutMs = Number(url.searchParams.get('timeoutMs') ?? '2000')
      const limit = Number(url.searchParams.get('limit') ?? '25')
      const options: SearchAnnouncementsOptions = {
        type,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 2000,
        limit: Number.isFinite(limit) ? limit : 25,
        publisher: url.searchParams.get('publisher') ?? undefined,
        qkey: url.searchParams.get('qkey') ?? undefined,
        hash: url.searchParams.get('hash') ?? undefined,
        name: url.searchParams.get('name') ?? undefined,
        mime: url.searchParams.get('mime') ?? undefined,
        tag: url.searchParams.get('tag') ?? undefined,
      }
      if (type === 'identity') {
        const route = await this.node.searchIdentity(query, options.timeoutMs)
        json(res, 200, { route })
        return
      }
      const response = await this.node.searchAnnouncements(query, options)
      json(res, 200, { response })
      return
    }

    if (url.pathname === '/api/content' && method === 'GET') {
      const key = url.searchParams.get('key')
      if (!key) {
        json(res, 400, { error: 'missing key' })
        return
      }
      const content = await this.node.getContent(key)
      if (!content) {
        json(res, 404, { error: 'not found' })
        return
      }
      const info = this.node.getAnnouncementInfo(key)
      const textContent = isProbablyText(content) ? content.toString('utf8') : null
      json(res, 200, {
        found: true,
        key,
        size: content.length,
        mime: info?.mime ?? 'application/octet-stream',
        name: info?.name ?? null,
        contentBase64: content.toString('base64'),
        text: textContent,
        announcement: info,
      })
      return
    }

    if (url.pathname === '/api/put' && method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8')) as {
        dataBase64?: string
        name?: string
        ttl?: number
        mime?: string
      }
      if (typeof body.dataBase64 !== 'string' || body.dataBase64.length === 0) {
        json(res, 400, { error: 'missing dataBase64' })
        return
      }
      const data = Buffer.from(body.dataBase64, 'base64')
      const location = await this.node.put(data, {
        name: body.name,
        ttl: typeof body.ttl === 'number' ? body.ttl : 86400,
        mime: body.mime,
      })
      json(res, 200, { location })
      return
    }

    const assetPath = safeResolve(this.rootDir, url.pathname)
    if (!assetPath) {
      text(res, 403, 'Forbidden')
      return
    }

    try {
      const file = await readFile(assetPath)
      const contentType = MIME_TYPES[extname(assetPath)] ?? 'application/octet-stream'
      text(res, 200, file.toString('utf8'), contentType)
    } catch {
      if (url.pathname !== '/') {
        json(res, 404, { error: 'not found' })
        return
      }
      json(res, 500, { error: 'web root missing index.html' })
    }
  }
}
