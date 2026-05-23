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

const program = new Command()
program.name('qdht-node').version('0.1.0').description('qDHT node CLI')

program
  .command('start')
  .description('Start the qDHT node daemon')
  .option('--config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
  .option('--port <port>', 'Override listen port', (value) => Number(value))
  .option('--data-dir <dir>', 'Override data directory')
  .action(async (opts: { config: string; port?: number; dataDir?: string }) => {
    const config = await loadNodeConfig(opts.config, {
      port: opts.port,
      dataDir: opts.dataDir,
    })
    const node = new QDHTNode(config)
    await node.start()

    console.log(`qdht-node started`)
    console.log(`  pubkey : ${node.pubkey()}`)
    console.log(`  port   : ${config.port}`)
    console.log(`  dataDir: ${config.dataDir}`)

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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
