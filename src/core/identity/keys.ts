import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes as nobleHexToBytes } from '@noble/hashes/utils.js'

export interface Keypair {
  privkey: string
  pubkey: string
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) {
    throw new Error(`invalid hex key length: expected 64 hex chars, got ${hex.length}`)
  }
  return nobleHexToBytes(hex)
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
