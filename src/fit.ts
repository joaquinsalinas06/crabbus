// Contract C: the fit check. Pure: no `$`, no Node.
//
// Before a design is used, every costume is drawn in every action at every tick of a full cycle,
// and each piece must:
//   stay on the card        no pixel outside 18x14, the highest jump included
//   hold on                 every part touches the body or another piece (unless it says `free`)
//   keep the eyes visible   while facing us, unless it says `coversEyes` (an eyepatch, a visor)
//   show on both themes     its outline reads on a dark and on a light terminal
// A piece that fails is not used; the costumes that wear it are not used either, and the reason
// (which check, which action, which tick) is reported in English.

import { CARD_H, CARD_W } from './canvas.ts'
import { compilePack, effectiveBodyId, planOf, renderAgent, without, type DesignFile, type Pack, type Problem, type CostumeDef, type Piece, type Action } from './pack.ts'
import { TAG } from './rig.ts'

const M = 8 // margin around the card, to see what spills
const W = CARD_W + 2 * M
const H = CARD_H + 2 * M
export const CYCLE = 60 // ticks checked: covers periods 1-6, 10, 12, 15, 16 (blink), 20, 30, 60

type Drawn = { tags: Map<string, Set<number>>; eyes: Set<number>; covered: Map<string, number>; color: Map<number, number>; owner: Map<number, string> }

const draw = (pack: Pack, costume: string, action: string, t: number): Drawn => {
  const tags = new Map<string, Set<number>>()
  const eyes = new Set<number>()
  const covered = new Map<string, number>()
  const color = new Map<number, number>()
  const owner = new Map<number, string>()
  renderAgent((x, y, col, tag) => {
    const k = y * W + x
    if (tag === TAG.eye) eyes.add(k)
    else if (TAG.isPiece(tag) && eyes.has(k)) covered.set(tag, (covered.get(tag) ?? 0) + 1)
    let s = tags.get(tag)
    if (!s) tags.set(tag, (s = new Set()))
    s.add(k)
    color.set(k, col)
    owner.set(k, TAG.stripFlags(tag))
  }, M, M, pack, costume, action, t)
  return { tags, eyes, covered, color, owner }
}

const inside = (k: number): boolean => {
  const x = k % W
  const y = Math.floor(k / W)
  return x >= M && x < M + CARD_W && y >= M && y < M + CARD_H
}

const near = (k: number, set: ReadonlySet<number>): boolean => {
  const x = k % W
  const y = Math.floor(k / W)
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (set.has((y + dy) * W + x + dx)) return true
  return false
}

/** 8-connected components of a pixel set. */
const components = (px: ReadonlySet<number>): number[][] => {
  const left = new Set(px)
  const out: number[][] = []
  for (const start of px) {
    if (!left.has(start)) continue
    left.delete(start)
    const comp = [start]
    for (let i = 0; i < comp.length; i++) {
      const k = comp[i] as number
      const x = k % W
      const y = Math.floor(k / W)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = (y + dy) * W + x + dx
          if (left.has(n)) {
            left.delete(n)
            comp.push(n)
          }
        }
    }
    out.push(comp)
  }
  return out
}

/** Parts of non-free pieces that touch neither the body nor anything already holding on. */
const floating = (d: Drawn): Map<string, number> => {
  const held = new Set<number>()
  for (const [tag, s] of d.tags) if (tag === TAG.body || tag === TAG.eye || TAG.isFree(tag)) for (const k of s) held.add(k)
  const pending: { tag: string; comp: number[] }[] = []
  for (const [tag, s] of d.tags) if (TAG.isPiece(tag) && !TAG.isFree(tag)) for (const comp of components(s)) pending.push({ tag, comp })
  let changed = true
  while (changed) {
    changed = false
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i] as (typeof pending)[number]
      if (p.comp.some(k => held.has(k) || near(k, held))) {
        for (const k of p.comp) held.add(k)
        pending.splice(i, 1)
        changed = true
      }
    }
  }
  const out = new Map<string, number>()
  for (const p of pending) out.set(p.tag, (out.get(p.tag) ?? 0) + p.comp.length)
  return out
}

// ---- contrast (WCAG relative luminance)

const lum = (c: number): number => {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch((c >> 16) & 255) + 0.7152 * ch((c >> 8) & 255) + 0.0722 * ch(c & 255)
}
export const contrast = (a: number, b: number): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
export const BACKGROUNDS = { dark: 0x1e1e1e, light: 0xffffff } as const
const MIN_CONTRAST = 1.3
// measured: built-in pieces read at 0.66-1.00; a white cloud on light 0.36, the 0.2 chef hat without its grey outline 0.47
const MIN_VISIBLE_EDGE = 0.6

/**
 * Share of a piece's outline that reads on background `bg`: every side of a visible pixel that
 * faces something else (empty background, the body, another piece) is one segment, seen when the
 * two colors contrast. A moustache on the face reads against the face; a white hat on a light
 * terminal has most of its outline against the background and fails.
 */
export const edgeVisibility = (d: Drawn, tag: string, bg: number): number => edgeStats(d, tag, bg).share

/** The share seen, and against what the unseen segments are: the terminal, the body, or other pieces. */
const edgeStats = (d: Drawn, tag: string, bg: number): { share: number; lostOn: 'background' | 'body' | 'pieces' } => {
  const mine = d.tags.get(tag)
  const lost = { background: 0, body: 0, pieces: 0 }
  if (!mine) return { share: 1, lostOn: 'background' }
  const own = TAG.stripFlags(tag)
  let edge = 0
  let seen = 0
  for (const k of mine) {
    if (d.owner.get(k) !== own) continue // covered by something drawn later
    const col = d.color.get(k) as number
    for (const o of [-1, 1, -W, W]) {
      const other = d.owner.get(k + o)
      if (other === own) continue
      edge++
      if (contrast(col, d.color.get(k + o) ?? bg) >= MIN_CONTRAST) seen++
      else lost[other === undefined ? 'background' : other === TAG.body || other === TAG.eye ? 'body' : 'pieces']++
    }
  }
  const lostOn = (Object.entries(lost).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'background') as 'background' | 'body' | 'pieces'
  return { share: edge === 0 ? 1 : seen / edge, lostOn }
}

/** How well each piece of a costume reads on each theme (0..1), on the resting crab. */
export const visibility = (pack: Pack, costume: string): Record<string, Record<keyof typeof BACKGROUNDS, number>> => {
  const rest = draw(pack, costume, 'walk', 0)
  const out: Record<string, Record<keyof typeof BACKGROUNDS, number>> = {}
  for (const id of pack.costumes[costume]?.pieces ?? []) out[id] = { dark: edgeVisibility(rest, TAG.piece(id), BACKGROUNDS.dark), light: edgeVisibility(rest, TAG.piece(id), BACKGROUNDS.light) }
  return out
}

// ---- the check

const where = (action: string, t: number) => `in "${action}" (tick ${t})`

export type FitReport = { problems: Problem[]; badPieces: Set<string>; badActions: Set<string>; badCostumes: Set<string> }

export const checkPack = (pack: Pack, only?: ReadonlySet<string>): FitReport => {
  const problems: Problem[] = []
  const badPieces = new Set<string>()
  const badActions = new Set<string>()
  const badCostumes = new Set<string>()
  let context = ''
  const said = new Set<string>()
  const report = (id: string, kind: string, msg: string, file: string, isAction = false) => {
    if (said.has(`${context}:${id}:${kind}`)) return
    said.add(`${context}:${id}:${kind}`)
    problems.push({ file, id, msg: `${msg}${context}`, fatal: true })
    ;(isAction ? badActions : badPieces).add(id)
  }
  // every piece is checked inside each costume that wears it; a piece nobody wears, on its own
  const cases: { costume: string; pack: Pack }[] = Object.keys(pack.costumes).map(costume => ({ costume, pack }))
  const worn = new Set(Object.values(pack.costumes).flatMap(d => d.pieces))
  for (const id of Object.keys(pack.pieces)) {
    if (worn.has(id)) continue
    const solo = `(solo) ${id}`
    cases.push({ costume: solo, pack: { ...pack, costumes: { ...pack.costumes, [solo]: { id: solo, name: id, color: 0x888780, body: 0xd97757, pieces: [id], origin: '', source: null } } } })
  }
  const actions = Object.keys(pack.actions)
  for (const { costume, pack: p } of cases) {
    const d = p.costumes[costume]
    if (!d || (only && !d.pieces.some(id => only.has(id)) && !only.has(costume))) continue
    context = ` [body "${effectiveBodyId(p, costume)}", costume "${costume}"]`
    for (const action of actions)
      for (let t = 0; t < CYCLE; t++) {
        const drawn = draw(p, costume, action, t)
        for (const [tag, s] of drawn.tags) {
          if (TAG.isLeaves(tag)) continue
          const out = [...s].filter(k => !inside(k))
          if (out.length === 0) continue
          const y = Math.floor((out[0] as number) / W) - M
          const side = y < 0 ? 'at the top' : y >= CARD_H ? 'at the bottom' : 'on the side'
          if (tag === TAG.body || tag === TAG.eye) {
            const key = `${context}:body-edge`
            if (!said.has(key)) {
              said.add(key)
              badCostumes.add(costume)
              problems.push({ file: p.bodies[effectiveBodyId(p, costume)]?.origin ?? d.origin, id: costume,
                msg: `body spills outside the card ${side} ${where(action, t)}${context}`, fatal: true })
            }
          } else if (TAG.isEffect(tag)) {
            const id = TAG.effectId(tag)
            report(id, 'edge', `effect spills outside the card ${side} (tick ${t})`, p.actions[id]?.origin ?? '', true)
          } else {
            const id = TAG.pieceId(tag)
            report(id, 'edge', `spills outside the card ${side} ${where(action, t)}; lower it or make it smaller`, p.pieces[id]?.origin ?? '')
          }
        }
        for (const [tag, n] of floating(drawn)) {
          const id = TAG.pieceId(tag)
          report(id, 'float', `floats ${where(action, t)}: ${n} pixel(s) do not touch the body or another piece (on "${d.name}"). Move it closer to its anchor or mark the layer "free": true`, p.pieces[id]?.origin ?? '')
        }
        // the eyes are protected while the crab faces us; turning, something in front of an eye is just perspective
        const front = (() => { const ps = planOf(p, costume, action, t).pose; return ps.width >= 1 && !ps.facingAway })()
        if (front) for (const [tag] of drawn.covered) {
          const id = TAG.pieceId(tag)
          if (p.pieces[id]?.coversEyes) continue
          report(id, 'eyes', `covers the eyes ${where(action, t)}; move it or declare "coversEyes": true if intentional`, p.pieces[id]?.origin ?? '')
        }
      }
    // contrast: on the resting crab
    const rest = draw(p, costume, 'walk', 0)
    for (const id of d.pieces) {
      for (const [name, bg] of Object.entries(BACKGROUNDS)) {
        const v = edgeStats(rest, TAG.piece(id), bg)
        if (v.share >= MIN_VISIBLE_EDGE) continue
        const fix =
          v.lostOn === 'background' ? `add a ${name === 'light' ? 'darker' : 'lighter'} outline`
          : v.lostOn === 'body' ? `blends into the body (#${d.body.toString(16).padStart(6, '0')}): use lighter or darker colors`
          : 'blends into another piece of the costume: change one of the two colors'
        report(id, v.lostOn === 'background' ? `contrast-${name}` : `contrast-${v.lostOn}`, `barely visible on ${name} background (only ${Math.round(v.share * 100)} % of its outline contrasts); ${fix}`, p.pieces[id]?.origin ?? '')
      }
    }
  }
  return { problems, badPieces, badActions, badCostumes }
}

/** Compiles design files over `base` and drops whatever does not fit, saying why. */
export const loadPack = (files: readonly DesignFile[], base: Pack): Pack => {
  const p = compilePack(files, base)
  // built-in content was checked by the tests; only what the files added or replaced is checked here
  const touched = new Set<string>()
  for (const [id, x] of Object.entries(p.pieces)) if (x !== base.pieces[id]) touched.add(id)
  for (const [id, x] of Object.entries(p.costumes)) if (x !== base.costumes[id]) touched.add(id)
  const newActions = Object.values(p.actions).some(a => a !== base.actions[a.id])
  const newBodies = p.defaultBody !== base.defaultBody || Object.values(p.bodies).some(b => b !== base.bodies[b.id])
  const r = checkPack(p, newActions || newBodies ? undefined : touched)
  const dropped = without(p, r.badPieces, r.problems)
  const out = { ...dropped, costumes: Object.fromEntries(Object.entries(dropped.costumes).filter(([id]) => !r.badCostumes.has(id))) }
  if (r.badActions.size === 0) return out
  const actions = Object.fromEntries(Object.entries(out.actions).filter(([id]) => !r.badActions.has(id)))
  return { ...out, actions, order: out.order.filter(a => !r.badActions.has(a.id)) }
}

/** Reuse fit across rules-only pack revisions; geometry references invalidate the entry. */
type BodyFit = { pieces: (Piece | undefined)[]; actions: Action[]; problems: Problem[] }
const bodyFits = new WeakMap<CostumeDef, WeakMap<object, BodyFit>>()
export const bodyCompatibility = (pack: Pack, costume: string, body: string): Problem[] => {
  const d = pack.costumes[costume], b = pack.bodies[body]
  if (!d || !b || !Object.hasOwn(pack.bodies, body)) return [{ file: 'body', msg: `unknown costume "${costume}" or body "${body}"`, fatal: true }]
  let cache = bodyFits.get(d)
  if (!cache) { cache = new WeakMap(); bodyFits.set(d, cache) }
  const pieces = d.pieces.map(id => pack.pieces[id])
  const actions = Object.values(pack.actions)
  const prior = cache.get(b)
  if (prior && prior.pieces.length === pieces.length && prior.actions.length === actions.length &&
    pieces.every((p, i) => p === prior.pieces[i]) && actions.every((a, i) => a === prior.actions[i])) return prior.problems
  const problems = checkPack({ ...pack, costumes: { [costume]: { ...d, bodyId: body } },
    pieces: Object.fromEntries(pieces.filter((p): p is Piece => p !== undefined).map(p => [p.id, p])) }).problems
  cache.set(b, { pieces, actions, problems })
  return problems
}

export const defaultBodyCompatibility = (pack: Pack, body: string): Problem[] => {
  if (!Object.hasOwn(pack.bodies, body)) return [{ file: 'rules', msg: `unknown body "${body}"`, fatal: true }]
  return Object.values(pack.costumes).filter(d => !d.bodyId).flatMap(d => bodyCompatibility(pack, d.id, body))
}
