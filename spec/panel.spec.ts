import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CARD_H, CARD_W, get } from '../src/art.ts'
import { emptyState, onComplete, onMeasure, onPermissionAnswer, onPermissionAsk, onSpawn, onStep, onToolEnd, onToolStart, onUsage, statusReport, uiStatus, type AgentRec, type BusState } from '../src/model.ts'
import { agentView, detailModel, filterTab, listModel, transcriptLines } from '../src/panel.ts'
import { costOf, windowOf } from '../src/price.ts'
import { agentCard, miniCard } from '../src/scene.ts'
import { C, prog, spark } from '../src/theme.ts'

const ag = (s: BusState, id: string) => s.agents[id] as AgentRec
const U = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite })

test('price: list prices and context windows by model id', () => {
  assert.equal(costOf(U(1_000_000, 0), 'claude-opus-5-5'), 4)
  assert.equal(costOf(U(0, 1_000_000), 'claude-sonnet-5-5'), 10)
  assert.equal(Math.round(costOf(U(0, 0, 1_000_000), 'claude-fable-5-1') * 100) / 100, 0.25)
  assert.equal(costOf(U(1_000_000, 0), 'claude-haiku-4-5'), 1)
  assert.equal(windowOf('claude-haiku-4-5'), 200_000)
  assert.equal(windowOf('claude-opus-5-5'), 1_000_000)
  assert.equal(windowOf('claude-sonnet-4-5[1m]'), 1_000_000)
})

test('usage: per-request usage counts once, the turn sum is only a fallback', () => {
  let s = onSpawn(emptyState(), { id: 'a', type: 'x', description: 'a', model: 'claude-sonnet-5-5' }, 0)
  s = onUsage(s, 'a', U(100, 50, 900, 0), 'claude-sonnet-5-5', 1)
  s = onUsage(s, 'a', U(10, 20, 1000, 0), 'claude-sonnet-5-5', 2)
  assert.equal(ag(s, 'a').tokensIn, 2010)
  assert.equal(ag(s, 'a').tokensOut, 70)
  assert.equal(ag(s, 'a').lastPrompt, 1010)
  assert.deepEqual(ag(s, 'a').usageHist, [50, 20])
  s = onComplete(s, 'a', { reason: 'answer', tokensIn: 2010, tokensOut: 70 }, 3)
  assert.equal(ag(s, 'a').tokensIn, 2010, 'turn.complete must not add the same tokens again')
  // an agent with no per-request usage still gets the turn's sum
  let t = onSpawn(emptyState(), { id: 'b', type: 'x', description: 'b' }, 0)
  t = onComplete(t, 'b', { reason: 'answer', tokensIn: 7, tokensOut: 3 }, 1)
  assert.equal(ag(t, 'b').tokensIn, 7)
  // the main loop's usage goes to the session
  const m = onUsage(emptyState(), undefined, U(5, 6), 'claude-opus-5-5', 1)
  assert.equal(m.session?.usage?.output, 6)
})

test('uiStatus: working, thinking, waiting, blocked, done, failed come from recorded facts', () => {
  let s = onSpawn(emptyState(), { id: 'a', type: 'x', description: 'a' }, 0)
  assert.equal(uiStatus(s, ag(s, 'a')), 'thinking')
  s = onToolStart(s, 'a', 'Read', { file_path: 'f' }, 10)
  assert.equal(uiStatus(s, ag(s, 'a')), 'working')
  s = onToolEnd(s, 'a', 'Read', { file_path: 'f' }, false, 20)
  s = onStep(s, 'a', { question: 'which db?' }, 30)
  assert.equal(uiStatus(s, ag(s, 'a')), 'waiting')
  s = onToolStart(s, 'a', 'Grep', { pattern: 'x' }, 40)
  assert.equal(uiStatus(s, ag(s, 'a')), 'working', 'running a tool after asking is no longer waiting')
  s = onPermissionAsk(s, { id: 'p', agentId: 'a', tool: 'Bash', arg: 'rm -rf x', at: 50 })
  assert.equal(uiStatus(s, ag(s, 'a')), 'blocked')
  assert.match(statusReport(s, 60), /PERMISSION waiting/)
  s = onPermissionAnswer(s, 'p', 'allow', 60)
  assert.equal(uiStatus(s, ag(s, 'a')), 'working')
  assert.equal(s.activity?.[0]?.text, 'approved Bash rm -rf x')
  s = onComplete(s, 'a', { reason: 'answer' }, 70)
  assert.equal(uiStatus(s, ag(s, 'a')), 'done')
  const f = onComplete(onSpawn(emptyState(), { id: 'b', type: 'x', description: 'b' }, 0), 'b', { reason: 'error' }, 1)
  assert.equal(uiStatus(f, ag(f, 'b')), 'failed')
})

test('tool log: each run closes with its outcome and duration', () => {
  let s = onSpawn(emptyState(), { id: 'a', type: 'x', description: 'a' }, 0)
  s = onToolStart(s, 'a', 'Bash', { command: 'npm test' }, 1000)
  s = onToolEnd(s, 'a', 'Bash', { command: 'npm test' }, true, 3500)
  assert.deepEqual(ag(s, 'a').toolLog, [{ tool: 'Bash', arg: 'npm test', at: 1000, ok: false, ms: 2500 }])
})

test('list model: declared stages are a count, never a percentage of the work; the ledger total is real', () => {
  let s = onSpawn(emptyState(), { id: 'a', type: 'x', description: 'alpha', model: 'claude-sonnet-5-5' }, 0)
  s = onSpawn(s, { id: 'b', type: 'x', description: 'beta' }, 0)
  s = onStep(s, 'a', { plan: ['1', '2', '3', '4', '5'], done: 4 }, 10)
  s = onUsage(s, 'a', U(1_000_000, 0), 'claude-sonnet-5-5', 11)
  s = onComplete(s, 'b', { reason: 'answer' }, 12)
  let m = listModel(s, 20, { filter: 'all', showAll: false })
  assert.equal(m.metrics.stagesTxt, '4/5')
  assert.doesNotMatch(m.metrics.summary, /80 ?%/)
  assert.match(m.metrics.costTxt, /^≈/, 'without the ledger the total is an estimate')
  s = onMeasure(s, { costUsd: 5 })
  m = listModel(s, 20, { filter: 'all', showAll: false })
  assert.equal(m.metrics.costTxt, '$5.00')
  assert.equal(m.master.costTxt, '$3.00', 'the master is the real total less the subagents\' estimates')
  assert.deepEqual(m.filters.map(f => [f.id, f.n]), [['all', 2], ['active', 1], ['attention', 0], ['done', 1]])
  assert.equal(listModel(s, 20, { filter: 'done', showAll: false }).cards[0]?.id, 'b')
  assert.equal(agentView(s, ag(s, 'a'), 1, 20).costTxt, '≈$2.00')
})

test('detail model: context cells, cost parts and tool history', () => {
  let s = onSpawn(emptyState(), { id: 'a', type: 'x', description: 'a', model: 'claude-haiku-4-5' }, 0)
  s = onUsage(s, 'a', U(0, 1000, 100_000, 0), 'claude-haiku-4-5', 1000)
  s = onToolStart(s, 'a', 'Read', { file_path: '/x' }, 1000)
  s = onToolEnd(s, 'a', 'Read', { file_path: '/x' }, false, 1500)
  const d = detailModel(s, ag(s, 'a'), [ag(s, 'a')], 2000)
  assert.equal(d.v.ctxPct, 50)
  assert.equal(d.ctx.cells.filter(c => c !== C.line && c !== 0x4a2a38).length, 10)
  assert.equal(d.tools.history[0]?.n, 'Read')
  assert.equal(d.cost.parts.length, 4)
  assert.equal(d.pos, '1/1')
})

test('transcript: the api messages become the design\'s lines, tool results attached to their call', () => {
  const msgs = [
    { role: 'user', content: 'Map the routing in src/bus.' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'grep first' }, { type: 'text', text: 'I will map it.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm vitest run' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: ' ✓ router.test.ts\n ✗ fanout.test.ts' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'a.ts', old_string: 'x()', new_string: 'if (y) x()' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Updated a.ts' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'mcp__crabbus__bus_step', input: { done: 1, question: 'db?' } }, { type: 'tool_use', id: 't4', name: 'Read', input: { file_path: 'b.ts' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't9', content: 'ok<system-reminder>engine text</system-reminder>' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't5', name: 'SubagentHandback', input: { report: 'All 21 tests pass.' } }] },
  ]
  const l = transcriptLines(msgs, 'lector', 50)
  assert.deepEqual(l.map(x => x.k), ['user', 'think', 'msg', 'tool', 'tool', 'tool', 'tool', 'msg'])
  assert.equal(l[5]?.text, 'done 1 · question: db?')
  assert.equal(l[7]?.text, 'All 21 tests pass.')
  assert.equal(l[0]?.head, 'master → lector  ')
  assert.equal(l[3]?.arg, '(pnpm vitest run)')
  assert.deepEqual(l[3]?.body.map(b => b.c), [C.mint, C.pink])
  assert.deepEqual(l[4]?.body.map(b => b.t), ['Updated a.ts', '- x()', '+ if (y) x()'])
  assert.equal(l[6]?.body[0]?.t, 'running…', 'a call with no result yet is still running')
  assert.equal(filterTab(l, 'tools').length, 4)
  assert.equal(filterTab(l, 'reasoning').length, 1)
})

test('sprites: state marks per state, done is dimmed, half size keeps the costume', () => {
  let s = onSpawn(emptyState(), { id: 'a', type: 'x', description: 'a' }, 0)
  s = { ...s, agents: { a: { ...ag(s, 'a'), costume: 'careful' } } }
  const thinking = agentCard(s, ag(s, 'a'), 0, 0)
  assert.equal(get(thinking, CARD_W - 1, 0), C.lav)
  const blocked = onStep(s, 'a', { blocker: 'stuck' }, 1)
  assert.equal(get(agentCard(blocked, ag(blocked, 'a'), 1, 0), CARD_W - 1, 0), C.pink)
  const done = onComplete(s, 'a', { reason: 'answer' }, 1)
  const before = agentCard(onToolStart(s, 'a', 'Read', {}, 1), ag(onToolStart(s, 'a', 'Read', {}, 1), 'a'), 1, 0)
  const after = agentCard(done, ag(done, 'a'), 1, 0)
  const lum = (v: number) => ((v >> 16) & 255) + ((v >> 8) & 255) + (v & 255)
  const sum = (c: typeof before) => [...c.px].filter(v => v >= 0).reduce((x, v) => x + lum(v), 0)
  assert.ok(sum(after) < sum(before), 'a finished crab is dimmer')
  const mini = miniCard(s, ag(s, 'a'), 0, 1)
  assert.equal(mini.width, CARD_W / 2)
  assert.equal(mini.height, CARD_H / 2)
  // the hard hat's yellow survives the halving
  const colors = new Set([...mini.px].filter(v => v >= 0))
  const full = new Set([...agentCard(s, ag(s, 'a'), 0, 1).px].filter(v => v >= 0))
  assert.ok([...colors].every(c => full.has(c) || c === C.lav))
  assert.ok(colors.size >= 4, 'body, eyes and the costume all show at half size')
})

test('theme helpers', () => {
  assert.equal(prog(2, 4), '▰▰▱▱')
  assert.equal(spark([0, 3, 7]), '▁▄█'); assert.equal(spark([0, 7]), '')
})
