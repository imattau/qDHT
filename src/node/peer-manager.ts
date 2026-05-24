import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import ReconnectingWebSocket from 'reconnecting-websocket'
import getPort, { portNumbers } from 'get-port'
import type { Transport } from './transport.js'
import { signEvent } from '../core/identity/signing.js'
import { QDHT_KIND } from '../core/nostr/kinds.js'

export interface PeerInfo {
  pubkey: string
  url: string
  latencyMs: number | null
  connectedAt: string
}

interface ConnectedPeer {
  ws: WebSocket
  tempId: string
  pubkey: string
  url: string
  connectedAt: string
  lastPong: number
  latencyMs: number | null
  outbound: boolean
}

export interface PeerManagerOptions {
  port: number
  pubkey: string
  privkey: string
  listenAddress?: string
}

type MessageHandler = (msg: unknown, peerId: string) => void
type PeerHandler = (peerId: string, info: PeerInfo) => void

const HANDSHAKE = 'handshake'
const PING_INTERVAL_MS = 30_000
const PONG_TIMEOUT_MS = 90_000
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 60_000

function nowIso(): string {
  return new Date().toISOString()
}

function safeJsonParse(data: RawData): unknown | null {
  try {
    return JSON.parse(data.toString())
  } catch {
    return null
  }
}

export class PeerManager implements Transport {
  private server: WebSocketServer | null = null
  private listeningPort: number | null = null
  private peerMap = new Map<string, ConnectedPeer>()
  private urlToPeerId = new Map<string, string>()
  private outboundState = new Map<string, { delayMs: number; timer: ReturnType<typeof setTimeout> | null; active: boolean }>()
  private messageHandlers: MessageHandler[] = []
  private peerConnectedHandlers: PeerHandler[] = []
  private peerDisconnectedHandlers: PeerHandler[] = []
  private transportConnectedHandlers: Array<(peerId: string) => void> = []
  private transportDisconnectedHandlers: Array<(peerId: string) => void> = []
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private advertisedListenAddress?: string

  constructor(private opts: PeerManagerOptions) {}

  setListenAddress(listenAddress?: string): void {
    this.advertisedListenAddress = listenAddress ?? this.opts.listenAddress
  }

  async listen(): Promise<number> {
    if (this.server) {
      return this.listeningPort ?? this.opts.port
    }

    const port = await getPort({ port: this.opts.port === 0 ? undefined : portNumbers(this.opts.port, 65535) })

    await new Promise<void>((resolve, reject) => {
      const server = new WebSocketServer({ port })
      server.once('listening', () => {
        this.server = server
        this.listeningPort = port
        resolve()
      })
      server.once('error', reject)
      server.on('connection', (ws, req) => {
        const url = `ws://${req.socket.remoteAddress ?? '127.0.0.1'}:${req.socket.remotePort ?? port}`
        this.attachPeer(ws, url, false)
      })
    })

    this.startPingLoop()
    return this.listeningPort!
  }

  connect(url: string): void {
    if (this.closed) {
      return
    }

    if (this.outboundState.get(url)?.active) {
      return
    }

    if (!this.outboundState.has(url)) {
      this.outboundState.set(url, { delayMs: RECONNECT_MIN_MS, timer: null, active: false })
    }

    // @ts-ignore -- reconnecting-websocket CJS types lose construct signature under NodeNext
    const rws = new ReconnectingWebSocket(url, [], {
      WebSocket: class extends WebSocket {
        constructor(url: string, protocols?: string | string[], options?: any) {
          super(url, protocols, options)
          this.on('error', () => {}) // Prevent unhandled 'error' events from crashing the process
        }
      } as unknown as new (...args: unknown[]) => unknown,
      maxRetries: Infinity,
      reconnectionDelayGrowFactor: 2,
      minReconnectionDelay: RECONNECT_MIN_MS,
      maxReconnectionDelay: RECONNECT_MAX_MS,
    })

    rws.addEventListener('open', () => {
      const nativeWs = (rws as unknown as { _ws: WebSocket })._ws ?? rws
      const peer = this.attachPeer(nativeWs as unknown as WebSocket, url, true)
      const state = this.outboundState.get(url)
      if (state) {
        state.active = true
      }
      peer.ws.send(JSON.stringify({ type: HANDSHAKE, pubkey: this.opts.pubkey }))
    })
    rws.addEventListener('close', () => {
      this.detachUrl(url)
      const state = this.outboundState.get(url)
      if (state) {
        state.active = false
      }
    })
    rws.addEventListener('error', () => {
      // ReconnectingWebSocket handles retry automatically
    })

    const state = this.outboundState.get(url)!
    state.timer = null
    // Store rws reference for cleanup
    ;(state as unknown as Record<string, unknown>).rws = rws
  }

  broadcast(msg: unknown, excludePeerId?: string): void {
    const data = JSON.stringify(msg)
    for (const [peerId, peer] of this.peerMap) {
      if (excludePeerId && peerId === excludePeerId) {
        continue
      }
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(data)
      }
    }
  }

  send(peerId: string, msg: unknown): void {
    const peer = this.peerMap.get(peerId)
    if (peer && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify(msg))
    }
  }

  peers(): PeerInfo[] {
    return [...this.peerMap.entries()].map(([peerId, peer]) => ({
      pubkey: peer.pubkey || peerId,
      url: peer.url,
      latencyMs: peer.latencyMs,
      connectedAt: peer.connectedAt,
    }))
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler)
  }

  onPeerConnected(handler: ((peerId: string) => void) | PeerHandler): void {
    if (handler.length === 1) {
      this.transportConnectedHandlers.push(handler as (peerId: string) => void)
      return
    }
    this.peerConnectedHandlers.push(handler as PeerHandler)
  }

  onPeerDisconnected(handler: ((peerId: string) => void) | PeerHandler): void {
    if (handler.length === 1) {
      this.transportDisconnectedHandlers.push(handler as (peerId: string) => void)
      return
    }
    this.peerDisconnectedHandlers.push(handler as PeerHandler)
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }

    for (const state of this.outboundState.values()) {
      if (state.timer) {
        clearTimeout(state.timer)
        state.timer = null
      }
      // @ts-ignore -- reconnecting-websocket CJS types lose namespace type under NodeNext
      const rws = (state as unknown as Record<string, unknown>).rws as ReconnectingWebSocket | undefined
      if (rws) {
        rws.close()
      }
    }

    for (const peer of this.peerMap.values()) {
      peer.ws.terminate()
    }
    this.peerMap.clear()
    this.urlToPeerId.clear()
    this.outboundState.clear()
    this.listeningPort = null

    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(() => resolve())
      this.server = null
    })
  }

  port(): number | null {
    return this.listeningPort
  }

  private attachPeer(ws: WebSocket, url: string, outbound: boolean): ConnectedPeer {
    const tempId = `temp-${randomUUID()}`
    const peer: ConnectedPeer = {
      ws,
      tempId,
      pubkey: '',
      url,
      connectedAt: nowIso(),
      lastPong: Date.now(),
      latencyMs: null,
      outbound,
    }
    this.peerMap.set(tempId, peer)
    this.urlToPeerId.set(url, tempId)

    ws.on('message', (data: RawData) => this.handleMessage(peer, data))
    ws.on('pong', () => {
      peer.lastPong = Date.now()
    })
    ws.on('close', () => {
      this.removePeer(peer)
      this.notifyDisconnected(peer)
    })
    ws.on('error', () => {
      this.removePeer(peer)
    })

    if (!outbound && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: HANDSHAKE, pubkey: this.opts.pubkey }))
    }

    return peer
  }

  private handleMessage(peer: ConnectedPeer, data: RawData): void {
    const parsed = safeJsonParse(data)
    if (!parsed || typeof parsed !== 'object') {
      return
    }

    const message = parsed as Record<string, unknown>
    if (message.type === HANDSHAKE && typeof message.pubkey === 'string') {
      this.registerPeerPubkey(peer, message.pubkey)
      return
    }

    const peerId = peer.pubkey || peer.tempId
    for (const handler of this.messageHandlers) {
      handler(message, peerId)
    }
  }

  private registerPeerPubkey(peer: ConnectedPeer, pubkey: string): void {
    const previousId = peer.pubkey || peer.tempId
    if (peer.pubkey === pubkey) {
      return
    }

    this.peerMap.delete(previousId)
    peer.pubkey = pubkey
    this.peerMap.set(pubkey, peer)
    this.urlToPeerId.set(peer.url, pubkey)
    this.notifyConnected(pubkey, peer)
    this.sendServiceRecord(peer)

    const state = this.outboundState.get(peer.url)
    if (state) {
      state.active = true
      state.delayMs = RECONNECT_MIN_MS
    }
  }

  private sendServiceRecord(peer: ConnectedPeer): void {
    const listenAddress = this.advertisedListenAddress ?? this.opts.listenAddress
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
          ['d', 'main'],
          ['url', listenAddress],
        ],
        content: '',
        sig: '',
      },
      this.opts.privkey,
    )
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify(event))
    }
  }

  private removePeer(peer: ConnectedPeer): void {
    this.peerMap.delete(peer.pubkey || peer.tempId)
    if (this.urlToPeerId.get(peer.url) === (peer.pubkey || peer.tempId)) {
      this.urlToPeerId.delete(peer.url)
    }
    const state = this.outboundState.get(peer.url)
    if (state && state.active) {
      state.active = false
    }
  }

  private detachUrl(url: string): void {
    const peerId = this.urlToPeerId.get(url)
    if (!peerId) {
      return
    }
    const peer = this.peerMap.get(peerId)
    if (peer) {
      this.removePeer(peer)
    }
  }

  private notifyConnected(peerId: string, peer: ConnectedPeer): void {
    const info: PeerInfo = {
      pubkey: peer.pubkey,
      url: peer.url,
      latencyMs: peer.latencyMs,
      connectedAt: peer.connectedAt,
    }
    for (const handler of this.peerConnectedHandlers) {
      handler(peerId, info)
    }
    for (const handler of this.transportConnectedHandlers) {
      handler(peerId)
    }
  }

  private notifyDisconnected(peer: ConnectedPeer): void {
    const peerId = peer.pubkey || peer.tempId
    const info: PeerInfo = {
      pubkey: peer.pubkey || peer.tempId,
      url: peer.url,
      latencyMs: peer.latencyMs,
      connectedAt: peer.connectedAt,
    }
    for (const handler of this.peerDisconnectedHandlers) {
      handler(peerId, info)
    }
    for (const handler of this.transportDisconnectedHandlers) {
      handler(peerId)
    }
  }

  private startPingLoop(): void {
    if (this.pingTimer) {
      return
    }
    this.pingTimer = setInterval(() => {
      const now = Date.now()
      for (const [peerId, peer] of this.peerMap) {
        if (now - peer.lastPong > PONG_TIMEOUT_MS) {
          peer.ws.terminate()
          this.peerMap.delete(peerId)
          continue
        }
        if (peer.ws.readyState === WebSocket.OPEN) {
          peer.ws.ping()
        }
      }
    }, PING_INTERVAL_MS)
  }
}
