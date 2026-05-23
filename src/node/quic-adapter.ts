import { createHmac, randomBytes, randomFillSync, timingSafeEqual } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  QUICClient,
  QUICConnection,
  QUICServer,
  QUICSocket,
  events,
  type QUICClientCrypto,
  type QUICServerCrypto,
  type QUICStream,
} from '@matrixai/quic'
import type { Transport } from './transport.js'

const execFileAsync = promisify(execFile)
const HANDSHAKE = 'handshake'
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 60_000

interface OutboundState {
  delayMs: number
  timer: ReturnType<typeof setTimeout> | null
  active: boolean
}

interface QuicPeerInfo {
  peerId: string
  address: string
  latencyMs: number | null
  connectedAt: string
}

interface QuicChannel {
  peerId: string
  address: string
  pubkey: string
  connection: QUICConnection
  stream: QUICStream
  reader: ReadableStreamDefaultReader<Uint8Array>
  writer: WritableStreamDefaultWriter<Uint8Array>
  buffer: string
  connectedAt: string
  latencyMs: number | null
  outbound: boolean
  handshakeSent: boolean
  closed: boolean
}

export interface QuicAdapterOptions {
  pubkey: string
  peers: string[]
  listenPort?: number
  listenHost?: string
  dataDir: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function canonicalAddress(host: string, port: number): string {
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `quic://${hostPart}:${port}`
}

function parsePeerAddress(input: string): { host: string; port: number; address: string } {
  const normalized = input.includes('://') ? input : `quic://${input}`
  const url = new URL(normalized)
  const port = Number(url.port)
  if (!url.hostname || !Number.isFinite(port)) {
    throw new Error(`Invalid QUIC peer address: ${input}`)
  }
  return {
    host: url.hostname,
    port,
    address: canonicalAddress(url.hostname, port),
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return new Uint8Array(buffer).slice().buffer
}

function createClientCrypto(): QUICClientCrypto {
  return {
    ops: {
      randomBytes: async (data: ArrayBuffer) => {
        randomFillSync(new Uint8Array(data))
      },
    },
  }
}

function createServerCrypto(): QUICServerCrypto {
  const key = randomBytes(32)
  const signBuffer = (signKey: ArrayBuffer, data: ArrayBuffer) => {
    const hmac = createHmac('sha256', Buffer.from(signKey))
    hmac.update(Buffer.from(data))
    const digest = hmac.digest()
    return toArrayBuffer(digest)
  }

  return {
    key: toArrayBuffer(key),
    ops: {
      sign: async (signKey: ArrayBuffer, data: ArrayBuffer) => signBuffer(signKey, data),
      verify: async (verifyKey: ArrayBuffer, data: ArrayBuffer, sig: ArrayBuffer) => {
        const expected = Buffer.from(signBuffer(verifyKey, data))
        const provided = Buffer.from(sig)
        if (expected.length !== provided.length) {
          return false
        }
        return timingSafeEqual(expected, provided)
      },
    },
  }
}

async function ensureCertFiles(dataDir: string): Promise<{ key: string; cert: string }> {
  const certDir = `${dataDir}/quic`
  const keyPath = `${certDir}/server.key`
  const certPath = `${certDir}/server.crt`

  try {
    await access(keyPath)
    await access(certPath)
  } catch {
    await mkdir(certDir, { recursive: true })
    await execFileAsync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-subj',
      '/CN=qdht-quic',
      '-days',
      '3650',
    ])
  }

  return {
    key: await readFile(keyPath, 'utf8'),
    cert: await readFile(certPath, 'utf8'),
  }
}

function safeJsonParse(frame: string): unknown | null {
  try {
    return JSON.parse(frame)
  } catch {
    return null
  }
}

export class QuicAdapter implements Transport {
  private socket: QUICSocket | null = null
  private server: QUICServer | null = null
  private clients = new Map<string, QUICClient>()
  private outboundState = new Map<string, OutboundState>()
  private addressToPeerId = new Map<string, string>()
  private peerMap = new Map<string, QuicChannel>()
  private messageHandlers: Array<(msg: unknown, peerId: string) => void> = []
  private peerConnectedHandlers: Array<(peerId: string) => void> = []
  private peerDisconnectedHandlers: Array<(peerId: string) => void> = []
  private started = false
  private closed = false
  private readonly clientCrypto = createClientCrypto()
  private readonly serverCrypto = createServerCrypto()
  private certPromise: Promise<{ key: string; cert: string }> | null = null

  constructor(private readonly opts: QuicAdapterOptions) {}

  async connect(): Promise<void> {
    if (this.closed || this.started) {
      return
    }

    const listenPort = this.opts.listenPort
    const listenHost = this.opts.listenHost ?? '::'
    const socketPort = listenPort ?? 0

    this.socket = new QUICSocket({})
    await this.socket.start({ host: listenHost, port: socketPort, reuseAddr: true })

    if (listenPort !== undefined) {
      const { key, cert } = await this.ensureCerts()
      this.server = new QUICServer({
        socket: this.socket,
        crypto: this.serverCrypto,
        config: {
          key,
          cert,
          verifyPeer: false,
          grease: true,
          applicationProtos: ['qdht'],
        },
      })
      this.server.addEventListener(events.EventQUICServerConnection.name, this.handleServerConnection)
      await this.server.start({ host: listenHost, port: listenPort, reuseAddr: true })
    }

    this.started = true

    for (const peer of this.opts.peers) {
      void this.connectPeer(peer)
    }
  }

  onMessage(handler: (msg: unknown, peerId: string) => void): void {
    this.messageHandlers.push(handler)
  }

  onPeerConnected(handler: (peerId: string) => void): void {
    this.peerConnectedHandlers.push(handler)
  }

  onPeerDisconnected(handler: (peerId: string) => void): void {
    this.peerDisconnectedHandlers.push(handler)
  }

  broadcast(msg: unknown, excludePeerId?: string): void {
    const data = JSON.stringify(msg)
    for (const [peerId, channel] of this.peerMap) {
      if (excludePeerId && this.matchesPeerId(channel, excludePeerId)) {
        continue
      }
      if (!channel.closed) {
        void this.writeFrame(channel, data)
      }
    }
  }

  send(peerId: string, msg: unknown): void {
    const channel = this.getChannel(peerId)
    if (!channel || channel.closed) {
      return
    }
    void this.writeFrame(channel, JSON.stringify(msg))
  }

  peers(): QuicPeerInfo[] {
    return [...this.peerMap.values()].map((peer) => ({
      peerId: peer.peerId,
      address: peer.address,
      latencyMs: peer.latencyMs,
      connectedAt: peer.connectedAt,
    }))
  }

  async close(): Promise<void> {
    this.closed = true
    this.started = false

    for (const state of this.outboundState.values()) {
      if (state.timer) {
        clearTimeout(state.timer)
        state.timer = null
      }
    }

    for (const channel of this.peerMap.values()) {
      await this.teardownChannel(channel, false, false)
    }

    this.addressToPeerId.clear()
    this.peerMap.clear()

    for (const client of this.clients.values()) {
      try {
        await client.destroy({ isApp: true, force: true })
      } catch {
        // ignore
      }
    }
    this.clients.clear()

    try {
      await this.server?.stop({ isApp: true, force: true })
    } catch {
      // ignore
    }
    this.server = null

    try {
      await this.socket?.stop({ force: true })
    } catch {
      // ignore
    }
    this.socket = null
  }

  private async ensureCerts(): Promise<{ key: string; cert: string }> {
    if (!this.certPromise) {
      this.certPromise = ensureCertFiles(this.opts.dataDir)
    }
    return await this.certPromise
  }

  private getChannel(peerId: string): QuicChannel | null {
    const resolved = this.addressToPeerId.get(peerId) ?? peerId
    return this.peerMap.get(resolved) ?? null
  }

  private matchesPeerId(channel: QuicChannel, peerId: string): boolean {
    if (channel.peerId === peerId || channel.address === peerId) {
      return true
    }
    return this.addressToPeerId.get(peerId) === channel.peerId
  }

  private async connectPeer(target: string): Promise<void> {
    const parsed = parsePeerAddress(target)
    const state = this.outboundState.get(parsed.address) ?? { delayMs: RECONNECT_MIN_MS, timer: null, active: false }
    this.outboundState.set(parsed.address, state)
    if (state.active) {
      return
    }
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }

    if (!this.socket) {
      return
    }

    try {
      const client = await QUICClient.createQUICClient({
        host: parsed.host,
        port: parsed.port,
        socket: this.socket,
        crypto: this.clientCrypto,
        config: {
          verifyPeer: false,
          grease: true,
          applicationProtos: ['qdht'],
        },
      })

      this.clients.set(parsed.address, client)
      state.active = true
      state.delayMs = RECONNECT_MIN_MS

      client.connection.addEventListener(events.EventQUICConnectionClose.name, () => this.handleConnectionClosed(parsed.address))
      client.connection.addEventListener(events.EventQUICConnectionStopped.name, () => this.handleConnectionClosed(parsed.address), { once: true })
      client.connection.addEventListener(events.EventQUICConnectionStream.name, (evt: Event) => {
        const stream = (evt as unknown as { detail: QUICStream }).detail
        void this.attachChannel(client.connection, stream, parsed.address, true)
      })

      const stream = client.connection.newStream('bidi')
      await this.attachChannel(client.connection, stream, parsed.address, true)
    } catch {
      state.active = false
      this.scheduleReconnect(parsed.address)
    }
  }

  private handleServerConnection = (evt: Event) => {
    const connection = (evt as unknown as { detail: QUICConnection }).detail
    const address = canonicalAddress(connection.remoteHost, connection.remotePort)
    connection.addEventListener(events.EventQUICConnectionClose.name, () => this.handleConnectionClosed(address))
    connection.addEventListener(events.EventQUICConnectionStopped.name, () => this.handleConnectionClosed(address), { once: true })
    connection.addEventListener(events.EventQUICConnectionStream.name, (streamEvt: Event) => {
      const stream = (streamEvt as unknown as { detail: QUICStream }).detail
      void this.attachChannel(connection, stream, address, false)
    })
  }

  private async attachChannel(connection: QUICConnection, stream: QUICStream, address: string, outbound: boolean): Promise<void> {
    if (this.closed) {
      return
    }

    const existing = [...this.peerMap.values()].find((peer) => peer.connection === connection)
    if (existing) {
      return
    }

    const channel: QuicChannel = {
      peerId: address,
      address,
      pubkey: '',
      connection,
      stream,
      reader: stream.readable.getReader(),
      writer: stream.writable.getWriter(),
      buffer: '',
      connectedAt: nowIso(),
      latencyMs: null,
      outbound,
      handshakeSent: false,
      closed: false,
    }

    this.peerMap.set(channel.peerId, channel)
    this.addressToPeerId.set(address, channel.peerId)
    connection.addEventListener(events.EventQUICConnectionClose.name, () => this.handleConnectionClosed(channel.peerId))
    connection.addEventListener(events.EventQUICConnectionStopped.name, () => this.handleConnectionClosed(channel.peerId), { once: true })
    void this.readLoop(channel)
    await this.writeFrame(channel, JSON.stringify({ type: HANDSHAKE, pubkey: this.opts.pubkey }))
    channel.handshakeSent = true
  }

  private async readLoop(channel: QuicChannel): Promise<void> {
    try {
      for (;;) {
        const { done, value } = await channel.reader.read()
        if (done) {
          break
        }
        channel.buffer += new TextDecoder().decode(value, { stream: true })
        let idx = channel.buffer.indexOf('\n')
        while (idx !== -1) {
          const frame = channel.buffer.slice(0, idx).trim()
          channel.buffer = channel.buffer.slice(idx + 1)
          if (frame.length > 0) {
            this.handleFrame(channel, frame)
          }
          idx = channel.buffer.indexOf('\n')
        }
      }
    } catch {
      // Ignore read errors; connection close will clean up.
    } finally {
      this.handleConnectionClosed(channel.peerId)
    }
  }

  private handleFrame(channel: QuicChannel, frame: string): void {
    const parsed = safeJsonParse(frame)
    if (!parsed || typeof parsed !== 'object') {
      return
    }

    const message = parsed as Record<string, unknown>
    if (message.type === HANDSHAKE && typeof message.pubkey === 'string') {
      this.registerPeerPubkey(channel, message.pubkey)
      return
    }

    const peerId = channel.pubkey || channel.peerId
    for (const handler of this.messageHandlers) {
      handler(message, peerId)
    }
  }

  private registerPeerPubkey(channel: QuicChannel, pubkey: string): void {
    if (channel.pubkey === pubkey) {
      return
    }

    const previousId = channel.pubkey || channel.peerId
    this.peerMap.delete(previousId)
    channel.pubkey = pubkey
    channel.peerId = pubkey
    this.peerMap.set(pubkey, channel)
    this.addressToPeerId.set(channel.address, pubkey)

    const state = this.outboundState.get(channel.address)
    if (state) {
      state.active = true
      state.delayMs = RECONNECT_MIN_MS
    }

    for (const handler of this.peerConnectedHandlers) {
      handler(pubkey)
    }
  }

  private async writeFrame(channel: QuicChannel, payload: string): Promise<void> {
    if (channel.closed) {
      return
    }
    try {
      const frame = `${payload}\n`
      const bytes = new TextEncoder().encode(frame)
      await channel.writer.write(bytes)
    } catch {
      this.handleConnectionClosed(channel.peerId)
    }
  }

  private async teardownChannel(channel: QuicChannel, notify: boolean, allowReconnect = true): Promise<void> {
    if (channel.closed) {
      return
    }
    channel.closed = true

    this.peerMap.delete(channel.peerId)
    if (this.addressToPeerId.get(channel.address) === channel.peerId) {
      this.addressToPeerId.delete(channel.address)
    }

    try {
      await channel.reader.cancel()
    } catch {
      // ignore
    }
    try {
      await channel.writer.close()
    } catch {
      // ignore
    }

    if (notify) {
      for (const handler of this.peerDisconnectedHandlers) {
        handler(channel.pubkey || channel.peerId)
      }
    }

    if (channel.outbound) {
      this.clients.delete(channel.address)
    }

    if (channel.outbound && allowReconnect) {
      const state = this.outboundState.get(channel.address)
      if (state) {
        state.active = false
      }
      this.scheduleReconnect(channel.address)
    }
  }

  private handleConnectionClosed(peerId: string): void {
    if (this.closed) {
      return
    }
    const channel = this.getChannel(peerId)
    if (!channel) {
      return
    }
    void this.teardownChannel(channel, true, true)
  }

  private scheduleReconnect(address: string): void {
    const state = this.outboundState.get(address)
    if (!state || this.closed || state.active) {
      return
    }
    if (state.timer) {
      return
    }

    state.timer = setTimeout(() => {
      state.timer = null
      if (!this.closed) {
        void this.connectPeer(address)
      }
    }, state.delayMs)
    state.delayMs = Math.min(RECONNECT_MAX_MS, state.delayMs * 2)
  }
}
