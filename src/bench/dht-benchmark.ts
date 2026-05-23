import { mkdtemp, rm } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLibp2p, type Libp2p } from 'libp2p'
import { memory } from '@libp2p/memory'
import { identify } from '@libp2p/identify'
import { kadDHT } from '@libp2p/kad-dht'
import { noise } from '@chainsafe/libp2p-noise'
import { ping } from '@libp2p/ping'
import { yamux } from '@chainsafe/libp2p-yamux'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import { code as rawCode } from 'multiformats/codecs/raw'
import { QDHTNode } from '../node/qdht-node.js'
import { generateKeypair } from '../core/identity/keys.js'

interface BenchmarkOptions {
  nodes: number
  rounds: number
  timeoutMs: number
  payloadBytes: number
  qdhtPortBase: number
}

interface RoundMetrics {
  publishMs: number
  discoveryMs: number
  discovered: number
  expected: number
}

interface BackendSummary {
  backend: string
  nodes: number
  rounds: number
  publishMsAvg: number
  publishMsP95: number
  discoveryMsAvg: number
  discoveryMsP95: number
  coverageAvg: number
  coverageMin: number
}

interface BenchmarkResult {
  options: BenchmarkOptions
  qdht: BackendSummary
  kadDht: BackendSummary
}

type Libp2pNode = Libp2p

interface QDHTHandle {
  node: QDHTNode
  dir: string
}

interface KadHandle {
  node: Libp2pNode
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

function parseArgs(): BenchmarkOptions {
  const defaults: BenchmarkOptions = {
    nodes: 6,
    rounds: 3,
    timeoutMs: 20_000,
    payloadBytes: 64 * 1024,
    qdhtPortBase: 24000,
  }

  const args = new Map<string, string>()
  const argv = process.argv.slice(2)
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === undefined) {
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        'usage: tsx src/bench/dht-benchmark.ts [--nodes N] [--rounds N] [--timeout-ms N] [--payload-bytes N] [--qdht-port-base N]',
      )
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
    index += 1
  }

  return {
    nodes: parseInteger(args.get('nodes'), defaults.nodes),
    rounds: parseInteger(args.get('rounds'), defaults.rounds),
    timeoutMs: parseInteger(args.get('timeout-ms'), defaults.timeoutMs),
    payloadBytes: parseInteger(args.get('payload-bytes'), defaults.payloadBytes),
    qdhtPortBase: parseInteger(args.get('qdht-port-base'), defaults.qdhtPortBase),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = performance.now()
  while (!(await fn())) {
    if (performance.now() - start > timeoutMs) {
      throw new Error('timeout')
    }
    await sleep(50)
  }
}

function percentile(values: number[], rank: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * rank) - 1))
  return sorted[index] ?? 0
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function makePayload(fill: string, round: number, size: number): Buffer {
  const payload = Buffer.alloc(size, fill)
  payload.writeUInt32BE(round, 0)
  return payload
}

async function makeCid(data: Buffer): Promise<CID> {
  const digest = await sha256.digest(data)
  return CID.createV1(rawCode, digest)
}

async function startQdhtCluster(options: BenchmarkOptions): Promise<QDHTHandle[]> {
  const handles: QDHTHandle[] = []
  const stamp = Date.now()

  try {
    for (let index = 0; index < options.nodes; index++) {
      const dir = await mkdtemp(join(tmpdir(), `qdht-bench-${index}-${stamp}-`))
      const node = new QDHTNode({
        identity: { privkey: generateKeypair().privkey },
        peers: index === 0 ? [] : [`ws://127.0.0.1:${options.qdhtPortBase}`],
        port: options.qdhtPortBase + index,
        dataDir: dir,
        relays: [],
        nip96Servers: [],
      })
      await node.start()
      handles.push({ node, dir })
    }

    return handles
  } catch (error) {
    await stopQdhtCluster(handles)
    throw error
  }
}

async function stopQdhtCluster(handles: QDHTHandle[]): Promise<void> {
  for (const handle of [...handles].reverse()) {
    try {
      await handle.node.stop()
    } finally {
      await rm(handle.dir, { recursive: true, force: true })
    }
  }
}

async function startKadDhtCluster(options: BenchmarkOptions): Promise<KadHandle[]> {
  const handles: KadHandle[] = []

  try {
    for (let index = 0; index < options.nodes; index++) {
      const node = await createLibp2p({
        addresses: {
          listen: [`/memory/${index + 1}`],
        },
        transports: [memory()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: {
          identify: identify(),
          ping: ping(),
          dht: kadDHT({
            clientMode: false,
          }),
        },
      })
      await node.start()
      handles.push({ node })
    }

    const bootstrap = handles[0]?.node
    if (!bootstrap) {
      throw new Error('No libp2p bootstrap node created')
    }

    const bootstrapAddress = bootstrap.getMultiaddrs()[0]
    if (!bootstrapAddress) {
      throw new Error('Bootstrap node has no multiaddrs')
    }

    for (const handle of handles.slice(1)) {
      await handle.node.dial(bootstrapAddress)
    }

    return handles
  } catch (error) {
    await stopKadDhtCluster(handles)
    throw error
  }
}

async function stopKadDhtCluster(handles: KadHandle[]): Promise<void> {
  for (const handle of [...handles].reverse()) {
    try {
      await handle.node.stop()
    } catch {
      // Ignore teardown noise in benchmark shutdown.
    }
  }
}

async function waitForQdhtConnections(nodes: QDHTNode[], timeoutMs: number): Promise<void> {
  await waitFor(() => nodes.every((node) => node.peerCount() > 0), timeoutMs)
}

async function waitForKadConnections(nodes: Libp2pNode[], timeoutMs: number): Promise<void> {
  await waitFor(() => nodes.every((node) => node.getPeers().length > 0), timeoutMs)
}

async function measureQdhtRound(handles: QDHTHandle[], options: BenchmarkOptions, round: number): Promise<RoundMetrics> {
  const nodes = handles.map((handle) => handle.node)
  const origin = nodes[0]
  if (!origin) {
    throw new Error('No qDHT origin node')
  }

  const payload = makePayload('q', round, options.payloadBytes)
  const publishStart = performance.now()
  const loc = await origin.put(payload, {
    name: `qdht-benchmark-${round}.bin`,
    mime: 'application/octet-stream',
    ttl: 3600,
  })
  const publishMs = performance.now() - publishStart

  const consumerNodes = nodes.slice(1)
  const start = performance.now()
  const discoveredAt = new Array<number | null>(consumerNodes.length).fill(null)
  while (performance.now() - start <= options.timeoutMs) {
    let complete = true
    for (let index = 0; index < consumerNodes.length; index++) {
      if (discoveredAt[index] !== null) {
        continue
      }
      if (consumerNodes[index]?.hasReceivedKey(loc.qkey)) {
        discoveredAt[index] = performance.now() - start
      } else {
        complete = false
      }
    }
    if (complete) {
      break
    }
    await sleep(50)
  }

  const discovered = discoveredAt.filter((value): value is number => value !== null)
  return {
    publishMs,
    discoveryMs: discovered.length > 0 ? Math.max(...discovered) : options.timeoutMs,
    discovered: discovered.length,
    expected: consumerNodes.length,
  }
}

async function hasProvider(node: Libp2pNode, cid: CID, timeoutMs: number): Promise<boolean> {
  const start = performance.now()
  while (performance.now() - start <= timeoutMs) {
    try {
      const providers = node.contentRouting.findProviders(cid, { signal: AbortSignal.timeout(1_000) } as never)
      for await (const _provider of providers) {
        return true
      }
    } catch {
      // Ignore transient lookup errors and retry until the outer timeout expires.
    }
    await sleep(50)
  }
  return false
}

async function measureKadRound(handles: KadHandle[], options: BenchmarkOptions, round: number): Promise<RoundMetrics> {
  const nodes = handles.map((handle) => handle.node)
  const origin = nodes[0]
  if (!origin) {
    throw new Error('No Kad-DHT origin node')
  }

  const payload = makePayload('k', round, options.payloadBytes)
  const cid = await makeCid(payload)
  const publishStart = performance.now()
  await origin.contentRouting.provide(cid)
  const publishMs = performance.now() - publishStart

  const consumerNodes = nodes.slice(1)
  const start = performance.now()
  const discoveredAt = new Array<number | null>(consumerNodes.length).fill(null)
  while (performance.now() - start <= options.timeoutMs) {
    let complete = true
    for (let index = 0; index < consumerNodes.length; index++) {
      if (discoveredAt[index] !== null) {
        continue
      }
      if (await hasProvider(consumerNodes[index]!, cid, 250)) {
        discoveredAt[index] = performance.now() - start
      } else {
        complete = false
      }
    }
    if (complete) {
      break
    }
    await sleep(50)
  }

  const discovered = discoveredAt.filter((value): value is number => value !== null)
  return {
    publishMs,
    discoveryMs: discovered.length > 0 ? Math.max(...discovered) : options.timeoutMs,
    discovered: discovered.length,
    expected: consumerNodes.length,
  }
}

function summarize(backend: string, nodes: number, rounds: number, results: RoundMetrics[]): BackendSummary {
  const publishMs = results.map((result) => result.publishMs)
  const discoveryMs = results.map((result) => result.discoveryMs)
  const coverage = results.map((result) => result.expected === 0 ? 0 : result.discovered / result.expected)
  return {
    backend,
    nodes,
    rounds,
    publishMsAvg: average(publishMs),
    publishMsP95: percentile(publishMs, 0.95),
    discoveryMsAvg: average(discoveryMs),
    discoveryMsP95: percentile(discoveryMs, 0.95),
    coverageAvg: average(coverage),
    coverageMin: coverage.length > 0 ? Math.min(...coverage) : 0,
  }
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function printBenchmark(result: BenchmarkResult): void {
  console.log('\n=== qDHT vs Kad-DHT ===')
  console.log(`${'metric'.padEnd(30)} ${'qDHT'.padEnd(16)} Kad-DHT`)
  console.log('-'.repeat(64))
  console.log(`nodes`.padEnd(30) + String(result.qdht.nodes).padEnd(16) + result.kadDht.nodes)
  console.log(`rounds`.padEnd(30) + String(result.qdht.rounds).padEnd(16) + result.kadDht.rounds)
  console.log(`publishMs.avg`.padEnd(30) + formatMs(result.qdht.publishMsAvg).padEnd(16) + formatMs(result.kadDht.publishMsAvg))
  console.log(`publishMs.p95`.padEnd(30) + formatMs(result.qdht.publishMsP95).padEnd(16) + formatMs(result.kadDht.publishMsP95))
  console.log(`discoveryMs.avg`.padEnd(30) + formatMs(result.qdht.discoveryMsAvg).padEnd(16) + formatMs(result.kadDht.discoveryMsAvg))
  console.log(`discoveryMs.p95`.padEnd(30) + formatMs(result.qdht.discoveryMsP95).padEnd(16) + formatMs(result.kadDht.discoveryMsP95))
  console.log(`coverage.avg`.padEnd(30) + formatPct(result.qdht.coverageAvg).padEnd(16) + formatPct(result.kadDht.coverageAvg))
  console.log(`coverage.min`.padEnd(30) + formatPct(result.qdht.coverageMin).padEnd(16) + formatPct(result.kadDht.coverageMin))
}

async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  if (options.nodes < 2) {
    throw new Error('At least 2 nodes are required')
  }

  const qdhtHandles = await startQdhtCluster(options)
  const kadHandles = await startKadDhtCluster(options)

  try {
    await waitForQdhtConnections(qdhtHandles.map((handle) => handle.node), options.timeoutMs)
    await waitForKadConnections(kadHandles.map((handle) => handle.node), options.timeoutMs)

    const qdhtRounds: RoundMetrics[] = []
    const kadRounds: RoundMetrics[] = []

    for (let round = 0; round < options.rounds; round++) {
      qdhtRounds.push(await measureQdhtRound(qdhtHandles, options, round))
      kadRounds.push(await measureKadRound(kadHandles, options, round))
    }

    return {
      options,
      qdht: summarize('qDHT', options.nodes, options.rounds, qdhtRounds),
      kadDht: summarize('Kad-DHT', options.nodes, options.rounds, kadRounds),
    }
  } finally {
    await stopKadDhtCluster(kadHandles)
    await stopQdhtCluster(qdhtHandles)
  }
}

function printJsonLine(payload: unknown): void {
  console.log(JSON.stringify(payload))
}

async function main(): Promise<void> {
  const options = parseArgs()
  const result = await runBenchmark(options)

  printBenchmark(result)
  printJsonLine({
    event: 'complete',
    options: result.options,
    qdht: result.qdht,
    kadDht: result.kadDht,
    note: 'qDHT uses live WebSocket peers; Kad-DHT uses in-process libp2p memory transport to isolate routing behavior.',
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}

export {
  runBenchmark,
  type BenchmarkOptions,
  type BenchmarkResult,
  type BackendSummary,
  type RoundMetrics,
}
