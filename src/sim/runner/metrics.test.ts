import { describe, expect, it } from 'vitest'
import { ChurnSchedule } from './churn.js'
import { MetricsCollector } from './metrics.js'

describe('MetricsCollector', () => {
  it('accumulates per-tick bandwidth', () => {
    const metrics = new MetricsCollector(10)
    metrics.startTick(1)
    metrics.recordAnnouncementSent(1)
    metrics.recordAnnouncementSent(1)
    metrics.recordContentBytes(1, 1024)
    metrics.endTick(1)

    const snapshot = metrics.tickSnapshot(1)
    expect(snapshot!.announcementBandwidth).toBe(2)
    expect(snapshot!.contentBandwidth).toBe(1024)
  })

  it('reports coverage as fraction of interested nodes reached', () => {
    const metrics = new MetricsCollector(10)
    metrics.setInterestedNodes('key1', new Set(['n1', 'n2', 'n3']))
    metrics.recordDelivered('key1', 'n1')
    metrics.recordDelivered('key1', 'n2')
    expect(metrics.coverage('key1')).toBeCloseTo(2 / 3)
  })
})

describe('ChurnSchedule', () => {
  it('returns offline nodes for a given tick', () => {
    const schedule = new ChurnSchedule()
    schedule.schedule('n1', { offlineAt: 5, onlineAt: 10 })
    schedule.schedule('n2', { offlineAt: 3, onlineAt: 8 })

    expect(schedule.goingOffline(5)).toContain('n1')
    expect(schedule.goingOffline(3)).toContain('n2')
    expect(schedule.goingOnline(10)).toContain('n1')
    expect(schedule.goingOnline(8)).toContain('n2')
  })
})
