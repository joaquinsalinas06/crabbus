// Designs as data: pieces, costumes, actions and wardrobe rules. Pure: no `$`, no Node.
//
// Everything a crab wears or does is described by JSON objects with a `type`:
//   piece    something drawn on the crab: it sits in one slot (contract B) and holds onto one
//            anchor of the body (contract A); drawn on the 18x14 card as it sits on the resting crab
//   costume  a set of pieces plus body and label colors
//   action   when it applies (tool, input, state), its priority, the pose and the effect drawn
//   rules    which costume each agent gets (rules first, then rotation) and text overrides
//   bundle   several of the above in one file, to share
// The built-in crew (src/builtin.ts) is written in this same format. Contract C (fit.ts) checks
// that every piece actually sits on the body before a pack is used.

import { CARD_H, CARD_W, mix, stampWith, type Put } from './canvas.ts'
import { normalizeDesignJson, resolveLegacyId } from './legacy.ts'
import { ANCHORS, BODY_LAYER, CLAY, EYES, FACE_SLOTS, POSE0, SLOTS, TAG, anchorOffset, drawCrab, mirrorPose, slotLayer, turned, type Anchor, type Pose, type Slot } from './rig.ts'
import type { KindDef } from './kinds.ts'

export const SLEEP_MS = 8000 // after this, a finished agent dozes instead of cheering
export const ERROR_MS = 3000 // a failed tool shows as an error this long
export const FALLBACK_COSTUME = 'other'
export const FALLBACK_ACTION = 'walk'
export const BUILTIN_ORIGIN = '(built-in)'

// ---- compiled form

export type Track<S> = { kind: 'fixed'; s: S } | { kind: 'steps'; steps: S[]; every: number } | { kind: 'at'; period: number; at: Map<number, S> }

export type Step = { d?: string; x?: number; y?: number; pal?: Record<string, number>; hidden?: boolean }

export type Layer = {
  x: number
  y: number
  drawings: Record<string, string[]>
  first: string
  pal: Record<string, number>
  anim: Record<string, Track<Step>[]> // by action id, '*' for every other action
  free: boolean
  /** An effect that may leave the card (a ball kicked away); the fit check does not hold it in. */
  leaves: boolean
}

export type Piece = {
  id: string
  name: string
  slot: Slot
  anchor: Anchor
  layers: Layer[]
  coversEyes: boolean
  free: boolean
  coversAction: string[]
  occupies: Slot[]
  origin: string
  source: unknown
}

export type CostumeDef = { id: string; name: string; color: number; body: number; eyes?: number; pieces: string[]; origin: string; source: unknown }

export const STATES = ['asleep', 'finished', 'failed', 'blocked', 'error', 'thinking', 'working', 'starting', 'tests-ok'] as const
export type State = (typeof STATES)[number]

export type Cond = { tool?: RegExp; input?: RegExp; state?: State; chance?: number }

/** A one-shot play: drawn from its start for `ticks`, optionally passing the ball to another agent at `atTick`. */
export type PlayDef = { ticks: number; group: string; pass?: { atTick: number; to: string[] } }

export type Action = {
  id: string
  label: string
  color: number
  when: Cond[]
  priority: number
  duration: number
  pose: Track<Partial<Pose>>[]
  dim: number
  hand?: 'left' | 'right'
  effect: Layer[]
  play?: PlayDef
  origin: string
  source: unknown
}

export type Rule = {
  origin: string
  ruleIdx: number
  if: {
    type?: RegExp
    name?: RegExp
    description?: RegExp
    model?: RegExp
    prompt?: RegExp
    mode?: RegExp
    kind?: string
    from?: number
    to?: number
  }
  costume: string
  ifFree: boolean
  nickname?: string
}

export type Problem = { file: string; id?: string; msg: string; fatal: boolean }

export type Pack = {
  pieces: Record<string, Piece>
  costumes: Record<string, CostumeDef>
  actions: Record<string, Action>
  order: Action[] // by priority, highest first
  active: string[]
  rules: Rule[]
  labels: Record<string, string>
  problems: Problem[]
  rulesSource: unknown[]
  master?: string
  kinds?: Record<string, KindDef>
  rulesFiles: string[]
}

export const emptyPack = (): Pack => ({
  pieces: {},
  costumes: {},
  actions: {},
  order: [],
  active: [],
  rules: [],
  labels: {},
  problems: [],
  rulesSource: [],
  rulesFiles: [],
})

// ---- reading JSON: every field is checked, the file names the problem in English

class Bad extends Error {}
const bad = (msg: string): never => {
  throw new Bad(msg)
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const ID = /^[a-z0-9][a-z0-9._-]{0,39}$/

const str = (o: Obj, k: string, opt = false): string | undefined => {
  const v = o[k]
  if (v === undefined && opt) return undefined
  if (typeof v !== 'string' || v.trim() === '') return bad(`"${k}" must be a non-empty string`)
  return v
}
const num = (o: Obj, k: string, min: number, max: number, def?: number): number => {
  const v = o[k]
  if (v === undefined && def !== undefined) return def
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return bad(`"${k}" must be a number between ${min} and ${max}`)
  return v
}
const bool = (o: Obj, k: string): boolean => {
  const v = o[k]
  if (v === undefined) return false
  if (typeof v !== 'boolean') return bad(`"${k}" must be true or false`)
  return v
}
const idOf = (o: Obj): string => {
  const id = str(o, 'id') as string
  if (!ID.test(id)) bad(`invalid id "${id}": use lowercase letters, digits, dot, hyphen or underscore (max 40)`)
  return id
}
const strList = (o: Obj, k: string): string[] => {
  const v = o[k]
  if (v === undefined) return []
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) return bad(`"${k}" must be a list of strings`)
  return v as string[]
}

export const parseColor = (v: unknown, where: string): number => {
  if (typeof v !== 'string') return bad(`${where}: color must be "#rrggbb"`)
  const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(v.trim())
  if (!m) return bad(`${where}: "${v}" is not a valid color; use "#rrggbb"`)
  const h = m[1] as string
  const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h
  return parseInt(full, 16)
}

const palette = (v: unknown, where: string): Record<string, number> => {
  if (!isObj(v)) return bad(`${where}: "palette" must be a letter -> color object`)
  const out: Record<string, number> = {}
  for (const [k, c] of Object.entries(v)) {
    if (k.length !== 1 || k === '.' || k === ' ') bad(`${where}: palette keys must be single characters (got "${k}")`)
    out[k] = parseColor(c, `${where}, key "${k}"`)
  }
  return out
}

/**
 * Why a pattern could take too long to run, or null. Design files are shared, and their patterns run
 * against tool input on every tool call, so only a small, plainly linear subset is accepted:
 * - no repeated group at all (`(ab)+`, `(a?){3}`): repeat a single character or class instead;
 * - no backreferences;
 * - at most MAX_REPEATS repetitions (*, +, {n,m}) in the whole pattern, since each overlapping one
 *   multiplies the work (eight `\s*` in a row take minutes on 60 spaces);
 * - at most MAX_CHOICES ways to match: choices in sequence multiply (an optional part doubles them, a
 *   group with three alternatives triples them), alternatives of one group add up. So a long
 *   alternation like `\b(pytest|vitest|jest|…)\b` is fine, while chains like `a?a?a?…aaa…b` or
 *   `(a|a)(a|a)(a|a)…b`, which grow exponentially, are refused.
 * Character classes follow JavaScript's rules: `[]` is empty and `[^]` is any character, so the first
 * `]` always closes the class (reading it as PCRE does let `[^](a+)+]` slip through).
 */
const MAX_REPEATS = 2
const MAX_CHOICES = 64
export const unsafePattern = (src: string): string | null => {
  // the quantifier at i: [chars it spans, whether it repeats more than once]
  const quant = (i: number): [number, boolean] => {
    const ch = src[i]
    let n = 0
    let rep = false
    if (ch === '*' || ch === '+') { n = 1; rep = true }
    else if (ch === '?') n = 1
    else if (ch === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i))
      if (m) { n = m[0].length; rep = m[2] === undefined ? Number(m[1]) > 1 : m[3] === '' || Number(m[3]) > 1 }
    }
    if (n > 0 && src[i + n] === '?') n++ // lazy
    return [n, rep]
  }
  let repeats = 0
  // ways to match, per open group: `done` adds up its finished alternatives, `cur` multiplies along the
  // alternative being read. [0] is the whole pattern.
  type Ways = { done: number; cur: number }
  const stack: Ways[] = [{ done: 0, cur: 1 }]
  const top = (): Ways => stack[stack.length - 1] as Ways
  const cap = (x: number): number => Math.min(x, 1e9)
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string
    let group = false
    if (ch === '\\') {
      const nx = src[i + 1] ?? ''
      if (/[1-9]/.test(nx) || (nx === 'k' && src[i + 2] === '<')) return 'backreferences are not allowed'
      i += 2
    } else if (ch === '[') {
      i++
      while (i < src.length && src[i] !== ']') i += src[i] === '\\' ? 2 : 1
      i++
    } else if (ch === ')') {
      group = true
      i++
    } else if (ch === '(') {
      stack.push({ done: 0, cur: 1 })
      i++
      continue // nothing to repeat yet; a quantifier right after is a syntax error RegExp reports
    } else if (ch === '|') {
      const t = top()
      t.done = cap(t.done + t.cur)
      t.cur = 1
      i++
      continue
    } else i++
    const [n, rep] = quant(i)
    if (group && rep) return 'a group cannot be repeated (repeat a single character or class instead, e.g. [^;]{0,80})'
    if (rep && ++repeats > MAX_REPEATS) return `more than ${MAX_REPEATS} repetitions (*, +, {n,m}) in one pattern`
    // the item just read matches in `w` ways; optional, it also matches as nothing
    let w = 1
    if (group && stack.length > 1) { const g = stack.pop() as Ways; w = cap(g.done + g.cur) }
    if (n > 0 && !rep) w = cap(w + 1)
    top().cur = cap(top().cur * w)
    if (top().done + top().cur > MAX_CHOICES) return `too many ways to match (choices in a row multiply; at most ${MAX_CHOICES})`
    i += n
  }
  return null
}

const regex = (v: unknown, where: string): RegExp => {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) return bad(`${where}: must be a string of 1 to 200 characters`)
  const why = unsafePattern(v)
  if (why) return bad(`${where}: "${v}" could hang Claude Code on some inputs: ${why}`)
  try {
    return new RegExp(v, 'i')
  } catch {
    return bad(`${where}: "${v}" is not a valid regular expression`)
  }
}

const track = <S>(v: unknown, where: string, step: (x: unknown, w: string) => S): Track<S> => {
  if (!isObj(v)) return bad(`${where}: each track must be an object with "fixed", "steps" or "at"`)
  if ('fixed' in v) return { kind: 'fixed', s: step(v['fixed'], `${where}.fixed`) }
  if ('steps' in v) {
    const p = v['steps']
    if (!Array.isArray(p) || p.length === 0 || p.length > 48) return bad(`${where}: "steps" must be a list of 1 to 48 steps`)
    return { kind: 'steps', steps: p.map((x, i) => step(x, `${where}.steps[${i}]`)), every: num(v, 'every', 1, 30, 1) }
  }
  if ('at' in v) {
    const period = num(v, 'period', 1, 120)
    const at = v['at']
    if (!isObj(at)) return bad(`${where}: "at" must be a tick -> step object`)
    const m = new Map<number, S>()
    for (const [k, x] of Object.entries(at)) {
      const n = Number(k)
      if (!Number.isInteger(n) || n < 0 || n >= period) bad(`${where}: tick "${k}" must be between 0 and ${period - 1}`)
      m.set(n, step(x, `${where}.at.${k}`))
    }
    return { kind: 'at', period, at: m }
  }
  return bad(`${where}: each track requires "fixed", "steps" or "at"`)
}

const tracks = <S>(v: unknown, where: string, step: (x: unknown, w: string) => S): Track<S>[] => {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > 8) return bad(`${where}: must be a list of up to 8 tracks`)
  return v.map((t, i) => track(t, `${where}[${i}]`, step))
}

const poseStep = (v: unknown, where: string): Partial<Pose> => {
  if (!isObj(v)) return bad(`${where}: a pose step must be an object`)
  const out: Partial<Pose> = {}
  for (const [k, x] of Object.entries(v)) {
    if (k === 'eyes') {
      if (!EYES.includes(x as never)) bad(`${where}: "eyes" must be one of ${EYES.join(', ')}`)
      out.eyes = x as Pose['eyes']
    } else if (k === 'bob' || k === 'legs' || k === 'armL' || k === 'leftArm' || k === 'armR' || k === 'rightArm') {
      if (x !== 0 && x !== 1) bad(`${where}: "${k}" must be 0 or 1`)
      const key = k === 'leftArm' ? 'armL' : k === 'rightArm' ? 'armR' : k
      ;(out as Record<string, number>)[key] = x as number
    } else if (k === 'lift' || k === 'jump') {
      if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > 2) bad(`${where}: "jump" must be 0, 1 or 2`)
      out.lift = x as number
    } else if (k === 'width') {
      if (typeof x !== 'number' || x < 0.1 || x > 1) bad(`${where}: "width" must be between 0.1 (side) and 1 (front)`)
      out.width = x as number
    } else if (k === 'facingAway') {
      if (typeof x !== 'boolean') bad(`${where}: "facingAway" must be true or false`)
      out.facingAway = x as boolean
    } else if (k === 'kick') {
      if (x !== 'left' && x !== 'right' && x !== null) bad(`${where}: "kick" must be "left", "right" or null`)
      out.kick = x as Pose['kick']
    } else if (k === 'dx' || k === 'shake') {
      if (typeof x !== 'number' || !Number.isInteger(x) || x < -1 || x > 1) bad(`${where}: "shake" must be -1, 0 or 1`)
      out.dx = x as number
    } else bad(`${where}: "${k}" is not part of a pose (bob, jump, shake, legs, leftArm, rightArm, eyes, width, facingAway, kick)`)
  }
  return out
}

const parseLayer = (v: unknown, where: string): Layer => {
  if (!isObj(v)) return bad(`${where}: a layer must be an object`)
  const drw = v['drawings']
  if (!isObj(drw) || Object.keys(drw).length === 0 || Object.keys(drw).length > 8) return bad(`${where}: "drawings" must have 1 to 8 named drawings`)
  const pal = palette(v['palette'], where)
  const drawings: Record<string, string[]> = {}
  for (const [name, rows] of Object.entries(drw)) {
    if (!Array.isArray(rows) || rows.length > CARD_H || rows.some(r => typeof r !== 'string' || r.length > CARD_W))
      bad(`${where}: drawing "${name}" must have up to ${CARD_H} rows of up to ${CARD_W} characters`)
    for (const r of rows as string[])
      for (const ch of r) if (ch !== '.' && ch !== ' ' && pal[ch] === undefined) bad(`${where}: character "${ch}" in drawing "${name}" is not in the palette`)
    drawings[name] = rows as string[]
  }
  const pos = v['pos']
  if (pos !== undefined && (!Array.isArray(pos) || pos.length !== 2 || pos.some(n => typeof n !== 'number' || !Number.isInteger(n) || n < -4 || n > 22)))
    bad(`${where}: "pos" must be [x, y] on the 18x14 card`)
  const [x, y] = (pos as [number, number] | undefined) ?? [0, 0]
  const step = (s: unknown, w: string): Step => {
    if (!isObj(s)) return bad(`${w}: a step must be an object`)
    const out: Step = {}
    for (const [k, val] of Object.entries(s)) {
      if (k === 'd') {
        if (typeof val !== 'string' || !drawings[val]) bad(`${w}: drawing "${String(val)}" does not exist in this layer`)
        out.d = val as string
      } else if (k === 'x' || k === 'y') {
        if (typeof val !== 'number' || !Number.isInteger(val) || Math.abs(val) > 24) bad(`${w}: "${k}" must be an integer between -24 and 24`)
        out[k] = val as number
      } else if (k === 'palette') out.pal = palette(val, w)
      else if (k === 'hidden') {
        if (typeof val !== 'boolean') bad(`${w}: "hidden" must be true or false`)
        out.hidden = val as boolean
      } else bad(`${w}: "${k}" is not part of a step (d, x, y, palette, hidden)`)
    }
    return out
  }
  const anim: Record<string, Track<Step>[]> = {}
  const a = v['anim']
  if (a !== undefined) {
    if (!isObj(a)) bad(`${where}: "anim" must be an action -> tracks object`)
    for (const [k, t] of Object.entries(a as Obj)) anim[k] = tracks(t, `${where}.anim.${k}`, step)
  }
  return { x, y, drawings, first: Object.keys(drawings)[0] as string, pal, anim, free: bool(v, 'free'), leaves: bool(v, 'leaves') }
}

const parseLayers = (v: unknown, where: string, max = 6): Layer[] => {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return bad(`${where}: must be a list of 1 to ${max} layers`)
  return v.map((c, i) => parseLayer(c, `${where}[${i}]`))
}

const parseSlot = (v: unknown, where: string): Slot => {
  if (!SLOTS.includes(v as Slot)) return bad(`${where}: slot "${String(v)}" does not exist (${SLOTS.join(', ')})`)
  return v as Slot
}

const parsePiece = (o: Obj, origin: string): Piece => {
  const id = idOf(o)
  const anchor = o['anchor']
  if (!ANCHORS.includes(anchor as Anchor)) bad(`"anchor" must be one of ${ANCHORS.join(', ')}`)
  const occupies = strList(o, 'occupies').map((s, i) => parseSlot(s, `occupies[${i}]`))
  return {
    id,
    name: str(o, 'name', true) ?? id,
    slot: parseSlot(o['slot'], 'slot'),
    anchor: anchor as Anchor,
    layers: parseLayers(o['layers'], 'layers'),
    coversEyes: bool(o, 'coversEyes'),
    free: bool(o, 'free'),
    coversAction: strList(o, 'coversAction'),
    occupies,
    origin,
    source: o,
  }
}

const parseCostume = (o: Obj, origin: string): CostumeDef => {
  const id = idOf(o)
  const bodyObj = o['body']
  if (bodyObj !== undefined && !isObj(bodyObj)) bad('"body" must be an object { "color": "#rrggbb", "eyes": "#rrggbb" }')
  const body = isObj(bodyObj) ? bodyObj : {}
  const pieces = strList(o, 'pieces')
  if (pieces.length > 9) bad('a costume can have at most 9 pieces')
  return {
    id,
    name: str(o, 'name') as string,
    color: parseColor(o['color'], 'color'),
    body: body['color'] !== undefined ? parseColor(body['color'], 'body.color') : CLAY,
    ...(body['eyes'] !== undefined ? { eyes: parseColor(body['eyes'], 'body.eyes') } : {}),
    pieces,
    origin,
    source: o,
  }
}

const parseCond = (v: unknown, where: string): Cond => {
  if (!isObj(v)) return bad(`${where}: a condition must be an object`)
  const out: Cond = {}
  for (const [k, x] of Object.entries(v)) {
    if (k === 'tool') out.tool = new RegExp(`^(?:${regex(x, `${where}.tool`).source})$`, 'i')
    else if (k === 'input') out.input = regex(x, `${where}.input`)
    else if (k === 'state') {
      if (!STATES.includes(x as State)) bad(`${where}: "state" must be one of ${STATES.join(', ')}`)
      out.state = x as State
    } else if (k === 'chance') {
      if (typeof x !== 'number' || x <= 0 || x > 1) bad(`${where}: "chance" must be a probability per second between 0 and 1 (e.g. 0.03 ≈ once every 30 s)`)
      out.chance = x as number
    } else bad(`${where}: "${k}" is not a valid condition field (tool, input, state, chance)`)
  }
  if (!out.tool && !out.input && !out.state) bad(`${where}: condition requires tool, input or state`)
  return out
}

const parsePlay = (v: unknown, id: string): PlayDef => {
  if (!isObj(v)) return bad('"play" must be { "ticks": n, "group": "name", "pass": { "atTick": n, "to": "id" | ["id", ...] } }')
  const ticks = num(v, 'ticks', 2, 240)
  const group = str(v, 'group', true) ?? id
  const pass = v['pass']
  if (pass === undefined) return { ticks, group }
  if (!isObj(pass)) return bad('"play.pass" must be { "atTick": n, "to": "id" | ["id", ...] }')
  const r = pass['to']
  const to = typeof r === 'string' ? [r] : Array.isArray(r) && r.length > 0 && r.every(x => typeof x === 'string') ? (r as string[]) : bad('"play.pass.to" must be another play id or a list of play ids')
  const atTickKey = 'atTick' in pass ? 'atTick' : 'at'
  return { ticks, group, pass: { atTick: num(pass, atTickKey, 0, ticks - 1), to } }
}

const parseAction = (o: Obj, origin: string): Action => {
  const id = idOf(o)
  const when = o['when']
  const conds = when === undefined ? [] : Array.isArray(when) ? when.map((c, i) => parseCond(c, `when[${i}]`)) : [parseCond(when, 'when')]
  const hand = o['hand']
  if (hand !== undefined && hand !== 'left' && hand !== 'right') bad('"hand" must be "left" or "right"')
  return {
    id,
    label: str(o, 'label') as string,
    color: parseColor(o['color'], 'color'),
    when: conds,
    priority: num(o, 'priority', 0, 1000, 60),
    duration: num(o, 'duration', 0, 30000, 0),
    pose: tracks(o['pose'], 'pose', poseStep),
    dim: num(o, 'dim', 0, 1, 0),
    ...(hand ? { hand: hand as 'left' | 'right' } : {}),
    effect: o['effect'] === undefined ? [] : parseLayers(o['effect'], 'effect'),
    ...(o['play'] !== undefined ? { play: parsePlay(o['play'], id) } : {}),
    origin,
    source: o,
  }
}

const MD = /^(\d\d)-(\d\d)$/
const monthDay = (v: unknown, where: string): number => {
  const m = typeof v === 'string' ? MD.exec(v) : null
  const n = m ? Number(m[1]) * 100 + Number(m[2]) : NaN
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) < 1 || Number(m[2]) > 31) return bad(`${where}: date must be "MM-DD" (e.g. "12-24")`)
  return n
}

const parseRules = (o: Obj, origin = 'rules'): { active?: string[]; rules: Rule[]; labels: Record<string, string>; master?: string; kinds?: Record<string, KindDef> } => {
  const master = str(o, 'master', true)
  const kinds: Record<string, KindDef> = {}
  const rawKinds = o['kinds']
  if (rawKinds !== undefined) {
    if (!isObj(rawKinds)) bad('"kinds" must be a kind -> { words, description } object')
    for (const [k, v] of Object.entries(rawKinds as Obj) as [string, unknown][]) {
      if (!ID.test(k)) bad(`kinds.${k}: kind identifier must be lowercase alphanumeric, dash, dot or underscore (got "${k}")`)
      if (!isObj(v)) { bad(`kinds.${k}: must be an object with "words": [...]`); continue }
      const rawWords: unknown[] = Array.isArray(v['words']) ? v['words'] : []
      if (rawWords.length === 0) bad(`kinds.${k}: "words" must be a non-empty list of regular expressions`)
      const words = rawWords.map((w: unknown, idx: number) => regex(w, `kinds.${k}.words[${idx}]`))
      const desc = str(v, 'description', true)
      kinds[k] = { words, ...(desc ? { description: desc } : {}) }
    }
  }
  const list = o['rules']
  if (list !== undefined && !Array.isArray(list)) bad('"rules" must be a list')
  const rules = ((list as unknown[] | undefined) ?? []).map((r, i): Rule => {
    const w = `rules[${i}]`
    if (!isObj(r) || !isObj(r['if'])) return bad(`${w}: each rule must be { "if": {...}, "costume": "id" }`)
    const cond = r['if'] as Obj
    const out: Rule['if'] = {}
    for (const [k, v] of Object.entries(cond)) {
      if (k === 'type' || k === 'name' || k === 'description' || k === 'model' || k === 'prompt' || k === 'mode') {
        out[k] = regex(v, `${w}.if.${k}`)
      } else if (k === 'kind') {
        const kd = str(cond, 'kind') as string
        if (!ID.test(kd)) bad(`${w}.if.kind: must be an identifier (got "${kd}")`)
        out.kind = kd
      } else if (k === 'from' || k === 'to') {
        out[k] = monthDay(v, `${w}.if.${k}`)
      } else {
        bad(`${w}.if: "${k}" is not a valid criterion (type, name, description, model, prompt, mode, kind, from, to)`)
      }
    }
    if ((out.from === undefined) !== (out.to === undefined)) bad(`${w}.if: "from" and "to" must be used together`)
    return {
      origin,
      ruleIdx: i + 1,
      if: out,
      costume: str(r, 'costume') as string,
      ifFree: bool(r, 'ifFree'),
      ...(str(r, 'nickname', true) ? { nickname: str(r, 'nickname') as string } : {}),
    }
  })
  const labels: Record<string, string> = {}
  const t = o['labels']
  if (t !== undefined) {
    if (!isObj(t)) bad('"labels" must be an action -> string object')
    for (const [k, v] of Object.entries(t as Obj)) {
      if (typeof v !== 'string' || v.length > 24) bad(`labels.${k}: must be a string of up to 24 characters`)
      labels[k] = v as string
    }
  }
  return {
    ...(o['active'] !== undefined ? { active: strList(o, 'active') } : {}),
    rules,
    labels,
    ...(master ? { master } : {}),
    ...(Object.keys(kinds).length > 0 ? { kinds } : {}),
  }
}

// ---- building a pack from files (over a base pack: same id replaces)

export type DesignFile = { file: string; text?: string; json?: unknown }

export const compilePack = (files: readonly DesignFile[], base: Pack = emptyPack()): Pack => {
  const p: Pack = {
    pieces: { ...base.pieces },
    costumes: { ...base.costumes },
    actions: { ...base.actions },
    order: [],
    active: [...base.active],
    rules: [...base.rules],
    labels: { ...base.labels },
    problems: [],
    rulesSource: [...base.rulesSource],
    ...(base.master ? { master: base.master } : {}),
    kinds: { ...(base.kinds ?? {}) },
    rulesFiles: [...base.rulesFiles],
  }
  const userRules: Rule[] = []
  const take = (raw: unknown, file: string): void => {
    const o = normalizeDesignJson(raw)
    if (!isObj(o)) return void p.problems.push({ file, msg: 'not a JSON object with "type"', fatal: true })
    const type = o['type']
    const id = typeof o['id'] === 'string' ? (o['id'] as string) : undefined
    try {
      if (type === 'bundle' || type === 'pack') {
        const items = o['items']
        if (!Array.isArray(items)) bad('a bundle requires "items": [...]')
        for (const it of items as unknown[]) take(it, file)
      } else if (type === 'piece') {
        const x = parsePiece(o, file)
        p.pieces[x.id] = x
      } else if (type === 'costume') {
        const x = parseCostume(o, file)
        p.costumes[x.id] = x
      } else if (type === 'action') {
        const x = parseAction(o, file)
        p.actions[x.id] = x
      } else if (type === 'rules') {
        const r = parseRules(o, file)
        if (r.active) p.active = r.active
        if (r.master) p.master = r.master
        if (r.kinds) Object.assign(p.kinds!, r.kinds)
        userRules.push(...r.rules)
        Object.assign(p.labels, r.labels)
        p.rulesSource.push(o)
        if (!p.rulesFiles.includes(file)) p.rulesFiles.push(file)
      } else bad(`"type" must be piece, costume, action, rules or bundle (got "${String(type)}")`)
    } catch (e) {
      if (!(e instanceof Bad)) throw e
      p.problems.push({ file, ...(id ? { id } : {}), msg: e.message, fatal: true })
    }
  }
  for (const f of files) {
    let json = f.json
    if (json === undefined) {
      try {
        json = JSON.parse(f.text ?? '')
      } catch (e) {
        p.problems.push({ file: f.file, msg: `malformed JSON: ${(e as Error).message}`, fatal: true })
        continue
      }
    }
    take(json, f.file)
  }
  // the user's rules are tried before the built-in ones
  p.rules = [...userRules, ...p.rules]
  return link(p)
}

/** Cross-references: costumes name pieces that exist, one piece per slot, nothing under what another covers. */
const link = (p: Pack): Pack => {
  for (const d of Object.values(p.costumes)) {
    const missing = d.pieces.filter(id => !p.pieces[id])
    const used = new Map<Slot, string>()
    const problems: string[] = missing.map(id => `piece "${id}" does not exist`)
    for (const id of d.pieces) {
      const pz = p.pieces[id]
      if (!pz) continue
      for (const s of [pz.slot, ...pz.occupies]) {
        const other = used.get(s)
        if (other) problems.push(`"${id}" and "${other}" both use slot "${s}"`)
        else used.set(s, id)
      }
    }
    if (problems.length > 0) {
      for (const msg of problems) p.problems.push({ file: d.origin, id: d.id, msg, fatal: true })
      delete p.costumes[d.id]
    }
  }
  if (p.master && !p.costumes[p.master]) p.problems.push({ file: 'rules', msg: `"master" costume "${p.master}" does not exist`, fatal: false })
  for (const r of p.rules) {
    if (!p.costumes[r.costume]) p.problems.push({ file: r.origin, msg: `a rule uses costume "${r.costume}", which does not exist`, fatal: false })
    if (r.if.kind && (!p.kinds || !p.kinds[r.if.kind])) p.problems.push({ file: r.origin, msg: `a rule uses kind "${r.if.kind}", which is not defined in "kinds"`, fatal: false })
  }
  for (const a of p.active) if (!p.costumes[a]) p.problems.push({ file: 'rules', msg: `"active" includes "${a}", which does not exist`, fatal: false })
  for (const a of Object.values(p.actions)) {
    for (const to of a.play?.pass?.to ?? [])
      if (!p.actions[to]?.play) p.problems.push({ file: a.origin, id: a.id, msg: `passes the ball to "${to}", which is not a play`, fatal: false })
  }
  const known = new Set(Object.keys(p.actions))
  for (const pz of Object.values(p.pieces))
    for (const c of pz.layers) for (const k of Object.keys(c.anim)) if (k !== '*' && !known.has(k)) p.problems.push({ file: pz.origin, id: pz.id, msg: `animates action "${k}", which does not exist`, fatal: false })
  p.order = Object.values(p.actions).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  return p
}

/** Removes pieces (and the costumes that use them) after a failed fit check, keeping the reasons. */
export const without = (p: Pack, pieces: ReadonlySet<string>, problems: Problem[]): Pack => {
  if (pieces.size === 0 && problems.length === 0) return p
  const keptPieces = Object.fromEntries(Object.entries(p.pieces).filter(([id]) => !pieces.has(id)))
  const keptCostumes = Object.fromEntries(Object.entries(p.costumes).filter(([, d]) => !d.pieces.some(id => pieces.has(id))))
  for (const d of Object.values(p.costumes))
    if (!keptCostumes[d.id]) p.problems.push({ file: d.origin, id: d.id, msg: `not used: wears ${d.pieces.filter(id => pieces.has(id)).join(', ')}, which did not pass the fit check`, fatal: true })
  return { ...p, pieces: keptPieces, costumes: keptCostumes, problems: [...p.problems, ...problems] }
}

// ---- tracks

const mod = (n: number, m: number): number => ((n % m) + m) % m

export const evalTracks = <S extends object>(ts: readonly Track<S>[], t: number, merge: (a: S, b: S) => S, start: S): S => {
  let out = start
  for (const tr of ts) {
    const s = tr.kind === 'fixed' ? tr.s : tr.kind === 'steps' ? tr.steps[mod(Math.floor(t / tr.every), tr.steps.length)] : tr.at.get(mod(t, tr.period))
    if (s) out = merge(out, s)
  }
  return out
}

const mergeStep = (a: Step, b: Step): Step => ({ ...a, ...b, ...(a.pal || b.pal ? { pal: { ...a.pal, ...b.pal } } : {}) })

export const poseOf = (a: Action | undefined, t: number): Pose => (a ? (evalTracks<Partial<Pose>>(a.pose, t, (x, y) => ({ ...x, ...y }), POSE0) as Pose) : POSE0)

const stepOf = (c: Layer, action: string, t: number): Step => evalTracks(c.anim[action] ?? c.anim['*'] ?? [], t, mergeStep, {})

const drawLayer = (put: Put, ox: number, oy: number, c: Layer, off: { x: number; y: number }, action: string, t: number, tag: string, free = false): void => {
  const s = stepOf(c, action, t)
  if (s.hidden) return
  const rows = c.drawings[s.d ?? c.first] ?? []
  stampWith(put, ox + c.x + off.x + (s.x ?? 0), oy + c.y + off.y + (s.y ?? 0), rows, s.pal ? { ...c.pal, ...s.pal } : c.pal, c.leaves ? TAG.leaves(tag) : free || c.free ? TAG.free(tag) : tag)
}

// ---- drawing one agent

export type Plan = { pose: Pose; mirror: boolean; hidden: Set<string>; effect: boolean; pieces: Piece[]; body: number }

/** Decides what is drawn: the pose, which pieces, whether the effect moves to the other claw. */
export const planOf = (pack: Pack, costume: string, action: string, t: number): Plan => {
  const d = pack.costumes[costume] ?? pack.costumes[resolveLegacyId('costume', costume)] ?? pack.costumes[FALLBACK_COSTUME]
  const a = pack.actions[action] ?? pack.actions[resolveLegacyId('action', action)] ?? pack.actions[FALLBACK_ACTION]
  const pieces = (d?.pieces ?? []).map(id => pack.pieces[id]).filter((x): x is Piece => x !== undefined)
  let pose = poseOf(a, t)
  const hidden = new Set<string>()
  let mirror = false
  const effect = a !== undefined && a.effect.length > 0 && !pieces.some(p => p.coversAction.includes(a.id))
  // an action that needs a claw: if the costume holds something there, use the other claw when it
  // is free, otherwise put the costume's prop away while the action lasts. Nothing is drawn twice.
  if (effect && a?.hand) {
    const own: Slot = `hand.${a.hand}`
    const other: Slot = a.hand === 'left' ? 'hand.right' : 'hand.left'
    const holds = (s: Slot) => pieces.find(p => p.slot === s || p.occupies.includes(s))
    const holder = holds(own)
    if (holder) {
      if (!holds(other)) mirror = true
      else hidden.add(holder.id)
    }
  }
  if (mirror) pose = mirrorPose(pose)
  const base = d?.body ?? CLAY
  const body = a && a.dim > 0 ? mix(base, 0x808080, a.dim) : base
  return { pose, mirror, hidden, effect, pieces, body }
}

/** Draws one agent card at (ox, oy): pieces by slot around the body, then the action's effect. */
export const renderAgent = (put: Put, ox: number, oy: number, pack: Pack, costume: string, action: string, t: number): void => {
  const d = pack.costumes[costume] ?? pack.costumes[resolveLegacyId('costume', costume)] ?? pack.costumes[FALLBACK_COSTUME]
  const a = pack.actions[action] ?? pack.actions[resolveLegacyId('action', action)] ?? pack.actions[FALLBACK_ACTION]
  const pl = planOf(pack, costume, action, t)
  const actionId = a?.id ?? action
  // turning squeezes the body and everything it wears together; from behind, nothing on the face shows
  const body = turned(put, ox, pl.pose)
  const layers = pl.pieces
    .filter(p => !pl.hidden.has(p.id) && !(pl.pose.facingAway && FACE_SLOTS.includes(p.slot)))
    .sort((x, y) => slotLayer(x.slot) - slotLayer(y.slot))
  let bodyDrawn = false
  for (const p of layers) {
    if (!bodyDrawn && slotLayer(p.slot) > BODY_LAYER) {
      drawCrab(body, ox, oy, pl.body, pl.pose, d?.eyes)
      bodyDrawn = true
    }
    const off = anchorOffset(p.anchor, pl.pose)
    for (const c of p.layers) drawLayer(body, ox, oy, c, off, actionId, t, TAG.piece(p.id), p.free)
  }
  if (!bodyDrawn) drawCrab(body, ox, oy, pl.body, pl.pose, d?.eyes)
  if (pl.effect && a) {
    const fx: Put = pl.mirror ? (x, y, col, tag) => put(ox + CARD_W - 1 - (x - ox), y, col, tag) : put
    for (const c of a.effect) drawLayer(fx, ox, oy, c, { x: 0, y: 0 }, actionId, t, TAG.effect(a.id))
  }
}

// ---- which action an agent shows (from recorded facts only)

export type Facts = {
  id?: string
  tests?: readonly { ok: boolean | null; at: number }[]
  status: 'running' | 'done' | 'failed' | 'killed'
  endedAt?: number
  blockers: readonly string[]
  inTool: boolean
  anim: string
  lastEventAt: number
  toolCount: number
  declaredAt?: number
  lastTool?: string
  lastToolInput?: string
  lastToolAt?: number
}

const inState = (e: State, a: Facts, now: number): boolean => {
  const running = a.status === 'running'
  switch (e) {
    case 'asleep':
      return a.status === 'done' && a.endedAt !== undefined && now - a.endedAt > SLEEP_MS
    case 'finished':
      return a.status === 'done'
    case 'failed':
      return a.status === 'failed' || a.status === 'killed'
    case 'blocked':
      return running && a.blockers.length > 0
    case 'error':
      return running && !a.inTool && a.anim === 'error' && now - a.lastEventAt < ERROR_MS
    case 'thinking':
      return running && !a.inTool && (a.toolCount > 0 || a.declaredAt !== undefined)
    case 'working':
      return running && a.inTool
    case 'starting':
      return running
    case 'tests-ok': {
      const last = a.tests?.[a.tests.length - 1]
      return last !== undefined && last.ok === true && now - last.at < ERROR_MS
    }
  }
}

/** A deterministic coin per agent and second: `chance` 0.03 comes up about once every 30 s. */
const coin = (id: string, now: number, p: number): boolean => hash(`${id}:${Math.floor(now / 1000)}`) / 0x100000000 < p

const matches = (c: Cond, act: Action, a: Facts, now: number): boolean => {
  if (c.state && !inState(c.state, a, now)) return false
  if (c.chance !== undefined && !coin(a.id ?? '', now, c.chance)) return false
  if (c.tool || c.input) {
    if (a.status !== 'running' || !a.lastTool) return false
    const live = a.inTool || (act.duration > 0 && a.lastToolAt !== undefined && now - a.lastToolAt < act.duration)
    if (!live) return false
    if (c.tool && !c.tool.test(a.lastTool)) return false
    if (c.input && !c.input.test(a.lastToolInput ?? '')) return false
  }
  return true
}

/** The looping action an agent shows (plays are started by the director, never chosen here). */
export const resolveAction = (pack: Pack, a: Facts, now: number): Action | undefined =>
  pack.order.find(act => !act.play && act.when.some(c => matches(c, act, a, now))) ?? pack.actions[FALLBACK_ACTION]

/** The plays whose condition holds right now (the director starts one when this set gains a member). */
export const playsReady = (pack: Pack, a: Facts, now: number): string[] =>
  pack.order.filter(act => act.play && act.when.some(c => matches(c, act, a, now))).map(act => act.id)

/** The label of an action, with the user's text override. */
export const labelOf = (pack: Pack, act: Action | undefined): [string, number] => (act ? [pack.labels[act.id] ?? act.label, act.color] : ['●', 0x9aa0a8])

export const costumeColor = (pack: Pack, id: string): number => (pack.costumes[id] ?? pack.costumes[FALLBACK_COSTUME])?.color ?? 0x888780

// ---- which costume an agent wears: rules first, then rotation without repeats

export const hash = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export type Who = { id: string; type: string; description: string; name?: string; model?: string; mode?: string; prompt?: string; kind?: string }

const inDates = (cond: Rule['if'], now: number): boolean => {
  if (cond.from === undefined || cond.to === undefined) return true
  const d = new Date(now)
  const md = (d.getMonth() + 1) * 100 + d.getDate()
  return cond.from <= cond.to ? md >= cond.from && md <= cond.to : md >= cond.from || md <= cond.to
}

const ruleMatches = (r: Rule, w: Who, now: number): boolean => {
  const bare = w.type.includes(':') ? (w.type.split(':').pop() ?? w.type) : w.type
  const cond = r.if
  if (cond.type && !cond.type.test(bare) && !cond.type.test(w.type)) return false
  if (cond.name && !cond.name.test(w.name ?? '')) return false
  if (cond.description && !cond.description.test(w.description)) return false
  if (cond.model && !cond.model.test(w.model ?? '')) return false
  if (cond.mode && !cond.mode.test(w.mode ?? '')) return false
  if (cond.prompt && !cond.prompt.test((w.prompt ?? '').slice(0, 400))) return false
  if (cond.kind && cond.kind !== w.kind) return false
  return inDates(cond, now)
}

export const resolveCostume = (pack: Pack, w: Who, taken: readonly string[], now: number): { costume: string; nickname?: string; by: string } => {
  for (const r of pack.rules) {
    if (!pack.costumes[r.costume] || !ruleMatches(r, w, now)) continue
    if (r.ifFree && taken.includes(r.costume)) continue
    return { costume: r.costume, ...(r.nickname ? { nickname: r.nickname } : {}), by: `${r.origin} #${r.ruleIdx}` }
  }
  const list = pack.active.filter(id => pack.costumes[id])
  if (list.length === 0) return { costume: FALLBACK_COSTUME, by: 'fallback' }
  const start = hash(w.id) % list.length
  for (let i = 0; i < list.length; i++) {
    const c = list[(start + i) % list.length] as string
    if (!taken.includes(c)) return { costume: c, by: 'rotation' }
  }
  return { costume: list[start] as string, by: 'rotation' }
}

// ---- sharing: a costume (or piece, or action) and everything it needs, as one file

export const bundle = (pack: Pack, ids: readonly string[]): { json: unknown; missing: string[] } => {
  const items: unknown[] = []
  const seen = new Set<string>()
  const missing: string[] = []
  const add = (kind: string, id: string, src: unknown) => {
    if (seen.has(`${kind}:${id}`)) return
    seen.add(`${kind}:${id}`)
    items.push(src)
  }
  for (const rawId of ids) {
    const cId = resolveLegacyId('costume', rawId)
    const pId = resolveLegacyId('piece', rawId)
    const aId = resolveLegacyId('action', rawId)
    const d = pack.costumes[rawId] ?? pack.costumes[cId]
    const pz = pack.pieces[rawId] ?? pack.pieces[pId]
    const ac = pack.actions[rawId] ?? pack.actions[aId]
    if (d) {
      add('costume', d.id, d.source)
      for (const p of d.pieces) if (pack.pieces[p]) add('piece', p, pack.pieces[p]?.source)
    } else if (pz) add('piece', pz.id, pz.source)
    else if (ac) add('action', ac.id, ac.source)
    else missing.push(rawId)
  }
  return { json: { type: 'bundle', format: 'crabbus/1', name: ids.join(', '), items }, missing }
}
