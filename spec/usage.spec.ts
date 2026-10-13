import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, onMeasure } from '../src/model.ts'
import { limitViews } from '../src/panel.ts'
import { lineParts } from '../src/scene.ts'
import { C, limitName, resetClock, untilTxt } from '../src/theme.ts'

const H = 3_600_000

test('usage: the account windows are kept and shown with time to reset', () => {
  const now = 1_000_000_000_000
  const s = onMeasure(emptyState(), { limits: [{ kind: 'five_hour', pct: 42.5, resetsAt: now + 2 * H + 13 * 60_000 }, { kind: 'seven_day', pct: 81, resetsAt: now + 4 * 24 * H + 6 * H }] })
  assert.deepEqual(limitViews(s, now), [
    { name: '5h', pct: 42.5, c: C.mint, reset: '2h 13m', at: resetClock(now + 2 * H + 13 * 60_000, now) },
    { name: 'week', pct: 81, c: C.pink, reset: '4d 6h', at: resetClock(now + 4 * 24 * H + 6 * H, now) },
  ])
  // a later measure without limits keeps them; one with an empty list clears them
  assert.equal(onMeasure(s, { costUsd: 1 }).session?.limits?.length, 2)
  assert.equal(onMeasure(s, { limits: [] }).session?.limits?.length, 0)
})

test('usage: names, countdowns and the band line', () => {
  assert.equal(limitName('five_hour'), '5h')
  assert.equal(limitName('seven_day'), 'week')
  assert.equal(limitName('spend_limit'), 'spend')
  assert.equal(untilTxt(9 * 60_000), '9m')
  assert.equal(untilTxt(-5), 'now')
  // local time: hours only within a day, the weekday beyond it
  const at = new Date(2026, 9, 17, 13, 5).getTime() // a Saturday
  assert.equal(resetClock(at, at - 2 * H), '13:05')
  assert.equal(resetClock(at, at - 3 * 24 * H), 'Sat 13:05')
  const s = onMeasure(emptyState(), { limits: [{ kind: 'five_hour', pct: 12 }] })
  assert.match(lineParts(s, 0).map(p => p.text).join(''), /5h 12%/)
  assert.doesNotMatch(lineParts(emptyState(), 0).map(p => p.text).join(''), /%/)
})
