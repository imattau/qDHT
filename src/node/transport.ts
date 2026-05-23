/** Minimum contract every node transport must satisfy. */
export interface Transport {
  /** Register a handler for all inbound messages from this transport. */
  onMessage(handler: (msg: unknown, peerId: string) => void): void

  /** Register a handler called when a peer becomes available on this transport. */
  onPeerConnected(handler: (peerId: string) => void): void

  /** Register a handler called when a peer disappears from this transport. */
  onPeerDisconnected(handler: (peerId: string) => void): void

  /** Send msg to all peers on this transport, optionally excluding one peer. */
  broadcast(msg: unknown, excludePeerId?: string): void

  /** Send msg to a specific peer on this transport. */
  send(peerId: string, msg: unknown): void

  /** Tear down all connections and timers. */
  close(): Promise<void>
}
