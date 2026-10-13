// Plays: one-shot actions (a spin, a football kick-about) and the passes between crabs. Pure: no `$`.
//
// Looping actions are chosen from facts at every frame (pack.resolveAction). A play is different:
// it starts when its condition *becomes* true (finishing, tests passing, a random moment while
// thinking), runs once from its own tick 0, and may pass the ball to another crab, which then
// starts the receiving play. Passes stop after MAX_PASSES so a ball never bounces forever.

import { hash, playsReady, type Pack } from './pack.ts'
import type { BusState } from './model.ts'
import { onStage } from './scene.ts'

/** The master's id in the director (it can receive and return passes). */
export const MASTER = ''
export const MAX_PASSES = 3

/** What the master does at random moments, so it is never just sitting there (a spin or one of its own plays). */
export const MASTER_IDLE = ['spin', 'master.hop', 'master.wave', 'master.dance']
/** Chance, checked once a second, that the master starts an idle play: about one every six seconds. */
const IDLE_CHANCE = 16 // out of 100

export type Play = { action: string; start: number; chain: number; passed: boolean }

export type Director = {
  plays: Record<string, Play>
  /** The plays whose condition held at the last step, per agent: a play starts on a new member. */
  ready: Record<string, string[]>
  /** Agents met at least once: what already holds when an agent is first seen (after a reload) is not news. */
  seen: Record<string, true>
}

export const emptyDirector = (): Director => ({ plays: {}, ready: {}, seen: {} })

/** Who gets the ball: the next crab on stage after the kicker, then the master; never one already playing. */
const receiver = (order: readonly string[], from: string, plays: Record<string, Play>): string | undefined => {
  const ids = [...order, MASTER]
  const i = ids.indexOf(from)
  for (let k = 1; k < ids.length; k++) {
    const id = ids[(i + k) % ids.length] as string
    if (id !== from && !plays[id]) return id
  }
  return undefined
}

export const direct = (d: Director, s: BusState, pack: Pack, now: number, frame: number): Director => {
  const plays = { ...d.plays }
  const ready = { ...d.ready }
  const seen = { ...d.seen }
  const cast = onStage(s, now)
  const order = cast.map(a => a.id)
  // finish plays, and pass the ball when a kick lands
  for (const [id, p] of Object.entries(plays)) {
    const j = pack.actions[p.action]?.play
    const t = frame - p.start
    if (!j || t >= j.ticks || t < 0 || (id !== MASTER && !order.includes(id))) {
      delete plays[id]
      continue
    }
    if (j.pass && !p.passed && t >= j.pass.atTick) {
      plays[id] = { ...p, passed: true }
      const options = j.pass.to.filter(r => pack.actions[r]?.play)
      if (p.chain < MAX_PASSES && options.length > 0) {
        const to = receiver(order, id, plays)
        if (to !== undefined) plays[to] = { action: options[hash(`${id}>${to}:${frame}`) % options.length] as string, start: frame, chain: p.chain + 1, passed: false }
      }
    }
  }
  // start a play whose condition has just become true
  for (const a of cast) {
    const now_ = playsReady(pack, a, now)
    const before = ready[a.id]
    ready[a.id] = now_
    if (!seen[a.id]) {
      seen[a.id] = true
      continue
    }
    if (plays[a.id]) continue
    // one ball at a time: while one is in play, plays that bring a ball wait for another moment
    const ballInPlay = Object.values(plays).some(p => pack.actions[p.action]?.play?.pass !== undefined)
    const fresh = now_.filter(x => !before?.includes(x) && !(ballInPlay && pack.actions[x]?.play?.pass))
    if (fresh.length === 0) continue
    // a group first (spin or football, equally likely), then one of its variants
    const groups = [...new Set(fresh.map(x => pack.actions[x]?.play?.group ?? x))]
    const group = groups[hash(`${a.id}:${frame}`) % groups.length] as string
    const variants = fresh.filter(x => (pack.actions[x]?.play?.group ?? x) === group)
    plays[a.id] = { action: variants[hash(`${a.id}:${frame}:v`) % variants.length] as string, start: frame, chain: 0, passed: false }
  }
  // the master, always on screen, plays now and then by itself
  if (!plays[MASTER] && frame % 6 === 0 && hash(`idle:${frame}`) % 100 < IDLE_CHANCE) {
    const idle = MASTER_IDLE.filter(x => pack.actions[x]?.play)
    if (idle.length > 0) plays[MASTER] = { action: idle[hash(`idle:${frame}:v`) % idle.length] as string, start: frame, chain: 0, passed: false }
  }
  for (const id of Object.keys(ready)) if (!order.includes(id)) delete ready[id]
  return { plays, ready, seen }
}

/** What a card draws for an agent while it plays: the play's action at the play's own tick. */
export const playOf = (d: Director | undefined, id: string, frame: number): { action: string; t: number } | undefined => {
  const p = d?.plays[id]
  return p ? { action: p.action, t: frame - p.start } : undefined
}
