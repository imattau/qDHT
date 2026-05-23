import { describe, expect, it } from 'vitest'
import { generateKeypair, keypairFromHex, pubkeyFromPrivkey } from './keys.js'

describe('generateKeypair', () => {
  it('returns 64-char lowercase hex privkey and pubkey', () => {
    const keypair = generateKeypair()
    expect(keypair.privkey).toMatch(/^[0-9a-f]{64}$/)
    expect(keypair.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique keypairs each call', () => {
    const a = generateKeypair()
    const b = generateKeypair()
    expect(a.privkey).not.toBe(b.privkey)
    expect(a.pubkey).not.toBe(b.pubkey)
  })
})

describe('pubkeyFromPrivkey', () => {
  it('is deterministic for the same private key', () => {
    const keypair = generateKeypair()
    expect(pubkeyFromPrivkey(keypair.privkey)).toBe(keypair.pubkey)
  })

  it('returns 64-char lowercase hex', () => {
    const keypair = generateKeypair()
    expect(pubkeyFromPrivkey(keypair.privkey)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('keypairFromHex', () => {
  it('round-trips a stored private key', () => {
    const original = generateKeypair()
    const restored = keypairFromHex(original.privkey)
    expect(restored.privkey).toBe(original.privkey)
    expect(restored.pubkey).toBe(original.pubkey)
  })
})
