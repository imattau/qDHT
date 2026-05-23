import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeypair } from '../core/identity/keys.js'
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

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...TSX_ARGS, ...args], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? -1 })
    })
  })
}

function spawnDaemon(configPath: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...TSX_ARGS, 'start', '--config', configPath], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    processes.push(child)

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (stdout.includes('qdht-node started')) {
        resolve(child)
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
  while (processes.length > 0) {
    const proc = processes.pop()
    if (!proc) {
      continue
    }
    if (proc.exitCode !== null || proc.signalCode !== null) {
      continue
    }
    proc.kill('SIGINT')
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve())
    })
  }
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
    await writeFile(clientConfig, JSON.stringify({
      identity: { privkey: '2'.repeat(64) },
      peers: [`ws://127.0.0.1:${seedPort}`],
      port: clientPort,
      dataDir: clientDir,
    }))

    await spawnDaemon(seedConfig)
    await spawnDaemon(clientConfig)

    await waitFor(async () => {
      const peers = await runCli(['peers', '--config', clientConfig])
      return peers.code === 0 && !peers.stdout.includes('No connected peers.')
    }, 15_000)

    const search = await runCli(['search', subject.pubkey, '--config', clientConfig, '--type', 'identity'])
    expect(search.code).toBe(0)
    expect(search.stdout).toContain(`Identity : ${subject.pubkey}`)
    expect(search.stdout).toContain('Reachable: yes')
    expect(search.stdout).toContain(`NAT      : ${expectedNat}`)
    expect(search.stdout).toContain('Best     : quic://203.0.113.44')
    expect(search.stdout).toContain('Fallback : relay://wss://relay.example')
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
  }, 30_000)
})
