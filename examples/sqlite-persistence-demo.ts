import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { cleanupHandles, makeNode, makeTempDir } from './_shared.js'

const tmpRoot = await makeTempDir('qdht-example-sqlite-')
const handles = []

try {
  const first = await makeNode(tmpRoot, 0, { port: 24200 })
  handles.push(first)

  const content = Buffer.from('persisted event log demo\n')
  const loc = await first.node.put(content, {
    name: 'persisted.txt',
    mime: 'text/plain',
    ttl: 3600,
  })

  const eventDb = join(first.dir, 'qdht.sqlite')
  await first.node.stop()
  handles.pop()

  const restarted = await makeNode(tmpRoot, 0, { port: 24200 })
  handles.push(restarted)
  console.log(`sqlite: ${eventDb}`)
  const info = restarted.node.getAnnouncementInfo(loc.qkey)
  console.log(`announcement found: ${info !== null}`)
  console.log(`restored hash: ${info?.hash ?? 'missing'}`)
} finally {
  await cleanupHandles(handles)
  await rm(tmpRoot, { recursive: true, force: true })
}
