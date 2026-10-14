import { test, expect, mock } from 'claude-code/testing'
import type { On, ToolCallInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const cfg = (extra: Record<string, unknown> = {}) => ({ externalAgents: JSON.stringify({ agents: { coder: { cli: 'codex' }, safe: { cli: 'agy' }, forbidden: { cli: 'agy', level: 'auto' } }, ...extra }), openOnStart: false })
const start = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }
const call = ($: Engine, args: Record<string, unknown>) => $.tool.call({ tool: 'mcp__crabbus__bus_delegate', tool_use_id: 'delegate', ...args } as ToolCallInput)
const status = async ($: Engine) => String((await $.tool.call({ tool: 'mcp__crabbus__bus_status', tool_use_id: 'status' })).result)
const result = (r: unknown) => String((r as { result?: unknown }).result)

function host(on: On, controls: { silent?: boolean; noGit?: boolean; failNotice?: boolean; hold?: boolean } = {}) {
  const clock = mock.clock(on)
  const prompts: string[] = [], commands: string[][] = [], launches: string[][] = [], waiting: (() => void)[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__crabbus__${e.name}` } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/user' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => { if (controls.failNotice) { controls.failNotice = false; return { drop: 'retry delivery' } }; prompts.push(e.text); return { text: e.text } })
  on('process.run', ($, e) => {
    commands.push([...e.argv])
    const cmd = e.argv.join(' ')
    return { value: { exitCode: controls.noGit && cmd.includes('--show-toplevel') ? 1 : 0, stdout: cmd.includes('--version') ? '1.0' : cmd.includes('--show-toplevel') ? '/repo\n' : cmd.includes('--porcelain') ? ' M pending.ts\0' : cmd.includes('--stat') ? ' changed.ts | 1 +\n' : cmd.includes('ls-files') ? 'new.ts\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* ($, e, next) {
    launches.push([...e.argv])
    yield { stream: 'stdout' as const, text: '{"type":"thread.started","thread_id":"session-one"}\n' }
    if (controls.hold) await new Promise<void>((resolve, reject) => { waiting.push(resolve); next.signal.addEventListener('abort', () => reject(Error('probe aborted')), { once: true }) })
    if (controls.silent) { await new Promise<void>((resolve, reject) => next.signal.addEventListener('abort', () => reject(Error('probe aborted')), { once: true })); return { value: { code: 0, signal: null } } }
    yield { stream: 'stdout' as const, text: '{"type":"item.started","item":{"id":"cmd","type":"command_execution","command":"npm test"}}\n' }
    yield { stream: 'stdout' as const, text: '{"type":"item.completed","item":{"id":"cmd","type":"command_execution","command":"npm test","exit_code":0}}\n' }
    yield { stream: 'stdout' as const, text: '{"type":"item.completed","item":{"id":"msg","type":"agent_message","text":"done"}}\n{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":25,"output_tokens":10}}\n' }
    return { value: { code: 0, signal: null } }
  })
  return { clock, prompts, commands, launches, waiting }
}

async function completed($: Engine, n: number) {
  for (let i = 0; i < 40; i++) {
    const s = await status($)
    if ((s.match(/— done/g) ?? []).length === n) return s
  }
  throw Error(await status($))
}

test('external runner: master-only, agy auto rejection, isolated edit and host diff/untracked notification', { options: cfg() }, async ($, on) => {
  const h = host(on)
  await $.session.start(start)
  expect(result(await call($, { agentId: 'sub', agent: 'coder', prompt: 'edit', description: 'task' }))).toMatch(/for the master/)
  expect(result(await call($, { agent: 'forbidden', prompt: 'edit', description: 'task' }))).toMatch(/agy auto is not supported yet/)
  const r = result(await call($, { agent: 'coder', prompt: 'edit', description: 'task' }))
  expect(r).toMatch(/started; the worktree starts from HEAD; 1 uncommitted files are not in it/)
  await completed($, 1)
  await h.clock.advance(1)
  expect(h.commands.some(c => c.includes('worktree') && c.includes('add') && c.some(a => a.startsWith('crabbus/codex-ext-')))).toBe(true)
  expect(h.commands.some(c => c.includes('--stat'))).toBe(true)
  expect(h.prompts.length).toBe(1)
  expect(h.prompts[0]).toContain('new.ts')
  expect(h.prompts[0]).toContain('changed.ts')
  expect(h.launches.length).toBe(1)
})

test('external runner: results batch while master is busy; continuation reuses the session', { options: cfg() }, async ($, on) => {
  const h = host(on)
  await $.session.start(start)
  await $.turn.start({ turnId: 'main', text: 'delegate' })
  const first = result(await call($, { agent: 'coder', prompt: 'one', description: 'first', mode: 'read' })).split(' ')[0]!
  await call($, { agent: 'coder', prompt: 'two', description: 'second', mode: 'read' })
  await completed($, 2)
  await h.clock.advance(1)
  expect(h.prompts.length).toBe(0)
  await $.turn.complete({ answer: 'master done', durationMs: 1, isAborted: false, reason: 'answer', turnId: 'main' })
  await h.clock.advance(1)
  expect(h.prompts.length).toBe(1)
  expect((h.prompts[0]!.match(/"status":"done"/g) ?? []).length).toBe(2)
  await call($, { agent: 'coder', to: first, prompt: 'continue' })
  await completed($, 2)
  expect(h.launches.at(-1)?.includes('resume')).toBe(true)
  expect(h.launches.at(-1)?.includes('session-one')).toBe(true)
})

test('external runner: concurrency reserves preparation slots and rejects before creating another worktree', { options: cfg({ maxConcurrent: 1 }) }, async ($, on) => {
  const h = host(on, { silent: true })
  await $.session.start(start)
  await call($, { agent: 'coder', prompt: 'one', description: 'first', mode: 'read' })
  expect(result(await call($, { agent: 'coder', prompt: 'two', description: 'second', mode: 'read' }))).toMatch(/maxConcurrent/)
  expect(h.commands.filter(c => c.includes('worktree')).length).toBe(0)
})

test('external runner: a time limit cancels a silent child and produces one notification', { options: cfg({ maxMinutes: 0.001 }) }, async ($, on) => {
  const h = host(on, { silent: true })
  await $.session.start(start)
  await call($, { agent: 'coder', prompt: 'one', description: 'first', mode: 'read' })
  await h.clock.advance(61)
  for (let i = 0; i < 20 && !(await status($)).includes('— killed'); i++) await h.clock.advance(1)
  expect(await status($)).toContain('— killed')
  await h.clock.advance(1)
  expect(h.prompts.length).toBe(1)
  expect(h.prompts[0]).toContain('Time limit')
})


test('external runner: no Git rejects edits before spawning; read mode remains available', { options: cfg() }, async ($, on) => {
  const h = host(on, { noGit: true })
  await $.session.start(start)
  expect(result(await call($, { agent: 'coder', prompt: 'edit', description: 'task' }))).toMatch(/git/)
  expect(h.launches.length).toBe(0)
  await call($, { agent: 'coder', prompt: 'read', description: 'task', mode: 'read' })
  await completed($, 1)
  expect(h.launches.length).toBe(1)
})

test('external runner: rejected prompt delivery retains results for one retry', { options: cfg() }, async ($, on) => {
  const h = host(on, { failNotice: true })
  await $.session.start(start)
  await call($, { agent: 'coder', prompt: 'read', description: 'task', mode: 'read' })
  await completed($, 1)
  await h.clock.advance(1)
  expect(h.prompts.length).toBe(0)
  await h.clock.advance(1001)
  expect(h.prompts.length).toBe(1)
})

test('external runner: messages wait FIFO and do not launch overlapping CLI processes', { options: cfg() }, async ($, on) => {
  const h = host(on, { hold: true })
  await $.session.start(start)
  const id = result(await call($, { agent: 'coder', prompt: 'first', description: 'task', mode: 'read' })).split(' ')[0]!
  await call($, { agent: 'coder', to: id, prompt: 'second' })
  await call($, { agent: 'coder', to: id, prompt: 'third' })
  expect(h.launches.length).toBe(1)
  expect((await status($)).match(/not yet delivered/g)?.length).toBe(2)
  for (let turn = 0; turn < 3; turn++) {
    for (let i = 0; i < 30 && !h.waiting.length; i++) await status($)
    h.waiting.shift()!()
    for (let i = 0; i < 30 && h.launches.length < Math.min(3, turn + 2); i++) await status($)
  }
  await completed($, 1)
  expect(h.launches.length).toBe(3)
  expect(h.launches[1]!.at(-1)).toContain('second')
  expect(h.launches[2]!.at(-1)).toContain('third')
  expect((await status($)).match(/delivered to its loop/g)?.length).toBe(2)
})

for (const surface of ['terminal', 'desktop'] as const) test(`external ${surface}: detail messages queue and Stop cancels the child and its queue`, { options: cfg() }, async ($, on) => {
  const h = host(on, { silent: true })
  await $.session.start({ ...start, surface })
  const id = result(await call($, { agent: 'coder', prompt: 'first', description: 'task', mode: 'read' })).split(' ')[0]!
  const ui = await $.ui.mount({ plugin: 'crabbus', surface, component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  await ui.press({ key: `b-${id}` })
  expect(await ui.find({ type: 'Button', key: `kill-${id}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /subscription/ })).toBeDefined()
  await ui.input({ key: `msg-${id}`, text: 'queued message' })
  for (let i = 0; i < 20 && !(await status($)).includes('queued message'); i++) await status($)
  expect(h.launches.length).toBe(1)
  await ui.press({ key: `kill-${id}` })
  for (let i = 0; i < 20 && !(await status($)).includes('— killed'); i++) await status($)
  expect(await status($)).toContain('— killed')
  await h.clock.advance(1)
  expect(h.prompts.length).toBe(1)
  expect(h.prompts[0]).toContain('Killed from the panel')
  expect(h.launches.length).toBe(1)
  await ui.unmount()
})

test('native resume aliases the runtime loop ID to its original card', { options: cfg() }, async ($, on) => {
  host(on)
  let n = 0
  on('agent.spawn', () => ({ agentId: ++n === 1 ? 'stable' : n === 2 ? 'runtime-loop' : 'third-loop', model: 'model' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: 'a.ts', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } } as never }))
  await $.session.start(start)
  const original = { tool_use_id: 'spawn', prompt: 'task', description: 'native task', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'model', background: true, fork: false, permissionMode: 'default' as const }
  await $.agent.spawn(original)
  await $.agent.spawn({ ...original, resume: { agentId: 'stable' } } as typeof original)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', tool_use_id: 'read', agentId: 'runtime-loop' } as ToolCallInput)
  await $.agent.spawn({ ...original, resume: { agentId: 'runtime-loop' } } as typeof original)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', tool_use_id: 'read-again', agentId: 'third-loop' } as ToolCallInput)
  const s = await status($)
  expect(s).toContain('1 agent(s)')
  expect(s).toContain('[stable]')
  expect(s).not.toContain('(not seen at spawn)')
})
