import { Command } from 'commander'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { initConfig, loadConfig, type ConfigOverrides, type QDHTConfig } from '../src/node/config.js'
import { QDHTNode } from '../src/node/qdht-node.js'

const DEFAULT_CONFIG_PATH = join(homedir(), '.qdht', 'config.json')
const DEFAULT_DATA_DIR = join(homedir(), '.qdht', 'data')

async function loadNodeConfig(
  configPath: string,
  overrides: ConfigOverrides = {},
): Promise<QDHTConfig> {
  try {
    return await loadConfig(configPath, overrides)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }
  const config = await initConfig(configPath, overrides.dataDir ?? DEFAULT_DATA_DIR)
  if (overrides.port !== undefined) config.port = overrides.port
  if (overrides.peers !== undefined) config.peers = overrides.peers
  if (overrides.relays !== undefined) config.relays = overrides.relays
  if (overrides.webPort !== undefined) config.webPort = overrides.webPort
  if (overrides.dataDir !== undefined) config.dataDir = overrides.dataDir
  return config
}

async function rpcCall(sockPath: string, request: unknown): Promise<any> {
  return await new Promise((resolve, reject) => {
    const conn = createConnection(sockPath)
    let buffer = ''
    const timer = setTimeout(() => {
      conn.destroy()
      reject(new Error('RPC timeout after 30s'))
    }, 30_000)

    conn.on('connect', () => conn.write(`${JSON.stringify(request)}\n`))
    conn.on('data', (data) => {
      buffer += data.toString()
      if (!buffer.includes('\n')) {
        return
      }
      clearTimeout(timer)
      conn.destroy()
      try {
        resolve(JSON.parse(buffer.trim()))
      } catch {
        reject(new Error(`bad JSON from RPC: ${buffer}`))
      }
    })
    conn.on('error', (err) => {
      clearTimeout(timer)
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error("Error: no running qdht-node found. Run 'qdht-node start' first."))
        return
      }
      reject(err)
    })
  })
}

function printRoute(route: {
  identity: string
  reachable: boolean
  bestEndpoint: { transport: string; address: string; port?: number; confidence: number } | null
  fallback: { transport: string; address: string; port?: number; confidence: number } | null
  nat: { typeEstimate: string }
  sequence: number
  updatedAt: number
}): void {
  console.log(`Identity : ${route.identity}`)
  console.log(`Reachable: ${route.reachable ? 'yes' : 'no'}`)
  console.log(`NAT      : ${route.nat.typeEstimate}`)
  console.log(`Sequence : ${route.sequence}`)
  console.log(`Updated  : ${new Date(route.updatedAt).toISOString()}`)
  if (route.bestEndpoint) {
    const port = route.bestEndpoint.port !== undefined ? `:${route.bestEndpoint.port}` : ''
    console.log(`Best     : ${route.bestEndpoint.transport}://${route.bestEndpoint.address}${port} (${route.bestEndpoint.confidence.toFixed(2)})`)
  }
  if (route.fallback) {
    const port = route.fallback.port !== undefined ? `:${route.fallback.port}` : ''
    console.log(`Fallback : ${route.fallback.transport}://${route.fallback.address}${port} (${route.fallback.confidence.toFixed(2)})`)
  }
}

function summarizeEvent(raw: string): string {
  try {
    const event = JSON.parse(raw) as { kind?: number; pubkey?: string; tags?: string[][]; content?: string }
    const parts: string[] = []
    if (typeof event.kind === 'number') parts.push(`kind=${event.kind}`)
    if (typeof event.pubkey === 'string') parts.push(`pubkey=${event.pubkey.slice(0, 12)}..`)
    const qkey = event.tags?.find((tag) => tag[0] === 'qkey')?.[1]
    const hash = event.tags?.find((tag) => tag[0] === 'hash')?.[1]
    const name = event.tags?.find((tag) => tag[0] === 'name')?.[1]
    const url = event.tags?.find((tag) => tag[0] === 'url')?.[1] ?? event.tags?.find((tag) => tag[0] === 'r')?.[1]
    if (qkey) parts.push(`qkey=${qkey}`)
    if (hash) parts.push(`hash=${hash.slice(0, 12)}..`)
    if (name) parts.push(`name=${name}`)
    if (url) parts.push(`url=${url}`)
    if (typeof event.content === 'string' && event.content.length > 0) {
      parts.push(`content=${event.content.slice(0, 48)}${event.content.length > 48 ? '…' : ''}`)
    }
    return parts.join(' ')
  } catch {
    return raw.slice(0, 96)
  }
}

const program = new Command()
program.name('qdht-node').version('0.1.0').description('qDHT node CLI')

program
  .command('start')
  .description('Start the qDHT node daemon')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--port <port>', 'Override listen port', (value) => Number(value))
  .option('--web-port <port>', 'Override web UI port', (value) => Number(value))
  .option('--data-dir <dir>', 'Override data directory')
  .option('--bootstrap', 'Run in bootstrap mode (rendezvous only, no routing)')
  .option('--max-peers <n>', 'Maximum concurrent peers (bootstrap mode only)', (value) => Number(value))
  .option('--listen-address <url>', 'Publicly reachable WebSocket URL to advertise in 30181')
  .action(async (opts: {
    config: string
    port?: number
    webPort?: number
    dataDir?: string
    bootstrap?: boolean
    maxPeers?: number
    listenAddress?: string
  }) => {
    const config = await loadNodeConfig(opts.config, {
      port: opts.port,
      webPort: opts.webPort,
      dataDir: opts.dataDir,
      bootstrapMode: opts.bootstrap,
      maxPeers: opts.maxPeers,
      listenAddress: opts.listenAddress,
    })
    const node = new QDHTNode(config)
    await node.start()

    console.log(`qdht-node started`)
    console.log(`  pubkey : ${node.pubkey()}`)
    console.log(`  port   : ${node.listenPort()}`)
    console.log(`  dataDir: ${config.dataDir}`)
    if (node.webPort() !== null) {
      console.log(`  web    : http://127.0.0.1:${node.webPort()}`)
    }

    process.on('SIGINT', async () => {
      await node.stop()
      process.exit(0)
    })

    await new Promise<void>(() => {})
  })

program
  .command('put <file>')
  .description('Store a file and announce it to the network')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--ttl <seconds>', 'TTL in seconds', (value) => Number(value), 86400)
  .option('--linger <ms>', 'Keep the process alive after announcing', (value) => Number(value), 0)
  .option('--data-dir <dir>', 'Override data directory')
  .action(async (file: string, opts: { config: string; ttl: number; linger: number; dataDir?: string }) => {
    const config = await loadNodeConfig(opts.config, { dataDir: opts.dataDir })
    const node = new QDHTNode(config)
    await node.start()

    const data = await readFile(file)
    const name = file.split('/').pop()
    const loc = await node.put(data, { name, ttl: opts.ttl })
    console.log(loc.qkey)

    if (opts.linger > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, opts.linger)
      })
    }

    await node.stop()
  })

program
  .command('get <key>')
  .description('Retrieve content by qkey from running node')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--out <file>', 'Output file')
  .option('--timeout <ms>', 'Timeout in milliseconds', (value) => Number(value), 30_000)
  .action(async (key: string, opts: { config: string; out?: string; timeout: number }) => {
    const config = await loadConfig(opts.config)
    const node = new QDHTNode(config)
    const progressHandler = (state: { fetched: number; total: number }) => {
      if (opts.out) {
        process.stderr.write(`\rfetching ${state.fetched}/${state.total} pieces...`)
      }
    }

    node.fetcher.on('progress', progressHandler)
    try {
      const data = await node.fetchContent(key, opts.timeout)
      if (opts.out) {
        await writeFile(opts.out, data)
        process.stderr.write('\n')
      } else {
        process.stdout.write(data)
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exitCode = 1
    } finally {
      node.fetcher.off('progress', progressHandler)
      await node.disconnect()
    }
  })

program
  .command('peers')
  .description('List connected peers from running node')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .action(async (opts: { config: string }) => {
    const config = await loadConfig(opts.config)
    const sockPath = join(config.dataDir, 'qdht.sock')
    const response = await rpcCall(sockPath, { cmd: 'peers' }) as { peers: Array<{ pubkey: string; url: string; latencyMs: number | null; connectedAt: string }> }
    if (response.peers.length === 0) {
      console.log('No connected peers.')
      return
    }

    const header = `${'PUBKEY'.padEnd(12)}  ${'URL'.padEnd(30)}  ${'LATENCY'.padEnd(9)}  CONNECTED_AT`
    console.log(header)
    console.log('-'.repeat(header.length))
    for (const peer of response.peers) {
      const pub = `${peer.pubkey.slice(0, 10)}..`
      const latency = peer.latencyMs !== null ? `${peer.latencyMs}ms` : 'n/a'
      console.log(`${pub.padEnd(12)}  ${peer.url.padEnd(30)}  ${latency.padEnd(9)}  ${peer.connectedAt}`)
    }
  })

program
  .command('replicas <key>')
  .description('List replica providers for a content key')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .action(async (key: string, opts: { config: string }) => {
    const config = await loadConfig(opts.config)
    const sockPath = join(config.dataDir, 'qdht.sock')
    const response = await rpcCall(sockPath, { cmd: 'replicas', key }) as { replicas: Array<{ pubkey: string; lastSeen: string; pieceCount: number; totalPieces: number }> }
    if (response.replicas.length === 0) {
      console.log('No replica providers found.')
      return
    }

    const header = `${'PUBKEY'.padEnd(12)}  ${'LAST_SEEN'.padEnd(24)}  ${'PIECES'.padEnd(10)}  TOTAL`
    console.log(header)
    console.log('-'.repeat(header.length))
    for (const replica of response.replicas) {
      const pub = `${replica.pubkey.slice(0, 10)}..`
      console.log(`${pub.padEnd(12)}  ${replica.lastSeen.padEnd(24)}  ${String(replica.pieceCount).padEnd(10)}  ${replica.totalPieces}`)
    }
  })

program
  .command('search <query>')
  .description('Search identity routes or announcement metadata on a running node')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--type <type>', 'Search type: identity, content, route, or replica', 'content')
  .option('--timeout <ms>', 'Timeout in milliseconds', (value) => Number(value), 2000)
  .option('--limit <n>', 'Max number of matches', (value) => Number(value), 25)
  .option('--publisher <pubkey>', 'Filter by publisher')
  .option('--qkey <qkey>', 'Filter by qkey')
  .option('--hash <hash>', 'Filter by content hash')
  .option('--name <name>', 'Filter by name')
  .option('--mime <mime>', 'Filter by MIME type')
  .option('--tag <tag>', 'Filter by tag')
  .action(async (
    query: string,
    opts: {
      config: string
      type: 'identity' | 'content' | 'route' | 'replica'
      timeout: number
      limit: number
      publisher?: string
      qkey?: string
      hash?: string
      name?: string
      mime?: string
      tag?: string
    },
  ) => {
    const config = await loadConfig(opts.config)
    const sockPath = join(config.dataDir, 'qdht.sock')
    const type = opts.type
    const response = await rpcCall(sockPath, type === 'identity'
      ? { cmd: 'search', type, query, timeoutMs: opts.timeout }
      : {
          cmd: 'search',
          type,
          query,
          timeoutMs: opts.timeout,
          limit: opts.limit,
          publisher: opts.publisher,
          qkey: opts.qkey,
          hash: opts.hash,
          name: opts.name,
          mime: opts.mime,
          tag: opts.tag,
        }) as
      | { route: null | { identity: string; reachable: boolean; bestEndpoint: { transport: string; address: string; port?: number; confidence: number } | null; fallback: { transport: string; address: string; port?: number; confidence: number } | null; nat: { typeEstimate: string }; sequence: number; updatedAt: number } }
      | { response: null | { requestType: string; query: string; limit: number; announcements: string[]; replicas: string[]; routes: string[] } }
      | { error: string }

    if ('error' in response) {
      console.error(response.error)
      process.exitCode = 1
      return
    }

    if ('route' in response) {
      if (!response.route) {
        console.log('No route found.')
        return
      }
      printRoute(response.route)
      return
    }

    if (!response.response) {
      console.log('No matches found.')
      return
    }

    console.log(`Request : ${response.response.requestType} "${response.response.query}"`)
    console.log(`Limit   : ${response.response.limit}`)
    console.log(`Counts  : announcements=${response.response.announcements.length} replicas=${response.response.replicas.length} routes=${response.response.routes.length}`)
    if (response.response.announcements.length > 0) {
      console.log('Announcements:')
      for (const item of response.response.announcements) {
        console.log(`  - ${summarizeEvent(item)}`)
      }
    }
    if (response.response.replicas.length > 0) {
      console.log('Replicas:')
      for (const item of response.response.replicas) {
        console.log(`  - ${summarizeEvent(item)}`)
      }
    }
    if (response.response.routes.length > 0) {
      console.log('Routes:')
      for (const item of response.response.routes) {
        console.log(`  - ${summarizeEvent(item)}`)
      }
    }
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
