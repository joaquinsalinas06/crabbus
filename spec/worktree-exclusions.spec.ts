import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkEnglish } from '../tools/check-english.ts'

test('English scan skips nested runtime worktrees but still checks primary sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'crabbus-exclusions-'))
  try {
    for (const name of ['src', 'hooks', 'tools', 'skills', 'spec', 'tests', '.claude-plugin']) mkdirSync(join(root, name))
    for (const name of ['README.md', 'DECISIONS.md']) writeFileSync(join(root, name), '')
    const copy = join(root, 'src', '.crabbus', 'worktrees', 'probe', 'src')
    mkdirSync(copy, { recursive: true })
    const invalid = `const label = "${String.fromCharCode(0xf1)}"`
    writeFileSync(join(copy, 'copied.ts'), invalid)
    const runtime = join(root, '.crabbus', 'worktrees', 'probe', 'src')
    mkdirSync(runtime, { recursive: true })
    writeFileSync(join(runtime, 'copied.ts'), invalid)
    assert.deepEqual(checkEnglish(root), [])
    writeFileSync(join(root, 'src', 'primary.ts'), invalid)
    assert.equal(checkEnglish(root).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
