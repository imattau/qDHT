import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

export interface Keypair {
  privkey: string
  pubkey: string
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(`invalid hex key length: expected 64 hex chars, got ${hex.length}`)
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

export function generateKeypair(): Keypair {
  const privkeyBytes = generateSecretKey()
  const privkey = bytesToHex(privkeyBytes)
  const pubkey = getPublicKey(privkeyBytes)
  return { privkey, pubkey }
}

export function pubkeyFromPrivkey(privkeyHex: string): string {
  return getPublicKey(hexToBytes(privkeyHex))
}

export function keypairFromHex(privkeyHex: string): Keypair {
  return {
    privkey: privkeyHex.toLowerCase(),
    pubkey: pubkeyFromPrivkey(privkeyHex),
  }
}
