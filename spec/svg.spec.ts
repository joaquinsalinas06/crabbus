import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canvas, halve, type Canvas } from '../src/canvas.ts'
import { drawAgent } from '../src/art.ts'
import { BUILTIN } from '../src/builtin.ts'
import { emptyState, onSpawn, onSend } from '../src/model.ts'
import { agentCard, miniCard, masterCard, compose, layout } from '../src/scene.ts'
import { barSvg, sparkSvg, toSvg } from '../src/svg.ts'

// Independent reader for the converter's deliberately small SVG subset.
const pixelsFromSvg = (source: string): Canvas => {
  const attrs = (tag: string): Record<string, string> => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]))
  const root = attrs(source.slice(0, source.indexOf('>')))
  const out = canvas(Number(root.width), Number(root.height))
  assert.equal(root.viewBox, `0 0 ${out.width} ${out.height}`)
  assert.equal(root['shape-rendering'], 'crispEdges')
  assert.equal(root.xmlns, 'http://www.w3.org/2000/svg')
  for (const match of source.matchAll(/<rect\b[^>]*\/>/g)) {
    const a = attrs(match[0])
    assert.match(a.fill!, /^#[0-9a-f]{6}$/)
    const [x, y, w, h] = [a.x, a.y, a.width, a.height].map(Number)
    for (const value of [x, y, w, h]) assert.ok(Number.isInteger(value))
    assert.ok(x! >= 0 && y! >= 0 && w! > 0 && h! > 0 && x! + w! <= out.width && y! + h! <= out.height)
    for (let row = y!; row < y! + h!; row++)
      for (let col = x!; col < x! + w!; col++) out.px[row * out.width + col] = Number.parseInt(a.fill!.slice(1), 16)
  }
  assert.equal(source.replace(/<svg\b[^>]*>|<rect\b[^>]*\/>|<\/svg>/g, ''), '')
  return out
}

const roundTrip = (c: Canvas, bg?: number): void => {
  const before = c.px.slice()
  const source = toSvg(c, bg)
  const decoded = pixelsFromSvg(source)
  assert.equal(decoded.width, c.width)
  assert.equal(decoded.height, c.height)
  assert.deepEqual(decoded.px, before.map(v => v === -1 && bg !== undefined ? bg : v))
  assert.deepEqual(c.px, before)
  assert.equal(toSvg(c, bg), source)
}

test('SVG: odd dimensions, transparent pixels, black and leading-zero colors round trip exactly', () => {
  const c = canvas(5, 3)
  c.px.set([-1, 0, 0x000001, 0xffffff, -1, 0x112233, 0x112233, 0x112233, -1, 0xff0000, -1, -1, -1, 0x00ff00, -1])
  roundTrip(c)
  roundTrip(c, 0x010203)
  roundTrip(c, 0)
  roundTrip(halve(c))
  roundTrip(canvas(1, 1))
  roundTrip(canvas(5, 3))
})

test('SVG: uniform rows merge horizontally and never merge through transparency', () => {
  const c = canvas(5, 2)
  c.px.set([0x112233, 0x112233, -1, 0x112233, 0x112233, 0x112233, 0x112233, 0x112233, 0x112233, 0x112233])
  const source = toSvg(c)
  assert.equal([...source.matchAll(/<rect /g)].length, 3)
  roundTrip(c)
})

test('SVG: every built-in costume and action preserves its pixels across frames and at half size', () => {
  for (const costume of Object.keys(BUILTIN.costumes))
    for (const action of Object.keys(BUILTIN.actions))
      for (const tick of [0, 1, 3, 8]) {
        const c = canvas(18, 14)
        drawAgent(c, 0, 0, costume, action, tick, BUILTIN)
        roundTrip(c)
        roundTrip(halve(c), 0x111111)
        assert.ok(toSvg(c).length < 131072)
      }
})

test('SVG: agent cards, miniatures, master and a scene with an envelope preserve pixels', () => {
  let s = onSpawn(emptyState(), { id: 'a', type: 'Explore', description: 'read source' }, 0, BUILTIN)
  s = onSend(s, 'a', 'review it', true, 1)
  const a = s.agents.a!
  const l = layout(s, 10, 100, 10)
  assert.equal(l.kind, 'stage')
  if (l.kind !== 'stage') return
  for (const c of [agentCard(s, a, 10, 1, true), miniCard(s, a, 10, 1, true), masterCard(s, 10, 1), compose(s, l, 10, 1, true)]) roundTrip(c)
})


test('graphical meters clamp percentages and keep unknown values as an empty track', () => {
  assert.equal(barSvg(undefined, 0xffffff, 0), barSvg(0, 0xffffff, 0))
  assert.equal(barSvg(NaN, 0xffffff, 0), barSvg(0, 0xffffff, 0))
  assert.equal(barSvg(-10, 0xffffff, 0), barSvg(0, 0xffffff, 0))
  assert.equal(barSvg(110, 0xffffff, 0), barSvg(100, 0xffffff, 0))
  assert.match(barSvg(25, 0xffffff, 0, 100), /<rect width="25" height="6"/)
  assert.match(barSvg(25, 0xffffff, 0, 200), /<rect width="50" height="6"/)
  assert.equal([...barSvg(undefined, 0xffffff, 0).matchAll(/<rect/g)].length, 1)
})

test('history plots handle missing, single, flat and varying samples without invalid coordinates', () => {
  for (const values of [[], [3], [2, 2, 2], [1, 3, 2], [NaN, 1, Infinity, 3]]) {
    const source = sparkSvg(values, 0x000001)
    assert.doesNotMatch(source, /NaN|Infinity/)
    assert.equal(sparkSvg(values, 0x000001), source)
  }
  assert.match(sparkSvg([3], 0), /<circle/)
  assert.doesNotMatch(sparkSvg([], 0), /<circle|<polyline/)
  assert.match(sparkSvg([2, 2, 2], 0), /points="2,12 50,12 98,12"/)
  assert.match(sparkSvg([1, 3, 2], 0), /points="2,22 50,2 98,12"/)
})
