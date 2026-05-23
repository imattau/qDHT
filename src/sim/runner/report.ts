import { type MetricsCollector } from './metrics.js'

export interface SimReport {
  scenario: string
  nodes: number
  ticks: number
  coverage: Record<string, number>
  totalAnnouncementBandwidth: number
  totalContentBandwidth: number
  totalSourceBandwidth: number
  avgReplicaCount: number
}

export function buildReport(
  scenario: string,
  nodes: number,
  ticks: number,
  metrics: MetricsCollector,
  keys: string[],
): SimReport {
  const snapshots = metrics.allTicks()
  const totalAnnouncementBandwidth = snapshots.reduce((sum, snapshot) => sum + snapshot.announcementBandwidth, 0)
  const totalContentBandwidth = snapshots.reduce((sum, snapshot) => sum + snapshot.contentBandwidth, 0)
  const totalSourceBandwidth = snapshots.reduce((sum, snapshot) => sum + snapshot.sourceBandwidth, 0)
  const avgReplicaCount = snapshots.length > 0
    ? snapshots.reduce((sum, snapshot) => sum + snapshot.replicaCount, 0) / snapshots.length
    : 0

  return {
    scenario,
    nodes,
    ticks,
    coverage: Object.fromEntries(keys.map((key) => [key, metrics.coverage(key)])),
    totalAnnouncementBandwidth,
    totalContentBandwidth,
    totalSourceBandwidth,
    avgReplicaCount,
  }
}

export function printReport(report: SimReport, comparison?: SimReport): void {
  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`

  console.log(`\n=== ${report.scenario} ===`)
  if (comparison) {
    console.log(`${'metric'.padEnd(30)} ${'qDHT'.padEnd(12)} ${comparison.scenario}`)
    console.log('-'.repeat(56))
    for (const [key, value] of Object.entries(report.coverage)) {
      const comparisonValue = comparison.coverage[key] ?? 0
      console.log(`coverage[${key}]`.padEnd(30) + formatPercent(value).padEnd(12) + formatPercent(comparisonValue))
    }
    console.log(`announcementBandwidth`.padEnd(30) + String(report.totalAnnouncementBandwidth).padEnd(12) + comparison.totalAnnouncementBandwidth)
    console.log(`contentBandwidth`.padEnd(30) + String(report.totalContentBandwidth).padEnd(12) + comparison.totalContentBandwidth)
    console.log(`avgReplicaCount`.padEnd(30) + report.avgReplicaCount.toFixed(1).padEnd(12) + comparison.avgReplicaCount.toFixed(1))
  } else {
    for (const [key, value] of Object.entries(report.coverage)) {
      console.log(`  coverage[${key}]: ${formatPercent(value)}`)
    }
    console.log(`  announcementBandwidth: ${report.totalAnnouncementBandwidth}`)
    console.log(`  contentBandwidth: ${report.totalContentBandwidth}`)
    console.log(`  avgReplicaCount: ${report.avgReplicaCount.toFixed(1)}`)
  }
}
