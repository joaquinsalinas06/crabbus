import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN } from '../src/builtin.ts'
import { emptyState, onSpawn } from '../src/model.ts'
import { describeRuleCondition, formatCostumeRulesText, previewMood, ruleParts, ruleSentence, tellPrompt, wardrobeModel } from '../src/panel.ts'
import { loadPack } from '../src/fit.ts'
import type { Pack } from '../src/pack.ts'

test('wardrobe: describeRuleCondition formats condition parts', () => {
  assert.equal(describeRuleCondition({}), 'always')
  assert.equal(describeRuleCondition({ type: /worker/i }), 'type ~ /worker/i')
  assert.equal(describeRuleCondition({ description: /fix/i }), 'desc ~ /fix/i')
  assert.equal(describeRuleCondition({ prompt: /refactor/i }), 'prompt ~ /refactor/i')
  assert.equal(describeRuleCondition({ mode: /acceptEdits/i }), 'mode ~ /acceptEdits/i')
  assert.equal(describeRuleCondition({ kind: 'planning' }), 'kind == "planning"')
  assert.equal(describeRuleCondition({ from: 1201, to: 1231 }), 'dates 12-01..12-31')
  assert.equal(describeRuleCondition({ description: /fix/i, mode: /auto/i }), 'desc ~ /fix/i and mode ~ /auto/i')
})

test('wardrobe: wardrobeModel compiles wearing, rules, rotation and master', () => {
  const custom = loadPack([{
    file: 'my-rules.json',
    text: JSON.stringify({
      type: 'rules',
      master: 'heavy',
      rules: [
        { if: { description: 'bug' }, costume: 'heavy', nickname: 'Sherlock' },
      ],
    }),
  }], BUILTIN)

  let s = emptyState()
  s = onSpawn(s, { id: 'a1', type: 'general-purpose', description: 'bug fixer' }, 0, custom)

  const m = wardrobeModel(custom, s, 0)
  assert.equal(m.wearing.length, 1)
  assert.equal(m.wearing[0]?.costume, 'heavy')
  assert.equal(m.wearing[0]?.by, 'my-rules.json #1')

  assert.equal(m.master.id, 'heavy')
  assert.equal(m.master.custom, true)

  const text = formatCostumeRulesText(custom, s, 0)
  assert.match(text, /WEARING NOW:/)
  assert.match(text, /my-rules\.json #1/)
  assert.match(text, /MASTER: heavy \(custom\)/)
  assert.match(text, /RULES IN ORDER/)
})

test('wardrobe: each costume knows who wears it and how many rules give it; only the user rules are editable', () => {
  const custom = loadPack([{
    file: 'my-rules.json',
    text: JSON.stringify({ type: 'rules', rules: [{ if: { description: 'bug' }, costume: 'heavy' }, { if: { name: 'x' }, costume: 'heavy' }] }),
  }], BUILTIN)
  let s = emptyState()
  s = onSpawn(s, { id: 'a1', type: 'general-purpose', description: 'bug fixer' }, 0, custom)
  s = onSpawn(s, { id: 'a2', type: 'general-purpose', description: 'bug again' }, 0, custom)
  const m = wardrobeModel(custom, s, 0)
  const heavy = m.rotation.find(c => c.id === 'heavy')
  assert.equal(heavy?.wornBy, 2)
  // the two user rules, plus the built-in ones that give heavy (the `heavy$` type and `Plan`)
  assert.ok((heavy?.rulesCount ?? 0) >= 3)
  assert.equal(m.rules.filter(r => r.editable).length, 2)
  assert.ok(m.rules.filter(r => !r.editable).every(r => r.origin === '(built-in)'))
})

test('wardrobe: a rule reads as a sentence, and a pattern that is not plain is shown as written', () => {
  assert.equal(ruleSentence({ description: /dino/i }), 'task description has “dino”')
  assert.equal(ruleSentence({ type: /^Explore$/i }), 'agent type is “Explore”')
  assert.equal(ruleSentence({ type: /fable$/i }), 'agent type ends with “fable”')
  assert.equal(ruleSentence({ prompt: /bug|fix/i, mode: /^plan$/i }), 'instructions has “bug” or “fix” and permission mode is “plan”')
  assert.equal(ruleSentence({ description: /colou?r/i }), 'task description matches /colou?r/')
  assert.equal(ruleSentence({ from: 1201, to: 1231 }), 'date is Dec 1 to Dec 31')
  assert.equal(ruleSentence({ kind: 'planning' }), 'task kind is “planning”')
  assert.equal(ruleSentence({}), 'always')
})

test('wardrobe: the master clowns around in turns, a costume in the rotation walks, one out of it sleeps', () => {
  assert.equal(previewMood(false, true, 5).mood, 'walk')
  assert.equal(previewMood(false, false, 5).mood, 'sleep')
  const antics = [0, 24, 48, 72].map(t => previewMood(true, false, t).mood)
  assert.deepEqual(antics, ['master.dance', 'master.wave', 'master.hop', 'master.dance'])
  // a play holds its last frame until the next one starts
  assert.equal(previewMood(true, true, 48 + 20).t, 7)
})

test('wardrobe: a rule splits into tagged parts, one per thing it looks at', () => {
  assert.deepEqual(ruleParts({ description: /dino/i, from: 1201, to: 1231 }), [
    { tag: 'description', text: 'has “dino”' },
    { tag: 'date', text: 'Dec 1 → Dec 31' },
  ])
  assert.deepEqual(ruleParts({ prompt: /^plan$/i, kind: 'review' }), [{ tag: 'prompt', text: 'is “plan”' }, { tag: 'kind', text: 'is “review”' }])
})

test('wardrobe: "Tell CrabBus" hands Claude the words, the folder, the open costume and what is set now', () => {
  const text = tellPrompt('  the one who plans wears the detective  ', '/cfg/crabbus', 'heavy', 'RULES IN ORDER (0):')
  assert.match(text, /the person asks: "the one who plans wears the detective"/)
  assert.match(text, /crabbus:design/)
  // it may make costumes, look things up and read a picture, not only change rules
  assert.match(text, /new costumes and pieces/)
  assert.match(text, /search the web/)
  assert.match(text, /path of a picture/)
  assert.match(text, /\/cfg\/crabbus\//)
  assert.match(text, /The costume open in the panel: heavy\./)
  assert.match(text, /What is set now:\nRULES IN ORDER/)
  // a long request is cut, never passed whole
  assert.ok(tellPrompt('x'.repeat(5000), '/d', undefined, '').length < 2000)
})

test('wardrobe: newRules names the user rules a save added, not the ones that only moved', async () => {
  const { newRules, ruleKey } = await import('../src/panel.ts')
  const one = { type: 'rules', rules: [{ if: { description: 'dino' }, costume: 'heavy' }] }
  const two = { type: 'rules', rules: [{ if: { prompt: 'plan' }, costume: 'careful' }, { if: { description: 'dino' }, costume: 'heavy' }] }
  const a = loadPack([{ file: 'r.json', text: JSON.stringify(one) }], BUILTIN)
  const b = loadPack([{ file: 'r.json', text: JSON.stringify(two) }], BUILTIN)
  const added = newRules(a, b)
  assert.equal(added.length, 1)
  assert.equal(added[0], ruleKey(b.rules[0]!))
  assert.deepEqual(newRules(b, b), [])
})
