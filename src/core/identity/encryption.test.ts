import { describe, expect, it } from 'vitest'
import { generateKeypair } from './keys.js'
import { decrypt, encrypt } from './encryption.js'

describe('encrypt / decrypt', () => {
  it('round-trips a plaintext message', () => {
    const sender = generateKeypair()
    const recipient = generateKeypair()
    const plaintext = 'hello qDHT'

    const ciphertext = encrypt(plaintext, sender.privkey, recipient.pubkey)
    const decrypted = decrypt(ciphertext, recipient.privkey, sender.pubkey)

    expect(decrypted).toBe(plaintext)
  })

  it('produces different ciphertext each call (random nonce)', () => {
    const sender = generateKeypair()
    const recipient = generateKeypair()
    const a = encrypt('same', sender.privkey, recipient.pubkey)
    const b = encrypt('same', sender.privkey, recipient.pubkey)
    expect(a).not.toBe(b)
  })

  it('throws when decrypting with wrong recipient key', () => {
    const sender = generateKeypair()
    const recipient = generateKeypair()
    const wrong = generateKeypair()

    const ciphertext = encrypt('secret', sender.privkey, recipient.pubkey)
    expect(() => decrypt(ciphertext, wrong.privkey, sender.pubkey)).toThrow()
  })
})
