const state = {
  contentUrl: null,
}

const $ = (selector) => document.querySelector(selector)

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function api(path, init) {
  const response = await fetch(path, init)
  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload ? payload.error : payload
    throw new Error(String(message))
  }
  return payload
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function formatDate(value) {
  if (!value) {
    return 'n/a'
  }
  return new Date(value).toLocaleString()
}

function renderStatus(status) {
  $('#status-pubkey').textContent = status.pubkey
  $('#status-web').textContent = `${window.location.origin}`
  $('#status-peers').textContent = String(status.peerCount)

  const stats = [
    ['Listen port', status.port],
    ['Data dir', status.dataDir],
    ['Peer count', status.peerCount],
    ['Connected peers', status.peers.length],
  ]

  const fragment = document.createDocumentFragment()
  for (const [label, value] of stats) {
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.className = 'mono'
    dd.textContent = String(value)
    fragment.append(dt, dd)
  }
  $('#status-stats').replaceChildren(fragment)
}

function renderPeers(peers) {
  const container = $('#peers')
  if (!peers.length) {
    container.innerHTML = '<div class="list-item"><strong>No connected peers</strong><span class="meta">Connect a peer to see the live transport list.</span></div>'
    return
  }

  container.replaceChildren(
    ...peers.map((peer) => {
      const item = document.createElement('div')
      item.className = 'list-item'
      item.innerHTML = `
        <strong class="key-text">${escapeHtml(peer.pubkey)}</strong>
        <div class="meta">${escapeHtml(peer.url)}</div>
        <div class="meta">connected ${escapeHtml(formatDate(peer.connectedAt))} · latency ${peer.latencyMs === null ? 'n/a' : `${peer.latencyMs}ms`}</div>
      `
      return item
    }),
  )
}

function renderRoute(route) {
  const output = $('#output')
  if (!route) {
    output.innerHTML = '<p class="muted">No route found.</p>'
    return
  }

  const endpoints = (route.endpoints ?? []).map((endpoint) => {
    const transport = endpoint.transport === 'relay' ? 'relay' : `${endpoint.transport}://${endpoint.address}${endpoint.port ? `:${endpoint.port}` : ''}`
    const source = endpoint.source === 'fallback' ? 'fallback' : endpoint.source
    return `
      <div class="output-block route-card">
        <div class="route-line">
          <strong class="key-text">${escapeHtml(transport)}</strong>
          <span class="tag ${endpoint.source === 'fallback' ? '' : 'accent'}">${escapeHtml(source)}</span>
          <span class="tag">${(endpoint.confidence ?? 0).toFixed(2)}</span>
        </div>
      </div>
    `
  }).join('')

  output.innerHTML = `
    <div class="output-grid">
      <div class="output-block route-card">
        <div class="route-line">
          <span class="tag accent">route</span>
          <span class="tag">${escapeHtml(route.nat?.typeEstimate ?? 'unknown')}</span>
          <span class="tag">${route.reachable ? 'reachable' : 'unreachable'}</span>
        </div>
        <pre class="key-text">${escapeHtml(JSON.stringify({
          identity: route.identity,
          sequence: route.sequence,
          updatedAt: route.updatedAt,
          bestEndpoint: route.bestEndpoint,
          fallback: route.fallback,
          nat: route.nat,
        }, null, 2))}</pre>
      </div>
      ${endpoints}
    </div>
  `
}

function summarizeEvent(raw) {
  try {
    const event = JSON.parse(raw)
    const parts = []
    if (typeof event.kind === 'number') parts.push(`kind=${event.kind}`)
    if (typeof event.pubkey === 'string') parts.push(`pubkey=${event.pubkey.slice(0, 12)}..`)
    const tags = Array.isArray(event.tags) ? event.tags : []
    const tagMap = new Map(tags.map((tag) => [tag[0], tag[1]]))
    if (tagMap.get('qkey')) parts.push(`qkey=${tagMap.get('qkey')}`)
    if (tagMap.get('hash')) parts.push(`hash=${String(tagMap.get('hash')).slice(0, 12)}..`)
    if (tagMap.get('name')) parts.push(`name=${tagMap.get('name')}`)
    if (tagMap.get('mime')) parts.push(`mime=${tagMap.get('mime')}`)
    return parts.join(' · ')
  } catch {
    return String(raw).slice(0, 100)
  }
}

function renderRequestResponse(response) {
  if (!response) {
    $('#output').innerHTML = '<p class="muted">No matches returned yet.</p>'
    return
  }

  const block = (label, items) => `
    <div class="output-block">
      <div class="route-line">
        <span class="tag accent">${escapeHtml(label)}</span>
        <span class="tag">${items.length}</span>
      </div>
      <div class="output-grid">
        ${items.length ? items.map((item) => `<pre>${escapeHtml(summarizeEvent(item))}\n${escapeHtml(item)}</pre>`).join('') : '<p class="muted">None</p>'}
      </div>
    </div>
  `

  $('#output').innerHTML = `
    <div class="output-grid">
      <div class="output-block">
        <div class="route-line">
          <span class="tag accent">request</span>
          <span class="tag">${escapeHtml(response.requestType ?? 'content')}</span>
          <span class="tag">${escapeHtml(response.query ?? '')}</span>
        </div>
        <pre class="key-text">${escapeHtml(JSON.stringify({
          requestId: response.requestId,
          limit: response.limit,
          query: response.query,
        }, null, 2))}</pre>
      </div>
      ${block('announcements', response.announcements ?? [])}
      ${block('replicas', response.replicas ?? [])}
      ${block('routes', response.routes ?? [])}
    </div>
  `
}

function renderContent(payload) {
  const output = $('#output')
  if (!payload || !payload.found) {
    output.innerHTML = '<p class="muted">Content not found.</p>'
    return
  }

  const bytes = base64ToBytes(payload.contentBase64)
  const blob = new Blob([bytes], { type: payload.mime ?? 'application/octet-stream' })
  if (state.contentUrl) {
    URL.revokeObjectURL(state.contentUrl)
  }
  state.contentUrl = URL.createObjectURL(blob)

  const preview = payload.text ?? '[binary content]'
  output.innerHTML = `
    <div class="output-grid">
      <div class="output-block">
        <div class="route-line">
          <span class="tag accent">content</span>
          <span class="tag">${escapeHtml(payload.name ?? 'unnamed')}</span>
          <span class="tag">${escapeHtml(payload.mime ?? 'application/octet-stream')}</span>
          <span class="tag">${escapeHtml(String(payload.size ?? bytes.length))} bytes</span>
        </div>
        <div class="route-line">
          <a class="download-link" href="${state.contentUrl}" download="${escapeHtml(payload.name ?? 'qdht-content.bin')}">Download payload</a>
        </div>
        <pre class="preview key-text">${escapeHtml(preview.slice(0, 4000))}</pre>
      </div>
      <div class="output-block">
        <pre class="key-text">${escapeHtml(JSON.stringify(payload.announcement ?? {}, null, 2))}</pre>
      </div>
    </div>
  `
}

function renderError(error) {
  $('#output').innerHTML = `
    <div class="output-block">
      <div class="route-line">
        <span class="tag danger">error</span>
      </div>
      <pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre>
    </div>
  `
}

async function refresh() {
  try {
    const [status, peers] = await Promise.all([
      api('/api/status'),
      api('/api/peers'),
    ])
    renderStatus(status)
    renderPeers(peers.peers ?? [])
  } catch (err) {
    $('#output').innerHTML = `<p class="muted">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#put-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    try {
      const fileInput = $('#put-file')
      const file = fileInput.files?.[0]
      if (!file) {
        return
      }
      const name = $('#put-name').value.trim() || file.name
      const ttl = Number($('#put-ttl').value || '86400')
      const mime = $('#put-mime').value.trim() || file.type || undefined
      const bytes = new Uint8Array(await file.arrayBuffer())
      const payload = {
        name,
        ttl,
        mime,
        dataBase64: bytesToBase64(bytes),
      }
      const response = await api('/api/put', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const location = response.location
      $('#fetch-key').value = location.qkey
      $('#output').innerHTML = `
        <div class="output-block">
          <div class="route-line">
            <span class="tag accent">published</span>
            <span class="tag key-text">${escapeHtml(location.qkey)}</span>
            <span class="tag key-text">${escapeHtml(location.hash.slice(0, 12))}..</span>
          </div>
          <pre class="key-text">${escapeHtml(JSON.stringify(location, null, 2))}</pre>
        </div>
      `
      await refresh()
    } catch (error) {
      renderError(error)
    }
  })

  $('#search-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    try {
      const query = $('#search-query').value.trim()
      const type = $('#search-type').value
      const limit = $('#search-limit').value || '25'
      const params = new URLSearchParams({
        query,
        type,
        limit,
      })
      const response = await api(`/api/search?${params.toString()}`)
      if (type === 'identity') {
        renderRoute(response.route)
      } else {
        renderRequestResponse(response.response)
      }
    } catch (error) {
      renderError(error)
    }
  })

  $('#fetch-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    try {
      const key = $('#fetch-key').value.trim()
      if (!key) {
        return
      }
      const response = await api(`/api/content?key=${encodeURIComponent(key)}`)
      renderContent(response)
    } catch (error) {
      renderError(error)
    }
  })

  refresh().catch(() => {})
  setInterval(() => {
    refresh().catch(() => {})
  }, 5000)
})
