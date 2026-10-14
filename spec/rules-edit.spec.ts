import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editRulesJson, planRuleEdit, rulesFileOf } from '../src/rules-edit.ts'
import type { DesignFile } from '../src/pack.ts'
import { BUILTIN } from '../src/builtin.ts'
import { loadPack } from '../src/fit.ts'

const rules = (o: unknown): DesignFile => ({ file: 'mine.json', text: JSON.stringify(o) })
const parse = (text: string): any => JSON.parse(text)

test('rules-edit: toggleActive removes and adds, keeping the order', () => {
  const initial = JSON.stringify({ type: 'rules', active: ['fable', 'heavy', 'careful'] })
  const gone = editRulesJson(initial, { op: 'toggleActive', costume: 'heavy' }, [])
  assert.deepEqual(parse(gone.text).active, ['fable', 'careful'])
  const back = editRulesJson(gone.text, { op: 'toggleActive', costume: 'heavy' }, [])
  assert.deepEqual(parse(back.text).active, ['fable', 'careful', 'heavy'])
})

test('rules-edit: a file with no "active" starts from the rotation in use, never from nothing', () => {
  const initial = JSON.stringify({ type: 'rules', rules: [] })
  const { text } = editRulesJson(initial, { op: 'toggleActive', costume: 'dino' }, ['fable', 'light'])
  assert.deepEqual(parse(text).active, ['fable', 'light', 'dino'])
})

test('rules-edit: setMaster sets, and the same costume again goes back to the default', () => {
  const initial = JSON.stringify({ type: 'rules' })
  const set = editRulesJson(initial, { op: 'setMaster', costume: 'dino' }, [])
  assert.equal(parse(set.text).master, 'dino')
  const unset = editRulesJson(set.text, { op: 'setMaster', costume: 'dino' }, [])
  assert.equal(parse(unset.text).master, undefined)
})

test('rules-edit: add, move, change the costume, flip ifFree and remove a rule', () => {
  let text = JSON.stringify({ type: 'rules', rules: [{ if: { description: 'dino' }, costume: 'dino' }] })
  text = editRulesJson(text, { op: 'addRule', criterion: 'prompt', pattern: 'plan', costume: 'heavy' }, []).text
  assert.deepEqual(parse(text).rules[1], { if: { prompt: 'plan' }, costume: 'heavy' })
  text = editRulesJson(text, { op: 'moveRule', file: 'x', index: 2, by: -1 }, []).text
  assert.equal(parse(text).rules[0].costume, 'heavy')
  text = editRulesJson(text, { op: 'setRuleCostume', file: 'x', index: 1, costume: 'careful' }, []).text
  assert.equal(parse(text).rules[0].costume, 'careful')
  text = editRulesJson(text, { op: 'toggleIfFree', file: 'x', index: 1 }, []).text
  assert.equal(parse(text).rules[0].ifFree, true)
  text = editRulesJson(text, { op: 'toggleIfFree', file: 'x', index: 1 }, []).text
  assert.equal(parse(text).rules[0].ifFree, undefined)
  text = editRulesJson(text, { op: 'removeRule', file: 'x', index: 1 }, []).text
  assert.deepEqual(parse(text).rules, [{ if: { description: 'dino' }, costume: 'dino' }])
})

test('rules-edit: a rule that is not there, or can not move further, is refused', () => {
  const text = JSON.stringify({ type: 'rules', rules: [{ if: { name: 'a' }, costume: 'dino' }] })
  assert.throws(() => editRulesJson(text, { op: 'removeRule', file: 'x', index: 3 }, []), /no rule 3/)
  assert.throws(() => editRulesJson(text, { op: 'moveRule', file: 'x', index: 1, by: -1 }, []), /already at the end/)
  assert.throws(() => editRulesJson(text, { op: 'addRule', criterion: 'name', pattern: '  ', costume: 'dino' }, []), /write what the rule/)
})

test('rules-edit: a file that is broken, or is not a rules file, is refused and left alone', () => {
  assert.throws(() => editRulesJson('{ "type": "rules", oops', { op: 'setMaster', costume: 'dino' }, []), /not valid JSON/)
  assert.throws(() => editRulesJson('[1]', { op: 'setMaster', costume: 'dino' }, []), /must be a JSON object/)
  assert.throws(() => editRulesJson('{"type":"costume"}', { op: 'setMaster', costume: 'dino' }, []), /not a rules file/)
  // a broken file is not a rules file the pack could read: it is left exactly as it is, and a clean one is started
  const broken = { file: 'mine.json', text: '{ "type": "rules", oops' }
  const plan = planRuleEdit([broken], { op: 'setMaster', costume: 'dino' }, BUILTIN)
  assert.equal(plan.ok, true)
  if (plan.ok) {
    assert.equal(plan.file, 'rules.json')
    assert.equal(plan.files.find(f => f.file === 'mine.json')?.text, broken.text)
  }
  // but naming the broken file for a rule edit is refused
  assert.equal(planRuleEdit([broken], { op: 'removeRule', file: 'mine.json', index: 1 }, BUILTIN).ok, false)
})

test('rules-edit: rulesFileOf is the first rules file, or rules.json when there is none', () => {
  assert.equal(rulesFileOf([{ file: 'a.json', text: '{"type":"costume"}' }, rules({ type: 'rules' })]), 'mine.json')
  assert.equal(rulesFileOf([]), 'rules.json')
})

test('rules-edit: planRuleEdit gives the pack the edit would make, with the user rules once', () => {
  const files = [rules({ type: 'rules', rules: [{ if: { description: 'dino' }, costume: 'dino' }] })]
  const plan = planRuleEdit(files, { op: 'addRule', criterion: 'description', pattern: 'chef', costume: 'medium' }, loadPack(files, BUILTIN))
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.file, 'mine.json')
  assert.equal(plan.pack.rules.filter(r => r.origin === 'mine.json').length, 2)
  assert.equal(plan.pack.rules[0]?.ruleIdx, 1)
})

test('rules-edit: a pattern the pack rejects refuses the edit, with its reason', () => {
  const files = [rules({ type: 'rules', rules: [] })]
  const plan = planRuleEdit(files, { op: 'addRule', criterion: 'description', pattern: '(a+)+', costume: 'dino' }, loadPack(files, BUILTIN))
  assert.equal(plan.ok, false)
  if (!plan.ok) assert.match(plan.error, /hang/)
})

test('rules-edit: with no rules file yet, the first edit creates rules.json', () => {
  const plan = planRuleEdit([], { op: 'toggleActive', costume: 'dino' }, { ...BUILTIN, active: ['fable'] })
  assert.equal(plan.ok, true)
  if (plan.ok) {
    assert.equal(plan.file, 'rules.json')
    assert.deepEqual(parse(plan.text).active, ['fable', 'dino'])
  }
})

test('rules-edit: the quick pack equals a full reload of the same files', () => {
  const files: DesignFile[] = [
    { file: 'other.json', text: JSON.stringify({ type: 'costume', id: 'twin', name: 'twin', color: '#3a7bd5', pieces: ['chef-hat'] }) },
    rules({ type: 'rules', active: ['fable', 'twin'], master: 'twin', rules: [{ if: { description: 'paris' }, costume: 'twin' }] }),
  ]
  const current = loadPack(files, BUILTIN)
  assert.ok(current.costumes['twin'], 'the test costume must load')
  const add = planRuleEdit(files, { op: 'addRule', criterion: 'type', pattern: 'Explore', costume: 'twin' }, current)
  assert.equal(add.ok, true)
  if (!add.ok) return
  const full = loadPack(add.files, BUILTIN)
  const show = (p: typeof full) => p.rules.map(r => `${r.origin}#${r.ruleIdx}:${r.costume}:${String(r.if.description ?? r.if.type ?? '')}`)
  assert.deepEqual(add.pack.active, full.active)
  assert.equal(add.pack.master, full.master)
  assert.deepEqual(show(add.pack), show(full))
  assert.deepEqual(Object.keys(add.pack.costumes).sort(), Object.keys(full.costumes).sort())
  assert.deepEqual(add.pack.problems.map(p => p.msg).sort(), full.problems.map(p => p.msg).sort())
})

test('rules-edit: a date rule is written from "MM-DD..MM-DD", and refused in any other shape', () => {
  const text = JSON.stringify({ type: 'rules', rules: [] })
  for (const pattern of ['12-01..12-31', '12-01 to 12-31', '12-01 12-31']) {
    const r = editRulesJson(text, { op: 'addRule', criterion: 'date', pattern, costume: 'dino' }, [])
    assert.deepEqual(parse(r.text).rules[0], { if: { from: '12-01', to: '12-31' }, costume: 'dino' })
  }
  assert.throws(() => editRulesJson(text, { op: 'addRule', criterion: 'date', pattern: 'december', costume: 'dino' }, []), /MM-DD\.\.MM-DD/)
  // a day that does not exist is refused by the pack, with its reason
  const plan = planRuleEdit([rules({ type: 'rules', rules: [] })], { op: 'addRule', criterion: 'date', pattern: '13-01..13-05', costume: 'heavy' }, BUILTIN)
  assert.equal(plan.ok, false)
})
