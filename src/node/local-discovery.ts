import dgram, { type RemoteInfo } from 'node:dgram'
import { signEvent } from '../core/identity/signing.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'
import { detectLocalHost } from './listen-address.js'

const DEFAULT_GROUP = '239.255.42.99'
const DEFAULT_INTERVAL_MS = 1_500

export interface LocalDiscoveryOptions {
  pubkey: string
  privkey: string
  port: number
  getListenAddress: () => string | undefined
  onEvent: (event: unknown, fromPeerId: string) => void
  group?: string
  intervalMs?: number
}

function safeJsonParse(data: Buffer): unknown | null {
  try {
    return JSON.parse(data.toString('utf8'))
  } catch {
    return null
  }
}

export class LocalDiscoveryService {
  private readonly group: string
  private readonly intervalMs: number
  private socket: dgram.Socket | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private closed = false

  constructor(private opts: LocalDiscoveryOptions) {
    this.group = opts.group ?? DEFAULT_GROUP
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  }

  async start(): Promise<void> {
    if (this.socket || this.closed) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      socket.on('error', (err) => {
        reject(err)
      })
      socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo)
      })
      socket.on('listening', () => {
        try {
          const interfaceAddress = detectLocalHost()
          socket.setBroadcast(true)
          socket.setMulticastTTL(1)
          socket.setMulticastLoopback(true)
          socket.setMulticastInterface(interfaceAddress)
          socket.addMembership(this.group, interfaceAddress)
        } catch (err) {
          reject(err as Error)
          return
        }
        this.socket = socket
        this.timer = setInterval(() => {
          void this.broadcast()
        }, this.intervalMs)
        void this.broadcast()
        resolve()
      })
      socket.bind(this.opts.port, '0.0.0.0')
    })
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    await new Promise<void>((resolve) => {
      if (!this.socket) {
        resolve()
        return
      }
      this.socket.close(() => resolve())
      this.socket = null
    })
  }

  private async broadcast(): Promise<void> {
    if (!this.socket) {
      return
    }
    const listenAddress = this.opts.getListenAddress()
    if (!listenAddress) {
      return
    }
    const now = Math.floor(Date.now() / 1000)
    const event = signEvent(
      {
        kind: QDHT_KIND.SERVICE_RECORD,
        pubkey: this.opts.pubkey,
        created_at: now,
        tags: [
          ['transport', 'ws'],
          ['d', 'local-discovery'],
          ['url', listenAddress],
        ],
        content: '',
        sig: '',
      },
      this.opts.privkey,
    )
    const payload = Buffer.from(JSON.stringify(event))
    await new Promise<void>((resolve, reject) => {
      this.socket?.send(payload, this.opts.port, this.group, (err?: Error | null) => {
        if (err) {
          reject(err)
          return
        }
        resolve()
      })
    })
  }

  private handleMessage(msg: Buffer, rinfo: RemoteInfo): void {
    const parsed = safeJsonParse(msg)
    if (!parsed || typeof parsed !== 'object') {
      return
    }
    const event = parsed as Record<string, unknown>
    this.opts.onEvent(event, typeof event.pubkey === 'string' ? event.pubkey : rinfo.address)
  }
}
