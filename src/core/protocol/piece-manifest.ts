export interface PieceInfo {
  index: number
  hash: string
}

export interface QDHTPieceManifest {
  kind: 10803
  pubkey: string
  qkey: string
  hash: string
  sizeBytes: number
  pieceSize: number
  pieces: PieceInfo[]
}

export function buildPieceManifest(opts: {
  pubkey: string
  qkey: string
  hash: string
  sizeBytes: number
  pieceSize: number
  pieces: PieceInfo[]
}): QDHTPieceManifest {
  return {
    kind: 10803,
    ...opts,
  }
}
