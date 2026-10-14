import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN, BODIES } from '../src/builtin.ts'
import { planBodyEdit } from '../src/body-edit.ts'
import { bodyCompatibility, checkPack, defaultBodyCompatibility, loadPack } from '../src/fit.ts'
import { bundle, compilePack, effectiveBodyId, renderAgent } from '../src/pack.ts'
import { bodyAnchorOffset, POSE0 } from '../src/rig.ts'
import { planRuleEdit } from '../src/rules-edit.ts'

const robot = () => JSON.parse(JSON.stringify(BODIES.find((b: any) => b.id === 'robot')))
const rules = (defaultBody: string) => ({ file: 'rules.json', json: { type: 'rules', defaultBody } })

test('bodies: both built-in species fit every costume and action', () => {
  assert.equal(checkPack(BUILTIN).problems.length, 0)
  const p = compilePack([rules('robot')], BUILTIN)
  assert.equal(checkPack(p).problems.length, 0)
  const pixels = (pack: typeof p) => {
    const out: unknown[] = []
    renderAgent((...px) => out.push(px), 0, 0, pack, 'other', 'walk', 1)
    return out
  }
  assert.notDeepEqual(pixels(p), pixels(BUILTIN))
})

test('bodies: explicit choice wins over global fallback; old designs keep inheriting', () => {
  const source = BUILTIN.costumes.other!.source as Record<string, unknown>
  const old = { ...source, id: 'old', body: { color: '#abcdef' } }
  const explicit = { ...source, id: 'explicit', body: { id: 'crab' } }
  const p = compilePack([rules('robot'), { file: 'crew.json', json: { type: 'bundle', items: [old, explicit] } }], BUILTIN)
  assert.equal(effectiveBodyId(p, 'old'), 'robot')
  assert.equal(effectiveBodyId(p, 'explicit'), 'crab')
  assert.equal(effectiveBodyId(BUILTIN, 'other'), 'crab')
  assert.equal(p.costumes.old!.bodyId, undefined)
  const rotated = planRuleEdit([{ file: 'rules.json', text: JSON.stringify({ type: 'rules', defaultBody: 'robot' }) }], { op: 'toggleActive', costume: 'other' }, p)
  assert.equal(rotated.ok && rotated.pack.defaultBody, 'robot')
})

test('bodies: reject malformed geometry, states, anchors and missing references', () => {
  for (const mutate of [
    (b: any) => b.layers[0].x = 0.5,
    (b: any) => b.layers[0].rows = ['X'],
    (b: any) => b.layers[0].when = { legs: 2 },
    (b: any) => b.anchors.card.motion = 'body',
    (b: any) => delete b.anchors.head,
    (b: any) => b.eyes.height = 1.5,
  ]) {
    const b = robot(); mutate(b)
    const p = compilePack([{ file: 'bad.json', json: b }], BUILTIN)
    assert.ok(p.problems.some(p => p.fatal), JSON.stringify(b))
    assert.equal(p.bodies.robot, BUILTIN.bodies.robot)
  }
  for (const id of ['missing', 'constructor', 'toString']) assert.ok(compilePack([rules(id)], BUILTIN).problems.some(p => p.fatal))
})

test('bodies: portable anchors move pieces from crab rest and follow their own arms', () => {
  const b = { ...BUILTIN.bodies.robot!, anchors: { ...BUILTIN.bodies.robot!.anchors,
    'claw.left': { x: 3, y: 8, motion: 'claw.left' as const } }, armLift: { left: -1, right: -3 } }
  assert.deepEqual(bodyAnchorOffset(b, 'claw.left', POSE0), { x: 1, y: -1 })
  assert.deepEqual(bodyAnchorOffset(b, 'claw.left', { ...POSE0, armL: 1, dx: 1, bob: 1, lift: 2 }), { x: 2, y: -3 })
  assert.deepEqual(bodyAnchorOffset(b, 'card', { ...POSE0, dx: 1, lift: 2 }), { x: 0, y: 0 })
})

test('bodies: fit rejects body and eye pixels outside the card with full context', () => {
  const b = robot(); b.eyes.points = [{ x: 5, y: 13 }]
  const p = loadPack([{ file: 'robot.json', json: b }, rules('robot')], BUILTIN)
  assert.ok(p.problems.some(p => /body spills/.test(p.msg) && /body "robot".*costume/.test(p.msg) && /tick/.test(p.msg)))
})

test('bodies: builtin edits create user overrides without mutating builtin or inputs', () => {
  const source = JSON.stringify(BUILTIN.costumes.other!.source)
  const input = [rules('crab')]
  const before = JSON.stringify(input)
  const edit = planBodyEdit(input, { op: 'setBody', costume: 'other', body: 'robot' }, BUILTIN)
  assert.equal(edit.ok, true)
  if (!edit.ok) return
  assert.equal(edit.file, 'body-other.crab.json')
  assert.equal(edit.pack.costumes.other!.origin, edit.file)
  assert.equal(edit.pack.costumes.other!.bodyId, 'robot')
  assert.equal(JSON.stringify(BUILTIN.costumes.other!.source), source)
  assert.equal(JSON.stringify(input), before)
  const inherited = planBodyEdit(edit.files, { op: 'setBody', costume: 'other' }, edit.pack)
  assert.equal(inherited.ok && inherited.pack.costumes.other!.bodyId, undefined)
})

test('bodies: user bundle edits preserve siblings and existing palette fields', () => {
  const other = BUILTIN.costumes.other!.source as Record<string, unknown>
  const sibling = { type: 'rules', labels: { walk: 'hello' } }
  const raw = { type: 'bundle', items: [{ ...other, body: { color: '#123456', eyes: '#010203' } }, sibling] }
  const files = [{ file: 'mine.json', json: raw }]
  const p = compilePack(files, BUILTIN)
  const edit = planBodyEdit(files, { op: 'setBody', costume: 'other', body: 'robot' }, p)
  assert.equal(edit.ok, true)
  if (!edit.ok) return
  const after = JSON.parse(edit.text)
  assert.deepEqual(after.items[1], sibling)
  assert.deepEqual(after.items[0].body, { id: 'robot', color: '#123456', eyes: '#010203' })
  assert.equal((raw.items[0] as any).body.id, undefined)
})

test('bodies: incompatible choices are cached and blocked before saving', () => {
  const b = robot(); b.anchors.head.x = 17
  const p = compilePack([{ file: 'bad-fit.json', json: b }], BUILTIN)
  const issues = bodyCompatibility(p, 'master', 'robot')
  assert.ok(issues.length > 0)
  assert.match(issues[0]!.msg, /body "robot", costume "master"/)
  assert.match(issues[0]!.msg, /tick/)
  assert.equal(bodyCompatibility(p, 'master', 'robot'), issues)
  assert.equal(planBodyEdit([{ file: 'bad-fit.json', json: b }], { op: 'setBody', costume: 'master', body: 'robot' }, p).ok, false)
  assert.ok(defaultBodyCompatibility(p, 'robot').length > 0)
  assert.equal(bodyCompatibility(BUILTIN, 'master', 'robot').length, 0)
})

test('bodies: export carries effective species and supports standalone body export', () => {
  const p = compilePack([rules('robot')], BUILTIN)
  const exported = bundle(p, ['other'])
  const imported = compilePack([{ file: 'shared.json', json: exported.json }], BUILTIN)
  assert.equal(effectiveBodyId(imported, 'other'), 'robot')
  const standalone = bundle(p, ['robot']).json as { items: any[] }
  assert.equal(standalone.items[0].type, 'body')
})
