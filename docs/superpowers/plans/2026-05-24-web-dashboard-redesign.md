# Web Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-scroll dashboard with a tabbed SPA (Overview · Network · Tools) that fits each view in the viewport with no page-level scrolling.

**Architecture:** Fixed header bar holds node status and tab navigation. Three tab panels replace all current sections — Overview (showcase + stat strip), Network (D3 force graph + peers list), Tools (segmented-control forms + output panel). Existing dark-glass styles, colour tokens, and IBM Plex fonts are preserved and extended, not replaced.

**Tech Stack:** Vanilla JS/HTML/CSS (no framework, no build step), D3 v7 loaded from CDN for force graph, IBM Plex fonts from Google Fonts (existing).

---

## File Map

| File | Change |
|------|--------|
| `web/index.html` | Full restructure — header bar + three `<section data-tab>` panels replacing all current sections |
| `web/styles.css` | Add: header, tab nav, concept cards, stat strip, segmented control, two-column tools layout, graph canvas. Keep all existing token/component styles. |
| `web/app.js` | Add: tab switcher, D3 graph renderer, graph update loop. Modify: `renderStatus` → populates stat strip; `renderPeers` → targets Network tab container. Move form handlers to Tools tab IDs. |

---

## Task 1: Restructure HTML shell

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1: Replace body content with header + tab shell**

Replace everything inside `<body>` with:

```html
<body>
  <div class="noise"></div>

  <header class="app-header">
    <div class="app-header-inner">
      <div class="brand">
        <span class="brand-name">qDHT</span>
        <span class="brand-dot" id="brand-dot"></span>
      </div>
      <nav class="tab-nav" role="tablist">
        <button class="tab-btn active" data-tab="overview" role="tab" aria-selected="true">Overview</button>
        <button class="tab-btn" data-tab="network" role="tab" aria-selected="false">Network</button>
        <button class="tab-btn" data-tab="tools" role="tab" aria-selected="false">Tools</button>
      </nav>
      <div class="header-status">
        <span class="header-pubkey key-text" id="status-pubkey">loading…</span>
        <span class="header-badge" id="status-peers">0 peers</span>
      </div>
    </div>
  </header>

  <main class="tab-content">

    <section class="tab-panel active" data-tab="overview">
      <!-- Task 3 fills this -->
    </section>

    <section class="tab-panel" data-tab="network">
      <!-- Task 7 fills this -->
    </section>

    <section class="tab-panel" data-tab="tools">
      <!-- Task 10 fills this -->
    </section>

  </main>
</body>
```

- [ ] **Step 2: Verify server starts and page loads without errors**

```bash
npm run web:start
```

Open `http://localhost:3000` — expect a blank page with no JS errors in console.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "refactor(web): restructure HTML shell with header and tab panels"
```

---

## Task 2: Header and tab nav CSS

**Files:**
- Modify: `web/styles.css`

- [ ] **Step 1: Add header bar styles at end of file**

```css
/* ── Header ── */
.app-header {
  position: fixed;
  top: 0;
  inset-inline: 0;
  z-index: 100;
  height: 56px;
  background: linear-gradient(180deg, rgba(11, 22, 30, 0.97), rgba(8, 15, 21, 0.95));
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(18px);
}

.app-header-inner {
  width: min(1240px, calc(100% - 2rem));
  margin: 0 auto;
  height: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1.5rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.brand-name {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.05em;
}

.brand-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted);
  transition: background 300ms ease;
}

.brand-dot.online {
  background: var(--accent);
  box-shadow: 0 0 6px rgba(105, 240, 199, 0.6);
}

.tab-nav {
  display: flex;
  justify-content: center;
  gap: 0.25rem;
}

.tab-btn {
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 0.9rem;
  font-weight: 500;
  padding: 0.4rem 0.85rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease;
  position: relative;
}

.tab-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
  transform: none;
}

.tab-btn.active {
  color: var(--text);
  background: rgba(105, 240, 199, 0.1);
  border: 1px solid rgba(105, 240, 199, 0.25);
}

.tab-btn:focus {
  border-color: rgba(105, 240, 199, 0.75);
  box-shadow: 0 0 0 4px rgba(105, 240, 199, 0.15);
}

.header-status {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  justify-content: flex-end;
  min-width: 0;
}

.header-pubkey {
  font-size: 0.75rem;
  color: var(--muted);
  max-width: 14ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-badge {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  white-space: nowrap;
}

/* ── Tab panels ── */
.tab-content {
  padding-top: 56px;
  height: 100vh;
  overflow: hidden;
}

.tab-panel {
  display: none;
  height: 100%;
}

.tab-panel.active {
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 2: Verify header renders and tabs are visible**

Reload `http://localhost:3000` — expect: fixed header bar with "qDHT", three tab buttons, no console errors.

- [ ] **Step 3: Commit**

```bash
git add web/styles.css
git commit -m "feat(web): add header bar and tab nav styles"
```

---

## Task 3: Tab switching JS

**Files:**
- Modify: `web/app.js`

- [ ] **Step 1: Add tab switching at top of file after the `state` declaration**

```js
function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn')
  const panels = document.querySelectorAll('.tab-panel')

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab
      buttons.forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === target)
        b.setAttribute('aria-selected', String(b.dataset.tab === target))
      })
      panels.forEach((p) => {
        p.classList.toggle('active', p.dataset.tab === target)
      })
    })
  })
}
```

- [ ] **Step 2: Call `initTabs()` inside the existing `DOMContentLoaded` handler**

Find the existing event listener at the bottom of `app.js`:

```js
document.addEventListener('DOMContentLoaded', () => {
```

Add `initTabs()` as the first line inside it.

- [ ] **Step 3: Verify tab switching works**

Reload and click each tab button — each panel should show/hide, active button should highlight.

- [ ] **Step 4: Commit**

```bash
git add web/app.js
git commit -m "feat(web): add tab switching logic"
```

---

## Task 4: Overview tab HTML

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1: Fill the overview tab panel**

Replace `<!-- Task 3 fills this -->` with:

```html
<div class="overview-inner shell">
  <div class="overview-hero">
    <div class="eyebrow">qDHT web node</div>
    <h1 class="overview-headline">Decentralised discovery, routing, and content — from the browser.</h1>
    <p class="lede">A Nostr-compatible layer where signed announcements propagate across local peer graphs, enabling global retrieval without global routing tables.</p>
  </div>

  <div class="concept-row">
    <article class="concept-card panel">
      <div class="concept-icon">⟳</div>
      <h3>Propagation</h3>
      <p>Content announcements spread across overlapping local peer graphs using quantum-walk probability scoring, so every node learns about nearby content without central coordination.</p>
    </article>
    <article class="concept-card panel">
      <div class="concept-icon">⇢</div>
      <h3>Routing</h3>
      <p>Each node maintains neighbour-state per key — a live map of which peers most likely lead to a replica. Queries route themselves by following reputation and probability.</p>
    </article>
    <article class="concept-card panel">
      <div class="concept-icon">◫</div>
      <h3>Content</h3>
      <p>Large files are fetched piece-by-piece from nearby replicas and verified by hash before reassembly. Reputation adjusts dynamically based on delivery quality.</p>
    </article>
  </div>

  <div class="stat-strip" id="stat-strip">
    <div class="stat-chip"><span>Port</span><strong id="stat-port">—</strong></div>
    <div class="stat-chip"><span>Data dir</span><strong id="stat-datadir" class="mono">—</strong></div>
    <div class="stat-chip"><span>Peers</span><strong id="stat-peercount">—</strong></div>
    <div class="stat-chip"><span>Status</span><strong id="stat-status">starting…</strong></div>
  </div>
</div>
```

- [ ] **Step 2: Verify Overview tab shows placeholder content**

Reload, click Overview — hero, three cards, stat strip should be visible.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(web): add overview tab HTML"
```

---

## Task 5: Overview tab CSS

**Files:**
- Modify: `web/styles.css`

- [ ] **Step 1: Add overview layout styles**

```css
/* ── Overview tab ── */
.overview-inner {
  padding-top: 2.5rem;
  padding-bottom: 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  overflow-y: auto;
  height: 100%;
}

.overview-hero {
  max-width: 72ch;
}

.overview-headline {
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: clamp(1.5rem, 3vw, 2.4rem);
  line-height: 1.1;
  margin: 0.5rem 0 0;
}

.concept-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.concept-card {
  padding: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.concept-card h3 {
  font-size: 1rem;
  font-weight: 700;
  margin: 0;
  line-height: 1.2;
}

.concept-card p {
  color: var(--muted);
  font-size: 0.92rem;
  margin: 0;
  line-height: 1.55;
}

.concept-icon {
  font-size: 1.4rem;
  color: var(--accent);
  line-height: 1;
  margin-bottom: 0.25rem;
}

.stat-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.stat-chip {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.02);
  padding: 0.65rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 130px;
}

.stat-chip span {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted);
  font-weight: 600;
}

.stat-chip strong {
  font-size: 0.94rem;
}
```

- [ ] **Step 2: Verify concept cards render in a row**

Reload Overview tab — three equal-width cards, stat strip below.

- [ ] **Step 3: Commit**

```bash
git add web/styles.css
git commit -m "feat(web): add overview tab styles"
```

---

## Task 6: Wire overview stat strip to live data

**Files:**
- Modify: `web/app.js`

- [ ] **Step 1: Update `renderStatus` to populate stat strip and header**

Find the existing `renderStatus` function and replace it with:

```js
function renderStatus(status) {
  const pubkeyEl = document.getElementById('status-pubkey')
  if (pubkeyEl) {
    const pk = status.pubkey ?? ''
    pubkeyEl.textContent = pk ? `${pk.slice(0, 8)}…${pk.slice(-4)}` : 'unknown'
  }

  const peersEl = document.getElementById('status-peers')
  if (peersEl) peersEl.textContent = `${status.peerCount} peer${status.peerCount === 1 ? '' : 's'}`

  const dot = document.getElementById('brand-dot')
  if (dot) dot.classList.add('online')

  const port = document.getElementById('stat-port')
  if (port) port.textContent = String(status.port ?? '—')

  const datadir = document.getElementById('stat-datadir')
  if (datadir) datadir.textContent = status.dataDir ?? '—'

  const peercount = document.getElementById('stat-peercount')
  if (peercount) peercount.textContent = String(status.peerCount ?? 0)

  const statStatus = document.getElementById('stat-status')
  if (statStatus) statStatus.textContent = 'running'
}
```

- [ ] **Step 2: Verify stat strip populates on load**

With `npm run web:start` running, reload Overview tab — Port, Data dir, Peers, Status should show live values.

- [ ] **Step 3: Commit**

```bash
git add web/app.js
git commit -m "feat(web): wire stat strip and header status to live node data"
```

---

## Task 7: Network tab HTML

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1: Fill the network tab panel**

Replace `<!-- Task 7 fills this -->` with:

```html
<div class="network-layout shell">
  <div class="graph-panel panel">
    <div class="eyebrow">Live topology</div>
    <div id="graph-canvas" class="graph-canvas">
      <p class="muted graph-empty">No peers connected. Connect a peer to visualise the network.</p>
    </div>
  </div>
  <div class="peers-panel panel">
    <div class="eyebrow">Connected peers</div>
    <div id="peers" class="list"></div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add web/index.html
git commit -m "feat(web): add network tab HTML"
```

---

## Task 8: Network tab CSS

**Files:**
- Modify: `web/styles.css`

- [ ] **Step 1: Add network layout styles**

```css
/* ── Network tab ── */
.network-layout {
  padding-top: 1.5rem;
  padding-bottom: 1.5rem;
  display: grid;
  grid-template-rows: 1fr auto;
  gap: 1rem;
  height: 100%;
  overflow: hidden;
}

.graph-panel {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
}

.graph-canvas {
  flex: 1;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--line);
  position: relative;
  overflow: hidden;
  min-height: 0;
}

.graph-canvas svg {
  width: 100%;
  height: 100%;
  display: block;
}

.graph-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 0.9rem;
}

.peers-panel {
  padding: 1.25rem;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
```

- [ ] **Step 2: Verify network tab layout renders**

Reload, switch to Network tab — graph canvas area occupies most of the viewport, peers panel below.

- [ ] **Step 3: Commit**

```bash
git add web/styles.css
git commit -m "feat(web): add network tab styles"
```

---

## Task 9: D3 force graph

**Files:**
- Modify: `web/index.html` (add D3 CDN script)
- Modify: `web/app.js` (add graph renderer)

- [ ] **Step 1: Add D3 CDN script to `<head>` in `index.html`**

Add before `<script type="module" src="/app.js"></script>`:

```html
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
```

- [ ] **Step 2: Add graph state and renderer to `app.js`**

Add after the `state` declaration at the top:

```js
const graphState = {
  simulation: null,
  svg: null,
}

function initGraph() {
  const canvas = document.getElementById('graph-canvas')
  if (!canvas) return

  const svg = d3.select(canvas)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')

  svg.append('g').attr('class', 'edges')
  svg.append('g').attr('class', 'nodes')

  graphState.svg = svg
  graphState.simulation = d3.forceSimulation([])
    .force('charge', d3.forceManyBody().strength(-120))
    .force('center', d3.forceCenter())
    .force('link', d3.forceLink([]).id((d) => d.id).distance(90))
    .force('collision', d3.forceCollide(22))

  graphState.simulation.on('tick', () => {
    if (!graphState.svg) return
    graphState.svg.select('.edges').selectAll('line')
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y)
    graphState.svg.select('.nodes').selectAll('g')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
  })
}

function updateGraph(peers) {
  const canvas = document.getElementById('graph-canvas')
  if (!canvas || !graphState.svg) return

  const rect = canvas.getBoundingClientRect()
  graphState.simulation.force('center', d3.forceCenter(rect.width / 2, rect.height / 2))

  const empty = canvas.querySelector('.graph-empty')
  if (empty) empty.style.display = peers.length === 0 ? 'flex' : 'none'

  const selfId = document.getElementById('status-pubkey')?.dataset.fullPubkey ?? 'self'
  const nodes = [{ id: selfId, self: true }, ...peers.map((p) => ({ id: p.pubkey, self: false }))]
  const links = peers.map((p) => ({ source: selfId, target: p.pubkey }))

  const simulation = graphState.simulation
  simulation.nodes(nodes)
  simulation.force('link').links(links)

  const svg = graphState.svg

  const edgeSel = svg.select('.edges').selectAll('line').data(links)
  edgeSel.enter().append('line')
    .attr('stroke', 'rgba(186,238,226,0.18)')
    .attr('stroke-width', 1.5)
  edgeSel.exit().remove()

  const nodeSel = svg.select('.nodes').selectAll('g').data(nodes, (d) => d.id)
  const nodeEnter = nodeSel.enter().append('g').style('cursor', 'default')
  nodeEnter.append('circle')
    .attr('r', (d) => d.self ? 10 : 7)
    .attr('fill', (d) => d.self ? 'rgba(105,240,199,0.8)' : 'rgba(105,240,199,0.35)')
    .attr('stroke', 'rgba(105,240,199,0.5)')
    .attr('stroke-width', 1.5)
  nodeEnter.append('text')
    .attr('dy', 20)
    .attr('text-anchor', 'middle')
    .attr('fill', 'rgba(148,163,173,0.8)')
    .attr('font-size', '9px')
    .attr('font-family', "'IBM Plex Mono', monospace")
    .text((d) => d.self ? 'self' : d.id.slice(0, 8))
  nodeSel.exit().remove()

  simulation.alpha(0.3).restart()
}
```

- [ ] **Step 3: Call `initGraph()` inside `DOMContentLoaded`**

Add `initGraph()` after `initTabs()` in the `DOMContentLoaded` handler.

- [ ] **Step 4: Update `renderPeers` to also call `updateGraph`**

Find the existing `renderPeers` function. Add `updateGraph(peers)` as the last line before the closing `}`.

- [ ] **Step 5: Store full pubkey on the element for graph self-node**

In `renderStatus`, after setting `pubkeyEl.textContent`, add:

```js
pubkeyEl.dataset.fullPubkey = status.pubkey ?? ''
```

- [ ] **Step 6: Verify graph renders when peers are present**

With peers connected, switch to Network tab — nodes and edges should appear and animate into position. With no peers, "No peers connected" placeholder should show.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/app.js
git commit -m "feat(web): add D3 force graph to network tab"
```

---

## Task 10: Tools tab HTML

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1: Fill the tools tab panel**

Replace `<!-- Task 10 fills this -->` with:

```html
<div class="tools-layout shell">
  <div class="tools-forms panel">
    <div class="seg-control" role="tablist">
      <button class="seg-btn active" data-form="publish" role="tab" aria-selected="true">Publish</button>
      <button class="seg-btn" data-form="search" role="tab" aria-selected="false">Search</button>
      <button class="seg-btn" data-form="fetch" role="tab" aria-selected="false">Fetch</button>
    </div>

    <form id="put-form" class="stack tool-form active" data-form="publish">
      <label>
        <span>File</span>
        <input id="put-file" type="file" required />
      </label>
      <div class="two-up">
        <label>
          <span>Name</span>
          <input id="put-name" type="text" placeholder="guide.pdf" />
        </label>
        <label>
          <span>TTL seconds</span>
          <input id="put-ttl" type="number" min="1" step="1" value="86400" />
        </label>
      </div>
      <label>
        <span>MIME type</span>
        <input id="put-mime" type="text" placeholder="application/pdf" />
      </label>
      <button type="submit">Publish</button>
    </form>

    <form id="search-form" class="stack tool-form" data-form="search">
      <label>
        <span>Query</span>
        <input id="search-query" type="text" placeholder="npub..., hash, file name, tag" required />
      </label>
      <div class="two-up">
        <label>
          <span>Type</span>
          <select id="search-type">
            <option value="identity">Identity</option>
            <option value="content" selected>Content</option>
            <option value="route">Route</option>
            <option value="replica">Replica</option>
          </select>
        </label>
        <label>
          <span>Limit</span>
          <input id="search-limit" type="number" min="1" step="1" value="25" />
        </label>
      </div>
      <button type="submit">Search</button>
    </form>

    <form id="fetch-form" class="stack tool-form" data-form="fetch">
      <label>
        <span>qkey</span>
        <input id="fetch-key" type="text" placeholder="64 hex chars" required />
      </label>
      <button type="submit">Fetch</button>
    </form>
  </div>

  <div class="tools-output panel">
    <div class="eyebrow">Output</div>
    <div id="output" class="output-body">
      <p class="muted">Run a search, publish a file, or fetch a key to populate this panel.</p>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add web/index.html
git commit -m "feat(web): add tools tab HTML with segmented control"
```

---

## Task 11: Tools tab CSS

**Files:**
- Modify: `web/styles.css`

- [ ] **Step 1: Add tools layout and segmented control styles**

```css
/* ── Tools tab ── */
.tools-layout {
  padding-top: 1.5rem;
  padding-bottom: 1.5rem;
  display: grid;
  grid-template-columns: 45fr 55fr;
  gap: 1rem;
  height: 100%;
  overflow: hidden;
}

.tools-forms {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  overflow-y: auto;
}

.tools-output {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow: hidden;
}

.tools-output .output-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.seg-control {
  display: flex;
  gap: 0.25rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 0.25rem;
}

.seg-btn {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.5rem 0.5rem;
  border-radius: calc(var(--radius-md) - 3px);
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease;
}

.seg-btn:hover {
  color: var(--text);
  transform: none;
}

.seg-btn.active {
  background: rgba(105, 240, 199, 0.12);
  border: 1px solid rgba(105, 240, 199, 0.25);
  color: var(--text);
}

.tool-form {
  display: none;
}

.tool-form.active {
  display: grid;
}
```

- [ ] **Step 2: Verify two-column layout renders**

Reload, switch to Tools tab — forms panel on left, output on right, segmented control at top of forms.

- [ ] **Step 3: Commit**

```bash
git add web/styles.css
git commit -m "feat(web): add tools tab styles and segmented control"
```

---

## Task 12: Tools tab JS — segmented control + form wiring

**Files:**
- Modify: `web/app.js`

- [ ] **Step 1: Add form switcher initialiser**

Add this function:

```js
function initFormSwitcher() {
  const buttons = document.querySelectorAll('.seg-btn')
  const forms = document.querySelectorAll('.tool-form')

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.form
      buttons.forEach((b) => {
        b.classList.toggle('active', b.dataset.form === target)
        b.setAttribute('aria-selected', String(b.dataset.form === target))
      })
      forms.forEach((f) => {
        f.classList.toggle('active', f.dataset.form === target)
      })
    })
  })
}
```

- [ ] **Step 2: Call `initFormSwitcher()` inside `DOMContentLoaded`**

Add after `initGraph()`.

- [ ] **Step 3: Verify segmented control switches forms**

Click each segment button — only that form should be visible. Publish form active by default.

- [ ] **Step 4: Verify all existing form handlers still work**

Submit the Publish, Search, and Fetch forms (with test data) — output should populate in the right panel. The existing `put-form`, `search-form`, `fetch-form` IDs are unchanged so handlers should wire automatically.

- [ ] **Step 5: Commit**

```bash
git add web/app.js
git commit -m "feat(web): add segmented control switcher for tools tab"
```

---

## Task 13: Responsive CSS

**Files:**
- Modify: `web/styles.css`

- [ ] **Step 1: Replace or extend existing `@media` blocks**

Find the existing `@media (max-width: 980px)` block and replace with:

```css
@media (max-width: 980px) {
  .concept-row {
    grid-template-columns: 1fr;
  }

  .tools-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    overflow-y: auto;
  }

  .tools-forms,
  .tools-output {
    overflow: visible;
  }

  .tools-output .output-body {
    overflow: visible;
    min-height: 12rem;
  }

  .network-layout {
    overflow-y: auto;
  }

  .graph-panel {
    min-height: 50vh;
  }

  .peers-panel {
    max-height: none;
  }
}

@media (max-width: 640px) {
  .app-header-inner {
    grid-template-columns: auto 1fr;
  }

  .header-status {
    display: none;
  }

  .tab-nav {
    justify-content: flex-end;
  }

  .two-up,
  .stat-strip {
    grid-template-columns: 1fr;
  }

  .stat-strip {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }
}
```

- [ ] **Step 2: Verify responsive layout at 768px**

Use browser devtools to resize to 768px — concept cards should stack, tools should be single-column.

- [ ] **Step 3: Verify responsive layout at 375px**

Resize to 375px — header should condense, stat strip should be 2×2.

- [ ] **Step 4: Commit**

```bash
git add web/styles.css
git commit -m "feat(web): add responsive styles for tabbed layout"
```

---

## Task 14: Remove stale CSS

**Files:**
- Modify: `web/styles.css`

- [ ] **Step 1: Redefine `.shell` as a pure width utility**

Find the existing `.shell` block and replace it with:

```css
.shell {
  width: min(1240px, calc(100% - 2rem));
  margin: 0 auto;
}
```

- [ ] **Step 2: Remove styles that are no longer used**

Remove the following blocks from `styles.css` (they were for the old layout):

- `.shell` block (now `.overview-inner` uses `shell` as a utility width class — keep the width rule but remove padding/margin that conflicts)
- `.hero`, `.hero::after`, `.hero-grid` blocks
- `.grid`, `.grid.wide` blocks
- `.card` block (cards now use `.panel` directly with padding inline)
- `.status-stack`, `.status-chip` blocks (replaced by `.stat-strip`, `.stat-chip`)
- The old `@media` blocks (replaced in Task 13)

Keep: all token definitions, `.panel`, `.noise`, `.eyebrow`, `h1`/`h2`, `.lede`, `.stack`, `label`, `input`/`select`/`button`, `.two-up`, `.stats`, `.list`, `.list-item`, `.output-body`, `.output-block`, `.output-grid`, `.route-card`, `.route-line`, `.tag`, `.preview`, `.download-link`, `.mono`, `.key-text`, `.muted`.

- [ ] **Step 2: Verify no visual regressions**

Check all three tabs look correct. Check output panel renders search results correctly by running a search.

- [ ] **Step 3: Commit**

```bash
git add web/styles.css
git commit -m "refactor(web): remove stale CSS from old layout"
```
