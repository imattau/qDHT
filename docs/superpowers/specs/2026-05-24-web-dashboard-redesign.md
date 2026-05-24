# Web Dashboard Redesign

**Date:** 2026-05-24
**Status:** Approved

## Goal

Redesign the qDHT web dashboard to serve a less-technical audience. The current layout stacks 6 panels vertically and requires significant scrolling. The redesign introduces a tabbed single-page layout that fits each view within the viewport with no page-level scrolling.

## Layout: Tabbed SPA (Option A)

A fixed header bar anchors the page. Below it, a full-viewport tab content area renders one tab at a time. No page-level scroll — internal scroll only where needed (output panel, peers list).

### Header Bar (~56px)

- **Left:** "qDHT" wordmark in IBM Plex Mono bold + small accent-coloured dot indicating node running status
- **Centre:** Tab navigation pills — Overview · Network · Tools — active tab has accent underline/fill
- **Right:** Compact inline status — truncated pubkey (first 8 + last 4 chars), peer count badge

### Tab: Overview

Audience-facing showcase of what qDHT is and does. Fits above the fold.

- **Hero:** eyebrow "qDHT web node", one-line headline ("Decentralised discovery, routing, and content — from the browser."), one-line muted subtitle
- **Concept cards (3, horizontal row):** each has an icon, one-line title, and 2-sentence plain-language description. Topics: Propagation, Routing, Content. Uses existing `panel` glass style.
- **Stat strip:** 4 horizontal `status-chip` pills — Port, Data dir, Peers, Status

### Tab: Network

Full-bleed topology visualisation of the live peer graph.

- **Graph canvas:** occupies upper ~60% of tab area. Force-directed layout (D3 or Cytoscape). Nodes are accent-coloured circles labelled with shortened pubkeys. Edges are dim lines representing live connections. Empty state: "No peers connected" placeholder.
- **Peers list:** below graph, scrollable list using existing `list-item` style showing pubkey, URL, connected time, latency.

### Tab: Tools

Functional interface for publishing, searching, and fetching content.

- **Two-column layout:** forms left (~45%), output right (~55%)
- **Form switcher:** segmented control (Publish / Search / Fetch) at top of left column — shows one form at a time, no stacking
- **Output panel:** right column, internally scrollable, never affects page height

## Visual Style

Carries over unchanged from current implementation:
- Dark glass panels (`--bg: #071016`, backdrop-filter blur)
- Colour palette: `--accent: #69f0c7`, `--text: #edf9f5`, `--muted: #94a3ad`
- Typography: IBM Plex Sans + IBM Plex Mono
- Border radius, shadow, noise overlay texture

## Network Graph Library

Use D3 force simulation (`d3-force`) — already a common dependency, lightweight, no canvas abstraction needed. Nodes and edges rendered as SVG. Alternatively Cytoscape.js if a higher-level API is preferred.

## Responsive Behaviour

- **< 980px:** tabs stack to icon-only or a bottom tab bar; hero cards stack vertically; Tools becomes single-column with output below forms
- **< 640px:** header condenses; stat strip wraps to 2×2

## Files Affected

- `web/index.html` — restructured around header + tab panels
- `web/styles.css` — add tab, header, concept card, stat strip, segmented control styles; keep existing token/component styles
- `web/app.js` — add tab switching logic, D3 graph rendering, move peers render into Network tab

## Out of Scope

- Backend API changes
- Authentication
- Settings or configuration UI
