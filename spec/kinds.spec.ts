import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDeterministic, type KindDef } from '../src/kinds.ts'

test('kinds: classifyDeterministic returns null on empty input or empty kinds', () => {
  assert.equal(classifyDeterministic(undefined, 'build a web app'), null)
  assert.equal(classifyDeterministic({}, 'build a web app'), null)
  assert.equal(classifyDeterministic({ planning: { words: [/plan/i] } }, ''), null)
  assert.equal(classifyDeterministic({ planning: { words: [/plan/i] } }, '   '), null)
})

test('kinds: matches single keyword with score 1', () => {
  const kinds: Record<string, KindDef> = {
    planning: { words: [/plan/i, /design/i] },
    debugging: { words: [/debug/i, /fix/i] },
  }
  const match = classifyDeterministic(kinds, 'we need to design the database schema')
  assert.deepEqual(match, { kind: 'planning', score: 1 })
})

test('kinds: higher score wins over lower score', () => {
  const kinds: Record<string, KindDef> = {
    planning: { words: [/plan/i] },
    debugging: { words: [/debug/i, /fix/i, /error/i] },
  }
  const match = classifyDeterministic(kinds, 'plan to debug and fix this error')
  assert.deepEqual(match, { kind: 'debugging', score: 3 })
})

test('kinds: tie-breaking is deterministic (alphabetical by kind id)', () => {
  const kinds: Record<string, KindDef> = {
    zebra: { words: [/work/i] },
    alpha: { words: [/work/i] },
  }
  const match = classifyDeterministic(kinds, 'do some work')
  assert.deepEqual(match, { kind: 'alpha', score: 1 })
})

test('kinds: returns null if no words match', () => {
  const kinds: Record<string, KindDef> = {
    planning: { words: [/plan/i] },
    debugging: { words: [/debug/i] },
  }
  const match = classifyDeterministic(kinds, 'random unrelated task')
  assert.equal(match, null)
})

test('kinds: only the first 400 characters are scored', () => {
  const kinds: Record<string, KindDef> = { planning: { words: [/plan/i] } }
  assert.deepEqual(classifyDeterministic(kinds, `${'x '.repeat(190)}plan`), { kind: 'planning', score: 1 })
  assert.equal(classifyDeterministic(kinds, `${'x '.repeat(250)}plan`), null)
})
