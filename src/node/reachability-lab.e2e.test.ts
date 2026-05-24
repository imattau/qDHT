import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeypair } from '../core/identity/keys.js'
import { keypairFromHex } from '../core/identity/keys.js'
import { NostrSqliteStore } from '../core/nostr/sqlite-store.js'
import { buildObservedAddressEvent, buildRouteAnnouncement, signRouteAnnouncement } from '../core/discovery/reachability.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const TSX_ARGS = ['--import', 'tsx', 'bin/qdht-node.ts']

let tmpRoot = ''
const processes: ChildProcess[] = []

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function rpcCall(sockPath: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const conn = connect(sockPath)
    let buffer = ''
    let settled = false

    const finish = (value: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
      conn.destroy()
    }

    conn.setEncoding('utf8')
    conn.setTimeout(8_000, () => {
      if (!settled) {
        settled = true
        reject(new Error('rpc timeout'))
      }
      conn.destroy()
    })
    conn.on('connect', () => {
      conn.write(`${JSON.stringify(payload)}\n`)
    })
    conn.on('data', (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline === -1) {
        return
      }
      const line = buffer.slice(0, newline).trim()
      if (!line) {
        return
      }
      try {
        finish(JSON.parse(line))
      } catch (err) {
        settled = true
        reject(err)
        conn.destroy()
      }
    })
    conn.on('error', (err) => {
      if (!settled) {
        settled = true
        reject(err)
      }
    })
    conn.on('close', () => {
      if (!settled) {
        settled = true
        reject(new Error('rpc socket closed before response'))
      }
    })
  })
}

function spawnDaemon(configPath: string): Promise<{ child: ChildProcess; port: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...TSX_ARGS, 'start', '--config', configPath], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    processes.push(child)

    let stdout = ''
    let stderr = ''
    let actualPort: number | null = null
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      const match = stdout.match(/^\s*port\s*:\s*(\d+)/m)
      if (match) {
        actualPort = Number(match[1])
      }
      if (stdout.includes('qdht-node started')) {
        resolve({ child, port: actualPort })
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0 && !stdout.includes('qdht-node started')) {
        reject(new Error(`daemon exited early: ${code}\n${stderr}`))
      }
    })
  })
}

async function stopAll(): Promise<void> {
  await Promise.all(
    processes.splice(0).map(async (proc) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        return
      }
      await Promise.race([
        new Promise<void>((resolve) => {
          proc.once('exit', () => resolve())
          proc.kill('SIGINT')
        }),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (proc.exitCode === null && proc.signalCode === null) {
              proc.kill('SIGKILL')
            }
            resolve()
          }, 3000)
        }),
      ])
    }),
  )
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-reachability-lab-'))
})

afterEach(async () => {
  await stopAll()
  await rm(tmpRoot, { recursive: true, force: true })
  tmpRoot = ''
})

describe('reachability lab e2e', () => {
  async function runSeededRouteCase({
    name,
    seedPort,
    clientPort,
    expectedNat,
    observations,
  }: {
    name: string
    seedPort: number
    clientPort: number
    expectedNat: 'stable-public' | 'port-changing' | 'symmetric-nat' | 'cgnat' | 'unknown'
    observations: Array<{
      subjectIdentity: string
      observerIdentity: string
      observedIp: string
      observedPort: number
      transport: 'quic' | 'udp' | 'tcp' | 'ws' | 'wss'
      observedAt: number
      confidence: number
      dialbackSuccess: boolean
    }>
  }): Promise<void> {
    const seedDir = join(tmpRoot, `${name}-seed`)
    const clientDir = join(tmpRoot, `${name}-client`)
    const seedConfig = join(tmpRoot, `${name}-seed-config.json`)
    const clientConfig = join(tmpRoot, `${name}-client-config.json`)

    await mkdir(seedDir, { recursive: true })
    await mkdir(clientDir, { recursive: true })

    const subject = generateKeypair()
    const store = new NostrSqliteStore(join(seedDir, 'qdht.sqlite'))
    const actualObservations: Array<{
      subjectIdentity: string
      observerIdentity: string
      observedIp: string
      observedPort: number
      transport: 'quic' | 'udp' | 'tcp' | 'ws' | 'wss'
      observedAt: number
      confidence: number
      dialbackSuccess: boolean
    }> = []

    for (const observation of observations) {
      const observer = generateKeypair()
      const actual = {
        ...observation,
        subjectIdentity: subject.pubkey,
        observerIdentity: observer.pubkey,
      }
      actualObservations.push(actual)
      store.upsert(buildObservedAddressEvent(actual, observer.privkey))
    }
    store.upsert(signRouteAnnouncement(buildRouteAnnouncement(subject.pubkey, actualObservations), subject.privkey))
    store.close()

    await writeFile(seedConfig, JSON.stringify({
      identity: { privkey: '1'.repeat(64) },
      peers: [],
      port: seedPort,
      dataDir: seedDir,
    }))

    const seedDaemon = await spawnDaemon(seedConfig)
    const resolvedSeedPort = seedDaemon.port ?? seedPort
    await writeFile(clientConfig, JSON.stringify({
      identity: { privkey: '2'.repeat(64) },
      peers: [`ws://127.0.0.1:${resolvedSeedPort}`],
      port: clientPort,
      dataDir: clientDir,
    }))
    await spawnDaemon(clientConfig)

    const clientSock = join(clientDir, 'qdht.sock')
    const seedSock = join(seedDir, 'qdht.sock')
    const clientPubkey = keypairFromHex('2'.repeat(64)).pubkey
    await waitFor(async () => {
      const seedPeers = await rpcCall(seedSock, { cmd: 'peers' }) as { peers?: Array<{ pubkey?: string }> }
      return Boolean(seedPeers.peers?.some((peer) => peer.pubkey === clientPubkey))
    }, 20_000)

    let search = await rpcCall(clientSock, {
      cmd: 'search',
      type: 'identity',
      query: subject.pubkey,
      timeoutMs: 5_000,
    }) as { route?: { identity?: string; reachable?: boolean; nat?: { typeEstimate?: string }; bestEndpoint?: { transport?: string; address?: string }; fallback?: { transport?: string; address?: string } } }

    if (search.route?.identity !== subject.pubkey) {
      await waitFor(async () => {
        search = await rpcCall(clientSock, {
          cmd: 'search',
          type: 'identity',
          query: subject.pubkey,
          timeoutMs: 5_000,
        }) as { route?: { identity?: string; reachable?: boolean; nat?: { typeEstimate?: string }; bestEndpoint?: { transport?: string; address?: string }; fallback?: { transport?: string; address?: string } } }
        return search.route?.identity === subject.pubkey
      }, 30_000)
    }
    expect(search.route?.identity).toBe(subject.pubkey)
    expect(search.route?.reachable).toBe(true)
    expect(search.route?.nat?.typeEstimate).toBe(expectedNat)
    expect(`${search.route?.bestEndpoint?.transport}://${search.route?.bestEndpoint?.address}`).toBe('quic://203.0.113.44')
    expect(`${search.route?.fallback?.transport}://${search.route?.fallback?.address}`).toBe('relay://wss://relay.example')
  }

  it('propagates a seeded NAT route across separate daemon processes', async () => {
    await runSeededRouteCase({
      name: 'port-changing',
      seedPort: 22300,
      clientPort: 22301,
      expectedNat: 'port-changing',
      observations: [
        {
          subjectIdentity: '',
          observerIdentity: '',
          observedIp: '203.0.113.44',
          observedPort: 51820,
          transport: 'quic',
          observedAt: 1710000300,
          confidence: 0.9,
          dialbackSuccess: true,
        },
        {
          subjectIdentity: '',
          observerIdentity: '',
          observedIp: '203.0.113.44',
          observedPort: 60433,
          transport: 'quic',
          observedAt: 1710000301,
          confidence: 0.8,
          dialbackSuccess: true,
        },
      ],
    })
  }, 30_000)

  it('propagates a cgnat-style route across separate daemon processes', async () => {
    await runSeededRouteCase({
      name: 'cgnat',
      seedPort: 22310,
      clientPort: 22311,
      expectedNat: 'cgnat',
      observations: [
        {
          subjectIdentity: '',
          observerIdentity: '',
          observedIp: '203.0.113.44',
          observedPort: 51820,
          transport: 'quic',
          observedAt: 1710000400,
          confidence: 0.9,
          dialbackSuccess: true,
        },
        {
          subjectIdentity: '',
          observerIdentity: '',
          observedIp: '198.51.100.9',
          observedPort: 62000,
          transport: 'quic',
          observedAt: 1710000401,
          confidence: 0.8,
          dialbackSuccess: true,
        },
      ],
    })
  }, 30_000)

  it('propagates a symmetric-nat-style route across separate daemon processes', async () => {
    await runSeededRouteCase({
      name: 'symmetric-nat',
      seedPort: 22320,
      clientPort: 22321,
      expectedNat: 'symmetric-nat',
      observations: [
        {
          subjectIdentity: '',
          observerIdentity: '',
          observedIp: '203.0.113.44',
          observedPort: 51820,
          transport: 'quic',
          observedAt: 1710000500,
          confidence: 0.9,
          dialbackSuccess: false,
        },
        {
          subjectIdentity: '',
          observerIdentity: '',
          observedIp: '203.0.113.44',
          observedPort: 60433,
          transport: 'quic',
          observedAt: 1710000501,
          confidence: 0.8,
          dialbackSuccess: false,
        },
      ],
    })
  }, 60_000)
})
