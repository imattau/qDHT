import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { generateKeypair } from '../core/identity/keys.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const TSX_ARGS = ['--import', 'tsx', 'bin/qdht-node.ts']

let tmpRoot = ''
const daemons: ChildProcess[] = []

function startDaemon(configPath: string, extra: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...TSX_ARGS, 'start', '--config', configPath, ...extra], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    daemons.push(child)

    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.includes('qdht-node started')) {
        resolve()
      }
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0 && !stdout.includes('qdht-node started')) {
        reject(new Error(`daemon exited early: code=${code}\n${stderr}`))
      }
    })
  })
}

function runCli(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...TSX_ARGS, ...args], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout!.on('data', (c: Buffer) => { stdout += c.toString() })
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, code: code ?? -1 }))
    child.stdin!.end()
  })
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function stopAll(): Promise<void> {
  await Promise.all(
    daemons.splice(0).map(
      (proc) =>
        new Promise<void>((resolve) => {
          if (proc.exitCode !== null || proc.signalCode !== null) {
            resolve()
            return
          }
          proc.once('exit', () => resolve())
          proc.kill('SIGINT')
        }),
    ),
  )
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-bootstrap-e2e-'))
})

afterEach(async () => {
  await stopAll()
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('bootstrap node e2e', () => {
  it('two regular nodes discover each other via a bootstrap node', async () => {
    const kpBootstrap = generateKeypair()
    const kpA = generateKeypair()
    const kpB = generateKeypair()

    const portBootstrap = 22100
    const portA = 22101
    const portB = 22102

    const bootstrapUrl = `ws://127.0.0.1:${portBootstrap}`

    const configBootstrap = join(tmpRoot, 'config-bootstrap.json')
    const configA = join(tmpRoot, 'config-a.json')
    const configB = join(tmpRoot, 'config-b.json')

    await writeFile(configBootstrap, JSON.stringify({
      identity: { privkey: kpBootstrap.privkey },
      peers: [],
      port: portBootstrap,
      dataDir: join(tmpRoot, 'bootstrap'),
      bootstrapMode: true,
      maxPeers: 100,
      listenAddress: bootstrapUrl,
    }))

    await writeFile(configA, JSON.stringify({
      identity: { privkey: kpA.privkey },
      peers: [bootstrapUrl],
      port: portA,
      dataDir: join(tmpRoot, 'a'),
      listenAddress: `ws://127.0.0.1:${portA}`,
    }))

    await writeFile(configB, JSON.stringify({
      identity: { privkey: kpB.privkey },
      peers: [bootstrapUrl],
      port: portB,
      dataDir: join(tmpRoot, 'b'),
      listenAddress: `ws://127.0.0.1:${portB}`,
    }))

    // Start bootstrap first, then regular nodes
    await startDaemon(configBootstrap)
    await startDaemon(configA)
    await startDaemon(configB)

    const shortA = kpA.pubkey.slice(0, 10)
    const shortB = kpB.pubkey.slice(0, 10)
    const shortBootstrap = kpBootstrap.pubkey.slice(0, 10)

    // Wait for bootstrap to see both nodes
    await waitFor(async () => {
      const { stdout } = await runCli(['peers', '--config', configBootstrap])
      return stdout.includes(shortA) && stdout.includes(shortB)
    }, 10_000)

    // Both nodes should be connected to bootstrap
    const { stdout: peersA } = await runCli(['peers', '--config', configA])
    expect(peersA).toContain(shortBootstrap)

    const { stdout: peersB } = await runCli(['peers', '--config', configB])
    expect(peersB).toContain(shortBootstrap)
  }, 30_000)

  it('bootstrap node responds to peers command showing connected nodes', async () => {
    const kpBootstrap = generateKeypair()
    const kpA = generateKeypair()

    const portBootstrap = 22200
    const portA = 22201
    const bootstrapUrl = `ws://127.0.0.1:${portBootstrap}`

    const configBootstrap = join(tmpRoot, 'config-bootstrap.json')
    const configA = join(tmpRoot, 'config-a.json')

    await writeFile(configBootstrap, JSON.stringify({
      identity: { privkey: kpBootstrap.privkey },
      peers: [],
      port: portBootstrap,
      dataDir: join(tmpRoot, 'bootstrap'),
      bootstrapMode: true,
      listenAddress: bootstrapUrl,
    }))

    await writeFile(configA, JSON.stringify({
      identity: { privkey: kpA.privkey },
      peers: [bootstrapUrl],
      port: portA,
      dataDir: join(tmpRoot, 'a'),
      listenAddress: `ws://127.0.0.1:${portA}`,
    }))

    await startDaemon(configBootstrap)
    await startDaemon(configA)

    const shortA = kpA.pubkey.slice(0, 10)

    // Bootstrap should show node A as a connected peer
    await waitFor(async () => {
      const { stdout } = await runCli(['peers', '--config', configBootstrap])
      return stdout.includes(shortA)
    }, 10_000)

    const { stdout } = await runCli(['peers', '--config', configBootstrap])
    expect(stdout).toContain(shortA)
  }, 30_000)
})
