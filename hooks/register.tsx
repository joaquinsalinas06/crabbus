// CrabBus: the one file that touches `$`. Everything it decides lives in ../src (pure, tested).
//
// Observe-only on every path it shares with Claude Code: it never denies, rewrites or answers another
// tool's call, never changes a message, and any failure of its own falls through to `next(e)`.
// It also adds one thing the model reads: BRIEF, appended to each spawned subagent's prompt (see README).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, Register, RenderChildren } from 'claude-code'

import { CARD_W, cellsOf } from '../src/art.ts'
import { textRows } from '../src/canvas.ts'
import { BUILTIN } from '../src/builtin.ts'
import { MASTER, direct, emptyDirector, playOf, type Director } from '../src/director.ts'
import { loadPack } from '../src/fit.ts'
import { normalizeDesignJson } from '../src/legacy.ts'
import { PERSON_DECIDES, describeInput, emptyState, onComplete, onMasterTool, onMeasure, onPermissionAnswer, onPermissionAsk, onReceive, onSend, onSpawn, onStep, onToolEnd, onToolStart, onUsage, parseStep, resolveTarget, statusReport, stepReceipt, type Limit } from '../src/model.ts'
import type { AgentRec, BusState, Completion, SpawnInfo } from '../src/model.ts'
import { BUILTIN_ORIGIN, bundle, type DesignFile, type Pack } from '../src/pack.ts'
import { FILTERS, TABS, detailModel, fallbackLines, filterTab, listModel, panelAgents, transcriptLines, type AgentView, type Filter, type TxLine, type TxTab } from '../src/panel.ts'
import { agentCard, agentLabel, compose, isActive, layout, lineParts, masterCard, masterLabel, masterMini, miniCard, paneList, phase, type Label } from '../src/scene.ts'
import { TEXT } from '../src/text.ts'
import { C, CARD_BG, ORDER, ST, cardBg, cardEdge, fit, meter, type UiStatus } from '../src/theme.ts'

const PANE = 'crabbus'
const STEP = 'mcp__crabbus__bus_step'
const STATUS = 'mcp__crabbus__bus_status'
const STAGE_KEY = 'bus-stage'
// the dock's width the panel asks for (the design's 400 px column)
const PANE_COLUMNS = 56

const bus = atom({ plugin: 'crabbus', key: 'bus' } as const, emptyState())
// the agent whose detail the pane shows; null = the list
const selected = atom({ plugin: 'crabbus', key: 'selected' } as const, null as string | null)
// the pane also lists agents that finished long ago
const showAll = atom({ plugin: 'crabbus', key: 'showAll' } as const, false)
// the panel's collapsible sections, as the design opens them
const OPEN0: Record<string, boolean> = { metrics: true, deleg: true, subs: true, act: true, details: true, dCost: false, dTok: false, dCtx: true, dTime: false, dTools: false, dTasks: true }
const openSecs = atom({ plugin: 'crabbus', key: 'open' } as const, OPEN0)
const filterAtom = atom({ plugin: 'crabbus', key: 'filter' } as const, 'all' as Filter)
const modeAtom = atom({ plugin: 'crabbus', key: 'mode' } as const, 'cards' as 'cards' | 'rows')
const tabAtom = atom({ plugin: 'crabbus', key: 'tab' } as const, 'all' as TxTab)

// each agent's transcript, read at most once a second while its detail is shown
const txCache = new Map<string, { at: number; lines: TxLine[] | null }>()

// ~140 tokens added once to each subagent's prompt. It is what makes `declared` progress exist at all.
const BRIEF = `

Progress reporting (CrabBus): call mcp__crabbus__bus_step first with plan (3-8 short stages) and done:0, and again as each stage finishes (done = stages completed, current = what you do now; evidence:[{stage,proof}] only for facts you can show, e.g. a passing test). Report blocker:"..." when stuck, question:"..." when you need the master. If a message from the master arrives, call bus_step with ack:true, and applied:true plus a short note once you have acted on it. Never claim a stage you have not finished.`

// Animation state lives in the module: it is redrawn from scratch after a reload, nothing to keep.
let clock: { cancel: () => void } | undefined
let frame = 0
let band: { site: string; columns: number; maxRows: number } | undefined
// the pane's site while it is drawn, and the crabs it shows (key -> agent id, '' = the master; mini = half size)
let paneSite: string | undefined
let paneCrabs: { key: string; id: string; i: number; mini: boolean; bg?: number }[] = []
// which view the pane shows: the list's text crabs move with each redraw, so it redraws more often
let paneView: 'list' | 'detail' = 'list'
// set once per session: the pane opens by itself only the first time an agent starts
let autoOpened = false
// the designs in use: the built-in crew plus the user's files that passed the fit check
let pack: Pack = BUILTIN
let packSig: string | undefined
let designDir: string | undefined
const MAX_DESIGN_BYTES = 512 * 1024
// one-shot plays (spins, football passes) in progress; rebuilt from scratch after a reload
let dir: Director = emptyDirector()
const playing = (id: string) => playOf(dir, id, frame)

const input = (e: unknown): Record<string, unknown> => (typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : {})
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`

// ---- top-level helpers: the only functions that receive `$`

async function record($: EngineInterface, f: (s: BusState, t: number) => BusState): Promise<void> {
  const t = await $.clock.now()
  await update($, bus, s => f(s, t))
}

/** The engine's rate-limit windows as the model keeps them (reset time in ms since epoch). */
const limitsOf = (xs: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): Limit[] =>
  xs.map(x => {
    const at = x.resetsAt ? Date.parse(x.resetsAt) : NaN
    return { kind: x.kind, pct: x.percentUsed, ...(Number.isFinite(at) ? { resetsAt: at } : {}) }
  })

/**
 * Where the user's design files live: `<config dir>/crabbus/*.json`. Designs made before the rename sit in
 * `<config dir>/agent-bus/`: the first time the new folder is missing they are copied over (the old folder
 * is left as it was), so nobody's crabs lose their costumes on upgrade.
 */
async function designsDir($: EngineInterface): Promise<string> {
  if (designDir) return designDir
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const base = cfg ?? `${home ?? '.'}/.claude`
  const dir = `${base}/crabbus`
  const legacy = `${base}/agent-bus`
  try {
    if (!(await $.fs.exists(dir)) && (await $.fs.exists(legacy))) {
      const old = (await $.fs.list(legacy)).filter(x => x.kind === 'file' && !x.isLink && x.name.endsWith('.json')).slice(0, 200)
      for (const x of old) await $.fs.write(`${dir}/${x.name}`, String(await $.fs.read(`${legacy}/${x.name}`)))
    }
  } catch {
    // a failed copy leaves the old folder intact; the user can still copy it by hand
  }
  designDir = dir
  return designDir
}

/** Reloads the design files when any of them changed (name, size or time); a bad file never stops the others. */
async function refreshDesigns($: EngineInterface, force = false): Promise<boolean> {
  const dir = await designsDir($)
  let entries: FsEntry[] = []
  if (await $.fs.exists(dir)) entries = (await $.fs.list(dir)).filter(x => x.kind === 'file' && x.name.endsWith('.json')).slice(0, 200)
  const sig = entries.map(x => `${x.name}:${x.size}:${x.mtimeMs}`).sort().join('|')
  if (!force && sig === packSig) return false
  packSig = sig
  const files: DesignFile[] = []
  const tooBig: string[] = []
  for (const x of entries) {
    if (x.size > MAX_DESIGN_BYTES) tooBig.push(x.name)
    else files.push({ file: x.name, text: String(await $.fs.read(`${dir}/${x.name}`)) })
  }
  const next = files.length === 0 ? BUILTIN : loadPack(files, BUILTIN)
  pack = tooBig.length === 0 ? next : { ...next, problems: [...next.problems, ...tooBig.map(file => ({ file, msg: TEXT.fileTooLarge, fatal: true }))] }
  $.ui.invalidate('ui.render')
  return true
}

/** What `/costume list` prints: costumes, the user's own actions and rules, and every problem. */
const designSummary = (dir: string): string => {
  const mine = (o: { origin: string }) => (o.origin === BUILTIN_ORIGIN ? '' : ` [${o.origin}]`)
  const costumes = Object.values(pack.costumes).map(d => `  ${d.id} «${d.name}»: ${d.pieces.join(', ')}${mine(d)}`)
  const actions = Object.values(pack.actions).filter(a => a.origin !== BUILTIN_ORIGIN).map(a => `  ${a.id} «${pack.labels[a.id] ?? a.label}» priority ${a.priority} [${a.origin}]`)
  const problems = pack.problems.map(x => `  ${x.fatal ? '✗' : '·'} ${x.file}${x.id ? ` (${x.id})` : ''}: ${x.msg}`)
  return [
    `Costumes (${costumes.length}):`, ...costumes,
    ...(actions.length > 0 ? ['Custom actions:', ...actions] : []),
    `In rotation: ${pack.active.filter(id => pack.costumes[id]).join(', ') || 'none'}`,
    ...(problems.length > 0 ? ['Problems:', ...problems] : ['No problems.']),
    `Folder: ${dir}/`,
  ].join('\n')
}

const problemLine = (): string => {
  const bad = pack.problems.filter(x => x.fatal)
  return bad.length === 0 ? '' : TEXT.designsProblemLine(bad.length, new Set(bad.map(x => x.file)).size)
}

/** Migrates Spanish v0.4 `.json` design files in `dir` to the v0.5 English schema with `.bak` backups. */
async function migrateDesigns($: EngineInterface, dir: string, dryRun: boolean): Promise<string> {
  if (!(await $.fs.exists(dir))) return `No design folder at ${dir}/.`
  const entries = (await $.fs.list(dir)).filter(x => x.kind === 'file' && x.name.endsWith('.json')).slice(0, 200)
  if (entries.length === 0) return `No .json design files found in ${dir}/.`
  const rawFiles: { name: string; text: string; parsed?: unknown; error?: string }[] = []
  for (const x of entries) {
    const text = String(await $.fs.read(`${dir}/${x.name}`))
    try {
      rawFiles.push({ name: x.name, text, parsed: JSON.parse(text) })
    } catch (e) {
      rawFiles.push({ name: x.name, text, error: (e as Error).message })
    }
  }
  const candidateFiles: DesignFile[] = []
  const nextTexts = new Map<string, string>()
  const changedNames = new Set<string>()
  for (const f of rawFiles) {
    if (f.error !== undefined) continue
    const norm = normalizeDesignJson(f.parsed)
    const nextText = `${JSON.stringify(norm, null, 2)}\n`
    nextTexts.set(f.name, nextText)
    if (JSON.stringify(f.parsed) !== JSON.stringify(norm)) changedNames.add(f.name)
    candidateFiles.push({ file: f.name, text: nextText })
  }
  const validated = candidateFiles.length > 0 ? loadPack(candidateFiles, BUILTIN) : BUILTIN
  const report: string[] = []
  let migratedCount = 0
  for (const f of rawFiles) {
    if (f.error !== undefined) {
      report.push(`  ✗ ${f.name}: skipped (malformed JSON: ${f.error})`)
      continue
    }
    if (!changedNames.has(f.name)) {
      report.push(`  · ${f.name}: already in English (unchanged)`)
      continue
    }
    const fatals = validated.problems.filter(p => p.file === f.name && p.fatal)
    if (fatals.length > 0) {
      report.push(`  ✗ ${f.name}: refused migration (${fatals.map(p => p.msg).join('; ')})`)
      continue
    }
    if (dryRun) {
      report.push(`  ~ ${f.name}: would migrate to English (--dry-run)`)
      migratedCount++
      continue
    }
    const bak = `${dir}/${f.name}.bak`
    if (!(await $.fs.exists(bak))) await $.fs.write(bak, f.text)
    await $.fs.write(`${dir}/${f.name}`, nextTexts.get(f.name) as string)
    report.push(`  ✓ ${f.name}: migrated (backup: ${f.name}.bak)`)
    migratedCount++
  }
  if (!dryRun && migratedCount > 0) await refreshDesigns($, true)
  const head = dryRun ? `Dry run (${migratedCount} file(s) would be migrated):` : `Migration complete (${migratedCount} file(s) migrated):`
  return [head, ...report].join('\n')
}

async function runCostumeCommand($: EngineInterface, argsStr: string): Promise<{ text: string }> {
  const [sub = 'list', ...rest] = argsStr.trim().split(/\s+/).filter(Boolean)
  const dir = await designsDir($)
  if (sub === 'folder' || sub === 'carpeta') return { text: TEXT.folderInfo(dir) }
  if (sub === 'reload' || sub === 'recargar') {
    await refreshDesigns($, true)
    return { text: designSummary(dir) }
  }
  if (sub === 'export' || sub === 'exportar') {
    const ids = rest.filter(x => !x.endsWith('.json'))
    if (ids.length === 0) return { text: TEXT.exportUsage }
    const { json, missing } = bundle(pack, ids)
    if (missing.length > 0) return { text: TEXT.notFoundIds(missing.join(', ')) }
    const target = rest.find(x => x.endsWith('.json')) ?? `${dir}/exported/${ids.join('+')}.crab.json`
    await $.fs.write(target, `${JSON.stringify(json, null, 2)}\n`)
    return { text: TEXT.exportedTo(target) }
  }
  if (sub === 'import' || sub === 'importar') {
    const src = rest.join(' ')
    if (!src) return { text: TEXT.importUsage }
    const name = (src.split('/').pop() ?? 'imported.json').replace(/\.(crab|cangrejo)\.json$/, '.json')
    let text: string
    try {
      text = String(await $.fs.read(src))
    } catch (err) {
      return { text: TEXT.cannotRead(src, (err as Error).message) }
    }
    // checked against what is installed now, exactly as it will be loaded
    const trial = loadPack([{ file: name, text }], pack)
    const mine = trial.problems.filter(x => x.file === name && x.fatal)
    if (mine.length > 0) return { text: TEXT.importRefused(mine.map(x => `  - ${x.id ? `${x.id}: ` : ''}${x.msg}`).join('\n')) }
    await $.fs.write(`${dir}/${name}`, text)
    await refreshDesigns($, true)
    return { text: TEXT.installedAt(`${dir}/${name}`, designSummary(dir)) }
  }
  if (sub === 'migrate' || sub === 'migrar') {
    const dryRun = rest.includes('--dry-run')
    return { text: await migrateDesigns($, dir, dryRun) }
  }
  return { text: designSummary(dir) }
}

/** One animation frame: repaint the stage and the pane's crabs in place; a size change asks for a redraw. */
async function paint($: EngineInterface, still: boolean): Promise<void> {
  frame = (frame + 1) % 100000
  // a design saved while the crabs are on screen shows up within about two seconds
  if (frame % 12 === 0) void refreshDesigns($).catch(() => undefined)
  const [s, t] = [await read($, bus), await $.clock.now()]
  if (!isActive(s, t) && !paneSite) {
    clock?.cancel()
    clock = undefined
    $.ui.invalidate('ui.render')
    return
  }
  // reduced motion: no plays, the crabs only show their state
  if (!still) dir = direct(dir, s, pack, t, frame)
  if (band) {
    const l = layout(s, t, band.columns, band.maxRows)
    if (l.kind === 'stage') {
      const c = cellsOf(compose(s, l, t, frame, still, pack, playing))
      const r = await $.ui.blit({ requestId: band.site, key: STAGE_KEY, cells: c.cells, columns: c.columns, rows: c.rows })
      if (r.deny !== undefined) $.ui.invalidate('ui.render')
    }
    // the "Ns ago" labels and the cast change slowly: a full redraw once a second is enough
    if (frame % 6 === 0) $.ui.invalidate('ui.render')
  }
  if (paneSite) {
    const site = paneSite
    for (const crab of paneCrabs) {
      const a = crab.id === '' ? undefined : s.agents[crab.id]
      if (crab.id !== '' && !a) continue
      const tick = still ? 1 : phase(frame, crab.i)
      const c = a
        ? (crab.mini ? miniCard : agentCard)(s, a, t, tick, still, pack, playing(a.id))
        : (crab.mini ? masterMini : masterCard)(s, t, tick, pack, playing(MASTER))
      await $.ui.blit({ requestId: site, key: crab.key, cells: cellsOf(c, crab.bg).cells })
    }
    if (frame % (paneView === 'list' && !still ? 3 : 6) === 0) $.ui.invalidate('ui.render')
  }
}

/** Opens the side pane by itself the first time a subagent starts; a narrow terminal leaves it waiting. */
async function autoOpen($: EngineInterface): Promise<void> {
  if (autoOpened) return
  autoOpened = true
  await $.ui.open({ id: PANE, title: TEXT.paneTitle, columns: PANE_COLUMNS })
}

/** The agent's conversation as transcript lines, re-read at most once a second; null when it cannot be read. */
async function transcript($: EngineInterface, a: AgentRec, name: string, width: number, now: number): Promise<TxLine[] | null> {
  const hit = txCache.get(a.id)
  if (hit && now - hit.at < 1000) return hit.lines
  let lines: TxLine[] | null = null
  try {
    const got: unknown = await $.session.messages({ agentId: a.id, as: 'api' })
    if (Array.isArray(got)) lines = transcriptLines(got, name, width)
  } catch {
    /* not readable: the panel falls back to what the hooks recorded */
  }
  // a finished agent's conversation may stop being readable: keep the last one read
  const kept = hit?.lines && hit.lines.length > 0 && (lines === null || lines.length === 0) ? hit.lines : lines
  txCache.set(a.id, { at: now, lines: kept })
  return kept
}

function ensureClock($: EngineInterface, ms: number, still: boolean): void {
  if (clock) return
  clock = $.clock.every(ms, () => void paint($, still).catch(() => undefined))
}

export const register: Register = (on, options) => {
  const opts = input(options)
  const raw = typeof opts['fps'] === 'number' ? opts['fps'] : 6
  const fps = Math.max(1, Math.min(10, Math.round(raw)))
  const still = opts['reduceMotion'] === true
  // with reduced motion one frame a second still refreshes states and envelopes
  const frameMs = still ? 1000 : Math.round(1000 / fps)
  // the band above the prompt: 'auto' = one discreet line only while the side pane is not shown,
  // 'stage' = the full animated stage there too, 'off' = never
  const bandMode = opts['band'] === 'stage' || opts['band'] === 'off' ? opts['band'] : 'auto'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'bus', description: TEXT.busCmdDesc })
    await $.command.register({ name: 'costume', description: TEXT.costumeCmdDesc })
    await $.command.register({ name: 'disfraz', description: TEXT.legacyCostumeCmdDesc })
    await refreshDesigns($).catch(() => undefined)
    // the usage limits as of now, so the bars show before this session's first reply
    try {
      const u = await $.session.usage()
      if (u.rateLimits.length > 0) await record($, s => onMeasure(s, { limits: limitsOf(u.rateLimits) }))
    } catch {
      /* no figures yet */
    }
    await $.tool.register({
      name: 'bus_step',
      description: 'For subagents: report your plan and progress to the master (plan, done, current, note, evidence, blocker, question, reply, ack, applied). Cheap; it only records state.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          plan: { type: 'array', items: { type: 'string' }, description: 'Your stages, 3-8 short items. Send it once, first.' },
          done: { type: 'integer', description: 'How many stages you have completed so far.' },
          current: { type: 'string', description: 'What you are doing now, a few words.' },
          note: { type: 'string', description: 'Short free note.' },
          evidence: { type: 'array', items: { type: 'object', properties: { stage: { type: 'integer' }, proof: { type: 'string' } }, required: ['stage', 'proof'] }, description: 'Facts that back a completed stage (a passing test, a file written).' },
          blocker: { type: 'string', description: 'What blocks you.' },
          clear_blocker: { type: 'boolean' },
          question: { type: 'string', description: 'A question for the master.' },
          reply: { type: 'string', description: 'Answer to a question the master sent you.' },
          ack: { type: 'boolean', description: 'You read a message from the master.' },
          applied: { type: 'boolean', description: 'You acted on a message from the master.' },
        },
      },
    })
    await $.tool.register({
      name: 'bus_status',
      description: 'For the master: what every subagent is doing right now. Three layers per agent: OBSERVED (hooks), DECLARED (its own bus_step reports), VERIFIED (declared stages with evidence), plus message delivery. Address SendMessage by the agent id shown here. Optional agent filter (id, name or part of its description).',
      isDeferred: false,
      inputSchema: { type: 'object', properties: { agent: { type: 'string' } } },
    })
    // the pane (master crab + subagents) is there from the first prompt, not only after the first spawn
    if (opts['openOnStart'] !== false) {
      autoOpened = true
      await $.ui.open({ id: PANE, title: TEXT.paneTitle, columns: PANE_COLUMNS }).catch(() => undefined)
      ensureClock($, frameMs, still)
    }
    return next(e)
  })

  on('command.run', { command: 'bus' }, async $ => {
    autoOpened = true
    const r = await $.ui.open({ id: PANE, title: TEXT.paneTitle, focus: true, columns: PANE_COLUMNS })
    ensureClock($, frameMs, still)
    return { text: r.isPlaced ? TEXT.paneOpened : TEXT.paneWaiting(r.reason ?? '') }
  })

  on('command.run', { command: 'costume' }, ($, e) => runCostumeCommand($, e.args))
  on('command.run', { command: 'disfraz' }, ($, e) => runCostumeCommand($, e.args))

  on('ui.close', { id: PANE }, ($, e, next) => {
    paneSite = undefined
    paneCrabs = []
    return next(e)
  })

  // The brief is the only thing added to what the model reads; the spawn itself is untouched.
  on('agent.spawn', async ($, e, next) => {
    const skip = e.workflow !== undefined || e.isTeammate === true
    const started = await next(skip ? e : { ...e, prompt: `${e.prompt}${BRIEF}` })
    if (started.deny === undefined && started.agentId) {
      const info: SpawnInfo = { id: started.agentId, type: e.subagentType, description: e.description, ...(e.name ? { name: e.name } : {}), model: started.model, ...(e.permissionMode ? { mode: e.permissionMode } : {}) }
      await refreshDesigns($).catch(() => undefined)
      await record($, (s, t) => onSpawn(s, info, t, pack))
      ensureClock($, frameMs, still)
      await autoOpen($)
    }
    return started
  }).catch(($, e, next) => next(e))

  // Every tool call a subagent makes is observed; the call itself is never touched.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    // bookkeeping tools (this plugin's, the engine's hand-back) are not what an agent does
    if (e.tool.startsWith('mcp__crabbus__') || (e.tool as string) === 'SubagentHandback') return next(e)
    if (!id) {
      // the master's own call: what its card shows (observed, never touched)
      const args = input(e)
      await record($, (s, t) => onMasterTool(s, e.tool, args, true, t)).catch(() => undefined)
      // the master working is reason enough to animate the panel's crab
      if (paneSite) ensureClock($, frameMs, still)
      const ran = await next(e)
      await record($, (s, t) => onMasterTool(s, e.tool, args, false, t)).catch(() => undefined)
      return ran
    }
    const args = input(e)
    try {
      await record($, (s, t) => onToolStart(s, id, e.tool, args, t))
      ensureClock($, frameMs, still)
    } catch {
      /* observation only */
    }
    const ran = await next(e)
    try {
      const failed = ran.deny !== undefined || ran.isError === true
      await record($, (s, t) => onToolEnd(s, id, e.tool, args, failed, t))
    } catch {
      /* observation only */
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: STEP }, async ($, e, next) => {
    void next
    const id = e.agentId
    if (!id) return { result: 'ignored: bus_step is for subagents. The master reads state with bus_status.' }
    const step = parseStep(input(e))
    await record($, (s, t) => onStep(s, id, step, t))
    return { result: stepReceipt(await read($, bus), id) }
  })

  on('tool.call', { tool: STATUS }, async ($, e, next) => {
    void next
    if (e.agentId) return { result: 'ignored: bus_status is for the master.' }
    const raw = input(e)['agent']
    const t = await $.clock.now()
    const report = statusReport(await read($, bus), t, typeof raw === 'string' && raw !== '' ? raw : undefined)
    const designs = problemLine()
    return { result: designs ? `${report}\n\n${designs}` : report }
  })

  // SendMessage from the master: observed as it leaves, with whether the harness accepted it.
  on('session.send', async ($, e, next) => {
    const sent = await next(e)
    if (e.agentId === undefined) {
      try {
        await record($, (s, t) => onSend(s, resolveTarget(s, e.to) ?? e.to, e.text, sent.isDelivered === true, t))
        ensureClock($, frameMs, still)
      } catch {
        /* observation only */
      }
    }
    return sent
  }).catch(($, e, next) => next(e))

  // Delivery into a subagent's own loop, as the engine sees it: the observed half of "received".
  on('session.receive', async ($, e, next) => {
    const got = await next(e)
    const id = e.agentId
    if (id) {
      try {
        await record($, (s, t) => onReceive(s, id, t))
      } catch {
        /* observation only */
      }
    }
    return got
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    if (id) {
      const c: Completion = {
        reason: e.reason,
        ...(e.usage ? { tokensIn: e.usage.input_tokens + e.usage.cache_read_input_tokens + e.usage.cache_creation_input_tokens, tokensOut: e.usage.output_tokens } : {}),
      }
      try {
        await record($, (s, t) => onComplete(s, id, c, t))
        ensureClock($, frameMs, still)
      } catch {
        /* observation only */
      }
    }
    return done
  }).catch(($, e, next) => next(e))

  // Every model request's usage, in any loop, as the API reported it: live tokens, context and cost.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r?.usage
    if (u) {
      const usage = { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens }
      void record($, (s, t) => onUsage(s, e.agentId, usage, u.model || e.model, t)).catch(() => undefined)
    }
    return r
  })

  // The ledger's real totals: session cost, the main loop's context window and the account's usage limits.
  on('session.measure', async ($, e, next) => {
    try {
      await record($, s => onMeasure(s, {
        ...(e.cost ? { costUsd: e.cost.usd } : {}),
        ...(e.context.tokens !== undefined ? { ctxTokens: e.context.tokens } : {}),
        ctxWindow: e.context.window,
        ...(e.context.percent !== undefined ? { ctxPercent: e.context.percent } : {}),
        limits: limitsOf(e.rateLimits),
      }))
    } catch {
      /* observation only */
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A subagent's call that Claude Code puts to the person (`ask` in a mode where the person decides)
  // shows in the panel as blocked until the call runs or is refused. Observed only: the answer is
  // given in Claude Code's own dialog, which a plugin can neither answer nor close.
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    const agentId = e.agentId
    const id = e.tool_use_id
    if (!agentId || !id || r.decision !== 'ask' || e.tool.startsWith('mcp__crabbus__')) return r
    try {
      const mode = (await read($, bus)).agents[agentId]?.mode
      if (mode !== undefined && PERSON_DECIDES.includes(mode)) {
        const t0 = await $.clock.now()
        await record($, s => onPermissionAsk(s, { id, agentId, tool: e.tool, arg: describeInput(e.tool, input(e.input)), at: t0 }))
        ensureClock($, frameMs, still)
        await $.ui.open({ id: PANE, title: TEXT.paneTitle, columns: PANE_COLUMNS }).catch(() => undefined)
      }
    } catch {
      /* observation only */
    }
    return r
  }).catch(($, e, next) => next(e))

  // ---- drawing (terminal only)

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface !== 'terminal' || bandMode === 'off') return next(e)
    const [s, t] = [await read($, bus), await $.clock.now()]
    const full = layout(s, t, e.props.bodyColumns, e.props.maxRows)
    // the side pane is the main view: while it is drawn the band stays out of the way
    const l = full.kind === 'none' || paneSite !== undefined ? { kind: 'none' as const } : bandMode === 'auto' ? { kind: 'line' as const } : full
    if (l.kind === 'none') {
      band = undefined
      return next(e)
    }
    band = { site: e.requestId, columns: e.props.bodyColumns, maxRows: e.props.maxRows }
    const { Box, Text, Raster } = $.ui.resolve(e)
    const below = await next(e)
    const labelBox = (lab: Label, key: string) => (
      <Box key={key} flexDirection="column" width={CARD_W} flexShrink={0}>
        {lab.lines.map((ln, i) => (
          <Text key={`${key}-${i}`} wrap="truncate-end" bold={ln.bold === true} dimColor={ln.dim === true} {...(ln.color !== undefined ? { color: hex(ln.color) } : {})}>
            {ln.text}
          </Text>
        ))}
      </Box>
    )
    if (l.kind === 'line') {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="flex-end">
            <Text wrap="truncate-end">
              {lineParts(s, t, pack).map((p, i) => (
                <Text key={`lp-${i}`} bold={p.bold === true} {...(p.color !== undefined ? { color: hex(p.color) } : {})}>
                  {p.text}
                </Text>
              ))}
            </Text>
          </Box>
          {below}
        </Box>
      )
    }
    const c = cellsOf(compose(s, l, t, frame, still, pack, playing))
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" alignItems="flex-end">
          <Raster key={STAGE_KEY} columns={c.columns} rows={c.rows} cells={c.cells} />
          <Box flexDirection="row" gap={1}>
            {l.agents.map(a => labelBox(agentLabel(a, t, l.labelRows, pack), `l-${a.id}`))}
            {labelBox(masterLabel(s, l, t, l.labelRows), 'l-master')}
          </Box>
        </Box>
        {below}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // The side panel (the v3 design): a list of the master and its subagents with metrics, delegation,
  // cards or rows and live activity; or one agent in detail with its transcript, a message field and
  // its figures. The body scrolls, so every section is drawn and the person folds what they skip.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [s, t, sel, all, open0, filter, mode, tab] = [
      await read($, bus), await $.clock.now(), await read($, selected), await read($, showAll),
      await read($, openSecs), await read($, filterAtom), await read($, modeAtom), await read($, tabAtom),
    ]
    if (e.surface !== 'terminal') {
      const { Text: Plain } = $.ui.resolve(e)
      return <Plain>{statusReport(s, t)}</Plain>
    }
    const { Box, Text, Raster, Button, Input } = $.ui.resolve(e)
    paneSite = e.requestId
    // after a reload nothing has started the animation clock yet: the open panel starts it
    ensureClock($, frameMs, still)
    const open = { ...OPEN0, ...(open0 ?? {}) }
    const W = Math.max(30, e.props.bodyColumns)
    const crabs: typeof paneCrabs = []
    const crabCanvas = (id: string, i: number, mini: boolean) => {
      const a = id === '' ? undefined : s.agents[id]
      const tick = still ? 1 : phase(frame, i)
      return a
        ? (mini ? miniCard : agentCard)(s, a, t, tick, still, pack, playing(a.id))
        : (mini ? masterMini : masterCard)(s, t, tick, pack, playing(MASTER))
    }
    // an animated crab repainted in place (blit) between redraws; `bg` fills its transparent cells
    const crab = (key: string, id: string, i: number, mini = false, bg?: number) => {
      crabs.push({ key, id, i, mini, ...(bg !== undefined ? { bg } : {}) })
      const c = cellsOf(crabCanvas(id, i, mini), bg)
      return <Raster key={key} columns={c.columns} rows={c.rows} cells={c.cells} />
    }
    // a crab drawn as colored text, one Button per row: pressing any part of it opens the agent.
    // It moves on each redraw of the list (twice a second), as the design's crabs step.
    const crabButtons = (key: string, id: string, i: number, mini: boolean, bg: number, onPress?: () => void) => (
      <Box key={key} flexDirection="column" flexShrink={0}>
        {textRows(crabCanvas(id, i, mini), bg).map((row, r) => {
          const runs = row.map((run, k) => <Text key={`${key}-${r}-${k}`} color={hex(run.fg)} backgroundColor={hex(run.bg)}>{run.t}</Text>)
          return onPress ? <Button key={`${key}-${r}`} plain onPress={onPress}>{runs}</Button> : <Text key={`${key}-${r}`}>{runs}</Text>
        })}
      </Box>
    )
    // a new view starts at its top: the body's window would otherwise stay where the last one was
    const toTop = () => void $.ui.scroll({ in: PANE, to: 'start' }).catch(() => undefined)
    const select = (id: string | null) => () => void update($, selected, () => id).then(toTop)
    const toggle = (k: string) => () => void update($, openSecs, o => ({ ...OPEN0, ...(o ?? {}), [k]: !({ ...OPEN0, ...(o ?? {}) })[k] }))
    const ch = (k: string) => (open[k] ? '▾' : '▸')
    // a section's header: the fold arrow and caps label on the left, a summary on the right
    const section = (k: string, label: string, right: string, rightColor: number = C.dim, mark?: [string, number]) => (
      <Box key={`h-${k}`} flexDirection="row" width="100%">
        <Button key={`sec-${k}`} plain onPress={toggle(k)}>
          <Text color={hex(C.dim)}>{ch(k)} </Text>
          {mark ? <Text color={hex(mark[1])}>{mark[0]} </Text> : ''}
          <Text color={hex(C.faint)}>{label}</Text>
        </Button>
        <Box flexGrow={1} />
        <Text wrap="truncate-end" color={hex(rightColor)}>{right}</Text>
      </Box>
    )
    // the state chip never wraps: in a narrow panel it keeps only its glyph
    const compact = W < 50
    const chip = (st: UiStatus, short = compact) => (
      <Box flexShrink={0}><Text color={hex(ST[st].c)} backgroundColor={hex(ST[st].bg)}>{short ? ` ${ST[st].g} ` : ` ${ST[st].g} ${ST[st].l} `}</Text></Box>
    )
    const rule = (key: string, w = W) => <Text key={key} color={hex(C.line)}>{'─'.repeat(Math.max(1, w))}</Text>
    const ctxLine = (key: string, pct: number | undefined, color: number, w: number, tail: string, tailCost: string) => {
      const bw = Math.max(4, w - 10 - tail.length - tailCost.length - 2)
      const [fill, rest] = meter(pct ?? 0, bw)
      return (
        <Text key={key} wrap="truncate-end">
          <Text color={hex(C.dim)}>ctx </Text>
          <Text color={hex(color)}>{pct !== undefined ? `${pct}%`.padEnd(4) : '–'.padEnd(4)} </Text>
          <Text color={hex(color)}>{fill}</Text>
          <Text color={hex(C.track)}>{rest}</Text>
          <Text color={hex(C.dim)}> {tail} </Text>
          <Text color={hex(C.peach)}>{tailCost}</Text>
        </Text>
      )
    }
    const listed = panelAgents(paneList(s, t, all === true).shown)
    // an agent opened from the older ones still has neighbours to move between
    const navList = sel && !listed.some(x => x.id === sel) ? panelAgents(paneList(s, t, true).shown) : listed
    const a = sel ? s.agents[sel] : undefined
    let body

    if (a) {
      // ---- one agent in detail
      paneView = 'detail'
      const d = detailModel(s, a, navList, t, pack)
      const v = d.v
      const go = (k: number) => () => {
        if (navList.length === 0) return
        const i = navList.findIndex(x => x.id === a.id)
        const next = navList[(i + k + navList.length) % navList.length] as AgentRec
        void update($, selected, () => next.id).then(toTop)
      }
      const txW = W - 7
      const read_ = await transcript($, a, v.name, txW, t)
      const source = read_ && read_.length > 0 ? read_ : fallbackLines(a, v.name)
      const lines = filterTab(source, tab ?? 'all').slice(-60)
      const active = v.st === 'working' || v.st === 'thinking'
      const spin = '·✢✳✶✻✽'[Math.floor(frame / 6) % 6] as string
      const half = Math.floor(W / 2)
      const card = (k: string, label: string, mark: number, right: string, rightC: number, w: number | string, inner: () => RenderChildren) => (
        <Box key={`d-${k}`} flexDirection="column" width={w} borderStyle="round" borderColor={hex(C.edgeHi)} backgroundColor={hex(CARD_BG)} paddingX={1}>
          {section(k, label, right, rightC, ['■', mark])}
          {open[k] ? inner() : null}
        </Box>
      )
      body = (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="back" hotkey="b" plain onPress={select(null)}>←</Button>
            {crab(`p-${a.id}`, a.id, Math.max(0, v.idx - 1))}
            <Box flexDirection="column" flexGrow={1}>
              <Text bold wrap="truncate-end" color={hex(v.color)}>{v.name}</Text>
              <Text wrap="truncate-end" color={hex(C.dim)}>{`${v.role} · ${v.model}`}</Text>
              <Box flexDirection="row">{chip(v.st)}</Box>
              <Text wrap="truncate-end" color={hex(C.text)}>{v.summary}</Text>
              {v.permission && <Text color={hex(C.pink)} wrap="truncate-end">{TEXT.answerInDialog}</Text>}
              <Box flexDirection="row" gap={1}>
                <Button key="prev" hotkey="p" plain onPress={go(-1)}>‹</Button>
                <Text color={hex(C.dim)}>{d.pos}</Text>
                <Button key="next" hotkey="n" plain onPress={go(1)}>›</Button>
              </Box>
            </Box>
          </Box>

          <Box flexDirection="column" borderStyle="round" borderColor={hex(C.line2)} paddingX={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              {TABS.map(x => (
                <Button key={`tab-${x}`} plain onPress={() => void update($, tabAtom, () => x).then(() => $.ui.scroll({ to: { key: 'tab-all' }, in: PANE, block: 'start' }).catch(() => undefined))}>
                  <Text color={hex(x === tab ? C.text : C.dim)} {...(x === tab ? { backgroundColor: hex(C.chip) } : {})}>{` ${x} `}</Text>
                </Button>
              ))}
              <Box flexGrow={1} />
              <Text color={hex(active ? C.mint : ST[v.st].c)}>{`● ${active ? TEXT.live : v.st}`}</Text>
            </Box>
            {(read_ === null || read_.length === 0) && <Text dimColor wrap="truncate-end">{TEXT.transcriptUnavailable}</Text>}
            {lines.length === 0 && <Text color={hex(C.faint)}>{tab === 'reasoning' ? TEXT.noReasoning : TEXT.noToolsYet}</Text>}
            {lines.map((l, k) => (
              <Box key={`tx-${k}`} flexDirection="row" marginTop={k === 0 ? 0 : 1}>
                <Box width={2} flexShrink={0}><Text color={hex(l.gc)}>{l.g}</Text></Box>
                <Box flexDirection="column" flexGrow={1}>
                  <Text wrap="wrap">
                    <Text bold color={hex(l.hc)}>{l.head}</Text>
                    <Text color={hex(C.dim)}>{l.arg}</Text>
                    <Text color={hex(l.tc)} italic={l.italic}>{l.text}</Text>
                  </Text>
                  {l.body.map((b, j) => (
                    <Box key={`tx-${k}-${j}`} flexDirection="row">
                      <Box width={2} flexShrink={0}><Text color={hex(C.faint)}>{b.p}</Text></Box>
                      <Text wrap="truncate-end" color={hex(b.c)} {...(b.bg !== undefined ? { backgroundColor: hex(b.bg) } : {})}>{b.t}</Text>
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}
            {active && (
              <Box flexDirection="row" marginTop={1}>
                <Box width={2}><Text color={hex(v.st === 'thinking' ? C.lav : C.peach)}>{spin}</Text></Box>
                <Text color={hex(v.st === 'thinking' ? C.lav : C.peach)}>{v.st === 'thinking' ? 'Pondering… ' : 'Working… '}<Text color={hex(C.faint)}>{`(${v.ago.replace(' ago', '')} · ↓ ${d.tokens.out} tokens)`}</Text></Text>
              </Box>
            )}
            {rule('tx-rule', W - 4)}
            <Box flexDirection="row">
              <Text color={hex(C.mint)} bold>❯ </Text>
              <Input
                key={`msg-${a.id}`}
                placeholder={TEXT.messagePlaceholder(v.name)}
                submitLabel="send"
                onSubmit={(text: string) => {
                  const msg = text.trim()
                  if (!msg) return
                  void (async () => {
                    const r = await $.session.send({ to: { agentId: a.id }, text: msg })
                    await record($, (st, now) => onSend(st, a.id, msg, r.isDelivered === true, now))
                    txCache.delete(a.id)
                    ensureClock($, frameMs, still)
                    $.ui.toast(r.isDelivered === true ? TEXT.sent(v.name) : TEXT.notSent('the agent did not take it'))
                  })().catch((err: unknown) => void $.ui.toast(TEXT.notSent((err as Error).message)))
                }}
              />
            </Box>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            {section('details', TEXT.secDetails, d.elapsed)}
            {open['details'] && (
              <Box flexDirection="column">
                <Box flexDirection="row">
                  {card('dCost', 'COST', C.peach, v.costTxt, C.peach, half, () => (
                    <Box flexDirection="column">
                      {d.cost.parts.map(p => (
                        <Box key={`cp-${p.l}`} flexDirection="column">
                          <Box flexDirection="row"><Text color={hex(C.dim)}>{p.l}</Text><Box flexGrow={1} /><Text>{p.v}</Text></Box>
                          <Text color={hex(C.peach)}>{meter(p.pct, Math.max(4, half - 4))[0]}<Text color={hex(C.track)}>{meter(p.pct, Math.max(4, half - 4))[1]}</Text></Text>
                        </Box>
                      ))}
                      <Text color={hex(C.faint)} wrap="truncate-end">{d.cost.rate}</Text>
                    </Box>
                  ))}
                  {card('dTok', 'TOKENS', C.cyan, `↑${d.tokens.inTxt}`, C.cyan, W - half, () => (
                    <Box flexDirection="column">
                      <Text><Text color={hex(C.pink)}>↓</Text> {d.tokens.out} out</Text>
                      <Text color={hex(C.cyan)} wrap="truncate-end">{d.tokens.spark || '–'}</Text>
                      <Text color={hex(C.dim)} wrap="truncate-end">cache {d.tokens.cache} · <Text color={hex(C.mint)}>{d.tokens.hit}</Text></Text>
                    </Box>
                  ))}
                </Box>
                <Box flexDirection="row">
                  {card('dCtx', 'CONTEXT', C.mint, v.ctxPct !== undefined ? `${v.ctxPct}%` : '–', v.ctxC, half, () => (
                    <Box flexDirection="column">
                      <Text>{d.ctx.cells.map((c, k) => <Text key={`cc-${k}`} color={hex(c)}>▮</Text>)}</Text>
                      <Text color={hex(C.dim)} wrap="truncate-end">{d.ctx.used} · compact 80%</Text>
                    </Box>
                  ))}
                  {card('dTime', 'TIMING', C.pink, `${d.timing.avg}/req`, C.text, W - half, () => (
                    <Box flexDirection="column">
                      <Text color={hex(C.dim)}>start <Text color={hex(C.text)}>{d.timing.start}</Text></Text>
                      <Text color={hex(C.dim)}>last <Text color={hex(C.text)}>{d.timing.last}</Text></Text>
                      <Text>{d.timing.cells.map((c, k) => <Text key={`tc-${k}`} color={hex(c)}>▮</Text>)}</Text>
                    </Box>
                  ))}
                </Box>
                {card('dTools', 'TOOLS', C.lav, d.tools.count, C.dim, '100%', () => (
                  <Box flexDirection="column">
                    <Text wrap="truncate-end"><Text color={hex(v.toolC)}>⏺</Text> <Text bold>{d.tools.current}</Text></Text>
                    {d.tools.history.map((run, k) => (
                      <Box key={`th-${k}`} flexDirection="row" gap={1}>
                        <Text color={hex(run.c)}>{run.g}</Text>
                        <Box width={9} flexShrink={0}><Text wrap="truncate-end">{run.n}</Text></Box>
                        <Box flexGrow={1}><Text wrap="truncate-end" color={hex(C.dim)}>{run.a}</Text></Box>
                        <Text color={hex(C.faint)}>{run.t}</Text>
                      </Box>
                    ))}
                  </Box>
                ))}
                {card('dTasks', 'STAGES', C.yellow, `${v.progTxt} declared`, C.yellow, '100%', () => (
                  <Box flexDirection="column">
                    {d.tasks.length === 0 && <Text color={hex(C.faint)}>no plan declared</Text>}
                    {d.tasks.map((x, k) => (
                      <Text key={`tk-${k}`} wrap="truncate-end"><Text color={hex(x.c)}>{x.g} </Text><Text color={hex(x.tc)} strikethrough={x.strike}>{x.t}</Text></Text>
                    ))}
                    <Text color={hex(C.mint)} dimColor wrap="truncate-end">{d.verified}</Text>
                    {d.blockers.map((b, k) => <Text key={`bl-${k}`} color={hex(C.pink)} wrap="truncate-end">⚠ {b}</Text>)}
                    {d.questions.map((q, k) => <Text key={`q-${k}`} color={hex(C.lav)} wrap="truncate-end">? {q}</Text>)}
                    {d.messages.map((m, k) => (
                      <Box key={`m-${k}`} flexDirection="column">
                        <Text wrap="truncate-end">✉ “{m.text}”</Text>
                        <Text color={hex(m.c)} wrap="truncate-end">  {m.steps}</Text>
                      </Box>
                    ))}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button key="tabkey" hotkey="t" plain onPress={() => void update($, tabAtom, x => TABS[(TABS.indexOf(x ?? 'all') + 1) % TABS.length] as TxTab)}>tab</Button>
            <Text color={hex(C.faint)} wrap="truncate-end">{TEXT.detailHints}</Text>
          </Box>
        </Box>
      )
    } else {
      // ---- the list
      paneView = 'list'
      const m = listModel(s, t, { filter: filter ?? 'all', showAll: all === true }, pack)
      // narrow panels: half-size crabs in the cards too
      const miniCards = W < 46
      const spriteW = miniCards ? CARD_W / 2 : CARD_W
      const cardInner = W - 4
      const textW = Math.max(10, cardInner - spriteW - 1)
      const ms = m.master.st
      // one line of a card: colored runs fitted to the column exactly (cut with … or padded with
      // spaces) inside a Button, so a press anywhere along the row opens the agent
      type Seg = [string, number, boolean?]
      const fitSegs = (segs: readonly Seg[], w: number): Seg[] => {
        const out: Seg[] = []
        let left = w
        for (const [t0, c, b] of segs) {
          if (left <= 0) break
          const t = t0.length > left ? `${t0.slice(0, Math.max(0, left - 1))}…` : t0
          out.push([t, c, b])
          left -= t.length
        }
        if (left > 0) out.push([' '.repeat(left), C.dim])
        return out
      }
      const rowButton = (key: string, segs: readonly Seg[], w: number, onPress: () => void, hotkey?: string) => (
        <Button key={key} plain {...(hotkey ? { hotkey } : {})} onPress={onPress}>
          {fitSegs(segs, hotkey ? w - hotkey.length - 2 : w).map(([t, c, b], k) => <Text key={`${key}-${k}`} color={hex(c)} bold={b === true}>{t}</Text>)}
        </Button>
      )
      const ctxSegs = (pct: number | undefined, color: number, w: number, tail: string, cost: string): Seg[] => {
        const bw = Math.max(4, w - 9 - (tail ? tail.length + 2 : 0) - (cost ? cost.length + 1 : 0))
        const [fill, rest] = meter(pct ?? 0, bw)
        return [['ctx ', C.dim], [`${pct !== undefined ? `${pct}%` : '–'}`.padEnd(4) + ' ', color], [fill, color], [rest, C.track], ...(tail ? ([[`  ${tail}`, C.dim]] as Seg[]) : []), ...(cost ? ([[` ${cost}`, C.peach]] as Seg[]) : [])]
      }
      const cell = (k: string, label: string, value: RenderChildren, extra: RenderChildren) => (
        <Box key={`mc-${k}`} flexDirection="column" width="25%" borderStyle="round" borderColor={hex(C.edgeHi)} backgroundColor={hex(cardBg('done'))} paddingX={1}>
          <Text color={hex(C.faint)}>{label}</Text>
          {value}
          {extra}
        </Box>
      )
      const cw = Math.max(4, Math.floor(W / 4) - 4)
      const problems = pack.problems.filter(x => x.fatal)
      const mBg = cardBg(ms)
      body = (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold color={hex(C.master)}>{TEXT.panelTitle} </Text>
            <Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="truncate-end" color={hex(C.dim)}>{`${TEXT.agentsCount(m.all.length + 1)} · updated ${new Date(t).toTimeString().slice(0, 8)}`}</Text></Box>
            <Button key="mode" hotkey="m" plain onPress={() => void update($, modeAtom, x => (x === 'rows' ? 'cards' : 'rows'))}>
              <Text color={hex(C.dim)}>{mode === 'rows' ? TEXT.modeCards : TEXT.modeRows}</Text>
            </Button>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {ORDER.map(k => (
              <Text key={`lg-${k}`}><Text color={hex(ST[k].c)}>{ST[k].g}</Text><Text color={hex(C.dim)}> {ST[k].l} </Text><Text color={hex(C.text)}>{k === 'done' ? m.counts.done + m.counts.failed : m.counts[k]}</Text></Text>
            ))}
          </Box>
          {rule('r1')}

          {section('metrics', TEXT.secMetrics, m.metrics.summary)}
          {open['metrics'] && (
            <Box flexDirection="column">
              <Box flexDirection="row">
                {cell('st', TEXT.cellStages, <Text bold color={hex(C.yellow)}>{m.metrics.stagesTxt}</Text>, <Text><Text color={hex(C.yellow)}>{meter(m.metrics.stagesPct, cw)[0]}</Text><Text color={hex(C.track)}>{meter(m.metrics.stagesPct, cw)[1]}</Text></Text>)}
                {cell('ctx', TEXT.cellCtx, <Text bold color={hex(m.metrics.ctxC)}>{m.metrics.ctxPct !== undefined ? `${m.metrics.ctxPct}%` : '–'}</Text>, <Text><Text color={hex(m.metrics.ctxC)}>{meter(m.metrics.ctxPct ?? 0, cw)[0]}</Text><Text color={hex(C.track)}>{meter(m.metrics.ctxPct ?? 0, cw)[1]}</Text></Text>)}
                {cell('tok', TEXT.cellTokens, <Text wrap="truncate-end"><Text color={hex(C.cyan)}>↑</Text>{m.metrics.tokIn}</Text>, <Text wrap="truncate-end" color={hex(C.dim)}><Text color={hex(C.pink)}>↓</Text>{m.metrics.tokOut}</Text>)}
                {cell('cost', TEXT.cellCost, <Text bold wrap="truncate-end" color={hex(C.peach)}>{m.metrics.costTxt}</Text>, <Text wrap="truncate-end" color={hex(C.peach)}>{m.metrics.costSpark || ' '}</Text>)}
              </Box>
              {m.metrics.limits.map(l => {
                // name (6) + bar + "  42%" (5) + "  resets …": the bar takes what the text leaves
                const reset = l.reset !== undefined ? `  ${TEXT.usageResets(l.at, l.reset)}` : ''
                // one width for every bar, so they line up: the longest reset text sets it
                const longest = Math.max(...m.metrics.limits.map(x => (x.reset !== undefined ? 2 + TEXT.usageResets(x.at, x.reset).length : 0)))
                const bw = Math.max(6, W - 2 - 6 - 5 - longest)
                const [used, left] = meter(l.pct, bw)
                return (
                  <Box key={`lim-${l.name}`} flexDirection="row">
                    <Box flexShrink={0}><Text color={hex(C.dim)}>{l.name.padEnd(6)}</Text></Box>
                    <Box flexShrink={0}><Text><Text color={hex(l.c)}>{used}</Text><Text color={hex(C.track)}>{left}</Text></Text></Box>
                    <Box flexShrink={0}><Text bold color={hex(l.c)}>{`${Math.round(l.pct)}%`.padStart(5)}</Text></Box>
                    {reset && <Box flexShrink={1} minWidth={0}><Text wrap="truncate-end" color={hex(C.faint)}>{reset}</Text></Box>}
                  </Box>
                )
              })}
              {m.liveTools.length > 0 && (
                <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                  <Text color={hex(C.faint)}>{TEXT.inFlight}</Text>
                  {m.liveTools.map(x => (
                    <Text key={`lt-${x.n}`} backgroundColor={hex(C.chip)}> <Text color={hex(x.c)}>●</Text> {x.n}<Text color={hex(C.faint)}>×{x.k}</Text> </Text>
                  ))}
                </Box>
              )}
            </Box>
          )}

          <Box key="card-master" flexDirection="column" borderStyle="round" borderColor={hex(cardEdge(ms))} backgroundColor={hex(mBg)} paddingX={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              {crabButtons('p-master', '', 0, miniCards, mBg)}
              <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                <Box flexDirection="row">
                  <Box flexGrow={1}><Text bold color={hex(C.master)}>{TEXT.masterTitle}</Text></Box>
                  {chip(ms)}
                </Box>
                <Text wrap="truncate-end"><Text color={hex(ms === 'working' ? C.mint : C.faint)}>⏺</Text> <Text bold>{m.master.tool}</Text> <Text color={hex(C.dim)}>{m.master.arg}</Text></Text>
                <Text wrap="truncate-end" color={hex(C.dim)}>{TEXT.delegated} <Text color={hex(C.yellow)}>{m.master.delegated}</Text> done</Text>
                <Text wrap="truncate-end" color={hex(C.dim)}>{m.master.tokTxt}  <Text color={hex(C.peach)}>{m.master.costTxt}</Text></Text>
                {ctxLine('m-ctx', m.master.ctxPct, m.master.ctxC, textW, '', '')}
              </Box>
            </Box>
            {rule('r-m', cardInner)}
            {section('deleg', TEXT.secDelegation, TEXT.subagentsCount(m.all.length))}
            {open['deleg'] && m.all.map((v, k) => {
              const nameW = Math.max(6, cardInner - 22)
              return (
                <Button key={`dl-${v.id}`} plain onPress={select(v.id)}>
                  <Text color={hex(C.faint)}>{k === m.all.length - 1 ? '└─ ' : '├─ '}</Text>
                  <Text color={hex(ST[v.st].c)}>{ST[v.st].g} </Text>
                  <Text color={hex(v.color)}>{fit(v.name, nameW).padEnd(nameW)}</Text>
                  <Text color={hex(ST[v.st].c)}> {fit(v.bar, 10).padEnd(10)}</Text>
                  <Text color={hex(C.dim)}> {v.progTxt.padStart(4)}</Text>
                </Button>
              )
            })}
          </Box>

          <Box flexDirection="column" marginTop={1}>
            {section('subs', TEXT.secSubagents, String(m.all.length))}
            {open['subs'] && (
              <Box flexDirection="column">
                <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                  {m.filters.map(f => (
                    <Button key={`f-${f.id}`} plain onPress={() => void update($, filterAtom, () => f.id)}>
                      <Text color={hex(f.id === filter ? C.text : C.dim)} {...(f.id === filter ? { backgroundColor: hex(C.chip) } : {})}>{` ${f.id} `}<Text color={hex(C.faint)}>{f.n} </Text></Text>
                    </Button>
                  ))}
                </Box>
                {m.cards.length === 0 && <Text color={hex(C.faint)}>{m.all.length === 0 ? TEXT.noSubagentsSession : TEXT.noneInFilter}</Text>}
                {(() => {
                  const rowsMode = mode === 'rows'
                  const items = m.cards.map((v, n) => {
                  const bg = cardBg(v.st)
                  const rows = rowsMode
                  const permission = v.permission && (
                    <Box flexDirection="column" borderStyle="round" borderColor={hex(C.pink)} backgroundColor={hex(cardBg('blocked', true))} paddingX={1}>
                      <Text color={hex(C.pink)} wrap="truncate-end">{TEXT.permissionAsk(`${v.permission.tool} ${v.permission.arg}`.trim())}</Text>
                      <Text color={hex(C.dim)} wrap="truncate-end">{TEXT.answerInDialog}</Text>
                    </Box>
                  )
                  return (
                    <Box
                      key={`card-${v.id}`}
                      flexDirection="column"
                      {...(rows
                        ? { backgroundColor: hex(bg), hover: { backgroundColor: hex(cardBg(v.st, true)) }, ...(n > 0 ? { marginTop: 0 } : {}) }
                        : { borderStyle: 'round', borderColor: hex(cardEdge(v.st)), backgroundColor: hex(bg), hover: { borderColor: hex(cardEdge(v.st, true)) }, paddingX: 1, marginTop: 1 })}
                    >
                      {rows && n > 0 && <Text color={hex(C.line2)}>{'─'.repeat(Math.max(1, cardInner))}</Text>}
                      <Box flexDirection="row" gap={1}>
                        {crabButtons(`cs-${v.id}`, v.id, v.idx, rows || miniCards, bg, select(v.id))}
                        {(() => {
                          const tw = Math.max(10, cardInner - (rows || miniCards ? CARD_W / 2 : CARD_W) - 1)
                          const short = rows || compact
                          const chipW = short ? 3 : ST[v.st].l.length + 4
                          const open_ = select(v.id)
                          return (
                            <Box flexDirection="column" width={tw}>
                              <Box flexDirection="row" gap={1}>
                                {rowButton(`b-${v.id}`, [[v.name, v.color, true]], tw - chipW - 1, open_, v.idx <= 9 ? String(v.idx) : undefined)}
                                {chip(v.st, short)}
                              </Box>
                              {!rows && rowButton(`cl-${v.id}-role`, [[`${v.role} · ${v.model}`, C.dim]], tw, open_)}
                              {rowButton(`cl-${v.id}-tool`, [['⏺ ', v.toolC], [v.tool, C.text, true], [` ${v.arg}`, C.dim]], tw, open_)}
                              {rowButton(`cl-${v.id}-prog`, [[v.bar || '–', ST[v.st].c], [` ${v.progTxt}`, C.dim], [`  ${v.ago}`, C.faint]], tw, open_)}
                              {rowButton(`cl-${v.id}-ctx`, ctxSegs(v.ctxPct, v.ctxC, tw, rows ? v.tokTxt : '', rows ? v.costTxt : ''), tw, open_)}
                              {!rows && rowButton(`cl-${v.id}-tok`, [[v.tokTxt, C.dim], [`  ${v.costTxt}`, C.peach]], tw, open_)}
                              {!rows && rowButton(`cl-${v.id}-sum`, [[v.summary, v.st === 'blocked' ? C.pink : C.faint]], tw, open_)}
                            </Box>
                          )
                        })()}
                      </Box>
                      {permission}
                    </Box>
                  )
                  })
                  // rows: one box, the design's list; cards: one box each
                  return rowsMode && items.length > 0 ? (
                    <Box flexDirection="column" borderStyle="round" borderColor={hex(C.edgeHi)} backgroundColor={hex(CARD_BG)} paddingX={1} marginTop={1}>{items}</Box>
                  ) : items
                })()}
              </Box>
            )}
          </Box>

          <Box flexDirection="column" borderStyle="round" borderColor={hex(C.edgeHi)} paddingX={1} marginTop={1}>
            {section('act', TEXT.secActivity, `● ${TEXT.live}`, C.mint)}
            {open['act'] && m.activity.length === 0 && <Text color={hex(C.faint)}>{TEXT.noActivity}</Text>}
            {open['act'] && m.activity.map((x, k) => (
              <Text key={`ac-${k}`} wrap="truncate-end">
                <Text color={hex(C.faint)}>{x.ts} </Text>
                <Text color={hex(x.gc)}>{x.g} </Text>
                <Text color={hex(x.color)}>{x.name}</Text>
                <Text color={hex(C.dim)}> {x.text}</Text>
              </Text>
            ))}
          </Box>

          {m.older > 0 || all === true ? (
            <Button key="older" hotkey="o" plain onPress={() => void update($, showAll, x => !x)}>
              <Text dimColor>{all === true ? TEXT.hideOlder : TEXT.showOlder(m.older)}</Text>
            </Button>
          ) : null}
          {problems.length > 0 && <Text color="#e5484d">{TEXT.problemsBanner(problems.length)}</Text>}
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
            <Button key="fkey" hotkey="f" plain onPress={() => void update($, filterAtom, x => FILTERS[(FILTERS.indexOf(x ?? 'all') + 1) % FILTERS.length] as Filter)}>filter</Button>
            <Text color={hex(C.faint)} wrap="truncate-end">{TEXT.listHints}</Text>
          </Box>
        </Box>
      )
    }
    paneCrabs = crabs
    return body
  }).catch(($, e, next) => next(e))
}
