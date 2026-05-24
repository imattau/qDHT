import type { ReputationMap } from '../core/protocol/reputation.js'
import type { PeerInfo } from './peer-manager.js'

export const REPUTATION_CONNECT_THRESHOLD = -0.3

export interface ServiceRecord {
  url: string
  advertiserPubkey: string
}

export interface PeerDiscoveryPolicy {
  shouldConnect(
    record: ServiceRecord,
    currentPeers: PeerInfo[],
    reputationMap: ReputationMap,
    maxPeers: number,
  ): boolean
}

export function normalizeServiceRecordUrl(url: string): string | null {
  try {
    return new URL(url).toString()
  } catch {
    return null
  }
}

export class DefaultPeerDiscoveryPolicy implements PeerDiscoveryPolicy {
  shouldConnect(
    record: ServiceRecord,
    currentPeers: PeerInfo[],
    reputationMap: ReputationMap,
    maxPeers: number,
  ): boolean {
    if (currentPeers.length >= maxPeers) {
      return false
    }

    const normalizedUrl = normalizeServiceRecordUrl(record.url)
    if (!normalizedUrl) {
      return false
    }

    if (currentPeers.some((peer) => normalizeServiceRecordUrl(peer.url) === normalizedUrl)) {
      return false
    }

    if (reputationMap.get(record.advertiserPubkey) < REPUTATION_CONNECT_THRESHOLD) {
      return false
    }

    return true
  }
}
