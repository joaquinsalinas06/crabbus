import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN } from '../src/builtin.ts'
import { canvas, putOn } from '../src/canvas.ts'
import { checkPack, loadPack } from '../src/fit.ts'
import { bundle, compilePack, labelOf, renderAgent, resolveAction, resolveCostume, type Facts, type Pack } from '../src/pack.ts'
import { checkEnglish } from '../tools/check-english.ts'
import { drawMaster } from '../src/art.ts'

const file = (json: unknown, name = 'test.json') => ({ file: name, json })
const load = (...items: unknown[]): Pack => loadPack(items.map((j, i) => file(j, `f${i}.json`)), BUILTIN)
const msgs = (p: Pack, id?: string) => p.problems.filter(x => !id || x.id === id).map(x => x.msg).join(' | ')

const hat = (id: string, rows: string[], y: number, extra: object = {}) => ({
  type: 'piece', id, slot: 'head', anchor: 'head',
  layers: [{ pos: [0, y], drawings: { a: rows }, palette: { r: '#c0392b', k: '#2b1d0e' } }],
  ...extra,
})
const costume = (id: string, pieces: string[]) => ({ type: 'costume', id, name: id, color: '#c08552', pieces })

// a beret that sits right on the head (head top is card row 6)
const BERET = hat('beret', ['......kk..........', '....rrrrrrrrr.....', '...rrrrrrrrrrr....'], 3)

const card = (p: Pack, co: string, m: string, t: number) => {
  const c = canvas(18, 14)
  renderAgent(putOn(c), 0, 0, p, co, m, t)
  return c
}

test('pack: every built-in piece fits (contract C holds for what already shipped)', () => {
  assert.deepEqual(BUILTIN.problems, [])
  assert.deepEqual(checkPack(BUILTIN).problems, [])
})

test('pack: a good beret loads and is worn', () => {
  const p = load(BERET, costume('french', ['beret']))
  assert.equal(msgs(p), '')
  assert.ok(p.costumes['french'])
  assert.notDeepEqual(card(p, 'french', 'walk', 0).px, card(p, 'other', 'walk', 0).px)
})

test('fit: a hat floating above the head is refused, with the action and tick', () => {
  const p = load(hat('floating', ['....rrrrrrrrr.....'], 2), costume('c1', ['floating']))
  assert.match(msgs(p, 'floating'), /floats in "walk" \(tick 0\)/)
  assert.equal(p.pieces['floating'], undefined)
  assert.equal(p.costumes['c1'], undefined, 'the costume that wears it is not used either')
  assert.match(msgs(p, 'c1'), /not used: wears floating/)
})

test('fit: a tall hat cut off when the crab jumps is refused', () => {
  const tall = hat('tophat', ['.....kkkkkkkk.....', '.....kkkkkkkk.....', '.....kkkkkkkk.....', '.....kkkkkkkk.....', '.....kkkkkkkk.....', '...rrrrrrrrrrrr...'], 0)
  const p = load(tall, costume('c2', ['tophat']))
  assert.match(msgs(p, 'tophat'), /spills outside the card at the top in "done"/)
})

test('fit: a piece over the eyes is refused unless it says coversEyes', () => {
  const mask = { type: 'piece', id: 'mask', slot: 'face.eyes', anchor: 'face', layers: [{ pos: [3, 8], drawings: { a: ['kkkkkkkkkkkk'] }, palette: { k: '#444444' } }] }
  assert.match(msgs(load(mask, costume('c3', ['mask'])), 'mask'), /covers the eyes/)
  assert.equal(msgs(load({ ...mask, coversEyes: true }, costume('c3', ['mask'])), 'mask'), '')
})

test('slots: two hats, or a moustache under a helmet that covers the face, are refused', () => {
  const p = load(BERET, hat('cap', ['....rrrrrrrrr.....', '...rrrrrrrrrrr....'], 4), costume('two', ['beret', 'cap']))
  assert.match(msgs(p, 'two'), /"cap" and "beret" both use slot "head"/)
  const helmet = hat('diving-helmet', ['....kkkkkkkkk.....', '...kkkkkkkkkkk....'], 4, { occupies: ['face.mouth'] })
  const moustache = { type: 'piece', id: 'moustache', slot: 'face.mouth', anchor: 'face', layers: [{ pos: [6, 10], drawings: { a: ['kkk.kk', 'k....k'] }, palette: { k: '#3b2a1a' } }] }
  const q = load(helmet, moustache, costume('diver', ['diving-helmet', 'moustache']))
  assert.match(msgs(q, 'diver'), /both use slot "face.mouth"/)
})

test('fit: a piece that disappears on one theme is refused (white on light, black on dark)', () => {
  const white = { type: 'piece', id: 'cloud', slot: 'head', anchor: 'head', layers: [{ pos: [0, 3], drawings: { a: ['....wwwwwwwww.....', '...wwwwwwwwwww....', '...wwwwwwwwwww....'] }, palette: { w: '#fbfbfb' } }] }
  assert.match(msgs(load(white, costume('c4', ['cloud'])), 'cloud'), /barely visible on light background/)
  const black = { ...white, id: 'soot', layers: [{ ...white.layers[0], palette: { w: '#151515' } }] }
  assert.match(msgs(load(black, costume('c5', ['soot'])), 'soot'), /barely visible on dark background/)
  // regression from 0.2: the chef's toque without its grey outline vanished on light terminals
  const bare = { type: 'piece', id: 'toque', slot: 'head', anchor: 'head', layers: [{ pos: [0, 1], drawings: { a: ['.....wwwwwwww.....', '.....wwgwwgww.....', '......wwwwww......', '......wwwwww......', '....TTTTTTTTTT....'] }, palette: { w: '#f4f3ee', g: '#d2d1c8', T: '#378add' } }] }
  assert.match(msgs(load(bare, costume('c6', ['toque'])), 'toque'), /barely visible on light background/)
  // a moustache sits on the face: it reads against the face, not against the terminal
  const moustache = { type: 'piece', id: 'moustache', slot: 'face.mouth', anchor: 'face', layers: [{ pos: [0, 10], drawings: { a: ['......kkkkkk......', '.....k......k.....'] }, palette: { k: '#3b2a1a' } }] }
  assert.equal(msgs(load(moustache, costume('c7', ['moustache']))), '')
})

test('format: problems name the file and say what to fix, in English; a bad file does not stop the others', () => {
  const p = loadPack([
    { file: 'broken.json', text: '{ not json' },
    file({ type: 'piece', id: 'x', slot: 'hat', anchor: 'head', layers: [] }, 'slot.json'),
    file({ ...BERET, id: 'y', layers: [{ drawings: { a: ['qq'] }, palette: { r: '#ff0000' } }] }, 'char.json'),
    file(BERET, 'good.json'),
  ], BUILTIN)
  const by = (f: string) => p.problems.filter(x => x.file === f).map(x => x.msg).join(' | ')
  assert.match(by('broken.json'), /malformed JSON/)
  assert.match(by('slot.json'), /slot "hat" does not exist/)
  assert.match(by('char.json'), /character "q" in drawing "a" is not in the palette/)
  assert.ok(p.pieces['beret'], 'the good file still loads')
})

const facts = (over: Partial<Facts> = {}): Facts => ({ status: 'running', blockers: [], inTool: false, anim: 'walk', lastEventAt: 0, toolCount: 1, ...over })

test('actions: a custom action matches tool + input, lasts `duration` after the tool, and loses to blocked', () => {
  const commit = {
    type: 'action', id: 'commit', label: '⎇ commit', color: '#f78166', priority: 60, duration: 3000,
    when: { tool: 'Bash', input: 'git commit' },
    pose: [{ steps: [{ jump: 0 }, { jump: 1 }] }],
  }
  const p = load(commit)
  const at = (o: Partial<Facts>, now = 1000) => resolveAction(p, facts(o), now)?.id
  assert.equal(at({ inTool: true, lastTool: 'Bash', lastToolInput: 'git commit -m x', lastToolAt: 1000 }), 'commit')
  assert.equal(at({ inTool: true, lastTool: 'Bash', lastToolInput: 'npm test', lastToolAt: 1000 }), 'testing')
  assert.equal(at({ inTool: false, lastTool: 'Bash', lastToolInput: 'git commit -m x', lastToolAt: 1000 }, 3500), 'commit', 'still shown 2.5 s later')
  assert.equal(at({ inTool: false, lastTool: 'Bash', lastToolInput: 'git commit -m x', lastToolAt: 1000 }, 5000), 'thinking', 'gone after duration')
  assert.equal(at({ inTool: true, lastTool: 'Bash', lastToolInput: 'git commit', lastToolAt: 1000, blockers: ['x'] }), 'blocked')
})

test('actions: the user renames a state through rules.labels', () => {
  const p = load({ type: 'rules', labels: { thinking: '… pondering' } })
  assert.equal(labelOf(p, p.actions['thinking'])[0], '… pondering')
})

test('hands: a held prop moves the action to the free claw, or is put away when both are busy', () => {
  const p = load(
    { type: 'piece', id: 'shovel', slot: 'hand.right', anchor: 'claw.right', layers: [{ pos: [15, 4], drawings: { a: ['..k', '..k', '..k', '.kk'] }, palette: { k: '#8a8f98' } }] },
    { type: 'piece', id: 'bucket', slot: 'hand.left', anchor: 'claw.left', layers: [{ pos: [0, 6], drawings: { a: ['kk', 'kk'] }, palette: { k: '#d0a040' } }] },
    costume('beach', ['shovel']),
    costume('beach2', ['shovel', 'bucket']),
  )
  assert.equal(msgs(p), '')
  // writing uses the right claw: with the shovel there, the pencil appears on the left instead
  const w = card(p, 'beach', 'writing', 0)
  const left = [...w.px].filter((v, i) => i % 18 < 3 && v === 0xf5c542).length
  assert.ok(left > 0, 'pencil drawn on the left')
  // both claws busy: the shovel is put away while writing, the pencil takes its place
  const w2 = card(p, 'beach2', 'writing', 0)
  assert.ok(![...w2.px].includes(0x8a8f98), 'shovel put away')
})

test('wardrobe: user rules come first, then built-in ones, then rotation; date ranges wrap the year', () => {
  const p = load(
    BERET, costume('french', ['beret']),
    { type: 'rules', rules: [{ if: { name: '^tester$' }, costume: 'medium', nickname: 'Chef Tester' }, { if: { from: '12-20', to: '01-06' }, costume: 'french' }] },
  )
  const june = Date.UTC(2026, 5, 15, 12)
  const xmas = Date.UTC(2026, 11, 24, 12)
  const jan = Date.UTC(2027, 0, 3, 12)
  assert.deepEqual(resolveCostume(p, { id: 'a', type: 'general-purpose', description: 'x', name: 'tester' }, [], june), { costume: 'medium', nickname: 'Chef Tester', by: 'f2.json #1' })
  assert.equal(resolveCostume(p, { id: 'a', type: 'Explore', description: 'x' }, [], xmas).costume, 'french')
  assert.equal(resolveCostume(p, { id: 'a', type: 'Explore', description: 'x' }, [], jan).costume, 'french')
  assert.equal(resolveCostume(p, { id: 'a', type: 'Explore', description: 'x' }, [], june).costume, 'explore', 'built-in type rule')
  const three = ['a', 'b', 'c'].reduce<string[]>((taken, id) => [...taken, resolveCostume(p, { id, type: 'x', description: id }, taken, june).costume], [])
  assert.equal(new Set(three).size, 3, 'rotation never repeats while there is room')
})

test('sharing: a costume exports with its pieces and imports into another pack, drawing the same', () => {
  const p = load(BERET, costume('french', ['beret']))
  const { json, missing } = bundle(p, ['french'])
  assert.deepEqual(missing, [])
  const q = loadPack([file(JSON.parse(JSON.stringify(json)), 'french.crab.json')], BUILTIN)
  assert.equal(msgs(q), '')
  for (const t of [0, 1, 2, 3]) assert.deepEqual(card(q, 'french', 'done', t).px, card(p, 'french', 'done', t).px)
})

test('compile: a user file replaces a built-in by id', () => {
  const p = compilePack([file({ type: 'costume', id: 'medium', name: 'blue chef', color: '#0000ff', pieces: ['chef-hat'] })], BUILTIN)
  assert.equal(p.costumes['medium']?.name, 'blue chef')
  assert.equal(p.costumes['heavy']?.name, 'detective')
})

test('rules: matches prompt and mode criteria', () => {
  const p = load(
    BERET, costume('french', ['beret']),
    {
      type: 'rules',
      rules: [
        { if: { prompt: 'refactor' }, costume: 'french' },
        { if: { mode: 'acceptEdits' }, costume: 'medium' },
      ],
    },
  )
  assert.equal(resolveCostume(p, { id: 'a', type: 'general-purpose', description: 'desc', prompt: 'please refactor this' }, [], 0).costume, 'french')
  assert.equal(resolveCostume(p, { id: 'b', type: 'general-purpose', description: 'desc', mode: 'acceptEdits' }, [], 0).costume, 'medium')
})

test('rules: matches kind criteria and links kinds', () => {
  const p = load(
    BERET, costume('french', ['beret']),
    {
      type: 'rules',
      kinds: {
        planning: { words: ['plan', 'design'], description: 'planning task' },
      },
      rules: [
        { if: { kind: 'planning' }, costume: 'french' },
      ],
    },
  )
  assert.equal(resolveCostume(p, { id: 'a', type: 'general-purpose', description: 'desc', kind: 'planning' }, [], 0).costume, 'french')
  assert.equal(resolveCostume(p, { id: 'b', type: 'general-purpose', description: 'desc', kind: 'debugging' }, [], 0).costume !== 'french', true)
})

test('rules: master costume configuration in rules and drawMaster', () => {
  const p = load(
    BERET, costume('french', ['beret']),
    { type: 'rules', master: 'french' },
  )
  assert.equal(p.master, 'french')
  const c = canvas(18, 14)
  drawMaster(c, 0, 0, false, 0, p)
  assert.ok(c.px.some(b => b !== 0))
})

test('rules: invalid criterion reports clear error message', () => {
  const p = load({ type: 'rules', rules: [{ if: { invalidField: 'test' }, costume: 'french' }] })
  assert.match(msgs(p), /is not a valid criterion \(type, name, description, model, prompt, mode, kind, from, to\)/)
})

// legacy-spanish-test-start
test('legacy: Spanish schema and built-in IDs (gorro-chef, estrella, giro) resolve and override built-ins', () => {
  const p = compilePack([
    file({ tipo: 'pieza', id: 'estrella', nombre: 'estrella roja', ranura: 'adorno', ancla: 'tarjeta', libre: true, capas: [{ pos: [15, 1], dibujos: { a: ['.r.', 'r.r', '.r.'] }, paleta: { r: '#ff0000' } }] }, 'estrella.json'),
    file({ tipo: 'disfraz', id: 'medium', nombre: 'chef azul', color: '#0000ff', piezas: ['gorro-chef'] }, 'chef.json'),
    file({ tipo: 'reglas', textos: { giro: '↻ vuelta' } }, 'reglas.json'),
  ], BUILTIN)
  assert.equal(p.problems.length, 0)
  assert.equal(p.pieces['star']?.name, 'estrella roja', 'defining legacy id "estrella" overrides built-in "star"')
  assert.equal(p.costumes['medium']?.name, 'chef azul')
  assert.deepEqual(p.costumes['medium']?.pieces, ['chef-hat'], 'legacy piece reference "gorro-chef" resolves to "chef-hat"')
  assert.equal(labelOf(p, p.actions['spin'])[0], '↻ vuelta', 'legacy action key "giro" in textos resolves to "spin"')
})
// legacy-spanish-test-end

test('check-english: codebase is verified free of Spanish violations outside whitelist', () => {
  const violations = checkEnglish()
  assert.equal(violations.length, 0, violations.map(v => `${v.file}:${v.line} [${v.match}]`).join(', '))
})
