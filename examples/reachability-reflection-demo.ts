import { generateKeypair } from '../src/core/identity/keys.js'
import {
  buildObservedAddressEvent,
  buildRouteAnnouncement,
  parseObservedAddressEvent,
  resolveRouteAnnouncement,
  signRouteAnnouncement,
  type ObservedAddressReport,
} from '../src/core/discovery/reachability.js'
import { verifyEvent } from '../src/core/identity/signing.js'

interface Peer {
  name: string
  pubkey: string
  privkey: string
}

function makePeer(name: string): Peer {
  const keypair = generateKeypair()
  return { name, pubkey: keypair.pubkey, privkey: keypair.privkey }
}

function shortKey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`
}

function signedObservedReport(subject: Peer, observer: Peer, report: Omit<ObservedAddressReport, 'subjectIdentity' | 'observerIdentity'>) {
  return buildObservedAddressEvent(
    {
      subjectIdentity: subject.pubkey,
      observerIdentity: observer.pubkey,
      ...report,
    },
    observer.privkey,
  )
}

function printReport(subject: Peer, reports: ObservedAddressReport[], routeIdentity: string): void {
  const route = buildRouteAnnouncement(routeIdentity, reports, 1)
  const signedRoute = signRouteAnnouncement(route, subject.privkey)
  const resolved = resolveRouteAnnouncement(subject.pubkey, [signedRoute])

  console.log('=== qDHT Reachability Reflection ===')
  console.log(`subject identity: ${shortKey(subject.pubkey)}`)
  console.log(`lookup key: pubkey -> route announcement`)
  console.log('')
  console.log('Observed address reports:')
  for (const report of reports) {
    console.log(
      `- ${shortKey(report.observerIdentity)} sees ${shortKey(report.subjectIdentity)} as ` +
      `${report.observedIp}:${report.observedPort} via ${report.transport} ` +
      `(dialback: ${report.dialbackSuccess ? 'ok' : 'fail'}, confidence: ${report.confidence.toFixed(2)})`,
    )
  }
  console.log('')
  console.log('Aggregated route announcement:')
  console.log(JSON.stringify(route, null, 2))
  console.log('')
  console.log(`signed route event valid: ${verifyEvent(signedRoute)}`)
  console.log(`route event kind: ${signedRoute.kind}`)
  console.log(`route signature id: ${signedRoute.id}`)
  console.log(`resolved best endpoint: ${resolved?.bestEndpoint ? `${resolved.bestEndpoint.transport}://${resolved.bestEndpoint.address}:${resolved.bestEndpoint.port ?? ''}` : 'none'}`)
  console.log('')
  console.log('Interpretation:')
  console.log(`- qDHT can use the node pubkey as the stable identity key instead of DNS.`)
  console.log(`- Peers reflect the endpoint they observe, then the subject aggregates multiple reports.`)
  console.log(`- Dialback confirmation upgrades confidence; relay remains the fallback when NAT is hostile.`)
  console.log(`- In this run the NAT estimate is: ${route.nat.typeEstimate}.`)
}

const subject = makePeer('subject')
const observerB = makePeer('observer-b')
const observerC = makePeer('observer-c')
const observerD = makePeer('observer-d')
const observerE = makePeer('observer-e')

const signedReports = [
  signedObservedReport(subject, observerB, {
    observedIp: '203.0.113.44',
    observedPort: 51820,
    transport: 'quic',
    observedAt: Math.floor(Date.now() / 1000) - 30,
    confidence: 0.82,
    dialbackSuccess: true,
  }),
  signedObservedReport(subject, observerC, {
    observedIp: '203.0.113.44',
    observedPort: 60433,
    transport: 'quic',
    observedAt: Math.floor(Date.now() / 1000) - 24,
    confidence: 0.66,
    dialbackSuccess: true,
  }),
  signedObservedReport(subject, observerD, {
    observedIp: '203.0.113.44',
    observedPort: 49102,
    transport: 'quic',
    observedAt: Math.floor(Date.now() / 1000) - 18,
    confidence: 0.44,
    dialbackSuccess: false,
  }),
  signedObservedReport(subject, observerE, {
    observedIp: '198.51.100.9',
    observedPort: 62000,
    transport: 'wss',
    observedAt: Math.floor(Date.now() / 1000) - 12,
    confidence: 0.18,
    dialbackSuccess: false,
  }),
]

const reports = signedReports
  .filter((event) => verifyEvent(event))
  .map((event) => parseObservedAddressEvent(event))
  .filter((report): report is ObservedAddressReport => report !== null && report.subjectIdentity === subject.pubkey)

printReport(subject, reports, subject.pubkey)
