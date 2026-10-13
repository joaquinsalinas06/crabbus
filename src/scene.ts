// The band above the prompt: layout, moods and labels. Pure: no `$`; callers pass `now` and the tick.
//
// Everything drawn comes from recorded facts (model.ts). A mood is chosen from what hooks observed or
// what the agent declared; when nothing specific is known the crab just walks.

import { CARD_H, CARD_W, canvas, drawAgent, drawEnvelope, drawMaster, drawQuestion, set, stamp, type Canvas, type Mood } from './art.ts'
import { BUILTIN } from './builtin.ts'
import { desaturate, halve } from './canvas.ts'
import { uiStatus, type AgentRec, type BusState } from './model.ts'
import { C, type UiStatus } from './theme.ts'
import { FALLBACK_ACTION, SLEEP_MS, costumeColor, labelOf, resolveAction, type Pack } from './pack.ts'
import { TEXT } from './text.ts'

export const GAP = 1 // columns between cards
export const LINGER_MS = 20000 // a finished agent stays on stage this long
export { SLEEP_MS }
const FLIGHT_MS = 1400

export type Layout =
  | { kind: 'none' }
  | { kind: 'line' } // too small for sprites: one colored text line
  | { kind: 'stage'; agents: AgentRec[]; hidden: number; labelRows: 1 | 2 | 3; withMaster: boolean }

export const onStage = (s: BusState, now: number): AgentRec[] =>
  Object.values(s.agents)
    .filter(a => a.status === 'running' || (a.endedAt !== undefined && now - a.endedAt < LINGER_MS))
    .sort((x, y) => x.startedAt - y.startedAt)

/** Messages still travelling or waiting at an agent keep the stage up. */
const liveMsgs = (s: BusState, now: number) => s.msgs.filter(m => m.accepted && (m.ackedAt === undefined || now - m.ackedAt < 4000))

export const isActive = (s: BusState, now: number): boolean => onStage(s, now).length > 0

/** Picks what fits: sprites need 7 rows plus labels; each card is CARD_W columns. */
export const layout = (s: BusState, now: number, columns: number, maxRows: number): Layout => {
  const list = onStage(s, now)
  if (list.length === 0) return { kind: 'none' }
  const per = CARD_W + GAP
  const fit = Math.floor((columns + GAP) / per)
  if (fit < 2 || maxRows < 8) return { kind: 'line' }
  const labelRows: 1 | 2 | 3 = maxRows >= 10 ? 3 : maxRows >= 9 ? 2 : 1
  const room = fit - 1 // one card for the master; extra agents are counted in its label
  const shown = list.slice(0, room)
  return { kind: 'stage', agents: shown, hidden: list.length - shown.length, labelRows, withMaster: true }
}

/** The action an agent shows now: the highest-priority action whose condition the recorded facts meet. */
export const moodOf = (a: AgentRec, now: number, pack: Pack = BUILTIN): Mood => resolveAction(pack, a, now)?.id ?? FALLBACK_ACTION

/** What the pane and labels call an agent: a wardrobe nickname, its name, or its description. */
export const shownName = (a: AgentRec): string => a.nickname ?? a.name ?? a.description

const word = (pack: Pack, a: AgentRec, now: number): [string, number] => labelOf(pack, resolveAction(pack, a, now))

/** Width in columns of the drawn stage (cards plus the `+N` slot and the master). */
export const stageWidth = (l: Extract<Layout, { kind: 'stage' }>): number => {
  const cards = l.agents.length + (l.withMaster ? 1 : 0)
  return cards * CARD_W + (cards - 1) * GAP
}

const cardX = (i: number): number => i * (CARD_W + GAP)

/** Per-agent phase so the crew does not move in lockstep. */
export const phase = (tick: number, i: number): number => tick + i * 5

/** A play overriding what a card shows: its action at its own tick (see director.ts). */
export type Playing = (id: string) => { action: string; t: number } | undefined

export const compose = (s: BusState, l: Extract<Layout, { kind: 'stage' }>, now: number, tick: number, reduceMotion = false, pack: Pack = BUILTIN, playing?: Playing): Canvas => {
  const w = stageWidth(l)
  const c = canvas(w, CARD_H)
  const t = (i: number) => (reduceMotion ? 1 : phase(tick, i))
  l.agents.forEach((a, i) => {
    const play = playing?.(a.id)
    drawAgent(c, cardX(i), 0, a.costume, play?.action ?? moodOf(a, now, pack), play?.t ?? t(i), pack)
    if (a.questions.length > 0 && a.status === 'running') drawQuestion(c, cardX(i), 0)
  })
  const masterIdx = l.agents.length
  const mx = cardX(masterIdx)
  const busy = l.agents.some(a => a.status === 'running')
  const mp = playing?.('')
  if (mp) drawAgent(c, mx, 0, pack.costumes['master'] ? 'master' : 'other', mp.action, mp.t, pack)
  else drawMaster(c, mx, 0, busy, reduceMotion ? 1 : tick, pack)
  // envelopes: flying from the master to the agent until delivered, then resting over its head until acknowledged
  for (const m of liveMsgs(s, now)) {
    const i = l.agents.findIndex(a => a.id === m.to)
    if (i < 0) continue
    const tx = cardX(i) + 6
    const flap = costumeColor(pack, l.agents[i]?.costume ?? '')
    if (m.receivedAt === undefined && m.ackedAt === undefined) {
      const k = reduceMotion ? 0.5 : ((now - m.sentAt) % FLIGHT_MS) / FLIGHT_MS
      const x = Math.round(mx + 6 + (tx - mx - 6) * k)
      const y = Math.round(1 + Math.sin(k * Math.PI) * -1 + 1)
      drawEnvelope(c, x, Math.max(0, y - 1), flap)
    } else if (m.ackedAt === undefined) {
      if (reduceMotion || tick % 4 < 3) drawEnvelope(c, cardX(i), 0, flap)
    }
  }
  return c
}

// ---- labels under the cards

export type Label = { lines: { text: string; color?: number; dim?: boolean; bold?: boolean }[] }

export const ago = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

export const bar = (done: number, total: number, width: number): string => {
  if (total <= 0) return ''
  const n = Math.max(0, Math.min(width, Math.round((done / total) * width)))
  return '▰'.repeat(n) + '▱'.repeat(width - n)
}

const fit = (s: string, w: number): string => (s.length <= w ? s : `${s.slice(0, Math.max(0, w - 1))}…`)

export const agentLabel = (a: AgentRec, now: number, rows: number, pack: Pack = BUILTIN): Label => {
  const [w, color] = word(pack, a, now)
  const stage = a.plan.length > 0 ? ` ${a.done}/${a.plan.length}` : ''
  const lines: Label['lines'] = [{ text: fit(shownName(a), CARD_W), color: costumeColor(pack, a.costume), bold: true }]
  if (rows >= 2) lines.push({ text: fit(`${w}${stage}`, CARD_W), color })
  if (rows >= 3) {
    const b = a.plan.length > 0 ? `${bar(a.done, a.plan.length, 8)} ` : ''
    lines.push({ text: fit(`${b}${ago(now - a.lastEventAt)}`, CARD_W), dim: true })
  }
  return { lines }
}

export const masterLabel = (s: BusState, l: Extract<Layout, { kind: 'stage' }>, now: number, rows: number): Label => {
  const all = onStage(s, now)
  const running = all.filter(a => a.status === 'running').length
  const flying = s.msgs.filter(m => m.accepted && m.receivedAt === undefined && m.ackedAt === undefined).length
  const waiting = s.msgs.filter(m => m.accepted && (m.receivedAt !== undefined || m.ackedAt !== undefined) && m.appliedAt === undefined).length
  const lines: Label['lines'] = [{ text: TEXT.masterTitle, color: 0xd97757, bold: true }]
  if (rows >= 2) lines.push({ text: fit(TEXT.activeCount(running, all.length, l.hidden), CARD_W), color: running > 0 ? 0x3fb96b : 0x7d8590 })
  if (rows >= 3) lines.push({ text: fit(flying > 0 ? TEXT.msgsInFlight(flying) : waiting > 0 ? TEXT.msgsUnapplied(waiting) : TEXT.msgsNone, CARD_W), dim: flying + waiting === 0, ...(flying + waiting > 0 ? { color: 0xd2a8ff } : {}) })
  return { lines }
}

/** The one-line fallback: `alpha ✎ 2/5 · beta … · gamma ✓`. */
export const lineParts = (s: BusState, now: number, pack: Pack = BUILTIN): { text: string; color?: number; bold?: boolean }[] => {
  const parts: { text: string; color?: number; bold?: boolean }[] = [{ text: '🦀 ', color: 0xd97757 }]
  onStage(s, now).forEach((a, i) => {
    const [w, color] = word(pack, a, now)
    if (i > 0) parts.push({ text: ' · ' })
    parts.push({ text: shownName(a), color: costumeColor(pack, a.costume), bold: true })
    parts.push({ text: ` ${w.split(' ')[0]}${a.plan.length > 0 ? ` ${a.done}/${a.plan.length}` : ''}`, color })
  })
  return parts
}

// ---- the side pane: one card per agent, the master on top

export const paneOrder = (s: BusState): AgentRec[] =>
  Object.values(s.agents).sort((x, y) =>
    x.status === 'running' && y.status === 'running' ? x.startedAt - y.startedAt
    : x.status === 'running' ? -1
    : y.status === 'running' ? 1
    : (y.endedAt ?? 0) - (x.endedAt ?? 0))

/**
 * The state marks drawn at the card's top-right corner, as in the panel design: two lavender dots
 * that take turns while thinking, a blinking pink "!" while blocked, a yellow dash while waiting.
 * Only a switched-off crab (finished or failed) is drawn paler; a running one keeps its full colors.
 */
export const drawStateMark = (c: Canvas, st: UiStatus, tick: number, reduceMotion: boolean): void => {
  const beat = reduceMotion ? 0 : Math.floor(tick / 3) % 2
  if (st === 'thinking') {
    if (reduceMotion || beat === 0) set(c, CARD_W - 1, 0, C.lav)
    if (reduceMotion || beat === 1) set(c, CARD_W - 2, 2, C.lav)
  } else if (st === 'blocked') {
    if (reduceMotion || beat === 0) stamp(c, CARD_W - 1, 0, ['p', 'p', 'p', '.', 'p'], { p: C.pink })
  } else if (st === 'waiting') {
    if (reduceMotion || Math.floor(tick / 6) % 2 === 0) stamp(c, CARD_W - 2, 1, ['yy'], { y: C.yellow })
  } else if (st === 'done' || st === 'failed') {
    // switched off: the costume keeps its hue, only paler and a little darker
    desaturate(c, 0.3, 0.12)
  }
}

/** An agent's card for the pane: its crab plus a resting or blinking envelope, a pending question and its state mark. */
export const agentCard = (s: BusState, a: AgentRec, now: number, tick: number, reduceMotion = false, pack: Pack = BUILTIN, play?: { action: string; t: number }): Canvas => {
  const c = canvas(CARD_W, CARD_H)
  drawAgent(c, 0, 0, a.costume, play?.action ?? moodOf(a, now, pack), play?.t ?? tick, pack)
  if (a.questions.length > 0 && a.status === 'running') drawQuestion(c, 0, 0)
  const m = liveMsgs(s, now).find(x => x.to === a.id && x.ackedAt === undefined)
  if (m) {
    const flying = m.receivedAt === undefined
    // in flight: drops in from above, again and again; delivered: rests and blinks until acknowledged
    const y = flying && !reduceMotion ? [-3, -2, -1, 0][tick % 4] ?? 0 : 0
    if (!flying || reduceMotion || tick % 4 !== 3) drawEnvelope(c, 0, y, costumeColor(pack, a.costume))
  }
  drawStateMark(c, uiStatus(s, a), tick, reduceMotion)
  return c
}

/** The same card at half size (9 columns, 4 rows): the panel's rows and delegation tree. */
export const miniCard = (s: BusState, a: AgentRec, now: number, tick: number, reduceMotion = false, pack: Pack = BUILTIN, play?: { action: string; t: number }): Canvas => {
  const c = canvas(CARD_W, CARD_H)
  drawAgent(c, 0, 0, a.costume, play?.action ?? moodOf(a, now, pack), play?.t ?? tick, pack)
  const st = uiStatus(s, a)
  if (st === 'done' || st === 'failed') drawStateMark(c, st, tick, reduceMotion)
  const h = halve(c)
  // the mark goes on after halving so it stays one crisp pixel
  if (st !== 'done' && st !== 'failed') {
    const beat = reduceMotion ? 0 : Math.floor(tick / 3) % 2
    const col = st === 'thinking' ? C.lav : st === 'blocked' ? C.pink : st === 'waiting' ? C.yellow : -1
    if (col >= 0 && (reduceMotion || beat === 0 || st === 'waiting')) set(h, h.width - 1, 0, col)
  }
  return h
}

export const masterCard = (s: BusState, now: number, tick: number, pack: Pack = BUILTIN, play?: { action: string; t: number }): Canvas => {
  const c = canvas(CARD_W, CARD_H)
  if (play) drawAgent(c, 0, 0, pack.costumes['master'] ? 'master' : 'other', play.action, play.t, pack)
  // busy while it works itself (a tool in flight) or any of its agents runs
  else drawMaster(c, 0, 0, s.session?.inTool === true || onStage(s, now).some(a => a.status === 'running'), tick, pack)
  return c
}

export const masterMini = (s: BusState, now: number, tick: number, pack: Pack = BUILTIN, play?: { action: string; t: number }): Canvas => halve(masterCard(s, now, tick, pack, play))

export type Row = { text: string; color?: number; dim?: boolean; bold?: boolean }

/** The few lines beside a crab in the pane list. */
export const rowLines = (s: BusState, a: AgentRec, now: number, width: number, pack: Pack = BUILTIN): Row[] => {
  const [w, color] = word(pack, a, now)
  const fitW = (t: string) => fit(t, Math.max(8, width))
  const out: Row[] = []
  const stage = a.plan.length > 0 ? `  ${bar(a.done, a.plan.length, Math.min(10, Math.max(4, width - 22)))} ${a.done}/${a.plan.length}` : ''
  out.push({ text: fitW(`${w}${stage}`), color })
  const doing = a.current ?? (a.lastTool ? `${a.lastTool}${a.lastToolInput ? ` ${a.lastToolInput}` : ''}` : TEXT.noActivityYet)
  out.push({ text: fitW(doing), dim: true })
  const msgs = s.msgs.filter(m => m.to === a.id && m.accepted)
  const pending = msgs.filter(m => m.appliedAt === undefined)
  const extra: string[] = []
  if (a.blockers.length > 0) extra.push(`⚠ ${a.blockers[a.blockers.length - 1]}`)
  if (a.questions.length > 0) extra.push(`? ${a.questions[a.questions.length - 1]}`)
  if (pending.length > 0) {
    const m = pending[pending.length - 1] as (typeof pending)[number]
    extra.push(`✉ ${m.receivedAt === undefined && m.ackedAt === undefined ? TEXT.msgInTransit : m.ackedAt === undefined ? TEXT.msgDelivered : TEXT.msgReadUnapplied}`)
  } else if (msgs.length > 0) extra.push(TEXT.msgsApplied(msgs.length))
  out.push(extra.length > 0 ? { text: fitW(extra.join('  ')), color: a.blockers.length > 0 ? 0xe5484d : 0xd2a8ff } : { text: fitW(TEXT.agoTools(ago(now - a.lastEventAt), a.toolCount)), dim: true })
  return out
}

export const masterLines = (s: BusState, now: number): Row[] => {
  const all = Object.values(s.agents)
  const running = all.filter(a => a.status === 'running').length
  const flying = s.msgs.filter(m => m.accepted && m.receivedAt === undefined && m.ackedAt === undefined).length
  const unapplied = s.msgs.filter(m => m.accepted && m.appliedAt === undefined).length - flying
  const blocked = all.filter(a => a.status === 'running' && a.blockers.length > 0).length
  return [
    { text: TEXT.masterTitle, color: 0xd97757, bold: true },
    { text: TEXT.runningFinished(running, all.length - running), color: running > 0 ? 0x3fb96b : 0x7d8590 },
    blocked > 0 ? { text: TEXT.blockedCount(blocked), color: 0xe5484d }
    : flying + unapplied > 0 ? { text: TEXT.inTransitUnapplied(flying, unapplied), color: 0xd2a8ff }
    : { text: TEXT.updatedAt(new Date(now).toTimeString().slice(0, 8)), dim: true },
  ]
}

/** The detail view of one agent, in sections, each line already fitted to `width`. */
export const detailRows = (s: BusState, a: AgentRec, now: number, width: number, pack: Pack = BUILTIN): Row[] => {
  const w = Math.max(16, width)
  const out: Row[] = []
  const head = (t: string, color: number) => out.push({ text: t, color, bold: true })
  const item = (t: string, extra: Omit<Row, 'text'> = {}) => {
    // wrap by words, indenting continuation lines
    const words = t.split(' ')
    let cur = ''
    let first = true
    for (const wd of words) {
      const pre = first ? '' : '   '
      if ((pre + cur + (cur ? ' ' : '') + wd).length > w && cur) {
        out.push({ text: pre + cur, ...extra }); cur = wd; first = false
      } else cur = cur ? `${cur} ${wd}` : wd
    }
    if (cur) out.push({ text: (first ? '' : '   ') + cur, ...extra })
  }
  item(`${a.type} · ${a.model ?? TEXT.unknownModel} · ${a.status === 'running' ? TEXT.runningFor(ago(now - a.startedAt)) : a.status === 'done' ? TEXT.finishedStatus : a.status}`, { dim: true })
  out.push({ text: '' })
  const d = pack.costumes[a.costume]
  if (d) item(TEXT.costumeLine(d.name), { dim: true })
  head(TEXT.declaredHeader, costumeColor(pack, a.costume))
  if (a.plan.length === 0) item(TEXT.noPlanDeclared, { dim: true })
  a.plan.forEach((p, i) => {
    const done = i < a.done
    const now_ = i === a.done && a.status === 'running'
    const ev = a.evidence[i + 1]
    item(`${done ? '✓' : now_ ? '▶' : '○'} ${p}${ev ? `  · ${ev}` : ''}`, done ? { color: 0x3fb96b } : now_ ? { color: 0xf5c542, bold: true } : { dim: true })
  })
  if (a.current) item(TEXT.nowDoing(a.current))
  if (a.note) item(TEXT.noteLine(a.note), { dim: true })
  const v = a.plan.length > 0 ? Object.keys(a.evidence).filter(k => Number(k) <= a.done).length : 0
  if (a.done > 0) item(TEXT.verifiedLine(v, a.done), { color: 0x3fb96b, dim: v === 0 })
  if (a.blockers.length > 0) { out.push({ text: '' }); head(TEXT.blockersHeader, 0xe5484d); a.blockers.forEach(b => item(`⚠ ${b}`, { color: 0xe5484d })) }
  if (a.questions.length > 0) { out.push({ text: '' }); head(TEXT.questionsHeader, 0xd2a8ff); a.questions.forEach(q => item(`? ${q}`, { color: 0xd2a8ff })) }
  const msgs = s.msgs.filter(m => m.to === a.id)
  if (msgs.length > 0 || a.replies.length > 0) {
    out.push({ text: '' }); head(TEXT.messagesHeader, 0xd2a8ff)
    for (const m of msgs.slice(-4)) {
      item(`✉ "${m.text}"`)
      const steps = [
        m.accepted ? TEXT.msgAccepted : TEXT.msgRejected,
        TEXT.msgDeliveredStep(m.receivedAt !== undefined),
        TEXT.msgReadStep(m.ackedAt !== undefined),
        TEXT.msgAppliedStep(m.appliedAt !== undefined),
      ]
      item(`   ${steps.join('  ')}`, { color: m.appliedAt !== undefined ? 0x3fb96b : 0xd2a8ff })
      if (m.ackNote) item(`   «${m.ackNote}»`, { dim: true })
    }
    a.replies.forEach(r => item(`↩ ${r}`, { color: 0xd2a8ff }))
  }
  out.push({ text: '' })
  head(TEXT.observedHeader, 0x8b949e)
  item(TEXT.lastToolLine(a.lastTool ? `${a.lastTool} ${a.lastToolInput ?? ''}` : null), { dim: true })
  item(TEXT.toolsActivityLine(a.toolCount, ago(now - a.lastEventAt)), { dim: true })
  if (a.filesModified.length > 0) item(TEXT.filesModifiedLine(a.filesModified.map(f => f.split('/').pop()).join(', ')), { dim: true })
  for (const tr of a.tests.slice(-3)) item(`${tr.ok ? '✓' : '✗'} test: ${tr.cmd}`, tr.ok ? { color: 0x3fb96b, dim: true } : { color: 0xe5484d })
  if (a.lastError) item(TEXT.lastErrorLine(a.lastError), { color: 0xe5484d })
  if (a.tokensIn !== undefined) item(TEXT.tokensLine(a.tokensIn, a.tokensOut ?? 0), { dim: true })
  return out
}

/**
 * How the pane's list fits `rows` (the room Claude Code gives it): the master and as many crabs as
 * fit (each takes CARD_H/2 rows, one row between blocks), a "+N" line for the rest, the problems
 * line, and the key hint only when there is room left. Under one crab's height: text lines only.
 */
export const paneFit = (agents: number, rows: number, problems: boolean, extra = 0): { crabs: number; more: number; hint: boolean; textOnly: boolean } => {
  const block = CARD_H / 2
  if (rows < block) return { crabs: 0, more: 0, hint: false, textOnly: true }
  const need = (k: number, hint: boolean) => {
    const lines = (k < agents ? 1 : 0) + (problems ? 1 : 0) + (hint ? 1 : 0) + (agents === 0 ? 1 : 0) + extra
    const children = 1 + k + lines
    return (1 + k) * block + lines + (children - 1)
  }
  let k = agents
  while (k > 0 && need(k, false) > rows) k--
  if (need(k, false) > rows) return { crabs: 0, more: 0, hint: false, textOnly: true }
  return { crabs: k, more: agents - k, hint: agents > 0 && need(k, true) <= rows, textOnly: false }
}

/** Finished this long ago (30 min), an agent leaves the pane's list for the "finished earlier" line (bus_status keeps it). */
export const RECENT_MS = 30 * 60_000

/** The agents the pane lists: running, or finished recently; the rest only on request. */
export const paneList = (s: BusState, now: number, all: boolean): { shown: AgentRec[]; older: number } => {
  const every = paneOrder(s)
  if (all) return { shown: every, older: 0 }
  const shown = every.filter(a => a.status === 'running' || a.endedAt === undefined || now - a.endedAt < RECENT_MS)
  return { shown, older: every.length - shown.length }
}

/** How many "k: name" buttons fit on one line of `width` cells after the "+N:" label. */
export const namesThatFit = (labels: readonly string[], width: number, lead: number): number => {
  let used = lead
  let n = 0
  for (const l of labels) {
    const w = l.length + 1
    if (used + w > width - 2) break
    used += w
    n++
  }
  return n
}
