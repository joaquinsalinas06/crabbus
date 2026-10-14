import { SPANISH_USER_DESIGNS } from './fixtures/spanish-designs.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN, BODIES } from '../src/builtin.ts'
import { planBodyEdit } from '../src/body-edit.ts'
import { bodyCompatibility, checkPack, loadPack } from '../src/fit.ts'
import { bundle, compilePack, effectiveBodyId, planOf, renderAgent } from '../src/pack.ts'
import { anchorShift, bodyAnchorOffset, POSE0 } from '../src/rig.ts'
import { planRuleEdit } from '../src/rules-edit.ts'

const robot = () => JSON.parse(JSON.stringify(BODIES.find((b: any) => b.id === 'robot')))
// a copy of a built-in costume that names its body: each costume is one creature, there is no crew-wide default
const on = (body: string, id = 'other') => ({ file: `${id}-${body}.json`, json: { ...(BUILTIN.costumes[id]!.source as object), body: { id: body } } })
const capybaraSkin = () => ({ file: 'capybara-scarf.json', json: { type: 'bundle', items: [
  { type: 'piece', id: 'capybara-scarf', name: 'wool scarf', body: 'capybara', slot: 'neck', anchor: 'body',
    layers: [{ pos: [7, 5], drawings: { a: ['rr...', 'cc...', 'rrrr.', '..rr.', '..c..', '..r..'] }, palette: { r: '#c0392b', c: '#efe2c2' } }] },
  { type: 'costume', id: 'capybara-scarf', name: 'capybara with scarf', color: '#cf7f45', body: { id: 'capybara' }, pieces: ['capybara-scarf'] },
] } })

test('bodies: both built-in species fit every costume and action', () => {
  assert.equal(checkPack(BUILTIN).problems.length, 0)
  const p = compilePack([on('robot')], BUILTIN)
  assert.equal(checkPack(p).problems.length, 0)
  const pixels = (pack: typeof p) => {
    const out: unknown[] = []
    renderAgent((...px) => out.push(px), 0, 0, pack, 'other', 'walk', 1)
    return out
  }
  assert.notDeepEqual(pixels(p), pixels(BUILTIN))
})

test('bodies: each costume names its own body; one without an id is a crab; defaultBody is no longer read', () => {
  const source = BUILTIN.costumes.other!.source as Record<string, unknown>
  const old = { ...source, id: 'old', body: { color: '#abcdef' } }
  const robo = { ...source, id: 'robo', body: { id: 'robot' } }
  const p = compilePack([{ file: 'rules.json', json: { type: 'rules', defaultBody: 'robot' } }, { file: 'crew.json', json: { type: 'bundle', items: [old, robo] } }], BUILTIN)
  assert.equal(effectiveBodyId(p, 'old'), 'crab')
  assert.equal(effectiveBodyId(p, 'robo'), 'robot')
  assert.equal(effectiveBodyId(BUILTIN, 'other'), 'crab')
  const warning = p.problems.find(x => /defaultBody/.test(x.msg))
  assert.ok(warning && !warning.fatal)
  assert.equal('defaultBody' in p, false)
})

test('bodies: crabs, robots and capybaras live side by side in one crew', () => {
  const p = loadPack([capybaraSkin(), on('robot', 'heavy')], BUILTIN)
  assert.deepEqual(p.problems.filter(x => x.fatal), [])
  assert.equal(effectiveBodyId(p, 'capybara-scarf'), 'capybara')
  assert.equal(effectiveBodyId(p, 'heavy'), 'robot')
  assert.equal(effectiveBodyId(p, 'fable'), 'crab')
})

test('bodies: the capybara fits every action bare and with its own scarf; the scarf is refused on a crab', () => {
  const bare = compilePack([{ file: 'bare.json', json: { type: 'costume', id: 'bare', name: 'bare', color: '#cf7f45', body: { id: 'capybara' }, pieces: [] } }], BUILTIN)
  assert.deepEqual(bodyCompatibility(bare, 'bare', 'capybara'), [])
  const p = loadPack([capybaraSkin()], BUILTIN)
  assert.ok(p.costumes['capybara-scarf'])
  assert.deepEqual(bodyCompatibility(p, 'capybara-scarf', 'capybara'), [])
  const wrong = compilePack([capybaraSkin(), { file: 'crab-scarf.json', json: { type: 'costume', id: 'crab-scarf', name: 'x', color: '#cf7f45', pieces: ['capybara-scarf'] } }], BUILTIN)
  assert.ok(wrong.problems.some(x => /drawn for body "capybara", not "crab"/.test(x.msg)))
})

test('bodies: a body brings its own color and fixed palette; a costume color still wins', () => {
  const bare = compilePack([{ file: 'c.json', json: { type: 'costume', id: 'c', name: 'c', color: '#cf7f45', body: { id: 'capybara' }, pieces: [] } }], BUILTIN)
  assert.equal(planOf(bare, 'c', 'walk', 0).body, BUILTIN.bodies.capybara!.color)
  const tinted = compilePack([{ file: 'c.json', json: { type: 'costume', id: 'c', name: 'c', color: '#cf7f45', body: { id: 'capybara', color: '#808080' } , pieces: [] } }], BUILTIN)
  assert.equal(planOf(tinted, 'c', 'walk', 0).body, 0x808080)
  const colors = new Set<number>()
  renderAgent((_x, _y, col) => colors.add(col), 0, 0, bare, 'c', 'walk', 0)
  for (const fixed of Object.values(BUILTIN.bodies.capybara!.palette ?? {}).slice(0, 2)) assert.ok(colors.has(fixed))
  for (const palette of [{ B: '#000000' }, { xy: '#000000' }, { q: 'red' }]) {
    const b = robot(); b.palette = palette
    assert.ok(compilePack([{ file: 'bad.json', json: b }], BUILTIN).problems.some(x => x.fatal), JSON.stringify(palette))
  }
})

test('bodies: a held prop moves to the paw the body has where the crab has its claw', () => {
  const cap = BUILTIN.bodies.capybara!
  assert.deepEqual(anchorShift(BUILTIN.bodies.crab!, 'claw.left'), { x: 0, y: 0 })
  const shift = anchorShift(cap, 'claw.left')
  const xs = (pack: typeof BUILTIN, costume: string) => {
    const out: number[] = []
    renderAgent((x, _y, _c, tag) => { if (tag?.startsWith('effect:reading')) out.push(x) }, 0, 0, pack, costume, 'reading', 0)
    return Math.min(...out)
  }
  const bare = compilePack([{ file: 'c.json', json: { type: 'costume', id: 'c', name: 'c', color: '#cf7f45', body: { id: 'capybara' }, pieces: [] } }], BUILTIN)
  assert.equal(xs(bare, 'c') - xs(BUILTIN, 'other'), shift.x)
})

test('bodies: reject malformed geometry, states, anchors and missing references', () => {
  for (const mutate of [
    (b: any) => b.layers[0].x = 0.5,
    (b: any) => b.layers[0].rows = ['X'],
    (b: any) => b.layers[0].when = { legs: 2 },
    (b: any) => b.anchors.card.motion = 'body',
    (b: any) => delete b.anchors.head,
    (b: any) => b.eyes.height = 1.5,
    (b: any) => b.layers[0].rows = ['z'],
  ]) {
    const b = robot(); mutate(b)
    const p = compilePack([{ file: 'bad.json', json: b }], BUILTIN)
    assert.ok(p.problems.some(p => p.fatal), JSON.stringify(b))
    assert.equal(p.bodies.robot, BUILTIN.bodies.robot)
  }
  for (const id of ['missing', 'constructor', 'toString']) assert.ok(compilePack([on(id)], BUILTIN).problems.some(p => p.fatal))
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
  const p = loadPack([{ file: 'robot.json', json: b }, on('robot')], BUILTIN)
  assert.ok(p.problems.some(p => /body spills/.test(p.msg) && /body "robot".*costume/.test(p.msg) && /tick/.test(p.msg)))
})

test('bodies: builtin edits create user overrides without mutating builtin or inputs', () => {
  const source = JSON.stringify(BUILTIN.costumes.other!.source)
  const input = [{ file: 'notes.json', json: { type: 'rules', labels: { walk: 'walk' } } }]
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
  assert.equal(bodyCompatibility(BUILTIN, 'master', 'robot').length, 0)
})

test('bodies: export carries effective species and supports standalone body export', () => {
  const p = compilePack([on('robot')], BUILTIN)
  const exported = bundle(p, ['other'])
  const imported = compilePack([{ file: 'shared.json', json: exported.json }], BUILTIN)
  assert.equal(effectiveBodyId(imported, 'other'), 'robot')
  const standalone = bundle(p, ['robot']).json as { items: any[] }
  assert.equal(standalone.items[0].type, 'body')
})

test('bodies: an incompatible non-crab outfit does not remove shared reference pieces', () => {
  const b = robot(); b.id = 'shifted'; b.anchors.head.x = 17
  const source = BUILTIN.costumes.master!.source as Record<string, unknown>
  const p = loadPack([{ file: 'shifted.json', json: { type: 'bundle', items: [b,
    { ...source, id: 'shifted-outfit', body: { id: 'shifted' } }] } }], BUILTIN)
  assert.equal(p.costumes['shifted-outfit'], undefined)
  assert.ok(p.costumes.master)
  for (const piece of BUILTIN.costumes.master!.pieces) assert.equal(p.pieces[piece], BUILTIN.pieces[piece])
})

test('bodies: unrelated rejected files do not block a valid choice', () => {
  const files = [{ file: 'broken.json', text: '{' }]
  const p = loadPack(files, BUILTIN)
  const edit = planBodyEdit(files, { op: 'setBody', costume: 'other', body: 'robot' }, p)
  assert.equal(edit.ok, true)
})

test('bodies: selecting inheritance twice is a no-op and restoring a builtin removes its shadow', () => {
  const noop = planBodyEdit([], { op: 'setBody', costume: 'other' }, BUILTIN)
  assert.equal(noop.ok && noop.unchanged, true)
  const explicit = planBodyEdit([], { op: 'setBody', costume: 'other', body: 'robot' }, BUILTIN)
  assert.ok(explicit.ok)
  if (!explicit.ok) return
  const inherited = planBodyEdit(explicit.files, { op: 'setBody', costume: 'other' }, explicit.pack)
  assert.ok(inherited.ok)
  if (!inherited.ok) return
  assert.equal(inherited.pack.costumes.other!.origin, BUILTIN.costumes.other!.origin)
  assert.deepEqual(JSON.parse(inherited.text), { type: 'bundle', items: [] })
  const again = planBodyEdit(inherited.files, { op: 'setBody', costume: 'other', body: 'robot' }, inherited.pack)
  assert.ok(again.ok)
  if (again.ok) assert.equal(again.pack.costumes.other!.bodyId, 'robot')
})

test('bodies: legacy bundles remain editable without rewriting their sibling items', () => {
  const file = SPANISH_USER_DESIGNS[0]!
  const p = loadPack([file], BUILTIN)
  const costume = Object.values(p.costumes).find(c => c.origin === file.file)!
  assert.ok(costume)
  assert.equal(planBodyEdit([file], { op: 'setBody', costume: costume.id, body: 'crab' }, p).ok, true)
  const edit = planBodyEdit([file], { op: 'setBody', costume: costume.id, body: 'robot' }, p)
  assert.ok(edit.ok)
  if (edit.ok) assert.equal(edit.pack.costumes[costume.id]!.bodyId, 'robot')
})


test('bodies: changing one costume does not revive or re-reject an unrelated broken outfit', () => {
  const broken = { type: 'bundle', items: [
    { type: 'piece', id: 'floating', name: 'floating', slot: 'head', anchor: 'head', layers: [{ drawings: { a: ['X'] }, pos: [0, 0], palette: { X: '#ffffff' } }] },
    { type: 'costume', id: 'broken-outfit', name: 'broken outfit', color: '#abcdef', pieces: ['floating'] },
  ] }
  const files = [{ file: 'broken-outfit.json', json: broken }]
  const p = loadPack(files, BUILTIN)
  assert.ok(p.problems.some(p => /floats/.test(p.msg)))
  assert.equal(p.costumes['broken-outfit'], undefined)
  const edit = planBodyEdit(files, { op: 'setBody', costume: 'other', body: 'robot' }, p)
  assert.ok(edit.ok)
  if (edit.ok) assert.equal(edit.pack.costumes['broken-outfit'], undefined)
})

test('bodies: the shipped-pair shortcut is invalidated by user actions', () => {
  const walk = BUILTIN.actions.walk!.source as Record<string, unknown>
  const p = compilePack([{ file: 'custom-action.json', json: { ...walk,
    effect: [{ pos: [17, 0], drawings: { a: ['XX'] }, palette: { X: '#ffffff' } }],
  } }], BUILTIN)
  assert.equal(p.problems.length, 0)
  assert.ok(bodyCompatibility(p, 'master', 'robot').some(p => /effect spills/.test(p.msg)))
})
