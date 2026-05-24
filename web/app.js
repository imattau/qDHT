const state = {
  contentUrl: null,
  activeTab: 'overview',
  activeTool: 'publish',
  simulatedNetwork: false,
  latestStatus: null,
  latestPeers: [],
  graph: {
    simulation: null,
    svg: null,
    nodesGroup: null,
    linksGroup: null,
    labelsGroup: null,
    resizeObserver: null,
  },
  layoutObserver: null,
}

const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]
const d3 = globalThis.d3

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function shortKey(value) {
  if (!value) return '—'
  if (value.length <= 12) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

function formatDate(value) {
  if (!value) {
    return 'n/a'
  }
  return new Date(value).toLocaleString()
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

function setActiveTab(tab) {
  state.activeTab = tab
  $$('.tab-btn').forEach((btn) => {
    const active = btn.dataset.tab === tab
    btn.classList.toggle('active', active)
    btn.setAttribute('aria-selected', String(active))
  })
  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.tab === tab)
  })
  if (tab === 'network') {
    renderGraph()
  }
}

function setActiveTool(tool) {
  state.activeTool = tool
  $$('.segment-btn').forEach((btn) => {
    const active = btn.dataset.tool === tool
    btn.classList.toggle('active', active)
    btn.setAttribute('aria-selected', String(active))
  })
  $$('.tool-form').forEach((form) => {
    form.classList.toggle('active', form.dataset.tool === tool)
  })
}

function buildSimulatedTopology(selfPubkey) {
  const nodes = [
    { id: selfPubkey, label: shortKey(selfPubkey), type: 'self', fx: null, fy: null },
    { id: 'seed-relay', label: 'seed relay', type: 'peer', role: 'relay' },
    { id: 'edge-cache', label: 'edge cache', type: 'peer', role: 'cache' },
    { id: 'route-observer', label: 'route observer', type: 'peer', role: 'observer' },
    { id: 'provider-a', label: 'provider A', type: 'peer', role: 'provider' },
    { id: 'provider-b', label: 'provider B', type: 'peer', role: 'provider' },
    { id: 'mobile-peer', label: 'mobile peer', type: 'peer', role: 'mobile' },
    { id: 'quic-peer', label: 'quic peer', type: 'peer', role: 'direct' },
  ]

  const links = [
    { source: selfPubkey, target: 'seed-relay' },
    { source: selfPubkey, target: 'route-observer' },
    { source: selfPubkey, target: 'quic-peer' },
    { source: 'seed-relay', target: 'provider-a' },
    { source: 'seed-relay', target: 'provider-b' },
    { source: 'seed-relay', target: 'edge-cache' },
    { source: 'route-observer', target: 'mobile-peer' },
    { source: 'provider-a', target: 'edge-cache' },
    { source: 'provider-b', target: 'mobile-peer' },
    { source: 'edge-cache', target: 'quic-peer' },
  ]

  return { nodes, links }
}

function updateLayoutMetrics() {
  const root = document.documentElement
  const header = document.querySelector('.app-header')
  const nav = document.querySelector('.tab-nav')
  const bottomNavHeight = window.matchMedia('(max-width: 980px)').matches ? (nav?.offsetHeight ?? 56) : 0
  root.style.setProperty('--app-header-height', `${header?.offsetHeight ?? 56}px`)
  root.style.setProperty('--app-bottom-nav-height', `${bottomNavHeight}px`)
}

function renderStatus(status) {
  state.latestStatus = status
  $('#status-pubkey').textContent = shortKey(status.pubkey)
  $('#status-peers').textContent = `${status.peerCount} peer${status.peerCount === 1 ? '' : 's'}`
  $('#status-port').textContent = String(status.port)
  $('#status-data-dir').textContent = status.dataDir
  $('#status-peer-count').textContent = String(status.peerCount)
  $('#status-online').textContent = status.peerCount > 0 ? 'online' : 'idle'
  const dot = $('#brand-dot')
  dot.classList.toggle('online', true)
}

function renderPeers(peers) {
  state.latestPeers = peers
  if (peers.length > 0) {
    state.simulatedNetwork = false
  }
  const container = $('#peers')
  if (!peers.length) {
    container.innerHTML = state.simulatedNetwork
      ? '<div class="list-item"><strong>Simulated topology</strong><span class="meta">The graph is previewing a synthetic mesh while no live peers are connected.</span></div>'
      : '<div class="list-item"><strong>No connected peers</strong><span class="meta">Connect a peer to see the live transport list.</span></div>'
    renderGraph()
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

  renderGraph()
}

function summarizeEvent(raw) {
  try {
    const event = JSON.parse(raw)
    const parts = []
    if (typeof event.kind === 'number') parts.push(`kind=${event.kind}`)
    if (typeof event.pubkey === 'string') parts.push(`pubkey=${shortKey(event.pubkey)}`)
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

function renderRoute(route) {
  if (!route) {
    $('#output').innerHTML = '<p class="muted">No route found.</p>'
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

  $('#output').innerHTML = `
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
        ${items.length ? items.map((item) => `<pre class="key-text">${escapeHtml(summarizeEvent(item))}\n${escapeHtml(item)}</pre>`).join('') : '<p class="muted">None</p>'}
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
      <pre class="key-text">${escapeHtml(error instanceof Error ? error.message : String(error))}</pre>
    </div>
  `
}

function renderGraph() {
  const svgNode = $('#network-graph')
  const empty = $('#graph-empty')
  const simulateButton = $('#simulate-network')
  if (!svgNode || !d3) {
    empty.innerHTML = '<div class="graph-empty-card"><p>Graph engine unavailable.</p></div>'
    empty.classList.add('visible')
    return
  }

  const peers = state.latestPeers ?? []
  const selfPubkey = state.latestStatus?.pubkey ?? 'self'
  const width = svgNode.clientWidth || 800
  const height = svgNode.clientHeight || 420
  const useSimulation = peers.length === 0 && state.simulatedNetwork
  const simulated = useSimulation ? buildSimulatedTopology(selfPubkey) : null

  const nodes = useSimulation
    ? simulated.nodes
    : [
        { id: selfPubkey, label: shortKey(selfPubkey), type: 'self', fx: width / 2, fy: height / 2 },
        ...peers.map((peer, index) => ({
          id: peer.pubkey || peer.url || `peer-${index}`,
          label: shortKey(peer.pubkey || peer.url),
          type: 'peer',
          url: peer.url,
          latencyMs: peer.latencyMs,
        })),
      ]

  const links = useSimulation
    ? simulated.links
    : peers.map((peer, index) => ({
        source: selfPubkey,
        target: peer.pubkey || peer.url || `peer-${index}`,
      }))

  const hasPeers = peers.length > 0
  empty.classList.toggle('visible', !hasPeers && !useSimulation)
  empty.classList.toggle('simulated', useSimulation)
  if (simulateButton) {
    simulateButton.textContent = useSimulation ? 'Reset preview' : 'Simulate network'
    simulateButton.setAttribute('aria-pressed', String(useSimulation))
  }

  const svg = d3.select(svgNode)
  svg.attr('viewBox', `0 0 ${width} ${height}`)
  svg.selectAll('*').remove()

  const linksGroup = svg.append('g').attr('class', 'graph-links')
  const nodesGroup = svg.append('g').attr('class', 'graph-nodes')
  const labelsGroup = svg.append('g').attr('class', 'graph-labels')

  const link = linksGroup
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('class', 'graph-link')

  const node = nodesGroup
    .selectAll('circle')
    .data(nodes)
    .join('circle')
    .attr('class', (datum) => `graph-node ${datum.type === 'self' ? 'self' : 'peer'}`)
    .attr('r', (datum) => (datum.type === 'self' ? 10 : 8))
    .call(
      d3.drag()
        .on('start', (event, datum) => {
          if (!event.active) state.graph.simulation.alphaTarget(0.3).restart()
          datum.fx = datum.x
          datum.fy = datum.y
        })
        .on('drag', (event, datum) => {
          datum.fx = event.x
          datum.fy = event.y
        })
        .on('end', (event, datum) => {
          if (!event.active) state.graph.simulation.alphaTarget(0)
          if (datum.type !== 'self') {
            datum.fx = null
            datum.fy = null
          }
        }),
    )

  const label = labelsGroup
    .selectAll('text')
    .data(nodes)
    .join('text')
    .attr('class', (datum) => `graph-label ${datum.type === 'self' ? 'self' : 'peer'}${datum.role ? ` ${datum.role}` : ''}`)
    .text((datum) => datum.label)

  if (state.graph.simulation) {
    state.graph.simulation.stop()
  }

  state.graph.simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((datum) => datum.id).distance(110).strength(0.75))
    .force('charge', d3.forceManyBody().strength((datum) => (datum.type === 'self' ? -900 : -260)))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius((datum) => (datum.type === 'self' ? 20 : 14)).iterations(2))
    .on('tick', () => {
      node
        .attr('cx', (datum) => datum.fx ?? datum.x)
        .attr('cy', (datum) => datum.fy ?? datum.y)

      link
        .attr('x1', (datum) => datum.source.x)
        .attr('y1', (datum) => datum.source.y)
        .attr('x2', (datum) => datum.target.x)
        .attr('y2', (datum) => datum.target.y)

      label
        .attr('x', (datum) => (datum.fx ?? datum.x) + 14)
        .attr('y', (datum) => (datum.fy ?? datum.y) + 4)
    })

  state.graph.svg = svg
  state.graph.nodesGroup = nodesGroup
  state.graph.linksGroup = linksGroup
  state.graph.labelsGroup = labelsGroup
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
    renderError(err)
  }
}

function bindTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab))
  })
}

function bindTools() {
  $$('.segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.tool))
  })

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
}

function bindNetworkSimulation() {
  const button = $('#simulate-network')
  if (!button) {
    return
  }
  button.addEventListener('click', () => {
    state.simulatedNetwork = !state.simulatedNetwork
    if (state.activeTab === 'network') {
      renderGraph()
    } else {
      setActiveTab('network')
    }
  })
}

function bindResize() {
  const graphFrame = $('#network-graph')?.parentElement
  if (!graphFrame || !('ResizeObserver' in window)) {
    return
  }
  state.graph.resizeObserver = new ResizeObserver(() => {
    if (state.activeTab === 'network') {
      renderGraph()
    }
  })
  state.graph.resizeObserver.observe(graphFrame)
}

function bindKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (event.key === '1') setActiveTab('overview')
    if (event.key === '2') setActiveTab('network')
    if (event.key === '3') setActiveTab('tools')
  })
}

document.addEventListener('DOMContentLoaded', async () => {
  updateLayoutMetrics()
  bindTabs()
  bindTools()
  bindNetworkSimulation()
  bindResize()
  bindKeyboard()
  setActiveTool('publish')
  setActiveTab('overview')
  await refresh()
  setInterval(() => {
    refresh().catch(() => {})
  }, 5000)
  window.addEventListener('resize', updateLayoutMetrics)
  if ('ResizeObserver' in window) {
    const header = document.querySelector('.app-header')
    const nav = document.querySelector('.tab-nav')
    if (header && nav) {
      state.layoutObserver = new ResizeObserver(updateLayoutMetrics)
      state.layoutObserver.observe(header)
      state.layoutObserver.observe(nav)
    }
  }
})
