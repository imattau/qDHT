import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const TSX_ARGS = ['--import', 'tsx', 'bin/qdht-node.ts']

let tmpRoot = ''
let daemon: ChildProcess | undefined

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function waitForPeers(configPath: string): Promise<{ stdout: string; stderr: string; code: number }> {
  let last = { stdout: '', stderr: '', code: -1 }
  await waitFor(async () => {
    last = await runCli(['peers', '--config', configPath])
    return last.code === 0 && !last.stdout.includes('No connected peers.')
  })
  return last
}

function runCli(args: string[], input?: Buffer | string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...TSX_ARGS, ...args], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
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

    if (input !== undefined) {
      child.stdin.end(input)
    } else {
      child.stdin.end()
    }
  })
}

function spawnCli(args: string[], input?: Buffer | string): ChildProcess & { stdout: Readable; stderr: Readable } {
  const child = spawn(process.execPath, [...TSX_ARGS, ...args], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (input !== undefined) {
    child.stdin.end(input)
  } else {
    child.stdin.end()
  }
  return child
}

function startDaemon(configPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...TSX_ARGS, 'start', '--config', configPath], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    daemon = child

    let stdout = ''
    let stderr = ''
    const fail = (err: Error) => {
      reject(err)
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (stdout.includes('qdht-node started')) {
        resolve()
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', fail)
    child.on('exit', (code) => {
      if (code !== 0 && !stdout.includes('qdht-node started')) {
        reject(new Error(`daemon exited early: ${code}\n${stderr}`))
      }
    })
  })
}

async function stopDaemon(): Promise<void> {
  if (!daemon) {
    return
  }
  const proc = daemon
  daemon = undefined
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return
  }
  proc.kill('SIGINT')
  await new Promise<void>((resolve) => {
    proc.once('exit', () => resolve())
  })
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'qdht-cli-'))
})

afterEach(async () => {
  await stopDaemon()
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('qdht-node CLI e2e', () => {
  it('starts a daemon, accepts put, reports peers, and retrieves content through the binary', async () => {
    const dirA = join(tmpRoot, 'a')
    const dirB = join(tmpRoot, 'b')
    const configA = join(tmpRoot, 'config-a.json')
    const configB = join(tmpRoot, 'config-b.json')
    const inputFile = join(tmpRoot, 'input.txt')
    const outputFile = join(tmpRoot, 'output.txt')

    await writeFile(inputFile, Buffer.alloc(2 * 1024 * 1024, 'q'))
    await writeFile(configA, JSON.stringify({
      identity: { privkey: 'a'.repeat(64) },
      peers: [],
      port: 21900,
      dataDir: dirA,
    }))
    await writeFile(configB, JSON.stringify({
      identity: { privkey: 'b'.repeat(64) },
      peers: ['ws://127.0.0.1:21900'],
      port: 21901,
      dataDir: dirB,
    }))

    await startDaemon(configA)

    const putProc = spawnCli(['put', inputFile, '--config', configB, '--linger', '3000'])
    const putPromise = new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      putProc.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      putProc.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      putProc.on('error', reject)
      putProc.on('close', (code) => {
        resolve({ stdout, stderr, code: code ?? -1 })
      })
    })
    const peerSeenPromise = waitForPeers(configA)
    const [put, peers] = await Promise.all([putPromise, peerSeenPromise])
    expect(put.code).toBe(0)
    const qkey = put.stdout.trim()
    expect(qkey).toMatch(/^[0-9a-f]{64}$/i)
    expect(peers.code).toBe(0)
    expect(peers.stdout).toContain('PUBKEY')
    expect(peers.stdout).not.toContain('No connected peers.')

    const get = await runCli(['get', qkey, '--config', configB, '--out', outputFile])
    expect(get.code).toBe(0)
    expect(await readFile(outputFile)).toEqual(await readFile(inputFile))
  }, 30_000)
})
