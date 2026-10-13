import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CARD_H, CARD_W, canvas, cellsOf, drawAgent, drawMaster, get, poseFor, toBase64, toWords, type Costume, type Mood } from '../src/art.ts'
import { agentLabel, bar, compose, layout, lineParts, moodOf, stageWidth } from '../src/scene.ts'
import { emptyState, onComplete, onReceive, onSend, onSpawn, onStep, onToolEnd, onToolStart, type BusState } from '../src/model.ts'

const COSTUMES: Costume[] = ['fable', 'heavy', 'careful', 'medium', 'light', 'explore', 'other']
const MOODS: Mood[] = ['walk', 'reading', 'writing', 'testing', 'thinking', 'blocked', 'error', 'done', 'sleep']
const key = (c: ReturnType<typeof canvas>) => toBase64(new Uint8Array(c.px.buffer))
const card = (co: Costume, m: Mood, t: number) => { const c = canvas(CARD_W, CARD_H); drawAgent(c, 0, 0, co, m, t); return c }

test('art: every costume x mood stays inside its 18x14 card and is not blank', () => {
  for (const co of COSTUMES)
    for (const m of MOODS)
      for (const t of [0, 1, 2, 3]) {
        const big = canvas(CARD_W + 4, CARD_H + 4)
        drawAgent(big, 2, 2, co, m, t)
        let inside = 0
        for (let y = 0; y < big.height; y++)
          for (let x = 0; x < big.width; x++) {
            if (get(big, x, y) < 0) continue
            assert.ok(x >= 2 && x < 2 + CARD_W && y >= 2 && y < 2 + CARD_H, `${co}/${m}/${t} spills at ${x - 2},${y - 2}`)
            inside++
          }
        assert.ok(inside > 60, `${co}/${m} too empty`)
      }
})

test('art: costumes are visibly different from each other', () => {
  assert.equal(new Set(COSTUMES.map(c => key(card(c, 'walk', 1)))).size, COSTUMES.length)
})

test('art: every mood looks different (same costume, same tick)', () => {
  for (const co of COSTUMES) assert.equal(new Set(MOODS.map(m => key(card(co, m, 1)))).size, MOODS.length, co)
})

test('art: animated moods move between ticks; sleep only dozes', () => {
  for (const m of MOODS) {
    const frames = new Set([0, 1, 2, 3, 4, 5, 6, 7].map(t => key(card('medium', m, t))))
    assert.ok(frames.size >= 2, `${m} never moves`)
  }
  assert.equal(poseFor('walk', 0).legs !== poseFor('walk', 1).legs, true)
})

test('art: half-block encoding keeps exact colors, two pixels per cell', () => {
  const c = canvas(2, 4)
  c.px.set([0x112233, -1, 0x445566, 0x445566, -1, -1, -1, 0x778899])
  const w = toWords(c)
  assert.equal(w.columns, 2); assert.equal(w.rows, 2)
  assert.deepEqual([...w.words], [0x2580, 0x112233, 0x445566, 0x2584, 0x445566, 0x01000000, 0x20, 0x01000000, 0x01000000, 0x2584, 0x778899, 0x01000000])
  assert.equal(Buffer.from(cellsOf(card('fable', 'walk', 0)).cells, 'base64').length, CARD_W * (CARD_H / 2) * 12)
})

test('art: base64 matches Buffer for every remainder', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 255]) {
    const u = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255)
    assert.equal(toBase64(u), Buffer.from(u).toString('base64'))
  }
})

test('art: the master wears a crown and differs from every agent', () => {
  const m = canvas(CARD_W, CARD_H); drawMaster(m, 0, 0, true, 1)
  for (const co of COSTUMES) assert.notEqual(key(m), key(card(co, 'walk', 1)))
})

const crew = (n: number, now = 100000): BusState => {
  let s = emptyState()
  for (let i = 0; i < n; i++) s = onSpawn(s, { id: `a${i}`, type: 'general-purpose', description: `agent${i}` }, now - 1000)
  return s
}

test('scene: layout scales with width and height', () => {
  const s = crew(3)
  const now = 100000
  assert.deepEqual(layout(emptyState(), now, 200, 20), { kind: 'none' })
  assert.equal(layout(s, now, 30, 20).kind, 'line', 'narrow: text line')
  assert.equal(layout(s, now, 200, 7).kind, 'line', 'short: text line')
  for (const [cols, rows] of [[40, 12], [60, 12], [80, 12], [120, 12], [200, 12], [80, 9], [80, 8]] as const) {
    const l = layout(s, now, cols, rows)
    assert.equal(l.kind, 'stage', `${cols}x${rows}`)
    if (l.kind !== 'stage') continue
    assert.ok(stageWidth(l) <= cols, `${cols}: stage ${stageWidth(l)} wider than the band`)
    assert.ok(7 + l.labelRows <= rows, `${cols}x${rows}: too tall`)
    assert.equal(l.agents.length + l.hidden, 3)
  }
  const tight = layout(s, now, 40, 12)
  assert.ok(tight.kind === 'stage' && tight.hidden > 0, 'a narrow band shows +N')
  const wide = layout(s, now, 120, 12)
  assert.ok(wide.kind === 'stage' && wide.hidden === 0 && wide.labelRows === 3)
})

test('scene: moods come from recorded facts only', () => {
  const now = 100000
  let s = crew(1, now)
  assert.equal(moodOf(s.agents['a0']!, now), 'walk')
  s = onToolStart(s, 'a0', 'Read', { file_path: 'x' }, now)
  assert.equal(moodOf(s.agents['a0']!, now), 'reading')
  s = onToolEnd(s, 'a0', 'Read', { file_path: 'x' }, false, now)
  assert.equal(moodOf(s.agents['a0']!, now), 'thinking', 'between tools the model is generating')
  s = onToolStart(s, 'a0', 'Bash', { command: 'npm test' }, now)
  assert.equal(moodOf(s.agents['a0']!, now), 'testing')
  s = onStep(s, 'a0', { blocker: 'no key' }, now)
  assert.equal(moodOf(s.agents['a0']!, now), 'blocked')
  s = onComplete(s, 'a0', { reason: 'answer' }, now)
  assert.equal(moodOf(s.agents['a0']!, now + 1000), 'done')
  assert.equal(moodOf(s.agents['a0']!, now + 10000), 'sleep')
})

test('scene: an envelope flies until delivered, then rests until acknowledged', () => {
  const now = 100000
  let s = crew(2, now)
  const l = layout(s, now, 120, 12)
  assert.equal(l.kind, 'stage')
  if (l.kind !== 'stage') return
  const base = key(compose(s, l, now, 1))
  s = onSend(s, 'a1', 'change', true, now - 300)
  const flying = compose(s, l, now, 1)
  assert.notEqual(key(flying), base)
  s = onReceive(s, 'a1', now)
  const resting = compose(s, l, now, 1)
  assert.notEqual(key(resting), key(flying))
  s = onStep(s, 'a1', { ack: true }, now)
  assert.equal(key(compose(s, l, now + 5000, 1)), key(compose(crew(2, now), l, now + 5000, 1)), 'gone after the ack')
})

test('scene: labels and the line fallback carry name, state and stages', () => {
  const now = 100000
  let s = crew(1, now)
  s = onStep(s, 'a0', { plan: ['a', 'b', 'c', 'd'], done: 2 }, now)
  const lab = agentLabel(s.agents['a0']!, now, 3)
  assert.equal(lab.lines.length, 3)
  assert.match(lab.lines[1]!.text, /2\/4/)
  assert.ok(lab.lines.every(l => l.text.length <= CARD_W))
  assert.equal(bar(2, 4, 8), '▰▰▰▰▱▱▱▱')
  assert.match(lineParts(s, now).map(p => p.text).join(''), /agent0 .* 2\/4/)
})

test('pane: the list fits the room it is given (regression: an inline pane overflowed and scrolled the crabs off)', async () => {
  const { paneFit } = await import('../src/scene.ts')
  const cost = (n: number, f: ReturnType<typeof paneFit>, problems: boolean) => {
    const lines = (f.more > 0 ? 1 : 0) + (problems ? 1 : 0) + (f.hint ? 1 : 0) + (n === 0 ? 1 : 0)
    return (1 + f.crabs) * 7 + lines + (1 + f.crabs + lines - 1)
  }
  for (const rows of [7, 10, 15, 16, 23, 24, 31, 40, 80])
    for (const n of [0, 1, 3, 6])
      for (const problems of [false, true]) {
        const f = paneFit(n, rows, problems)
        if (f.textOnly) {
          assert.ok(rows < 12, `${n} agents in ${rows} rows fell back to text although sprites fit`)
          continue
        }
        assert.ok(cost(n, f, problems) <= rows, `${n} agents in ${rows} rows: ${JSON.stringify(f)} takes ${cost(n, f, problems)}`)
        assert.equal(f.crabs + f.more, n)
      }
  assert.deepEqual(paneFit(3, 5, false), { crabs: 0, more: 0, hint: false, textOnly: true })
  assert.equal(paneFit(3, 80, false).hint, true)
  assert.equal(paneFit(3, 31, false).crabs, 3, '3 agents fit in 31 rows without the hint')
  assert.equal(paneFit(3, 31, false).hint, false)
})

test('pane: agents that finished long ago leave the list for one line; t shows them again', async () => {
  const { paneList, namesThatFit, RECENT_MS } = await import('../src/scene.ts')
  const now = 10_000_000
  let s = emptyState()
  for (const id of ['old1', 'old2', 'recent', 'live']) s = onSpawn(s, { id, type: 'general-purpose', description: id }, now - RECENT_MS * 3)
  s = onComplete(s, 'old1', { reason: 'answer' }, now - RECENT_MS * 2)
  s = onComplete(s, 'old2', { reason: 'answer' }, now - RECENT_MS - 1)
  s = onComplete(s, 'recent', { reason: 'answer' }, now - 1000)
  const p = paneList(s, now, false)
  assert.deepEqual(p.shown.map(a => a.id), ['live', 'recent'])
  assert.equal(p.older, 2)
  assert.equal(paneList(s, now, true).shown.length, 4)
  // the "+N" line never wraps: names stop where the width ends
  assert.equal(namesThatFit(['5: backend testerx', '6: frontend reader', '7: writerxx', '8: tester'], 50, 5), 2)
  assert.equal(namesThatFit(['5: a', '6: b'], 60, 5), 2)
})
