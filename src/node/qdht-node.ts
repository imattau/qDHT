import { mkdir, unlink } from 'node:fs/promises'
import { createServer as createNetServer, type Server as NetServer } from 'node:net'
import { join } from 'node:path'
import { GraphState } from '../core/graph/graph-state.js'
import { keypairFromHex } from '../core/identity/keys.js'
import { NeighbourStateMap } from '../core/neighbour-state.js'
import { Propagator } from '../core/propagation/propagator.js'
import { ContentStore, type ContentLocation, type PutMeta } from './content-store.js'
import type { QDHTConfig } from './config.js'
import { PeerManager } from './peer-manager.js'
import { RelayAdapter } from './relay-adapter.js'
import { SyncManager } from './sync-manager.js'
import type { Transport } from './transport.js'

type RpcRequest =
  | { cmd: 'peers' }
  | { cmd: 'replicas'; key: string }
  | { cmd: 'get'; key: string }

export interface PeerInfo {
  pubkey: string
  url: string
  latencyMs: number | null
  connectedAt: string
}

export interface ReplicaInfo {
  pubkey: string
  lastSeen: string
  pieceCount: number
  totalPieces: number
}

export class QDHTNode {
  private peerManager: PeerManager
  private syncManager: SyncManager
  private contentStore: ContentStore
  private relayAdapter: RelayAdapter | null = null
  private rpcServer: NetServer | null = null
  private graph: GraphState
  private propagator: Propagator
  private neighbourState: NeighbourStateMap
  private kp: { pubkey: string; privkey: string }
  private started = false

  constructor(private config: QDHTConfig) {
    this.kp = keypairFromHex(config.identity.privkey)
    this.graph = new GraphState()
    this.graph.addNode(this.kp.pubkey)
    this.propagator = new Propagator(this.graph, this.graph.getIndex(this.kp.pubkey), 0.5)
    this.neighbourState = new NeighbourStateMap()
    this.contentStore = new ContentStore(config.dataDir)

    this.peerManager = new PeerManager({
      port: config.port,
      pubkey: this.kp.pubkey,
      privkey: this.kp.privkey,
    })

    const transports: Transport[] = [this.peerManager]
    if (config.relays && config.relays.length > 0) {
      this.relayAdapter = new RelayAdapter({
        privkey: this.kp.privkey,
        relayUrls: config.relays,
      })
      transports.push(this.relayAdapter)
    }

    this.syncManager = new SyncManager({
      pubkey: this.kp.pubkey,
      privkey: this.kp.privkey,
      propagator: this.propagator,
      neighbourState: this.neighbourState,
      transports,
    })
  }

  async start(): Promise<void> {
    if (this.started) {
      return
    }
    this.started = true
    await mkdir(this.config.dataDir, { recursive: true })
    await this.peerManager.listen()
    await this.relayAdapter?.connect()
    for (const peer of this.config.peers) {
      this.peerManager.connect(peer)
    }
    await this.startRpc()
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return
    }
    this.started = false
    await this.relayAdapter?.close()
    await this.peerManager.close()
    if (this.rpcServer) {
      await new Promise<void>((resolve) => this.rpcServer?.close(() => resolve()))
      this.rpcServer = null
    }
    try {
      await unlink(this.sockPath())
    } catch {
      // ignore
    }
  }

  async put(data: Buffer, meta: PutMeta): Promise<ContentLocation> {
    const loc = await this.contentStore.put(data, meta)
    this.syncManager.publishAnnouncement({
      qkey: loc.qkey,
      hash: loc.hash,
      sizeBytes: loc.sizeBytes,
      pieces: loc.totalPieces,
      pieceSize: loc.pieceSize,
      ttl: meta.ttl,
      mime: meta.mime,
      name: meta.name,
    })
    return loc
  }

  pubkey(): string {
    return this.kp.pubkey
  }

  peerCount(): number {
    return this.peerManager.peers().length
  }

  hasReceivedKey(qkey: string): boolean {
    return this.neighbourState.get(qkey) !== undefined
  }

  async getContent(key: string): Promise<Buffer | null> {
    const index = await this.contentStore.getIndex()
    const entry = index[key]
    if (!entry) {
      return null
    }

    const chunks: Buffer[] = []
    for (let i = 0; i < entry.totalPieces; i++) {
      const piece = await this.contentStore.getPiece(entry.hash, i)
      if (!piece) {
        return null
      }
      chunks.push(piece)
    }
    return Buffer.concat(chunks)
  }

  async getPieces(key: string): Promise<Array<{ index: number; data: string }> | null> {
    const index = await this.contentStore.getIndex()
    const entry = index[key]
    if (!entry) {
      return null
    }

    const pieces: Array<{ index: number; data: string }> = []
    for (let i = 0; i < entry.totalPieces; i++) {
      const piece = await this.contentStore.getPiece(entry.hash, i)
      if (!piece) {
        return null
      }
      pieces.push({ index: i, data: piece.toString('base64') })
    }
    return pieces
  }

  private sockPath(): string {
    return join(this.config.dataDir, 'qdht.sock')
  }

  private async startRpc(): Promise<void> {
    const sock = this.sockPath()
    try {
      await unlink(sock)
    } catch {
      // ignore
    }

    await new Promise<void>((resolve) => {
      this.rpcServer = createNetServer((conn) => {
        let buffer = ''
        conn.on('data', (data) => {
          buffer += data.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) {
              continue
            }
            this.handleRpc(line.trim(), (response) => {
              conn.write(`${JSON.stringify(response)}\n`)
            })
          }
        })
        conn.on('error', () => {})
      })
      this.rpcServer.listen(sock, () => resolve())
    })
  }

  private handleRpc(line: string, reply: (resp: unknown) => void): void {
    let req: RpcRequest | null = null
    try {
      req = JSON.parse(line) as RpcRequest
    } catch {
      reply({ error: 'invalid JSON' })
      return
    }

    switch (req.cmd) {
      case 'peers':
        reply({ peers: this.peerManager.peers() as PeerInfo[] })
        break
      case 'replicas': {
        Promise.all([this.contentStore.getIndex(), Promise.resolve(this.neighbourState.get(req.key))])
          .then(([index, state]) => {
            if (!state) {
              reply({ replicas: [] })
              return
            }
            const totalPieces = index[req.key]?.totalPieces ?? 0
            const replicas: ReplicaInfo[] = []
            for (const [pubkey, neighbour] of state.inbound) {
              if (!neighbour.hasReplica && neighbour.pieceRanges.length === 0) {
                continue
              }
              replicas.push({
                pubkey,
                lastSeen: new Date(neighbour.lastSeen * 1000).toISOString(),
                pieceCount: neighbour.pieceRanges.reduce((sum, [start, end]) => sum + (end - start + 1), 0),
                totalPieces,
              })
            }
            reply({ replicas })
          })
          .catch(() => reply({ error: 'index error' }))
        break
      }
      case 'get':
        this.getPieces(req.key)
          .then((data) => {
            if (!data) {
              reply({ error: 'not found' })
              return
            }
            reply({ pieces: data })
          })
          .catch(() => reply({ error: 'read error' }))
        break
    }
  }
}
