import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44'
import { hexToBytes as nobleHexToBytes } from '@noble/hashes/utils.js'

function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) {
    throw new Error(`key must be 64 hex chars, got ${hex.length}`)
  }
  return nobleHexToBytes(hex)
}

export function encrypt(
  plaintext: string,
  senderPrivkeyHex: string,
  recipientPubkeyHex: string,
): string {
  const conversationKey = getConversationKey(hexToBytes(senderPrivkeyHex), recipientPubkeyHex)
  return nip44Encrypt(plaintext, conversationKey)
}

export function decrypt(
  ciphertext: string,
  recipientPrivkeyHex: string,
  senderPubkeyHex: string,
): string {
  const conversationKey = getConversationKey(hexToBytes(recipientPrivkeyHex), senderPubkeyHex)
  return nip44Decrypt(ciphertext, conversationKey)
}
