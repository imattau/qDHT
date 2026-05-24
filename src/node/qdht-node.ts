import { mkdir, unlink } from 'node:fs/promises'
import { createServer as createNetServer, type Server as NetServer } from 'node:net'
import { join } from 'node:path'
import { GraphState } from '../core/graph/graph-state.js'
import { keypairFromHex } from '../core/identity/keys.js'
import { ReachabilityDirectory, isDirectPeerRef, normalizeIdentityRef, resolveRouteAnnouncement, type ResolvedRoute } from '../core/discovery/reachability.js'
import { NeighbourStateMap } from '../core/neighbour-state.js'
import { ContentProviderRegistry } from '../core/content/provider-registry.js'
import { PieceFetcherService } from './piece-fetcher-service.js'
import { ReputationMap } from '../core/protocol/reputation.js'
import { ReplicaStore } from '../core/content/replica-store.js'
import { Nip96Provider } from '../core/content/nip96-provider.js'
import { Propagator } from '../core/propagation/propagator.js'
import { type ContentIndexRepository, type ContentLocation, type PutMeta } from '../core/storage/content-repository.js'
import type { QDHTConfig } from './config.js'
import { PeerManager } from './peer-manager.js'
import { RelayAdapter } from './relay-adapter.js'
import { QuicAdapter } from './quic-adapter.js'
import { SyncManager } from './sync-manager.js'
import { NodeWebServer } from './web-server.js'
import type { QDHTRequestPayload, QDHTRequestResponsePayload } from '../core/protocol/request.js'
import type { NodeStorage } from '../core/storage/node-storage.js'
import { SqliteNodeStorage } from '../core/storage/sqlite-node-storage.js'
import type { StoredNostrEvent } from '../core/storage/event-repository.js'
import type { Transport } from './transport.js'
import { BootstrapService } from './bootstrap-service.js'
import { DefaultPeerDiscoveryPolicy } from './peer-discovery-policy.js'
import { LocalDiscoveryService } from './local-discovery.js'
import { buildAdvertisedListenAddress } from './listen-address.js'

type RpcRequest =
  | { cmd: 'peers' }
  | { cmd: 'replicas'; key: string }
  | { cmd: 'get'; key: string }
  | {
      cmd: 'search'
      type: 'identity'
      query: string
      timeoutMs?: number
    }
  | {
      cmd: 'search'
      type: 'content' | 'route' | 'replica'
      query: string
      timeoutMs?: number
      limit?: number
      publisher?: string
      qkey?: string
      hash?: string
      name?: string
      mime?: string
      tag?: string
    }

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

export interface SearchAnnouncementsOptions {
  type?: QDHTRequestPayload['type']
  limit?: number
  timeoutMs?: number
  ttl?: number
  publisher?: string
  qkey?: string
  hash?: string
  name?: string
  mime?: string
  tag?: string
}

export class QDHTNode {
  private peerManager: PeerManager
  private syncManager: SyncManager
  private contentStore: ContentIndexRepository
  public readonly fetcher: PieceFetcherService
  private providerRegistry: ContentProviderRegistry
  private replicaStore: ReplicaStore
  private reputationMap: ReputationMap
  private discoveryDirectory: ReachabilityDirectory
  private relayAdapter: RelayAdapter | null = null
  private quicAdapter: QuicAdapter | null = null
  private rpcServer: NetServer | null = null
  private webServer: NodeWebServer | null = null
  private graph: GraphState
  private propagator: Propagator
  private neighbourState: NeighbourStateMap
  private readonly storage: NodeStorage
  private kp: { pubkey: string; privkey: string }
  private started = false
  private fetchNetworkConnected = false
  private bootstrapService: BootstrapService | null = null
  private localDiscovery: LocalDiscoveryService | null = null

  constructor(private config: QDHTConfig, storage?: NodeStorage) {
    this.kp = keypairFromHex(config.identity.privkey)
    this.graph = new GraphState()
    this.graph.addNode(this.kp.pubkey)
    this.storage = storage ?? new SqliteNodeStorage(config.dataDir)
    this.contentStore = this.storage.content

    if (config.bootstrapMode) {
      // Bootstrap mode: skip heavy subsystems
      this.propagator = null as unknown as Propagator
      this.neighbourState = null as unknown as NeighbourStateMap
      this.replicaStore = null as unknown as ReplicaStore
      this.reputationMap = null as unknown as ReputationMap
      this.providerRegistry = null as unknown as ContentProviderRegistry
    } else {
      this.propagator = new Propagator(this.graph, this.graph.getIndex(this.kp.pubkey), 0.5)
      this.neighbourState = new NeighbourStateMap()
      this.replicaStore = new ReplicaStore()
      this.reputationMap = new ReputationMap()
      this.providerRegistry = new ContentProviderRegistry()

      if (config.nip96Servers) {
        for (const serverUrl of config.nip96Servers) {
          this.providerRegistry.register(new Nip96Provider({ serverUrl }))
        }
      }
    }

    this.discoveryDirectory = new ReachabilityDirectory(this.storage.events)

    this.peerManager = new PeerManager({
      port: config.port,
      pubkey: this.kp.pubkey,
      privkey: this.kp.privkey,
      listenAddress: config.listenAddress,
    })

    const transports: Transport[] = [this.peerManager]
    if (!config.bootstrapMode) {
      if (config.relays && config.relays.length > 0) {
        this.relayAdapter = new RelayAdapter({
          privkey: this.kp.privkey,
          relayUrls: config.relays,
        })
        transports.push(this.relayAdapter)
      }

      if ((config.quicPeers && config.quicPeers.length > 0) || config.quicListenPort !== undefined) {
        this.quicAdapter = new QuicAdapter({
          pubkey: this.kp.pubkey,
          peers: config.quicPeers ?? [],
          listenPort: config.quicListenPort,
          dataDir: config.dataDir,
        })
        transports.push(this.quicAdapter)
      }

      this.syncManager = new SyncManager({
        pubkey: this.kp.pubkey,
        privkey: this.kp.privkey,
        propagator: this.propagator,
        neighbourState: this.neighbourState,
        reputationMap: this.reputationMap,
        eventStore: this.storage.events,
        transports,
        peerManager: this.peerManager,
        peerDiscoveryPolicy: new DefaultPeerDiscoveryPolicy(),
        maxPeers: config.maxPeers ?? 50,
        ownUrl: config.listenAddress,
        ownPubkey: this.kp.pubkey,
        bootstrapMode: config.bootstrapMode,
      })

      this.fetcher = new PieceFetcherService(
        this.providerRegistry,
        this.replicaStore,
        this.neighbourState,
        this.reputationMap,
      )
    } else {
      this.syncManager = null as unknown as SyncManager
      this.fetcher = null as unknown as PieceFetcherService

      // Wire BootstrapService
      this.bootstrapService = new BootstrapService({
        pubkey: this.kp.pubkey,
        privkey: this.kp.privkey,
        maxPeers: config.maxPeers,
      })

      this.peerManager.onPeerConnected((peerId: string, info: import('./peer-manager.js').PeerInfo) => {
        this.bootstrapService!.onPeerConnected(
          peerId,
          info.url,
          (msg) => this.peerManager.send(peerId, msg),
        )
      })
      this.peerManager.onPeerDisconnected((peerId: string, _info: import('./peer-manager.js').PeerInfo) => {
        this.bootstrapService!.onPeerDisconnected(peerId)
      })
      this.peerManager.onMessage((msg: unknown, peerId: string) => {
        this.bootstrapService!.handleEvent(
          msg,
          peerId,
          (event) => this.peerManager.broadcast(event, peerId),
          (event) => this.peerManager.send(peerId, event),
        )
      })
    }

    if (config.localDiscovery) {
      this.localDiscovery = new LocalDiscoveryService({
        pubkey: this.kp.pubkey,
        privkey: this.kp.privkey,
        port: config.localDiscoveryPort ?? 45555,
        getListenAddress: () => buildAdvertisedListenAddress(this.config.listenAddress, this.listenPort()),
        onEvent: (event, peerId) => this.syncManager?.handleMessage(event, peerId),
      })
    }

    if (config.webPort !== undefined) {
      this.webServer = new NodeWebServer(this, config.webPort)
    }
  }

  async start(): Promise<void> {
    if (this.started) {
      return
    }
    this.started = true
    await mkdir(this.config.dataDir, { recursive: true })
    await this.peerManager.listen()
    this.peerManager.setListenAddress(buildAdvertisedListenAddress(this.config.listenAddress, this.listenPort()))
    await this.localDiscovery?.start()
    await this.connect()
    await this.startRpc()
    await this.webServer?.start()
  }

  async stop(): Promise<void> {
    await this.webServer?.close()
    await this.disconnect()
    await this.localDiscovery?.close()
    this.bootstrapService?.stop()
    this.storage.close()
    this.syncManager?.close()
    this.discoveryDirectory.close()
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

  async connect(): Promise<void> {
    if (this.fetchNetworkConnected) {
      return
    }
    await mkdir(this.config.dataDir, { recursive: true })
    if (!this.config.bootstrapMode) {
      await this.relayAdapter?.connect()
      await this.quicAdapter?.connect()
      for (const peer of this.config.peers) {
        await this.connectPeerRef(peer)
      }
    }
    this.fetchNetworkConnected = true
  }

  async disconnect(): Promise<void> {
    if (!this.fetchNetworkConnected && !this.started) {
      return
    }
    this.fetchNetworkConnected = false
    await this.relayAdapter?.close()
    await this.quicAdapter?.close()
    await this.peerManager.close()
    this.started = false
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
    this.replicaStore.declareTotal(loc.hash, loc.totalPieces)
    return loc
  }

  async fetchContent(key: string, timeoutMs = 30_000): Promise<Buffer> {
    const local = await this.getContent(key)
    if (local) {
      return local
    }

    const info = this.syncManager.getAnnouncementInfo(key)
    if (!info) {
      throw new Error(`No announcement metadata found for ${key}`)
    }
    if (!info.sourceUrl) {
      throw new Error(`No source URL found for ${key}`)
    }

    await this.connect()

    const fetchPromise = this.fetcher.fetchContent({
      qkey: key,
      hash: info.hash,
      totalPieces: info.totalPieces,
      pieceSize: info.pieceSize,
      sourceUrl: info.sourceUrl,
    })

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return await fetchPromise
    }

    return await Promise.race([
      fetchPromise,
      new Promise<Buffer>((_, reject) => {
        setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  }

  pubkey(): string {
    return this.kp.pubkey
  }

  peerCount(): number {
    return this.listPeers().length
  }

  listPeers(): PeerInfo[] {
    const wsPeers = this.peerManager.peers()
    const quicPeers = this.quicAdapter?.peers().map((peer) => ({
      pubkey: peer.peerId,
      url: peer.address,
      latencyMs: peer.latencyMs,
      connectedAt: peer.connectedAt,
    })) ?? []
    return [...wsPeers, ...quicPeers]
  }

  hasReceivedKey(qkey: string): boolean {
    return this.neighbourState.get(qkey) !== undefined
  }

  getAnnouncementInfo(qkey: string): {
    hash: string
    totalPieces: number
    pieceSize: number
    sourceUrl?: string
    name?: string
    mime?: string
  } | null {
    return this.syncManager.getAnnouncementInfo(qkey)
  }

  status(): {
    pubkey: string
    port: number
    dataDir: string
    peerCount: number
    peers: PeerInfo[]
  } {
    const peers = this.listPeers()
    return {
      pubkey: this.pubkey(),
      port: this.peerManager.port() ?? this.config.port,
      dataDir: this.config.dataDir,
      peerCount: peers.length,
      peers,
    }
  }

  listenPort(): number {
    return this.peerManager.port() ?? this.config.port
  }

  webPort(): number | null {
    return this.webServer?.port() ?? null
  }

  async listReplicas(key: string): Promise<ReplicaInfo[]> {
    const [index, state] = await Promise.all([this.contentStore.getIndex(), Promise.resolve(this.neighbourState.get(key))])
    if (!state) {
      return []
    }
    const totalPieces = index[key]?.totalPieces ?? 0
    const replicas: ReplicaInfo[] = []
    for (const [pubkey, neighbour] of state.inbound) {
      if (!neighbour.hasReplica && neighbour.pieceRanges.length === 0) {
        continue
      }
      replicas.push({
        pubkey,
        lastSeen: new Date(neighbour.lastSeen * 1000).toISOString(),
        pieceCount: neighbour.pieceRanges.reduce((sum: number, [start, end]: [number, number]) => sum + (end - start + 1), 0),
        totalPieces,
      })
    }
    return replicas
  }

  async searchIdentity(identityRef: string, timeoutMs = 2_000): Promise<ResolvedRoute | null> {
    const local = this.discoveryDirectory.resolve(identityRef)
    if (local) {
      return local
    }

    const response = await this.syncManager.searchRequest({
      type: 'route',
      query: identityRef,
      limit: 5,
      ttl: 300,
    }, timeoutMs)

    if (!response) {
      return null
    }

    const parsedRoutes = this.parseRouteEvents(response.routes)
    const normalizedIdentity = normalizeIdentityRef(identityRef)?.identity ?? identityRef.trim().toLowerCase()
    return resolveRouteAnnouncement(normalizedIdentity, parsedRoutes)
  }

  async searchAnnouncements(query: string, options: SearchAnnouncementsOptions = {}): Promise<QDHTRequestResponsePayload | null> {
    return await this.syncManager.searchRequest({
      type: options.type ?? 'content',
      query,
      limit: options.limit ?? 25,
      ttl: options.ttl ?? 300,
      publisher: options.publisher,
      qkey: options.qkey,
      hash: options.hash,
      name: options.name,
      mime: options.mime,
      tag: options.tag,
    }, options.timeoutMs ?? 2_000)
  }

  private async connectPeerRef(peerRef: string): Promise<void> {
    const targets = this.discoveryDirectory.resolvePeerTargets(peerRef)
    if (targets.length === 0 && isDirectPeerRef(peerRef)) {
      targets.push({
        identity: peerRef,
        transport: peerRef.startsWith('quic://') ? 'quic' : peerRef.startsWith('ws://') ? 'ws' : 'wss',
        url: peerRef,
        confidence: 1,
        source: 'direct',
      })
    }

    if (targets.length === 0) {
      const parsed = normalizeIdentityRef(peerRef)
      if (!parsed) {
        return
      }
      return
    }

    for (const target of targets) {
      if (target.transport === 'quic') {
        await this.quicAdapter?.connectPeer(target.url)
      } else if (target.transport === 'wss' || target.transport === 'ws') {
        this.peerManager.connect(target.url)
      }
    }
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

  private parseRouteEvents(routes: string[]): StoredNostrEvent[] {
    const parsed: StoredNostrEvent[] = []
    for (const raw of routes) {
      try {
        const event = JSON.parse(raw) as StoredNostrEvent
        if (event && typeof event === 'object' && event.kind === 30801) {
          parsed.push(event)
        }
      } catch {
        continue
      }
    }
    return parsed
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
        reply({ peers: this.listPeers() })
        break
      case 'replicas': {
        this.listReplicas(req.key)
          .then((replicas) => reply({ replicas }))
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
      case 'search':
        if (req.type === 'identity') {
          this.searchIdentity(req.query, req.timeoutMs)
            .then((route) => reply({ route }))
            .catch(() => reply({ error: 'search error' }))
          break
        }
        this.searchAnnouncements(req.query, {
          type: req.type,
          limit: req.limit,
          timeoutMs: req.timeoutMs,
          publisher: req.publisher,
          qkey: req.qkey,
          hash: req.hash,
          name: req.name,
          mime: req.mime,
          tag: req.tag,
        })
          .then((response) => reply({ response }))
          .catch(() => reply({ error: 'search error' }))
        break
    }
  }
}
