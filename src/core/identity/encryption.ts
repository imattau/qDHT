import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44'

function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(`key must be 64 hex chars, got ${hex.length}`)
  }

  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
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
