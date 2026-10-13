// The port of the hand-written crew (0.3) to data (0.4) must draw the same pixels, except where the
// fit check found a real problem or the hand rules changed on purpose. Each exception says why, and
// must still differ: an exception that no longer applies is a stale excuse and fails the test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CARD_H, CARD_W, canvas, drawAgent, drawMaster } from '../src/art.ts'
import { BUILTIN } from '../src/builtin.ts'
import { loadPack } from '../src/fit.ts'
import { normalizeDesignJson, resolveLegacyId } from '../src/legacy.ts'
import * as old from './fixtures/art-v03.ts'
import { GOLDEN_BUILTIN_FINGERPRINTS, GOLDEN_FRAMES, GOLDEN_USER_FINGERPRINTS, SPANISH_USER_DESIGNS } from './fixtures/spanish-designs.ts'

const COSTUMES = ['fable', 'heavy', 'careful', 'medium', 'light', 'explore', 'other']
const MOODS = ['walk', 'reading', 'writing', 'testing', 'thinking', 'blocked', 'error', 'done', 'sleep']
const TICKS = 48

const WHY: Record<string, string> = {
  '*/error': 'shivers in place: a sideways shake pushed props at the card edge (magnifier, pan, mic) off it',
  'heavy/writing': 'the right claw holds the magnifier, so the pencil moves to the free left claw',
  'medium/writing': 'the right claw holds the pan, so the pencil moves to the free left claw',
  'explore/writing': 'the right claw holds the cutlass, so the pencil moves to the free left claw',
  'careful/reading': 'the left claw holds the wrench, so the book moves to the free right claw',
  'careful/testing': 'the left claw holds the wrench, so the flask moves to the free right claw',
  'light/done': 'the flag is planted behind the crab (slot behind): the helmet now covers its corner when jumping',
  'explore/*': 'the tricorn floated one pixel above the head; the cutlass blade did not reach its hilt and now follows the claw',
}

const reason = (co: string, m: string): string | undefined => WHY[`${co}/${m}`] ?? WHY[`*/${m}`] ?? WHY[`${co}/*`]

const same = (a: ReturnType<typeof canvas>, b: ReturnType<typeof canvas>): boolean => a.px.every((v, i) => v === b.px[i])

const fnv1a = (px: Int32Array): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < px.length; i++) {
    h ^= px[i] as number
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const decodeFrame = (rle: string): Int32Array => {
  const out = new Int32Array(CARD_W * CARD_H)
  let i = 0
  for (const part of rle.split(',')) {
    if (part.endsWith('.')) {
      const n = Number(part.slice(0, -1))
      out.fill(-1, i, i + n)
      i += n
    } else {
      const [nStr, hex] = part.split(':')
      const n = Number(nStr)
      const c = parseInt(hex ?? '0', 16)
      out.fill(c, i, i + n)
      i += n
    }
  }
  return out
}

const fmtColor = (c: number): string => (c < 0 ? 'transparent' : `#${c.toString(16).padStart(6, '0')}`)

const firstDiff = (expected: Int32Array, actual: Int32Array): string | null => {
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i] as number
    const a = actual[i] as number
    if (e !== a) {
      const x = i % CARD_W
      const y = Math.floor(i / CARD_W)
      return `first pixel diff at (${x}, ${y}): expected ${fmtColor(e)}, got ${fmtColor(a)}`
    }
  }
  return null
}

const assertMatchesGolden = (key: string, spec: string, actual: Int32Array): void => {
  const [expectedHash, idxStr] = spec.split(':')
  const frameRle = GOLDEN_FRAMES[Number(idxStr)]
  assert.ok(frameRle !== undefined, `${key}: missing golden frame ${idxStr}`)
  const expectedPx = decodeFrame(frameRle)
  const diff = firstDiff(expectedPx, actual)
  if (diff !== null) assert.fail(`${key}: ${diff} (hash expected ${expectedHash}, got ${fnv1a(actual)})`)
  assert.equal(fnv1a(actual), expectedHash, `${key}: hash mismatch`)
}

test('golden: the data-driven crew draws exactly what 0.3 drew, except for the listed fixes', () => {
  for (const co of COSTUMES)
    for (const m of MOODS) {
      let differs = false
      for (let t = 0; t < TICKS; t++) {
        const a = canvas(18, 14)
        old.drawAgent(a, 0, 0, co as old.Costume, m as old.Mood, t)
        const b = canvas(18, 14)
        drawAgent(b, 0, 0, co, m, t)
        if (!same(a, b)) differs = true
      }
      const why = reason(co, m)
      if (why) assert.ok(differs, `${co}/${m} is listed as changed (${why}) but draws the same: drop the exception`)
      else assert.ok(!differs, `${co}/${m} changed without a listed reason`)
    }
})

test('golden: the master only lost the one-pixel gap under its crown', () => {
  // busy only: since v0.5 the free master moves on purpose (see the next test)
  for (const busy of [true])
    for (let t = 0; t < 40; t++) {
      const a = canvas(18, 14)
      old.drawMaster(a, 0, 0, busy, t)
      const b = canvas(18, 14)
      drawMaster(b, 0, 0, busy, t)
      // the crown's pixels (its own colors, above the body) moved down one row; everything else is identical
      const CROWN = new Set([0xf5c542, 0xe5484d, 0x4ea0ff, 0xffffff])
      const split = (c: ReturnType<typeof canvas>) => {
        const crown: string[] = []
        const rest: string[] = []
        c.px.forEach((v, i) => {
          if (v === -1) return
          const [x, y] = [i % 18, Math.floor(i / 18)]
          ;(y < 7 && CROWN.has(v) ? crown : rest).push(`${x},${y},${v}`)
        })
        return { crown, rest }
      }
      const was = split(a)
      const now = split(b)
      assert.deepEqual(now.rest, was.rest, `master busy=${busy} t=${t}: only the crown may move`)
      assert.deepEqual(now.crown, was.crown.map(p => { const [x, y, v] = p.split(','); return `${x},${Number(y) + 1},${v}` }), `master busy=${busy} t=${t}: crown one row lower`)
    }
})

test('the free master is never still: it bobs, looks around and waves; its idle plays fit every built-in costume', async () => {
  const frames = new Set<string>()
  for (let t = 0; t < 36; t++) {
    const c = canvas(CARD_W, CARD_H)
    drawMaster(c, 0, 0, false, t, BUILTIN)
    frames.add(c.px.join(','))
  }
  assert.ok(frames.size >= 4, `only ${frames.size} distinct frames in a free master's 6 seconds`)
  const { MASTER_IDLE } = await import('../src/director.ts')
  for (const id of MASTER_IDLE) assert.ok(BUILTIN.actions[id]?.play, `${id} is a play`)
})

test('golden: all built-in costumes x actions/plays + master match frozen v0.4 pixel fingerprints', () => {
  const entries = Object.entries(GOLDEN_BUILTIN_FINGERPRINTS)
  assert.equal(entries.length, 1536)
  let checked = 0
  for (const [key, spec] of entries) {
    const parts = key.split(':')
    const cv = canvas(CARD_W, CARD_H)
    if (parts.length === 2) {
      const [masterAction, tStr] = parts
      const resolved = resolveLegacyId('action', masterAction as string)
      assert.ok(BUILTIN.actions[resolved], `missing built-in master action ${resolved}`)
      // the free master was redrawn on purpose in v0.5 (never still); its frames are checked below
      if (resolved === 'master.free') { checked++; continue }
      drawMaster(cv, 0, 0, resolved === 'master.busy', Number(tStr), BUILTIN)
    } else {
      const [co, action, tStr] = parts
      const resolvedAction = resolveLegacyId('action', action as string)
      assert.ok(BUILTIN.actions[resolvedAction], `missing built-in action ${resolvedAction} (from ${String(action)})`)
      drawAgent(cv, 0, 0, co as string, resolvedAction, Number(tStr), BUILTIN)
    }
    assertMatchesGolden(key, spec, cv.px)
    checked++
  }
  assert.equal(checked, 1536)
})

test('golden: the 6 Spanish user designs load with 0 problems and match frozen v0.4 pixel fingerprints', () => {
  const files = SPANISH_USER_DESIGNS.map(d => ({ file: d.file, text: d.text }))
  const loaded = loadPack(files, BUILTIN)
  assert.deepEqual(loaded.problems, [])
  const entries = Object.entries(GOLDEN_USER_FINGERPRINTS)
  assert.equal(entries.length, 264)
  let checked = 0
  for (const [key, spec] of entries) {
    const [co, action, tStr] = key.split(':')
    const cv = canvas(CARD_W, CARD_H)
    drawAgent(cv, 0, 0, co as string, resolveLegacyId('action', action as string), Number(tStr), loaded)
    assertMatchesGolden(key, spec, cv.px)
    checked++
  }
  assert.equal(checked, 264)
})

test('golden: migrating the 6 Spanish user designs via normalizeDesignJson is idempotent and draws identical pixels', () => {
  const migratedFiles = SPANISH_USER_DESIGNS.map(d => {
    const once = normalizeDesignJson(JSON.parse(d.text))
    const twice = normalizeDesignJson(JSON.parse(JSON.stringify(once)))
    assert.deepEqual(twice, once, `${d.file}: normalizeDesignJson must be idempotent`)
    return { file: d.file, text: JSON.stringify(once, null, 2) }
  })
  const loaded = loadPack(migratedFiles, BUILTIN)
  assert.deepEqual(loaded.problems, [])
  const entries = Object.entries(GOLDEN_USER_FINGERPRINTS)
  assert.equal(entries.length, 264)
  let checked = 0
  for (const [key, spec] of entries) {
    const [co, action, tStr] = key.split(':')
    const cv = canvas(CARD_W, CARD_H)
    drawAgent(cv, 0, 0, co as string, resolveLegacyId('action', action as string), Number(tStr), loaded)
    assertMatchesGolden(key, spec, cv.px)
    checked++
  }
  assert.equal(checked, 264)
})

