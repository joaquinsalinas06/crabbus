import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { BUILTIN } from '../src/builtin.ts'
import { loadPack } from '../src/fit.ts'
import { emptyState, onSend, onSpawn, onStep, onToolStart, statusReport } from '../src/model.ts'
import { unsafePattern } from '../src/pack.ts'
import { clean, fit } from '../src/theme.ts'

test('security: patterns that can backtrack catastrophically are refused', () => {
  for (const p of ['(a+)+$', '(a|ab)*c', '(\\w+\\s?)*$', '(.*a){12}', '(\\s+-C\\s+\\S+)*', '(x)\\1', '(?<n>a)\\k<n>']) {
    assert.ok(unsafePattern(p), `should refuse ${p}`)
  }
  for (const p of ['Read|Grep|Glob', '^general-purpose$', '\\bgit\\b[^|;&\\n]{0,120}\\scommit\\b', '(ab)+', '[(+)]*x', '(?:Edit|Write)']) {
    assert.equal(unsafePattern(p), null, `should allow ${p}`)
  }
})

test('security: a design with an unsafe pattern is rejected with a reason, the rest still loads', () => {
  const evil = { type: 'action', id: 'evil', label: 'evil', color: '#ff0000', when: { tool: 'Bash', input: '(a+)+$' } }
  const pack = loadPack([{ file: 'evil.json', text: JSON.stringify(evil) }], BUILTIN)
  assert.ok(!pack.actions['evil'])
  assert.match(pack.problems.map(x => x.msg).join(' '), /could hang Claude Code/)
  assert.ok(pack.actions['reading'])
})

test('security: every shipped example passes the checks', () => {
  const files = readdirSync('examples').filter(f => f.endsWith('.json')).map(f => ({ file: f, text: readFileSync(`examples/${f}`, 'utf8') }))
  const pack = loadPack(files, BUILTIN)
  assert.deepEqual(pack.problems.filter(x => x.fatal).map(x => `${x.file}: ${x.msg}`), [])
})

test('security: terminal control sequences from agents never reach the screen', () => {
  const ESC = String.fromCharCode(0x1b)
  const RLO = String.fromCharCode(0x202e) // right-to-left override
  const nasty = `x${ESC}[2J${ESC}]52;c;ZXZpbA==\u0007${RLO}evil\u009bA\r\ny`
  assert.equal(clean(nasty), 'x[2J]52;c;ZXZpbA==evilA  y')
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/.test(fit(nasty, 200)))

  let s = emptyState()
  s = onSpawn(s, { id: 'a', type: `general${ESC}[31m`, description: `desc${ESC}[2J`, name: `n${ESC}]0;title\u0007` }, 0)
  s = onToolStart(s, 'a', `Bash${ESC}[1A`, { command: `ls ${ESC}[2J; echo` }, 1)
  s = onStep(s, 'a', { plan: [`step${ESC}[H`], blocker: `stuck${ESC}c`, question: `why${RLO}?` }, 2)
  s = onSend(s, 'a', `do it${ESC}[?1049h`, true, 3)
  const shown = JSON.stringify(s) + statusReport(s, 4)
  assert.ok(!shown.includes(ESC) && !shown.includes('\\u001b'), 'no ESC stored or reported')
  assert.ok(!shown.includes(RLO) && !shown.includes('\\u202e'), 'no bidi override stored or reported')
})
