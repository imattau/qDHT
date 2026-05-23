import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QDHTNode } from '../src/node/qdht-node.js'
import { generateKeypair } from '../src/core/identity/keys.js'
import type { QDHTConfig } from '../src/node/config.js'

export interface ExampleNodeHandle {
  node: QDHTNode
  dir: string
}

export async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

export async function cleanupHandles(handles: ExampleNodeHandle[]): Promise<void> {
  for (const handle of [...handles].reverse()) {
    try {
      await handle.node.stop()
    } finally {
      await rm(handle.dir, { recursive: true, force: true })
    }
  }
}

export async function makeNode(
  baseDir: string,
  index: number,
  opts: {
    port: number
    peers?: string[]
    relays?: string[]
    quicPeers?: string[]
    quicListenPort?: number
    nip96Servers?: string[]
  },
): Promise<ExampleNodeHandle> {
  const dir = join(baseDir, `node-${index}`)
  const keypair = generateKeypair()
  const config: QDHTConfig = {
    identity: { privkey: keypair.privkey },
    peers: opts.peers ?? [],
    port: opts.port,
    dataDir: dir,
  }
  if (opts.relays !== undefined) config.relays = opts.relays
  if (opts.nip96Servers !== undefined) config.nip96Servers = opts.nip96Servers
  if (opts.quicPeers !== undefined) config.quicPeers = opts.quicPeers
  if (opts.quicListenPort !== undefined) config.quicListenPort = opts.quicListenPort
  const node = new QDHTNode(config)
  await node.start()
  return { node, dir }
}

export async function waitFor(fn: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export async function writeExampleFile(filePath: string, content: string | Buffer): Promise<void> {
  await writeFile(filePath, content)
}
