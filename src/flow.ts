// Topology and communication flow graph for CrabBus. Pure: no `$`, no Node.
//
// Builds a layered node-and-edge network from BusState (observed spawns, parent-child links,
// SendMessage traffic between master and subagents or peer-to-peer, and declared roles/links).

import { BUILTIN } from './builtin.ts'
import { ago, uiStatus, type AgentRec, type AgentRole, type BusMsg, type BusState } from './model.ts'
import { costumeColor, type Pack } from './pack.ts'
import { bar, shownName } from './scene.ts'
import { C, clean, fit, ST, type UiStatus } from './theme.ts'

export type FlowDirection = 'td' | 'lr'

export type NodeRole = AgentRole | 'teammate'

export type ArchPattern =
  | 'idle'
  | 'single'
  | 'fan-out'
  | 'orchestrator-workers-verifier'
  | 'hierarchical'
  | 'team-mesh'
  | 'evaluator-optimizer'
  | 'hybrid-cli'

export type FlowNode = {
  /** '' for the master, agent.id for subagents. */
  id: string
  name: string
  role: NodeRole
  roleBadge: string
  roleColor: number
  tier: number
  st: UiStatus
  color: number
  costume: string
  cli?: 'codex' | 'agy' | 'claude'
  isTeammate?: boolean
  parentId: string
  tool: string
  progTxt: string
  bar: string
  inFlightIn: number
  inFlightOut: number
  msgCountIn: number
  msgCountOut: number
  agoTxt: string
}

export type FlowEdge = {
  id: string
  from: string
  to: string
  fromName: string
  toName: string
  kind: 'spawn' | 'pipeline' | 'message' | 'peer' | 'feedback'
  msgCount: number
  inFlight: boolean
  unapplied: boolean
  lastText?: string
  lastAt?: number
  agoTxt?: string
  color: number
}

export type FlowTier = {
  tier: number
  label: string
  nodes: FlowNode[]
}

export type FlowGraph = {
  pattern: ArchPattern
  patternLabel: string
  patternDesc: string
  nodes: FlowNode[]
  tiers: FlowTier[]
  edges: FlowEdge[]
  channels: FlowEdge[]
  flyingCount: number
  unappliedCount: number
  totalMsgs: number
  hasFeedbackLoop: boolean
  feedbackText?: string
}

const VERIFIER_RE = /\b(verif\w*|qa|review\w*|judge|audit\w*|gate|validator|tester|check\w*)\b/i
const CRITIC_RE = /\b(critic\w*|red-team|adversar\w*|challenger|evaluat\w*)\b/i
const LEAD_RE = /\b(lead\w*|orchestrat\w*|coordinat\w*|architect|manager|dispatcher|planner)\b/i

export const ROLE_META: Record<NodeRole, { badge: string; color: number }> = {
  orchestrator: { badge: 'ORCHESTRATOR', color: C.master },
  lead: { badge: 'LEAD', color: C.lav },
  worker: { badge: 'WORKER', color: C.cyan },
  verifier: { badge: 'VERIFIER', color: C.mint },
  critic: { badge: 'CRITIC', color: C.pink },
  teammate: { badge: 'TEAMMATE', color: C.peach },
}

/** Infers an agent's architectural role from its explicit bus_step declaration, children, or task text. */
export const inferNodeRole = (a: AgentRec, all: readonly AgentRec[]): NodeRole => {
  if (a.role) return a.role
  if (all.some(x => x.parentId === a.id)) return 'lead'
  const text = `${a.name ?? ''} ${a.nickname ?? ''} ${a.description} ${a.type}`
  if (CRITIC_RE.test(text)) return 'critic'
  if (VERIFIER_RE.test(text)) return 'verifier'
  if (LEAD_RE.test(text)) return 'lead'
  if (a.isTeammate) return 'teammate'
  return 'worker'
}

const masterSt = (s: BusState): UiStatus =>
  s.session?.inTool ? 'working' : Object.values(s.agents).some(a => a.status === 'running') ? 'thinking' : 'done'

const nodeNameOf = (s: BusState, id: string): string => {
  if (!id || id === 'master') return 'master'
  const a = s.agents[id]
  return a ? clean(shownName(a)) : id
}

const resolveNodeId = (s: BusState, ref: string): string => {
  if (!ref || ref === 'master' || ref === 'orchestrator') return ''
  if (s.agents[ref]) return ref
  const low = ref.toLowerCase()
  const found = Object.values(s.agents).find(
    a => a.name?.toLowerCase() === low || a.nickname?.toLowerCase() === low || a.description.toLowerCase().includes(low),
  )
  return found ? found.id : ref
}

const patternMeta = (p: ArchPattern, n: number): { label: string; desc: string } => {
  switch (p) {
    case 'idle':
      return { label: 'Ready · No Active Topology', desc: 'Spawn subagents or use the architectures skill (fan-out, verifier pipeline, team mesh).' }
    case 'single':
      return { label: 'Direct Delegation (1 → 1)', desc: 'Master delegates a focused task to a single worker agent.' }
    case 'fan-out':
      return { label: `Fan-Out / Map-Reduce (1 → ${n})`, desc: 'Master dispatches parallel workers and synthesizes their independent results.' }
    case 'orchestrator-workers-verifier':
      return { label: 'Orchestrator → Workers → Verifier', desc: 'Workers implement in parallel; a Verifier checks the output and feeds back to Master.' }
    case 'hierarchical':
      return { label: 'Hierarchical Tree (Multi-Tier)', desc: 'Master delegates to domain leads, which spawn and coordinate specialist subagents.' }
    case 'team-mesh':
      return { label: 'Agent Team (Peer-to-Peer Mesh)', desc: 'Teammates communicate directly across horizontal channels via SendMessage.' }
    case 'evaluator-optimizer':
      return { label: 'Evaluator ⇄ Optimizer Loop', desc: 'Generator and Critic exchange iterative feedback until acceptance criteria pass.' }
    case 'hybrid-cli':
      return { label: 'Hybrid Multi-CLI Topology', desc: 'Master coordinates tasks across native Claude agents, Codex sandboxes, and Antigravity.' }
  }
}

export const buildFlowGraph = (s: BusState, now: number, pack: Pack = BUILTIN, showAll = true): FlowGraph => {
  const allAgents = Object.values(s.agents).sort((x, y) => x.startedAt - y.startedAt)
  const visible = showAll
    ? allAgents
    : allAgents.filter(a => a.status === 'running' || (a.endedAt !== undefined && now - a.endedAt < 120000))
  const list = visible.length > 0 ? visible : allAgents.slice(-8)

  // 1. Assign initial roles
  const roles = new Map<string, NodeRole>()
  for (const a of list) roles.set(a.id, inferNodeRole(a, list))

  // Check if any agent is targeted by another agent's `next` declaration
  const targetedByWorker = new Set<string>()
  for (const a of list) {
    for (const nxt of a.next ?? []) {
      const targetId = resolveNodeId(s, nxt)
      if (targetId && targetId !== a.id) targetedByWorker.add(targetId)
    }
  }

  // 2. Compute raw tiers
  const rawTier = new Map<string, number>()
  rawTier.set('', 0)
  for (const a of list) {
    const r = roles.get(a.id) ?? 'worker'
    const parent = a.parentId && s.agents[a.parentId] ? a.parentId : ''
    if (r === 'lead') {
      rawTier.set(a.id, 1)
    } else if (parent !== '') {
      rawTier.set(a.id, (rawTier.get(parent) ?? 1) + 1)
    } else {
      rawTier.set(a.id, 1)
    }
  }

  // Push verifiers, critics, and downstream pipeline targets one tier after workers
  const workerTiers = list
    .filter(a => {
      const r = roles.get(a.id)
      return r !== 'verifier' && r !== 'critic' && !targetedByWorker.has(a.id)
    })
    .map(a => rawTier.get(a.id) ?? 1)
  const maxWorkerTier = workerTiers.length > 0 ? Math.max(...workerTiers) : 0

  for (const a of list) {
    const r = roles.get(a.id)
    if ((r === 'verifier' || r === 'critic' || targetedByWorker.has(a.id)) && maxWorkerTier >= 1) {
      rawTier.set(a.id, maxWorkerTier + 1)
    }
  }

  // Normalize tier indices to 0..K with no gaps
  const distinctTiers = [...new Set([0, ...list.map(a => rawTier.get(a.id) ?? 1)])].sort((a, b) => a - b)
  const normTier = (t: number): number => Math.max(0, distinctTiers.indexOf(t))

  // 3. Aggregate messages per directed pair (from -> to)
  const pairMsgs = new Map<string, BusMsg[]>()
  for (const m of s.msgs) {
    if (!m.accepted) continue
    const fromId = m.from ? resolveNodeId(s, m.from) : ''
    const toId = resolveNodeId(s, m.to)
    const key = `${fromId}->${toId}`
    const arr = pairMsgs.get(key) ?? []
    arr.push(m)
    pairMsgs.set(key, arr)
  }

  const countInFlight = (msgs: readonly BusMsg[]) =>
    msgs.filter(m => m.receivedAt === undefined && m.ackedAt === undefined).length

  // 4. Build FlowNodes
  const mSt = masterSt(s)
  const mOutMsgs = s.msgs.filter(m => m.accepted && !m.from)
  const mInMsgs = s.msgs.filter(m => m.accepted && m.to === '')
  const masterNode: FlowNode = {
    id: '',
    name: 'master',
    role: 'orchestrator',
    roleBadge: ROLE_META.orchestrator.badge,
    roleColor: ROLE_META.orchestrator.color,
    tier: 0,
    st: mSt,
    color: C.master,
    costume: pack.master && pack.costumes[pack.master] ? pack.master : 'master',
    parentId: '',
    tool: s.session?.lastTool ? clean(s.session.lastTool) : 'orchestrating',
    progTxt: `${list.filter(a => a.status === 'done').length}/${list.length}`,
    bar: bar(list.filter(a => a.status === 'done').length, Math.max(1, list.length), 6),
    inFlightIn: countInFlight(mInMsgs),
    inFlightOut: countInFlight(mOutMsgs),
    msgCountIn: mInMsgs.length,
    msgCountOut: mOutMsgs.length,
    agoTxt: 'now',
  }

  const agentNodes: FlowNode[] = list.map(a => {
    const role = roles.get(a.id) ?? 'worker'
    const meta = ROLE_META[role]
    const tier = normTier(rawTier.get(a.id) ?? 1)
    const st = uiStatus(s, a)
    const inMsgs = s.msgs.filter(m => m.accepted && resolveNodeId(s, m.to) === a.id)
    const outMsgs = s.msgs.filter(m => m.accepted && m.from && resolveNodeId(s, m.from) === a.id)
    return {
      id: a.id,
      name: clean(shownName(a)),
      role,
      roleBadge: a.ext ? (a.ext.cli === 'codex' ? 'CODEX' : a.ext.cli === 'agy' ? 'ANTIGRAVITY' : 'CLAUDE EXT') : meta.badge,
      roleColor: meta.color,
      tier,
      st,
      color: costumeColor(pack, a.costume),
      costume: a.costume,
      ...(a.ext ? { cli: a.ext.cli } : {}),
      ...(a.isTeammate ? { isTeammate: true } : {}),
      parentId: a.parentId && s.agents[a.parentId] ? a.parentId : '',
      tool: a.current ? clean(a.current) : a.lastTool ? clean(a.lastTool) : a.status === 'done' ? 'done' : 'ready',
      progTxt: a.plan.length > 0 ? `${a.done}/${a.plan.length}` : `${a.toolCount}t`,
      bar: a.plan.length > 0 ? bar(a.done, a.plan.length, 6) : '',
      inFlightIn: countInFlight(inMsgs),
      inFlightOut: countInFlight(outMsgs),
      msgCountIn: inMsgs.length,
      msgCountOut: outMsgs.length,
      agoTxt: ago(now - a.lastEventAt),
    }
  })

  const nodes: FlowNode[] = [masterNode, ...agentNodes]
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  // 5. Build Edges (spawn + pipeline + messages)
  const edgeMap = new Map<string, FlowEdge>()
  const upsertEdge = (from: string, to: string, kind: FlowEdge['kind']) => {
    if (from === to) return
    const key = `${from}->${to}`
    const msgs = pairMsgs.get(key) ?? []
    const last = msgs.at(-1)
    const inFlight = countInFlight(msgs) > 0
    const unapplied = msgs.some(m => m.appliedAt === undefined)
    const fromNode = nodeById.get(from)
    const toNode = nodeById.get(to)
    const existing = edgeMap.get(key)
    const resolvedKind: FlowEdge['kind'] =
      fromNode && toNode && fromNode.tier > toNode.tier
        ? 'feedback'
        : fromNode && toNode && fromNode.tier === toNode.tier && from !== ''
          ? 'peer'
          : msgs.length > 0 && kind === 'spawn'
            ? 'message'
            : existing?.kind === 'pipeline' || existing?.kind === 'feedback'
              ? existing.kind
              : kind
    const color = inFlight
      ? C.yellow
      : resolvedKind === 'feedback'
        ? C.mint
        : resolvedKind === 'peer'
          ? C.peach
          : msgs.length > 0
            ? C.cyan
            : C.dim
    edgeMap.set(key, {
      id: key,
      from,
      to,
      fromName: fromNode?.name ?? nodeNameOf(s, from),
      toName: toNode?.name ?? nodeNameOf(s, to),
      kind: resolvedKind,
      msgCount: msgs.length,
      inFlight,
      unapplied,
      ...(last ? { lastText: clean(last.text), lastAt: last.sentAt, agoTxt: ago(now - last.sentAt) } : {}),
      color,
    })
  }

  // Spawn edges
  for (const n of agentNodes) {
    // If a node is in tier >= 2 and has no explicit parent subagent (e.g. a Verifier), its upstream is the worker tier, not raw spawn
    if (n.tier >= 2 && n.parentId === '') continue
    upsertEdge(n.parentId, n.id, 'spawn')
  }

  // Declared `next` pipeline edges
  for (const a of list) {
    for (const nxt of a.next ?? []) {
      const targetId = resolveNodeId(s, nxt)
      if (nodeById.has(targetId)) upsertEdge(a.id, targetId, 'pipeline')
    }
  }

  // Automatic Worker -> Verifier -> Master pipeline wiring when a verifier tier is present
  const verifiers = agentNodes.filter(n => n.role === 'verifier' || n.role === 'critic' || n.tier >= 2)
  for (const v of verifiers) {
    const upstreamWorkers = agentNodes.filter(w => w.tier === v.tier - 1 && w.id !== v.id)
    for (const w of upstreamWorkers) {
      upsertEdge(w.id, v.id, 'pipeline')
    }
    if (v.role === 'verifier' || v.role === 'critic') {
      upsertEdge(v.id, '', 'feedback')
    }
  }

  // Message edges (including peer-to-peer and feedback)
  for (const [key] of pairMsgs) {
    const [from, to] = key.split('->') as [string, string]
    upsertEdge(from, to, from !== '' && to !== '' ? 'peer' : 'message')
  }

  const edges = [...edgeMap.values()]
  const channels = edges.filter(e => e.msgCount > 0 || e.kind === 'pipeline' || e.kind === 'peer' || e.kind === 'feedback')

  // 6. Group into Tiers
  const maxTier = Math.max(0, ...nodes.map(n => n.tier))
  const tiers: FlowTier[] = []
  for (let t = 0; t <= maxTier; t++) {
    const tNodes = nodes.filter(n => n.tier === t)
    if (tNodes.length === 0) continue
    const label =
      t === 0
        ? 'TIER 0 · ORCHESTRATOR'
        : tNodes.every(n => n.role === 'verifier' || n.role === 'critic')
          ? `TIER ${t} · VERIFIER & QA GATE`
          : tNodes.some(n => n.role === 'lead')
            ? `TIER ${t} · DOMAIN LEADS (${tNodes.length})`
            : `TIER ${t} · PARALLEL WORKERS (${tNodes.length})`
    tiers.push({ tier: t, label, nodes: tNodes })
  }

  // 7. Detect Pattern
  const hasSubParent = agentNodes.some(n => n.parentId !== '')
  const hasVerifier = agentNodes.some(n => n.role === 'verifier')
  const hasCritic = agentNodes.some(n => n.role === 'critic')
  const hasPeerMsgs = edges.some(e => e.kind === 'peer' && e.msgCount > 0)
  const hasTeammates = agentNodes.some(n => n.isTeammate)
  const cliSet = new Set(agentNodes.map(n => n.cli ?? 'native'))
  let pattern: ArchPattern = 'idle'
  if (agentNodes.length === 0) pattern = 'idle'
  else if (hasVerifier && agentNodes.length >= 2) pattern = 'orchestrator-workers-verifier'
  else if (hasSubParent) pattern = 'hierarchical'
  else if (hasCritic) pattern = 'evaluator-optimizer'
  else if (hasPeerMsgs || hasTeammates) pattern = 'team-mesh'
  else if (cliSet.size > 1 || (agentNodes.some(n => n.cli) && agentNodes.length >= 2)) pattern = 'hybrid-cli'
  else if (agentNodes.length === 1) pattern = 'single'
  else pattern = 'fan-out'

  const meta = patternMeta(pattern, agentNodes.length)
  const flyingCount = s.msgs.filter(m => m.accepted && m.receivedAt === undefined && m.ackedAt === undefined).length
  const unappliedCount = s.msgs.filter(m => m.accepted && m.appliedAt === undefined).length - flyingCount
  const feedbackEdge = edges.find(e => e.kind === 'feedback')

  return {
    pattern,
    patternLabel: meta.label,
    patternDesc: meta.desc,
    nodes,
    tiers,
    edges,
    channels,
    flyingCount,
    unappliedCount: Math.max(0, unappliedCount),
    totalMsgs: s.msgs.filter(m => m.accepted).length,
    hasFeedbackLoop: Boolean(feedbackEdge),
    ...(feedbackEdge
      ? {
          feedbackText: feedbackEdge.lastText
            ? `↺ ${feedbackEdge.fromName} ──✉ "${fit(feedbackEdge.lastText, 28)}"──► ${feedbackEdge.toName}`
            : `↺ ${feedbackEdge.fromName} ──feedback loop──► ${feedbackEdge.toName}`,
        }
      : {}),
  }
}

/**
 * Builds the Unicode connector lines between Tier `fromTier` (with `fromCount` nodes)
 * and Tier `toTier` (with `toCount` nodes) for Top-Down (`td`) view.
 */
export const tierConnectors = (
  g: FlowGraph,
  fromTier: FlowTier,
  toTier: FlowTier,
  width: number,
): { lines: string[]; activeMsg?: string; color: number } => {
  const w = Math.max(20, Math.min(80, width - 4))
  const mid = Math.max(2, Math.floor(w / 2))
  const fromIds = new Set(fromTier.nodes.map(n => n.id))
  const toIds = new Set(toTier.nodes.map(n => n.id))
  const tierEdges = g.edges.filter(e => fromIds.has(e.from) && toIds.has(e.to))
  const inFlight = tierEdges.find(e => e.inFlight)
  const withMsg = tierEdges.find(e => e.lastText)
  const color = inFlight ? C.yellow : withMsg ? C.cyan : C.dim
  const activeMsg = inFlight
    ? `✉ in transit: ${inFlight.fromName} → ${inFlight.toName}${inFlight.lastText ? ` "${fit(inFlight.lastText, 24)}"` : ''}`
    : withMsg && withMsg.msgCount > 0
      ? `✉ ${withMsg.fromName} → ${withMsg.toName} (×${withMsg.msgCount})`
      : undefined

  const fN = fromTier.nodes.length
  const tN = toTier.nodes.length
  const span = Math.max(8, Math.min(w - 4, Math.max(fN, tN) * 14))
  const half = Math.floor(span / 2)

  if (fN === 1 && tN === 1) {
    const pad = ' '.repeat(mid)
    return { lines: [`${pad}│`, `${pad}▼`], ...(activeMsg ? { activeMsg } : {}), color }
  }
  if (fN === 1 && tN > 1) {
    // Fan-out: 1 -> N
    const left = Math.max(2, mid - half)
    const barW = Math.max(4, span)
    const step = Math.max(2, Math.floor(barW / Math.max(1, tN - 1)))
    let top = ''
    let arrows = ''
    for (let i = 0; i <= barW; i++) {
      const isTap = i === 0 || i === barW || (tN > 2 && i % step === 0 && i < barW)
      if (i === Math.floor(barW / 2)) top += isTap ? '┼' : '┴'
      else if (i === 0) top += '┌'
      else if (i === barW) top += '┐'
      else top += isTap ? '┬' : '─'
      arrows += isTap ? '▼' : ' '
    }
    return {
      lines: [`${' '.repeat(mid)}│`, `${' '.repeat(left)}${top}`, `${' '.repeat(left)}${arrows}`],
      ...(activeMsg ? { activeMsg } : {}),
      color,
    }
  }
  if (fN > 1 && tN === 1) {
    // Fan-in / Verifier gate: N -> 1
    const left = Math.max(2, mid - half)
    const barW = Math.max(4, span)
    const step = Math.max(2, Math.floor(barW / Math.max(1, fN - 1)))
    let bot = ''
    for (let i = 0; i <= barW; i++) {
      const isTap = i === 0 || i === barW || (fN > 2 && i % step === 0 && i < barW)
      if (i === Math.floor(barW / 2)) bot += isTap ? '┼' : '┬'
      else if (i === 0) bot += '└'
      else if (i === barW) bot += '┘'
      else bot += isTap ? '┴' : '─'
    }
    return {
      lines: [`${' '.repeat(left)}${bot}`, `${' '.repeat(mid)}▼`],
      ...(activeMsg ? { activeMsg } : {}),
      color,
    }
  }
  // N -> M
  const left = Math.max(2, mid - half)
  const barW = Math.max(4, span)
  return {
    lines: [`${' '.repeat(left)}├─${'─'.repeat(Math.max(1, barW - 2))}─┤`, `${' '.repeat(mid)}▼`],
    ...(activeMsg ? { activeMsg } : {}),
    color,
  }
}
