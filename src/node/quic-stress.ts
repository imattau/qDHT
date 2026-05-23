import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QDHTNode } from './qdht-node.js'
import { generateKeypair } from '../core/identity/keys.js'

interface StressOptions {
  nodes: number
  listenPortBase: number
  portBase: number
  timeoutMs: number
  rounds: number
  payloadBytes: number
}

interface NodeHandle {
  node: QDHTNode
  dir: string
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.length === 0) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer value: ${value}`)
  }
  return parsed
}

function parseArgs(): StressOptions {
  const defaults: StressOptions = {
    nodes: 8,
    listenPortBase: 23100,
    portBase: 20100,
    timeoutMs: 15_000,
    rounds: 1,
    payloadBytes: 2 * 1024 * 1024,
  }

  const args = new Map<string, string>()
  const argv = process.argv.slice(2)
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === undefined) {
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`usage: tsx src/node/quic-stress.ts [--nodes N] [--listen-port-base N] [--port-base N] [--timeout-ms N] [--rounds N] [--payload-bytes N]`)
      process.exit(0)
    }
    if (!arg.startsWith('--')) {
      continue
    }
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }
    args.set(key, next)
    index++
  }

  return {
    nodes: parseInteger(args.get('nodes'), defaults.nodes),
    listenPortBase: parseInteger(args.get('listen-port-base'), defaults.listenPortBase),
    portBase: parseInteger(args.get('port-base'), defaults.portBase),
    timeoutMs: parseInteger(args.get('timeout-ms'), defaults.timeoutMs),
    rounds: parseInteger(args.get('rounds'), defaults.rounds),
    payloadBytes: parseInteger(args.get('payload-bytes'), defaults.payloadBytes),
  }
}

async function waitFor(fn: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function startNodes(options: StressOptions): Promise<NodeHandle[]> {
  const handles: NodeHandle[] = []
  const stamp = Date.now()

  try {
    for (let index = 0; index < options.nodes; index++) {
      const dir = await mkdtemp(join(tmpdir(), `qdht-quic-stress-${index}-${stamp}-`))
      const peers = index === 0 ? [] : [`quic://127.0.0.1:${options.listenPortBase}`]
      const node = new QDHTNode({
        identity: { privkey: generateKeypair().privkey },
        peers: [],
        quicPeers: peers,
        quicListenPort: options.listenPortBase + index,
        port: options.portBase + index,
        dataDir: dir,
        relays: [],
        nip96Servers: [],
      })
      await node.start()
      handles.push({ node, dir })
    }

    return handles
  } catch (error) {
    await stopNodes(handles)
    throw error
  }
}

async function stopNodes(handles: NodeHandle[]): Promise<void> {
  for (const handle of [...handles].reverse()) {
    try {
      await handle.node.stop()
    } finally {
      await rm(handle.dir, { recursive: true, force: true })
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs()
  if (options.nodes < 2) {
    throw new Error('At least 2 nodes are required')
  }

  const handles = await startNodes(options)
  const nodes = handles.map((handle) => handle.node)
  const origin = nodes[0]
  if (!origin) {
    throw new Error('No origin node available')
  }

  try {
    console.log(JSON.stringify({
      event: 'started',
      nodes: options.nodes,
      listenPortBase: options.listenPortBase,
      portBase: options.portBase,
      timeoutMs: options.timeoutMs,
      rounds: options.rounds,
      payloadBytes: options.payloadBytes,
    }))

    await waitFor(() => nodes.slice(1).every((node) => node.peerCount() > 0), options.timeoutMs)
    console.log(JSON.stringify({
      event: 'connected',
      peerCounts: nodes.map((node) => node.peerCount()),
    }))

    const payload = Buffer.alloc(options.payloadBytes, 'q')
    for (let round = 0; round < options.rounds; round++) {
      const located = await origin.put(payload, {
        name: `quic-stress-${round}.bin`,
        mime: 'application/octet-stream',
        ttl: 3600,
      })
      await waitFor(() => nodes.slice(1).every((node) => node.hasReceivedKey(located.qkey)), options.timeoutMs)
      console.log(JSON.stringify({
        event: 'round-complete',
        round,
        qkey: located.qkey,
        peerCounts: nodes.map((node) => node.peerCount()),
      }))
    }

    console.log(JSON.stringify({
      event: 'complete',
      peerCounts: nodes.map((node) => node.peerCount()),
      rounds: options.rounds,
    }))
  } finally {
    await stopNodes(handles)
  }
}

await main()
