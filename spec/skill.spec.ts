import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN } from '../src/builtin.ts'
import { loadPack } from '../src/fit.ts'
import { canvas, CARD_W, CARD_H, type Canvas } from '../src/canvas.ts'
import { drawAgent } from '../src/art.ts'

const card = (draw: (c: Canvas) => void): Canvas => {
  const c = canvas(CARD_W, CARD_H)
  draw(c)
  return c
}

const SKILL_PATH = join(new URL('..', import.meta.url).pathname, 'skills/design/SKILL.md')

function extractSkillJsonBlocks(): string[] {
  const content = readFileSync(SKILL_PATH, 'utf8')
  const regex = /```json\s*([\s\S]*?)\s*```/g
  const blocks: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) blocks.push(match[1].trim())
  }
  return blocks
}

test('skill sync: skills/design/SKILL.md contains valid, up-to-date JSON examples matching real parser', () => {
  const blocks = extractSkillJsonBlocks()
  assert.ok(blocks.length >= 5, `expected at least 5 JSON examples in SKILL.md, found ${blocks.length}`)

  // Ensure forbidden / deprecated / hallucinated field names are absent from SKILL.md JSON blocks
  const forbiddenNames = ['"hop"', '"oneShot"', '"receives"', '"escapes"', '"ifAvailable"']
  for (const block of blocks) {
    for (const bad of forbiddenNames) {
      assert.ok(!block.includes(bad), `SKILL.md JSON block contains forbidden/outdated field name ${bad}:\n${block}`)
    }
  }

  // 1. Piece (example 0): loads standalone with 0 problems
  const p0 = loadPack([{ file: 'piece.json', text: blocks[0]! }], BUILTIN)
  assert.equal(p0.problems.length, 0, `piece example failed: ${p0.problems.map(p => p.msg).join('; ')}`)
  assert.ok(p0.pieces['beret'])

  // 2. Costume (example 1): loads together with piece example with 0 problems
  const p1 = loadPack([{ file: 'piece.json', text: blocks[0]! }, { file: 'costume.json', text: blocks[1]! }], BUILTIN)
  assert.equal(p1.problems.length, 0, `costume example failed: ${p1.problems.map(p => p.msg).join('; ')}`)
  assert.ok(p1.costumes['french'])

  // 3. Action "commit" (example 2): loads standalone with 0 problems
  const p2 = loadPack([{ file: 'commit.json', text: blocks[2]! }], BUILTIN)
  assert.equal(p2.problems.length, 0, `action commit example failed: ${p2.problems.map(p => p.msg).join('; ')}`)
  assert.ok(p2.actions['commit'])

  // 4. Play "dance" (example 3): loads standalone with 0 problems
  const p3 = loadPack([{ file: 'dance.json', text: blocks[3]! }], BUILTIN)
  assert.equal(p3.problems.length, 0, `play dance example failed: ${p3.problems.map(p => p.msg).join('; ')}`)
  assert.ok(p3.actions['dance'])

  // 5. Rules (example 4): loads together with costume example with 0 problems
  const p4 = loadPack([{ file: 'piece.json', text: blocks[0]! }, { file: 'costume.json', text: blocks[1]! }, { file: 'rules.json', text: blocks[4]! }], BUILTIN)
  assert.equal(p4.problems.length, 0, `rules example failed: ${p4.problems.map(p => p.msg).join('; ')}`)
  assert.equal(p4.rules.length, BUILTIN.rules.length + 2)

  // 6. All skill examples combined into a single pack must compile and fit with 0 problems
  const files = blocks.map((text, i) => ({ file: `example-${i}.json`, text }))
  const combined = loadPack(files, BUILTIN)
  const allErrs = combined.problems.map(pr => `${pr.file}${pr.id ? ` [${pr.id}]` : ''}: ${pr.msg}`).join('; ')
  assert.equal(combined.problems.length, 0, `combined skill examples produced problems: ${allErrs}`)

  // Verify compiled items exist
  assert.ok(combined.pieces['beret'], 'piece "beret" must be present')
  assert.ok(combined.costumes['french'], 'costume "french" must be present')
  assert.ok(combined.actions['commit'], 'action "commit" must be present')
  assert.ok(combined.actions['dance'], 'action "dance" must be present')
  assert.equal(combined.rules.length, BUILTIN.rules.length + 2, 'expected user rules prepended before built-ins')

  // Verify that rendering them does not crash or throw
  const frameCommit = card(c => drawAgent(c, 0, 0, 'french', 'commit', 0, combined))
  assert.ok(frameCommit.px.some(b => b !== 0), 'rendered frame for commit should not be blank')

  const frameDance = card(c => drawAgent(c, 0, 0, 'french', 'dance', 0, combined))
  assert.ok(frameDance.px.some(b => b !== 0), 'rendered frame for dance should not be blank')
})
