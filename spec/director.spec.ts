import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN } from '../src/builtin.ts'
import { MASTER, MAX_PASSES, direct, emptyDirector, type Director } from '../src/director.ts'
import { emptyState, onComplete, onSpawn, onToolEnd, onToolStart, type BusState } from '../src/model.ts'

const T0 = 1_000_000
const crew = (n: number): BusState => {
  let s = emptyState()
  for (let i = 0; i < n; i++) s = onSpawn(s, { id: `a${i}`, type: 'general-purpose', description: `a${i}` }, T0)
  return s
}
const run = (d: Director, s: BusState, from: number, frames: number, now = T0): Director => {
  for (let f = from; f < from + frames; f++) d = direct(d, s, BUILTIN, now, f)
  return d
}

test('director: what already holds when an agent is first seen does not start a play (no party after a reload)', () => {
  let s = crew(1)
  s = onComplete(s, 'a0', { reason: 'answer' }, T0)
  const d = direct(emptyDirector(), s, BUILTIN, T0 + 100, 1)
  assert.deepEqual(d.plays, {})
})

test('director: finishing starts a celebration play (spin or football) once, which ends on its own', () => {
  let s = crew(1)
  let d = direct(emptyDirector(), s, BUILTIN, T0, 1)
  s = onComplete(s, 'a0', { reason: 'answer' }, T0 + 10)
  d = direct(d, s, BUILTIN, T0 + 20, 2)
  const p = d.plays['a0']
  assert.ok(p && (p.action === 'spin' || p.action.startsWith('football-')), JSON.stringify(d.plays))
  const ticks = BUILTIN.actions[p.action]?.play?.ticks as number
  d = run(d, s, 3, ticks + 2, T0 + 30)
  assert.equal(d.plays['a0']?.action === p.action && d.plays['a0']?.start === p.start, false, 'the play ended')
  assert.equal(d.plays['a0'], undefined, 'and does not restart while the condition just keeps holding')
})

test('director: tests passing starts the spin', () => {
  let s = crew(1)
  s = onToolStart(s, 'a0', 'Bash', { command: 'npm test' }, T0)
  let d = direct(emptyDirector(), s, BUILTIN, T0, 1)
  s = onToolEnd(s, 'a0', 'Bash', { command: 'npm test' }, false, T0 + 500)
  d = direct(d, s, BUILTIN, T0 + 600, 2)
  assert.equal(d.plays['a0']?.action, 'spin')
})

test('director: a kick passes the ball to the next crab, then on, and stops after MAX_PASSES', () => {
  const s = crew(3)
  let d = direct(emptyDirector(), s, BUILTIN, T0, 0)
  d = { ...d, plays: { a0: { action: 'football-a', start: 1, chain: 0, passed: false } } }
  const pass = BUILTIN.actions['football-a']?.play?.pass?.atTick as number
  d = run(d, s, 1, pass + 1)
  assert.match(d.plays['a1']?.action ?? '', /^football-receive-/, 'a0 kicked to a1')
  assert.equal(d.plays['a1']?.chain, 1)
  // let the ball travel on: a1 -> a2 -> master; then nobody new gets it
  const seen: string[] = []
  for (let f = pass + 2; f < pass + 2 + 200; f++) {
    d = direct(d, s, BUILTIN, T0, f)
    for (const [id, p] of Object.entries(d.plays)) if (p.start === f && p.action.startsWith('football-receive')) seen.push(id)
  }
  assert.deepEqual(seen, ['a2', MASTER], 'a2 and then the master received')
  assert.ok(seen.length + 1 <= MAX_PASSES)
})

test('director: alone on stage, the crab passes to the master', () => {
  const s = crew(1)
  let d = direct(emptyDirector(), s, BUILTIN, T0, 0)
  d = { ...d, plays: { a0: { action: 'football-a', start: 1, chain: 0, passed: false } } }
  d = run(d, s, 1, 30)
  assert.match(d.plays[MASTER]?.action ?? '', /^football-receive-/)
})

test('director: one ball at a time; a second crab finishing meanwhile spins instead', () => {
  let s = crew(3)
  let d = direct(emptyDirector(), s, BUILTIN, T0, 0)
  d = { ...d, plays: { a0: { action: 'football-a', start: 0, chain: 0, passed: false } } }
  for (let k = 0; k < 20; k++) {
    // a2 finishes at different moments while the ball is in play: it may only spin
    let s2 = onComplete(s, 'a2', { reason: 'answer' }, T0 + 10)
    let d2 = direct({ ...d, plays: { ...d.plays, a0: { ...d.plays['a0']!, start: k } } }, s, BUILTIN, T0, k + 1)
    d2 = direct(d2, s2, BUILTIN, T0 + 20, k + 2)
    const a2 = d2.plays['a2']
    if (a2 && !a2.action.startsWith('football-receive')) assert.equal(a2.action, 'spin', `frame ${k}: ${a2.action}`)
    void s2
  }
  void s
})

test('director: kicks vary: both feet, both directions and different juggles show up', () => {
  const groups = Object.values(BUILTIN.actions).filter(a => a.play?.group === 'football')
  assert.ok(groups.length >= 4)
  const lengths = new Set(groups.map(a => a.play?.ticks))
  assert.ok(lengths.size >= 2, 'different numbers of juggles')
  const feet = new Set(groups.flatMap(a => a.pose.flatMap(tr => (tr.kind === 'steps' ? tr.steps.map(p => p.kick).filter(Boolean) : []))))
  assert.deepEqual([...feet].sort(), ['left', 'right'])
})

test('director: the master plays by itself now and then, with no agent on stage', async () => {
  const { BUILTIN } = await import('../src/builtin.ts')
  const { MASTER_IDLE } = await import('../src/director.ts')
  let d = emptyDirector()
  const s = emptyState()
  const seen = new Set<string>()
  for (let f = 0; f < 6 * 120; f++) {
    d = direct(d, s, BUILTIN, 0, f)
    const p = d.plays['']
    if (p) seen.add(p.action)
  }
  assert.ok(seen.size >= 2, `the master played only ${[...seen].join(', ') || 'nothing'} in two minutes`)
  for (const a of seen) assert.ok(MASTER_IDLE.includes(a))
})
