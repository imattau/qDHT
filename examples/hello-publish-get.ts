import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { cleanupHandles, makeNode, makeTempDir, writeExampleFile } from './_shared.js'

const tmpRoot = await makeTempDir('qdht-example-hello-')
const handles = []

try {
  const inputPath = join(tmpRoot, 'hello.txt')
  await writeExampleFile(inputPath, 'hello from qDHT\n')

  const handle = await makeNode(tmpRoot, 0, { port: 24000 })
  handles.push(handle)

  const data = await readFile(inputPath)
  const loc = await handle.node.put(data, {
    name: 'hello.txt',
    mime: 'text/plain',
    ttl: 3600,
  })

  const roundTrip = await handle.node.getContent(loc.qkey)
  console.log(`qkey: ${loc.qkey}`)
  console.log(`bytes: ${roundTrip?.length ?? 0}`)
  console.log(roundTrip?.toString('utf8').trimEnd() ?? 'missing')
} finally {
  await cleanupHandles(handles)
}
