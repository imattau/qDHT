import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeypair } from '../core/identity/keys.js'
import { MemoryNodeStorage } from '../core/storage/memory-node-storage.js'

type FakeRemoteInfo = { address: string; port: number }

class FakeSocket extends EventEmitter {
  public boundPort: number | null = null
  public closed = false
  public broadcast = false
  public multicastTTL = 0
  public multicastLoopback = false
  public multicastInterface = ''
  public membership: Array<{ group: string; iface: string }> = []

  bind(port: number, _host?: string, cb?: () => void): void {
    this.boundPort = port
    sockets.add(this)
    queueMicrotask(() => {
      this.emit('listening')
      cb?.()
    })
  }

  setBroadcast(value: boolean): void {
    this.broadcast = value
  }

  setMulticastTTL(value: number): void {
    this.multicastTTL = value
  }

  setMulticastLoopback(value: boolean): void {
    this.multicastLoopback = value
  }

  setMulticastInterface(value: string): void {
    this.multicastInterface = value
  }

  addMembership(group: string, iface: string): void {
    this.membership.push({ group, iface })
  }

  send(
    payload: Buffer,
    port: number,
    _group: string,
    cb?: (err?: Error | null) => void,
  ): void {
    queueMicrotask(() => {
      for (const socket of sockets) {
        if (socket.closed || socket.boundPort !== port) {
          continue
        }
        socket.emit('message', Buffer.from(payload), { address: '127.0.0.1', port: this.boundPort ?? 0 } satisfies FakeRemoteInfo)
      }
      cb?.(undefined)
    })
  }

  close(cb?: () => void): void {
    this.closed = true
    sockets.delete(this)
    queueMicrotask(() => cb?.())
  }
}

const sockets = new Set<FakeSocket>()

vi.mock('node:dgram', () => ({
  default: {
    createSocket: () => new FakeSocket(),
  },
}))

import { QDHTNode } from './qdht-node.js'

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

describe('local discovery', () => {
  let tmpRoot = ''
  let nodeA: QDHTNode | undefined
  let nodeB: QDHTNode | undefined

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-local-discovery-'))
    sockets.clear()
  })

  afterEach(async () => {
    await nodeA?.stop()
    await nodeB?.stop()
    await rm(tmpRoot, { recursive: true, force: true })
    sockets.clear()
  })

  it('discovers and auto-connects nearby peers via signed service records', async () => {
    const kpA = generateKeypair()
    const kpB = generateKeypair()

    nodeA = new QDHTNode(
      {
        identity: { privkey: kpA.privkey },
        peers: [],
        port: 22110,
        listenAddress: `ws://127.0.0.1:22110`,
        localDiscovery: true,
        localDiscoveryPort: 45555,
        dataDir: join(tmpRoot, 'a'),
      },
      new MemoryNodeStorage(),
    )

    nodeB = new QDHTNode(
      {
        identity: { privkey: kpB.privkey },
        peers: [],
        port: 22111,
        listenAddress: `ws://127.0.0.1:22111`,
        localDiscovery: true,
        localDiscoveryPort: 45555,
        dataDir: join(tmpRoot, 'b'),
      },
      new MemoryNodeStorage(),
    )

    await Promise.all([nodeA.start(), nodeB.start()])

    await waitFor(
      () =>
        nodeA!.listPeers().some((peer) => peer.pubkey === kpB.pubkey) &&
        nodeB!.listPeers().some((peer) => peer.pubkey === kpA.pubkey),
      20_000,
    )

    expect(nodeA.listPeers().some((peer) => peer.pubkey === kpB.pubkey)).toBe(true)
    expect(nodeB.listPeers().some((peer) => peer.pubkey === kpA.pubkey)).toBe(true)
  }, 20_000)
})
