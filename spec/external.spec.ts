import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { externalConfig, externalLabel, safeSession, CLAUDE_SANDBOX, externalTaskNote, externalUsageDelta, externalArgv, externalParser, externalLines, AGY_AUTO_ERROR, type ExternalCli, type ExtEvent } from '../src/external.ts'
import { emptyState, statusReport, onSpawn, onExternal, onResume, onUsage, onToolStart, onToolEnd } from '../src/model.ts'
import { agentView, listModel, detailModel } from '../src/panel.ts'

const fixture = (file: string) => readFileSync(new URL(`./fixtures/external/${file}.jsonl`, import.meta.url), 'utf8')
const events = (cli: ExternalCli, file: string): ExtEvent[] => {
  const parse = externalParser(cli)
  return fixture(file).split('\n').flatMap(parse)
}

test('external config validates limits, names, environment and rejects agy auto before launch', () => {
  assert.deepEqual(externalConfig(undefined).maxConcurrent, 3)
  for (const raw of ['{', '[]', '{"maxConcurrent":0}', '{"maxMinutes":0}', '{"agents":{"bad":{"cli":"unknown"}}}', '{"agents":{"a":{"cli":"codex","env":{"x":3}}}}']) assert.throws(() => externalConfig(raw))
  const cfg = externalConfig('{"agents":{"a":{"cli":"agy","level":"auto"}}}')
  assert.throws(() => externalArgv(cfg.agents.a!, 'task', '/repo', 'edit'), { message: AGY_AUTO_ERROR })
})

test('external args preserve sandbox, mode, profile-specific allowances and continuation', () => {
  const c = externalArgv({ cli: 'codex' }, '$(literal prompt)', '/repo', 'edit', 'session')
  assert.ok(c.includes('sandbox_workspace_write.exclude_tmpdir_env_var=false'))
  assert.ok(c.includes('sandbox_workspace_write.exclude_slash_tmp=true'))
  assert.deepEqual(c.slice(-3), ['resume', 'session', '$(literal prompt)'])
  assert.ok(externalArgv({ cli: 'codex' }, 'task', '/repo', 'read').includes('read-only'))
  const a = externalArgv({ cli: 'agy' }, 'task', '/repo', 'edit', 'latest')
  assert.ok(a.includes('accept-edits')); assert.ok(!a.includes('--dangerously-skip-permissions')); assert.equal(a.at(-1), 'latest')
  const cl = externalArgv({ cli: 'claude', allow: ['Bash(npm test:*)'] }, 'task', '/repo', 'edit', 'session')
  assert.ok(cl.includes('Bash(npm test:*)')); assert.ok(cl.includes('--resume'))
})

test('external fixtures: tools, usage, sessions and agy safe denials retain real wire schemas', () => {
  for (const [cli, file] of [['codex', 'codex-user-tmpdir'], ['agy', 'agy-safe'], ['claude', 'claude-profile']] as const) {
    const out = events(cli, file)
    assert.ok(out.some(e => e.kind === 'session'), cli)
    assert.ok(out.some(e => e.kind === 'tool'), cli)
    assert.equal(out.filter(e => e.kind === 'usage').length, 1, cli)
    assert.ok(out.some(e => e.kind === 'done'), cli)
  }
  assert.ok(events('agy', 'agy-safe').some(e => e.kind === 'denied' && e.tool === 'Bash'))
  assert.ok(events('codex', 'codex-user-tmpdir').some(e => e.kind === 'tool' && e.name === 'Bash'))
})

test('external lines reconstruct fragmented JSON, isolate buffers and drop oversized lines safely', () => {
  const out: string[] = [], errors: string[] = []
  const stdout = externalLines(s => out.push(s), 32), stderr = externalLines(s => errors.push(s))
  stdout.push('{"a":'); stderr.push('diagnostic\n'); stdout.push('1}\n{"b":2}'); stdout.end()
  stdout.push('x'.repeat(40)); stdout.push('tail\n{"ok":true}\n'); stdout.end(); stderr.end()
  assert.deepEqual(out, ['{"a":1}', '{"b":2}', '{"ok":true}'])
  assert.deepEqual(errors, ['diagnostic'])
})

test('external parsers ignore hook noise and malformed lines but preserve turn failure', () => {
  const parse = externalParser('codex')
  assert.deepEqual(parse('noise'), [])
  assert.deepEqual(parse('{"type":"item.completed","item":{"type":"error","message":"plugin hook noise"}}'), [])
  assert.equal(parse('{"type":"turn.failed","error":{"message":"failed"}}')[0]?.kind, 'done')
  const a = externalParser('agy')
  assert.deepEqual(a('{"event":"result","result":{"conversation_id":"new","status":"SUCCESS"}}')[0], { kind: 'session', id: 'new' })
})

test('external tokens never affect Claude cost; resume and tool IDs preserve attribution', () => {
  let s = onSpawn(emptyState(), { id: 'ext', type: 'codex', description: 'task' }, 1)
  s = onExternal(s, 'ext', { cli: 'codex', profile: 'codex' })
  s = onUsage(s, 'ext', { input: 100, output: 20, cacheRead: 50, cacheWrite: 0 }, 'unknown-model', 2)
  s = onToolStart(s, 'ext', 'Bash', { command: 'first' }, 3, 'one')
  s = onToolStart(s, 'ext', 'Bash', { command: 'second' }, 4, 'two')
  s = onToolEnd(s, 'ext', 'Bash', { command: 'first' }, false, 5, 'one')
  assert.equal(s.agents.ext!.toolLog![0]!.ok, true)
  assert.equal(s.agents.ext!.toolLog![1]!.ok, undefined)
  assert.equal(s.agents.ext!.inTool, true)
  const view = agentView(s, s.agents.ext!, 1, 6)
  assert.equal(view.costTxt, 'subscription'); assert.equal(view.ctxPct, undefined)
  assert.equal(s.agents.ext!.requests, undefined)
  assert.equal(s.agents.ext!.lastPrompt, undefined)
  assert.equal(detailModel(s, s.agents.ext!, [s.agents.ext!], 6).cost.parts.length, 0)
  assert.equal(listModel(s, 6, { filter: 'all', showAll: true }).master.cost, 0)
  const resumed = onResume(s, 'ext', 7, true)
  assert.equal(resumed.agents.ext!.tokensIn, 150)
  assert.equal(Object.keys(resumed.agents).length, 1)
})

test('external plans come only from explicit task events and completion is not counted twice', () => {
  const parse = externalParser('claude')
  parse(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'create', name: 'TaskCreate', input: { subject: 'Test the change' } }] } }))
  parse(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'create', content: 'Task #1 created successfully: Test the change' }] } }))
  const update = parse(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'update', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }] } }))
  assert.deepEqual(update.find(e => e.kind === 'plan'), { kind: 'plan', items: ['Test the change'], done: 1 })
  const c = externalParser('codex')
  assert.deepEqual(c('{"type":"item.completed","item":{"id":"m","type":"agent_message","text":"I finished 3 stages"}}').filter(e => e.kind === 'plan'), [])
  c('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":1}}')
  assert.deepEqual(c('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":1}}'), [])
})


test('external Codex resume adds only the measured cumulative-usage delta', () => {
  const snapshots = JSON.parse(readFileSync(new URL('./fixtures/external/codex-resume-usage.json', import.meta.url), 'utf8'))
  const frame = (raw: { input_tokens: number; cached_input_tokens: number; output_tokens: number }) => ({
    input: raw.input_tokens - raw.cached_input_tokens, cacheRead: raw.cached_input_tokens, output: raw.output_tokens, cacheWrite: 0,
  })
  const first = frame(snapshots.before), second = frame(snapshots.after)
  const delta = externalUsageDelta(second, first)
  assert.equal(delta.input + delta.cacheRead, 92523)
  assert.equal(first.input + first.cacheRead + delta.input + delta.cacheRead, 256646)
  assert.equal(first.output + delta.output, 757)
  assert.deepEqual(externalUsageDelta(first), first)
  assert.deepEqual(externalUsageDelta(first, second), first)
})


test('external Claude resume usage remains per invocation, unlike Codex snapshots', () => {
  const snapshots = JSON.parse(readFileSync(new URL('./fixtures/external/claude-resume-usage.json', import.meta.url), 'utf8'))
  const frames = [snapshots.before, snapshots.after].map(usage => externalParser('claude')(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'same-session', usage })))
  const first = frames[0]!.find(e => e.kind === 'usage'), next = frames[1]!.find(e => e.kind === 'usage')
  assert.ok(first?.kind === 'usage' && next?.kind === 'usage')
  assert.equal(first.scope, 'turn'); assert.equal(next.scope, 'turn')
  assert.equal(first.usage.output + next.usage.output, 975)
})

test('external labels read as products, with the profile when it says more, or as configured', () => {
  assert.equal(externalLabel('agy', { cli: 'agy' }), 'Antigravity')
  assert.equal(externalLabel('codex', { cli: 'codex' }), 'Codex')
  assert.equal(externalLabel('claude-r', { cli: 'claude' }), 'Claude · claude-r')
  assert.equal(externalLabel('safe', { cli: 'agy', label: 'Antigravity Flash' }), 'Antigravity Flash')
  assert.equal(externalConfig('{"agents":{"a":{"cli":"agy","label":" Fast "}}}').agents.a!.label, 'Fast')
  for (const label of ['""', '"' + 'x'.repeat(41) + '"']) assert.throws(() => externalConfig(`{"agents":{"a":{"cli":"agy","label":${label}}}}`))
})

test('Antigravity safe edits are told they have no terminal; other CLIs and read mode are not', () => {
  assert.match(externalTaskNote({ cli: 'agy' }, 'edit'), /no terminal/)
  assert.equal(externalTaskNote({ cli: 'agy' }, 'read'), '')
  assert.equal(externalTaskNote({ cli: 'codex' }, 'edit'), '')
})

test('bus_status finds an external agent by the start of its id', () => {
  let s = onSpawn(emptyState(), { id: 'ext-09dbdcaa-4786-4137', type: 'agy', description: 'document a constant' }, 1)
  s = onExternal(s, 'ext-09dbdcaa-4786-4137', { cli: 'agy', profile: 'agy', label: 'Antigravity' })
  const report = statusReport(s, 2, 'ext-09dbdcaa')
  assert.match(report, /Antigravity \(agy, profile agy\)/)
  assert.doesNotMatch(report, /No agent matches/)
  assert.match(statusReport(s, 2, 'ext'), /No agent matches/)
})

test('external config refuses flags and code-loading environment that a repository setting could inject', () => {
  for (const raw of [
    '{"agents":{"a":{"cli":"claude","allow":["--dangerously-skip-permissions"]}}}',
    '{"agents":{"a":{"cli":"codex","model":"--full-auto"}}}',
    '{"agents":{"a":{"cli":"claude","env":{"NODE_OPTIONS":"--require /tmp/x.js"}}}}',
    '{"agents":{"a":{"cli":"codex","env":{"PATH":"/tmp/evil"}}}}',
    '{"agents":{"a":{"cli":"codex","env":{"DYLD_INSERT_LIBRARIES":"x"}}}}',
    '{"agents":{"a":{"cli":"codex","env":{"git_dir":"x"}}}}',
    '{"agents":{"a":{"cli":"codex","env":{"SSL_CERT_FILE":"x"}}}}',
    '{"agents":{"a":{"cli":"claude","allow":["Bash"]}}}',
    '{"agents":{"a":{"cli":"claude","allow":["Bash(*)"]}}}',
    '{"agents":{"a":{"cli":"claude","allow":["Bash(npm test; curl x:*)"]}}}',
    '{"agents":{"a":{"cli":"claude","allow":["WebFetch"]}}}',
  ]) assert.throws(() => externalConfig(raw), undefined, raw)
  assert.deepEqual(externalConfig('{"agents":{"a":{"cli":"claude","allow":["Bash(npm test:*)","Bash(node --test:*)","Edit"]}}}').agents.a!.allow, ['Bash(npm test:*)', 'Bash(node --test:*)', 'Edit'])
  assert.equal(externalConfig('{"agents":{"a":{"cli":"claude","env":{"CLAUDE_CONFIG_DIR":"~/.claude-r"}}}}').agents.a!.env!.CLAUDE_CONFIG_DIR, '~/.claude-r')
})

test('every external Claude run has Bash in the OS sandbox; only plain session ids are passed back', () => {
  const argv = externalArgv({ cli: 'claude', allow: ['Bash(npm test:*)'] }, 'task', '/repo', 'edit')
  assert.equal(argv[argv.indexOf('--settings') + 1], CLAUDE_SANDBOX)
  assert.equal(JSON.parse(CLAUDE_SANDBOX).sandbox.enabled, true)
  assert.equal(safeSession('--dangerously-skip-permissions'), undefined)
  assert.equal(safeSession('01a13c34-a8fa-70d0-9fd3-c2a624d89867'), '01a13c34-a8fa-70d0-9fd3-c2a624d89867')
  assert.ok(!externalArgv({ cli: 'codex' }, 'task', '/repo', 'edit', '-x').includes('resume'))
})
