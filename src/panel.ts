// The side panel's view models (the v3 panel design). Pure: no `$`; callers pass `now` and the state.
//
// Every figure comes from recorded facts. Declared progress stays "x/y stages declared", never a
// percentage of the work. A subagent's cost is an estimate (price.ts) and is always marked "≈"; the
// session total is the ledger's real figure.

import { BUILTIN } from './builtin.ts'
import { uiStatus, type Activity, type AgentRec, type BusState, type Permission } from './model.ts'
import { costumeColor, type Pack } from './pack.ts'
import { NO_USAGE, costOf, costParts, promptTokens, windowOf, type Usage } from './price.ts'
import { paneList, shownName } from './scene.ts'
import { C, ST, agoTxt, clock, ctxColor, dur, fc, fk, fit, prog, spark, toolColor, type UiStatus } from './theme.ts'

// ---- one agent

export type AgentView = {
  id: string
  /** 1-based position in the list: its hotkey. */
  idx: number
  name: string
  color: number
  role: string
  model: string
  st: UiStatus
  tool: string
  arg: string
  toolC: number
  done: number
  total: number
  bar: string
  progTxt: string
  ago: string
  ctxPct?: number
  ctxC: number
  tokTxt: string
  cost: number
  costTxt: string
  permission?: Permission
  summary: string
}

// tools the engine or this plugin use for bookkeeping: never shown as what an agent is doing
const BUS_TOOL = /^(mcp__crabbus__|SubagentHandback$)/

/** Loops the bus adopted without seeing their spawn (engine forks, hook agents): kept in bus_status, left out of the panel. */
export const panelAgents = (list: readonly AgentRec[]): AgentRec[] => list.filter(a => a.type !== 'unknown')

export const agentCost = (a: AgentRec): number => (a.usage ? costOf(a.usage, a.usedModel ?? a.model) : 0)

export const agentCtx = (a: AgentRec): number | undefined =>
  a.lastPrompt === undefined ? undefined : Math.min(100, Math.round((a.lastPrompt / windowOf(a.usedModel ?? a.model)) * 100))

export const agentView = (s: BusState, a: AgentRec, idx: number, now: number, pack: Pack = BUILTIN): AgentView => {
  const st = uiStatus(s, a)
  const total = a.plan.length
  const ctxPct = agentCtx(a)
  const cost = agentCost(a)
  const permission = (s.pending ?? []).find(p => p.agentId === a.id)
  const shown = a.lastTool && !BUS_TOOL.test(a.lastTool) && a.status === 'running'
  const tool = shown ? (a.lastTool as string) : a.status === 'done' ? 'finished' : a.status !== 'running' ? a.status : a.current ? 'now' : '—'
  const arg = shown ? (a.lastToolInput ?? '') : a.status === 'done' ? 'report delivered' : (a.current ?? '')
  const summary =
    st === 'blocked' ? (permission ? `waiting for your answer in the dialog: ${permission.tool}` : `blocked: ${a.blockers[a.blockers.length - 1] ?? ''}`)
    : st === 'waiting' ? (a.questions.length > 0 ? `asks: ${a.questions[a.questions.length - 1]}` : 'waiting on a message')
    : st === 'done' ? `finished${a.endedAt !== undefined ? ` ${agoTxt(now - a.endedAt)}` : ''}`
    : st === 'failed' ? `ended (${a.status})${a.lastError ? `: ${a.lastError}` : ''}`
    : st === 'thinking' ? (a.current ? `now: ${a.current}` : 'reasoning about the next step')
    : `running ${a.lastTool ?? 'a tool'}${total > 0 ? ` · ${a.done} of ${total} stages` : ''}`
  return {
    id: a.id,
    idx,
    name: shownName(a),
    color: costumeColor(pack, a.costume),
    role: a.type,
    model: a.usedModel ?? a.model ?? 'model ?',
    st,
    tool,
    arg,
    toolC: st === 'working' ? C.mint : st === 'done' ? C.cyan : C.faint,
    done: a.done,
    total,
    bar: prog(a.done, total, 10),
    progTxt: total > 0 ? `${a.done}/${total}` : '–',
    ago: agoTxt(now - a.lastEventAt),
    ...(ctxPct !== undefined ? { ctxPct } : {}),
    ctxC: ctxColor(ctxPct ?? 0),
    tokTxt: a.tokensIn !== undefined ? `↑${fk(a.tokensIn)} ↓${fk(a.tokensOut ?? 0)}` : '↑– ↓–',
    cost,
    costTxt: a.usage ? fc(cost, true) : '≈$–',
    ...(permission ? { permission } : {}),
    summary,
  }
}

// ---- the list

export type Filter = 'all' | 'active' | 'attention' | 'done'
export const FILTERS: readonly Filter[] = ['all', 'active', 'attention', 'done']

const inFilter = (f: Filter, st: UiStatus): boolean =>
  f === 'all' ? true
  : f === 'active' ? st === 'working' || st === 'thinking'
  : f === 'attention' ? st === 'blocked' || st === 'waiting'
  : st === 'done' || st === 'failed'

export type MasterView = {
  st: UiStatus
  tool: string
  arg: string
  delegated: string
  tokTxt: string
  cost: number
  costTxt: string
  ctxPct?: number
  ctxC: number
}

export type ActivityView = { ts: string; g: string; gc: number; name: string; color: number; text: string }

export type ListModel = {
  /** Subagents shown (filter applied), in pane order. */
  cards: AgentView[]
  /** Every listed subagent, for the delegation tree and counts. */
  all: AgentView[]
  older: number
  counts: Record<UiStatus, number>
  filters: { id: Filter; n: number }[]
  master: MasterView
  metrics: {
    stagesTxt: string
    stagesPct: number
    ctxPct?: number
    ctxC: number
    tokIn: string
    tokOut: string
    cost: number
    costTxt: string
    costSpark: string
    summary: string
  }
  liveTools: { n: string; k: number; c: number }[]
  activity: ActivityView[]
}

const sumUsage = (us: readonly (Usage | undefined)[]): Usage =>
  us.reduce<Usage>((x, u) => (u ? { input: x.input + u.input, output: x.output + u.output, cacheRead: x.cacheRead + u.cacheRead, cacheWrite: x.cacheWrite + u.cacheWrite } : x), NO_USAGE)

export const listModel = (s: BusState, now: number, opts: { filter: Filter; showAll: boolean }, pack: Pack = BUILTIN): ListModel => {
  const { shown, older } = paneList(s, now, opts.showAll)
  const all = panelAgents(shown).map((a, i) => agentView(s, a, i + 1, now, pack))
  const counts: Record<UiStatus, number> = { working: 0, thinking: 0, waiting: 0, blocked: 0, done: 0, failed: 0 }
  for (const v of all) counts[v.st]++
  const ses = s.session ?? {}
  const subs = panelAgents(Object.values(s.agents))
  const subCost = subs.reduce((x, a) => x + agentCost(a), 0)
  const masterEst = ses.usage ? costOf(ses.usage, ses.model) : 0
  // the ledger's total is real; without it, everything is an estimate
  const total = ses.costUsd ?? masterEst + subCost
  const masterCost = ses.costUsd !== undefined ? Math.max(0, ses.costUsd - subCost) : masterEst
  const running = subs.filter(a => a.status === 'running').length
  const doneSubs = subs.filter(a => a.status === 'done').length
  const masterCtx = ses.ctxPercent ?? (ses.lastPrompt !== undefined ? Math.round((ses.lastPrompt / windowOf(ses.model)) * 100) : undefined)
  const master: MasterView = {
    st: ses.inTool ? 'working' : running > 0 ? 'thinking' : 'done',
    tool: ses.lastTool ?? '—',
    arg: ses.lastToolInput ?? '',
    delegated: `${doneSubs}/${subs.length}`,
    tokTxt: ses.usage ? `↑${fk(promptTokens(ses.usage))} ↓${fk(ses.usage.output)}` : '↑– ↓–',
    cost: masterCost,
    costTxt: fc(masterCost, ses.costUsd === undefined),
    ...(masterCtx !== undefined ? { ctxPct: masterCtx } : {}),
    ctxC: ctxColor(masterCtx ?? 0),
  }
  const dn = subs.reduce((x, a) => x + Math.min(a.done, a.plan.length), 0)
  const tot = subs.reduce((x, a) => x + a.plan.length, 0)
  const every = sumUsage([ses.usage, ...subs.map(a => a.usage)])
  const tin = promptTokens(every) || subs.reduce((x, a) => x + (a.tokensIn ?? 0), 0)
  const tout = every.output || subs.reduce((x, a) => x + (a.tokensOut ?? 0), 0)
  const live = new Map<string, number>()
  for (const a of subs) if (a.status === 'running' && a.inTool && a.lastTool && !BUS_TOOL.test(a.lastTool)) live.set(a.lastTool, (live.get(a.lastTool) ?? 0) + 1)
  if (ses.inTool && ses.lastTool) live.set(ses.lastTool, (live.get(ses.lastTool) ?? 0) + 1)
  const costTxt = fc(total, ses.costUsd === undefined)
  return {
    cards: all.filter(v => inFilter(opts.filter, v.st)),
    all,
    older,
    counts,
    filters: FILTERS.map(id => ({ id, n: all.filter(v => inFilter(id, v.st)).length })),
    master,
    metrics: {
      stagesTxt: tot > 0 ? `${dn}/${tot}` : '–',
      stagesPct: tot > 0 ? Math.round((dn / tot) * 100) : 0,
      ...(masterCtx !== undefined ? { ctxPct: masterCtx } : {}),
      ctxC: ctxColor(masterCtx ?? 0),
      tokIn: fk(tin),
      tokOut: fk(tout),
      cost: total,
      costTxt,
      costSpark: spark(ses.costHist ?? []),
      summary: `${tot > 0 ? `${dn}/${tot} stages` : 'no plans'} · ${costTxt}`,
    },
    liveTools: [...live.entries()].map(([n, k]) => ({ n, k, c: toolColor(n) })),
    activity: activityView(s, s.activity ?? [], pack).slice(0, 5),
  }
}

export const activityView = (s: BusState, list: readonly Activity[], pack: Pack = BUILTIN): ActivityView[] =>
  list.filter(e => s.agents[e.id]?.type !== 'unknown' && !/SubagentHandback/.test(e.text)).map(e => {
    const a = s.agents[e.id]
    return { ts: clock(e.at), g: e.g ?? ST[e.st].g, gc: e.g === '✓' ? C.mint : ST[e.st].c, name: a ? shownName(a) : e.id, color: a ? costumeColor(pack, a.costume) : C.dim, text: e.text }
  })

// ---- one agent in detail

export type DetailModel = {
  v: AgentView
  pos: string
  elapsed: string
  cost: { parts: { l: string; v: string; pct: number }[]; rate: string }
  tokens: { out: string; inTxt: string; spark: string; cache: string; hit: string }
  ctx: { cells: number[]; used: string }
  timing: { start: string; last: string; avg: string; cells: number[] }
  tools: { current: string; history: { g: string; c: number; n: string; a: string; t: string }[]; count: string }
  tasks: { g: string; c: number; tc: number; t: string; strike: boolean }[]
  verified: string
  blockers: string[]
  questions: string[]
  messages: { text: string; steps: string; c: number }[]
}

export const detailModel = (s: BusState, a: AgentRec, list: readonly AgentRec[], now: number, pack: Pack = BUILTIN): DetailModel => {
  const i = Math.max(0, list.findIndex(x => x.id === a.id))
  const v = agentView(s, a, i + 1, now, pack)
  const u = a.usage ?? NO_USAGE
  const model = a.usedModel ?? a.model
  const parts = costParts(u, model)
  const total = parts.input + parts.output + parts.cacheRead + parts.cacheWrite
  const biggest = Math.max(parts.input, parts.output, parts.cacheRead, parts.cacheWrite, 1e-9)
  const elapsedMs = (a.endedAt ?? now) - a.startedAt
  const prompt = promptTokens(u)
  const window = windowOf(model)
  const used = a.lastPrompt ?? 0
  const filled = Math.round((used / window) * 20)
  const runs = a.toolLog ?? []
  const tl = runs.slice(-18).map(r => (r.ok === false ? C.pink : toolColor(r.tool)))
  while (tl.length < 18) tl.unshift(C.line)
  const verified = Object.keys(a.evidence).filter(k => Number(k) <= a.done).length
  return {
    v,
    pos: `${i + 1}/${list.length}`,
    elapsed: dur(elapsedMs),
    cost: {
      parts: [['input', parts.input], ['output', parts.output], ['cache read', parts.cacheRead], ['cache write', parts.cacheWrite]].map(([l, x]) => ({ l: l as string, v: fc(x as number), pct: Math.round(((x as number) / biggest) * 100) })),
      rate: a.usage ? `≈${fc(total / Math.max(1 / 60, elapsedMs / 60000))}/min · list prices` : 'no usage reported yet',
    },
    tokens: {
      out: fk(u.output || (a.tokensOut ?? 0)),
      inTxt: fk(prompt || (a.tokensIn ?? 0)),
      spark: spark(a.usageHist ?? []),
      cache: fk(u.cacheRead),
      hit: prompt > 0 ? `${Math.round((u.cacheRead / prompt) * 100)}% hit` : '–',
    },
    ctx: {
      // one cell per 5 % of the window; the 80 % cell marks where compaction starts
      cells: [...Array(20)].map((_, k) => (k < filled ? ctxColor(v.ctxPct ?? 0) : k === 16 ? 0x4a2a38 : C.line)),
      used: a.lastPrompt !== undefined ? `${fk(used)} / ${fk(window)}` : 'no request reported yet',
    },
    timing: {
      start: clock(a.startedAt),
      last: agoTxt(now - a.lastEventAt),
      avg: a.requests ? `${(elapsedMs / a.requests / 1000).toFixed(1)}s` : '–',
      cells: tl,
    },
    tools: {
      current: a.lastTool ? `${a.lastTool} ${a.lastToolInput ?? ''}`.trim() : 'none yet',
      history: runs.filter(r => r.ok !== undefined).slice(-5).reverse().map(r => ({ g: r.ok ? '✓' : '✗', c: r.ok ? C.mint : C.pink, n: r.tool, a: r.arg, t: r.ms !== undefined ? `${(r.ms / 1000).toFixed(1)}s` : '' })),
      count: `${a.toolCount} tool${a.toolCount === 1 ? '' : 's'}`,
    },
    tasks: a.plan.map((t, k) => {
      const dn = k < a.done
      const cur = k === a.done && a.status === 'running'
      const ev = a.evidence[k + 1]
      return { g: dn ? '☒' : cur ? '◐' : '☐', c: dn ? C.mint : cur ? C.yellow : C.faint, tc: dn ? C.faint : cur ? C.text : C.dim, t: `${t}${ev ? `  · ${ev}` : ''}`, strike: dn }
    }),
    verified: a.done > 0 ? `verified: ${verified} of ${a.done} declared-done stage(s) carry evidence` : a.declaredAt === undefined ? 'no bus_step report yet: nothing declared' : 'no stage declared done yet',
    blockers: a.blockers,
    questions: a.questions,
    messages: s.msgs.filter(m => m.to === a.id).slice(-3).map(m => ({
      text: m.text,
      steps: [m.accepted ? '✓ accepted' : '✗ rejected', `${m.receivedAt !== undefined ? '✓' : '○'} delivered`, `${m.ackedAt !== undefined ? '✓' : '○'} read`, `${m.appliedAt !== undefined ? '✓' : '○'} applied`].join('  '),
      c: m.appliedAt !== undefined ? C.mint : C.lav,
    })),
  }
}

// ---- the transcript, from the agent's own messages ($.session.messages({ agentId, as: 'api' }))

export type TxBody = { p: string; t: string; c: number; bg?: number }
export type TxLine = { k: 'msg' | 'think' | 'tool' | 'user'; g: string; gc: number; head: string; hc: number; arg: string; text: string; tc: number; italic: boolean; body: TxBody[] }
export type TxTab = 'all' | 'tools' | 'reasoning'
export const TABS: readonly TxTab[] = ['all', 'tools', 'reasoning']

type Block = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const blocksOf = (m: unknown): Block[] => {
  const c = (m as { content?: unknown } | null)?.content
  return Array.isArray(c) ? (c.filter(b => typeof b === 'object' && b !== null) as Block[]) : typeof c === 'string' ? [{ type: 'text', text: c }] : []
}
const resultText = (b: Block): string => {
  const c = b['content']
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(x => str((x as Block)['text'])).filter(Boolean).join('\n')
  return ''
}
/** What the engine adds to a tool result for the model (reminders), and terminal escapes: never the agent's work. */
const clean = (t: string): string =>
  t.replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\t\r]/g, ' ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

/** What a tool call was given, as one short argument: the path, command, pattern or url. */
export const toolArg = (name: string, input: unknown): string => {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const v = str(o['file_path']) || str(o['command']) || str(o['pattern']) || str(o['url']) || str(o['path']) || str(o['description']) || str(o['to']) || str(o['query'])
  return v ? `(${fit(v.replace(/\s+/g, ' '), 70)})` : name === 'TodoWrite' ? '' : '()'
}

const resultBody = (name: string, input: unknown, result: string, isError: boolean, w: number): TxBody[] => {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const lines = clean(result).split('\n').filter(l => l.trim() !== '')
  if (isError) return [{ p: '⎿', t: fit(lines[0] ?? 'error', w), c: C.pink }]
  if ((name === 'Edit' || name === 'MultiEdit') && typeof o['old_string'] === 'string') {
    const out: TxBody[] = [{ p: '⎿', t: fit(lines[0] ?? 'Updated', w), c: C.dim }]
    for (const l of str(o['old_string']).split('\n').slice(0, 3)) out.push({ p: '', t: fit(`- ${l}`, w), c: C.pink, bg: 0x2a1820 })
    for (const l of str(o['new_string']).split('\n').slice(0, 4)) out.push({ p: '', t: fit(`+ ${l}`, w), c: C.mint, bg: 0x18261c })
    return out
  }
  if (name === 'Read') return [{ p: '⎿', t: `Read ${lines.length} lines`, c: C.dim }]
  if (name === 'TodoWrite' && Array.isArray(o['todos']))
    return (o['todos'] as Block[]).slice(0, 8).map((t, k) => {
      const st = str(t['status'])
      return { p: k === 0 ? '⎿' : '', t: fit(`${st === 'completed' ? '☒' : '☐'} ${str(t['content'])}`, w), c: st === 'completed' ? C.faint : st === 'in_progress' ? C.yellow : C.text }
    })
  const shown = lines.slice(0, name === 'Bash' ? 5 : 2)
  if (shown.length === 0) return [{ p: '⎿', t: '(no output)', c: C.dim }]
  return shown.map((l, k) => ({ p: k === 0 ? '⎿' : '', t: fit(l, w), c: /✗|fail|error/i.test(l) ? C.pink : /✓|pass/i.test(l) ? C.mint : C.dim }))
}

/**
 * The agent's conversation as the panel's transcript lines: the task and the master's messages,
 * thinking, text, and each tool call with the first lines of its result (diffs for edits).
 */
export const transcriptLines = (messages: readonly unknown[], name: string, width: number): TxLine[] => {
  const w = Math.max(16, width)
  const results = new Map<string, { text: string; isError: boolean }>()
  for (const m of messages) for (const b of blocksOf(m)) if (b['type'] === 'tool_result') results.set(str(b['tool_use_id']), { text: resultText(b), isError: b['is_error'] === true })
  const out: TxLine[] = []
  const base = { head: '', hc: C.text, arg: '', text: '', tc: C.text, italic: false, body: [] as TxBody[] }
  for (const m of messages) {
    const role = (m as { role?: unknown } | null)?.role
    for (const b of blocksOf(m)) {
      const t = b['type']
      if (role === 'user' && t === 'text') {
        const text = clean(str(b['text'])).trim()
        // reminders the engine adds are not the master's words
        if (text) out.push({ ...base, k: 'user', g: '›', gc: C.faint, head: `master → ${name}  `, hc: C.master, text: fit(text.replace(/\s+/g, ' '), w * 3) })
      } else if (role === 'assistant' && t === 'thinking') {
        // models that return no summary leave the block empty: nothing to show
        const text = clean(str(b['thinking'])).trim()
        if (text) out.push({ ...base, k: 'think', g: '✻', gc: C.lav, head: 'thinking  ', hc: C.lav, text: fit(text.replace(/\s+/g, ' '), w * 3), tc: C.thought, italic: true })
      } else if (role === 'assistant' && t === 'text') {
        const text = clean(str(b['text'])).trim()
        if (text) out.push({ ...base, k: 'msg', g: '⏺', gc: C.text, text: fit(text.replace(/\s+/g, ' '), w * 4) })
      } else if (role === 'assistant' && t === 'tool_use') {
        const n = str(b['name'])
        const inp = (typeof b['input'] === 'object' && b['input'] !== null ? b['input'] : {}) as Record<string, unknown>
        if (n === 'SubagentHandback') {
          // the agent's final report to the master
          const report = clean(Object.values(inp).filter((x): x is string => typeof x === 'string').sort((x, y) => y.length - x.length)[0] ?? '').trim()
          if (report) out.push({ ...base, k: 'msg', g: '⏺', gc: C.cyan, head: 'report → master  ', hc: C.cyan, text: fit(report.replace(/\s+/g, ' '), w * 5) })
          continue
        }
        if (n === 'mcp__crabbus__bus_step') {
          // what the agent declared, in one line: the bus's DECLARED layer as it happened
          const parts: string[] = []
          if (Array.isArray(inp['plan'])) parts.push(`plan ${(inp['plan'] as unknown[]).length} stages`)
          if (typeof inp['done'] === 'number') parts.push(`done ${inp['done']}`)
          for (const k of ['current', 'question', 'blocker', 'reply', 'note'] as const) if (typeof inp[k] === 'string') parts.push(`${k}: ${inp[k] as string}`)
          if (inp['ack'] === true) parts.push('ack')
          if (inp['applied'] === true) parts.push('applied')
          out.push({ ...base, k: 'tool', g: '◇', gc: typeof inp['blocker'] === 'string' ? C.pink : typeof inp['question'] === 'string' ? C.yellow : C.lav, head: 'declared  ', hc: C.lav, text: fit(parts.join(' · ') || 'progress', w * 2), tc: C.dim })
          continue
        }
        if (BUS_TOOL.test(n)) continue
        const r = results.get(str(b['id']))
        out.push({
          ...base,
          k: 'tool',
          g: '⏺',
          gc: r === undefined ? C.yellow : r.isError ? C.pink : C.mint,
          head: n === 'TodoWrite' ? 'Update Todos' : n,
          arg: toolArg(n, b['input']),
          body: r === undefined ? [{ p: '⎿', t: 'running…', c: C.yellow }] : resultBody(n, b['input'], r.text, r.isError, w - 4),
        })
      }
    }
  }
  return out
}

export const filterTab = (lines: readonly TxLine[], tab: TxTab): TxLine[] =>
  tab === 'tools' ? lines.filter(l => l.k === 'tool') : tab === 'reasoning' ? lines.filter(l => l.k === 'think') : [...lines]

/** Lines the transcript keeps when no conversation can be read: the facts the bus recorded. */
export const fallbackLines = (a: AgentRec, name: string): TxLine[] => {
  const base = { head: '', hc: C.text, arg: '', text: '', tc: C.text, italic: false, body: [] as TxBody[] }
  const out: TxLine[] = [{ ...base, k: 'user', g: '›', gc: C.faint, head: `master → ${name}  `, hc: C.master, text: a.description }]
  for (const r of a.toolLog ?? []) out.push({ ...base, k: 'tool', g: '⏺', gc: r.ok === false ? C.pink : r.ok ? C.mint : C.yellow, head: r.tool, arg: r.arg ? `(${r.arg})` : '', body: [{ p: '⎿', t: r.ok === undefined ? 'running…' : r.ok ? `done in ${((r.ms ?? 0) / 1000).toFixed(1)}s` : 'failed', c: r.ok === false ? C.pink : C.dim }] })
  return out
}
