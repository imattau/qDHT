import { cleanupHandles, makeNode, makeTempDir, waitFor } from './_shared.js'

const tmpRoot = await makeTempDir('qdht-example-gossip-')
const handles = []

try {
  const a = await makeNode(tmpRoot, 0, { port: 24100 })
  const b = await makeNode(tmpRoot, 1, { port: 24101, peers: ['ws://127.0.0.1:24100'] })
  handles.push(a, b)

  await waitFor(() => a.node.peerCount() > 0 && b.node.peerCount() > 0)
  console.log(`node-a peers: ${a.node.peerCount()}`)
  console.log(`node-b peers: ${b.node.peerCount()}`)
  console.log(`node-a pubkey: ${a.node.pubkey()}`)
  console.log(`node-b pubkey: ${b.node.pubkey()}`)
} finally {
  await cleanupHandles(handles)
}
