// External CLI wire formats and arguments. Pure: no process, filesystem or host APIs.
import type { Usage } from './price.ts'

export type ExternalCli = 'codex' | 'agy' | 'claude'
export type ExternalAgent = { cli: ExternalCli; model?: string; env?: Record<string, string>; allow?: string[]; level?: 'safe' | 'auto'; label?: string }
export type ExternalConfig = { maxConcurrent: number; maxMinutes: number; agents: Record<string, ExternalAgent> }
export const AGY_AUTO_ERROR = 'agy auto is not supported yet: git fails inside its sandbox, see PR #9'
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string => typeof v === 'string' ? v : ''
const count = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0

// The only variables a configuration may set: where each CLI keeps its account. A denylist always
// misses a loader variable, and plugin options may come from settings a repository supplies.
export const ALLOWED_ENV: readonly string[] = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME']
const flagLike = (v: string): boolean => v.trim().startsWith('-')
// What a Claude profile may be allowed on top of its defaults: file tools, and Bash for one named
// command (`Bash(npm test:*)`), never Bash at large or a shell expression.
const ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'TaskCreate', 'TaskUpdate']
export const safeAllow = (v: string): boolean =>
  ALLOWED_TOOLS.includes(v) || /^Bash\([A-Za-z0-9][A-Za-z0-9._\/ -]{0,79}:\*\)$/.test(v)

/** A provider session id as the CLI reported it; anything else is never passed back as an argument. */
export const safeSession = (id: string | undefined): string | undefined => id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : undefined

/** The Claude settings every external Claude run gets: Bash in the OS sandbox, so an allowed command
 *  (`npm test`) cannot write outside the worktree through a script the agent edited. */
export const CLAUDE_SANDBOX = JSON.stringify({ sandbox: { enabled: true, autoAllowBashIfSandboxed: false } })

export function externalConfig(raw: unknown): ExternalConfig {
  const o: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}
  if (!obj(o)) throw Error('externalAgents must be a JSON object')
  const maxConcurrent = o['maxConcurrent'] ?? 3, maxMinutes = o['maxMinutes'] ?? 30
  if (typeof maxConcurrent !== 'number' || !Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw Error('maxConcurrent must be a positive integer')
  if (typeof maxMinutes !== 'number' || !Number.isFinite(maxMinutes) || maxMinutes <= 0) throw Error('maxMinutes must be positive and finite')
  const agents: Record<string, ExternalAgent> = Object.create(null)
  const entries = o['agents'] ?? {}
  if (!obj(entries)) throw Error('externalAgents.agents must be an object')
  for (const [name, v] of Object.entries(entries)) {
    if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(name) || !obj(v) || !['codex', 'agy', 'claude'].includes(text(v['cli']))) throw Error(`invalid external agent "${name}"`)
    if (v['model'] !== undefined && (!text(v['model']).trim() || flagLike(text(v['model'])))) throw Error(`${name}.model must be a nonempty name, not a flag`)
    if (v['level'] !== undefined && v['level'] !== 'safe' && v['level'] !== 'auto') throw Error(`${name}.level must be safe or auto`)
    if (v['env'] !== undefined && (!obj(v['env']) || Object.values(v['env']).some(x => typeof x !== 'string'))) throw Error(`${name}.env must map names to strings`)
    for (const key of obj(v['env']) ? Object.keys(v['env']) : []) {
      if (!ALLOWED_ENV.includes(key)) throw Error(`${name}.env can only set ${ALLOWED_ENV.join(' or ')}, not ${key}`)
    }
    if (v['allow'] !== undefined && (!Array.isArray(v['allow']) || v['allow'].some(x => !safeAllow(text(x))))) throw Error(`${name}.allow takes file tools and Bash(<command>:*) entries only`)
    if (v['label'] !== undefined && (!text(v['label']).trim() || text(v['label']).length > 40)) throw Error(`${name}.label must be 1 to 40 characters`)
    agents[name] = { cli: v['cli'] as ExternalCli, ...(v['model'] ? { model: text(v['model']) } : {}),
      ...(v['env'] ? { env: { ...v['env'] as Record<string, string> } } : {}),
      ...(v['allow'] ? { allow: v['allow'] as string[] } : {}), ...(v['level'] ? { level: v['level'] as 'safe' | 'auto' } : {}),
      ...(v['label'] ? { label: text(v['label']).trim() } : {}) }
  }
  // `repos` is deliberately not read here: trusted repositories live in ~/.crabbus/trusted-repos.json
  return { maxConcurrent, maxMinutes, agents }
}

const plainAbsolute = (p: string): boolean =>
  p.startsWith('/') && p.length <= 1024 && !p.includes('\0') && !p.includes('//') && !p.split('/').some(s => s === '.' || s === '..')

/** Where the person lists the other repositories bus_delegate may work in, relative to HOME. Not a
 *  plugin option: options may come from settings a repository supplies, which could trust itself or
 *  any path. A file in HOME is one no repository's settings can write. */
export const TRUSTED_REPOS_FILE = '.crabbus/trusted-repos.json'

/** The trusted repositories file: a JSON array of absolute paths naming repositories, never roots. */
export function trustedRepos(raw: string): string[] {
  let v: unknown
  try { v = JSON.parse(raw) } catch { throw Error(`~/${TRUSTED_REPOS_FILE} is not valid JSON`) }
  if (!Array.isArray(v) || v.some(r => typeof r !== 'string' || !plainAbsolute(r) || r.split('/').filter(Boolean).length < 3))
    throw Error(`~/${TRUSTED_REPOS_FILE} must be a JSON array of absolute repository paths (at least three segments, no . or ..)`)
  return v.map(r => (r as string).replace(/\/+$/, ''))
}

/** Another repository than the session's is trusted only when the person listed it: git runs there
 *  (`rev-parse`, `status`, `worktree add`), and a repository's own config can make git run its code. */
export const allowedRepo = (path: string, repos: readonly string[]): boolean =>
  plainAbsolute(path) && repos.some(r => path === r || path.startsWith(`${r}/`))

const PRODUCT: Record<ExternalCli, string> = { codex: 'Codex', agy: 'Antigravity', claude: 'Claude' }

/** What the panel calls an agent: its label, else the product, with the profile name when it says more. */
export const externalLabel = (name: string, cfg: ExternalAgent): string => {
  if (cfg.label) return cfg.label
  const product = PRODUCT[cfg.cli]
  return name === cfg.cli || name === product.toLowerCase() ? product : `${product} · ${name}`
}

/** The worker contract every Antigravity task carries (skills/external-delegation/SKILL.md explains it to the
 *  master). Headless agy has no one to answer it: shell commands and questions are refused, and a turn
 *  that ends without a final message reaches the master as an empty result. */
export const AGY_WORKER_BRIEF = [
  'You are a worker agent under a master reviewer who will verify everything you report. Work alone: nobody can answer you.',
  'Rules:',
  '- Stay inside the working directory and the paths the task names. Do not touch lockfiles, generated output or global configuration unless the task asks for it.',
  '- You have no terminal: every shell command is denied, so do not try any. Use your file tools: view_file, list_dir, find_by_name, grep_search to read; replace_file_content, multi_replace_file_content, write_to_file to edit.',
  '- Do not ask questions (ask_question is never answered). When something is ambiguous, pick the most conservative option and record the assumption.',
  '- Do not commit, push, merge, delete branches or remove the worktree. Do not delegate to other agents.',
  '- Never claim that tests, builds or commands passed: you cannot run them. Write the exact commands the master should run instead.',
  '- Always finish with a final message in this shape, even when you did nothing:',
  '  ## Result: what you did, or why you stopped',
  '  ## Files: each file changed or read, one line each',
  '  ## Verify: the commands and checks the master should run',
  '  ## Assumptions and risks',
  '  ## Pending: what is left, or "nothing"',
].join('\n')

/** What the task adds for this CLI: Antigravity gets its worker contract; read tasks may not edit. */
export const externalTaskNote = (cfg: ExternalAgent, mode: 'edit' | 'read'): string =>
  cfg.cli === 'agy'
    ? `\n\n${AGY_WORKER_BRIEF}${mode === 'read' ? '\n- This is a read-only task: do not create or edit any file.' : ''}`
    : ''

export function externalArgv(cfg: ExternalAgent, prompt: string, cwd: string, mode: 'edit' | 'read', reported?: string): string[] {
  if (cfg.cli === 'agy' && cfg.level === 'auto') throw Error(AGY_AUTO_ERROR)
  const session = safeSession(reported)
  const model = cfg.model ? ['--model', cfg.model] : []
  if (cfg.cli === 'codex') return ['codex', 'exec', '--json', '--sandbox', mode === 'edit' ? 'workspace-write' : 'read-only',
    '--skip-git-repo-check', '-c', 'sandbox_workspace_write.exclude_slash_tmp=true', '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=false',
    '-C', cwd, ...model, ...(session ? ['resume', session, prompt] : [prompt])]
  // --add-dir: headless agy denies every path outside its workspace and does not adopt the process cwd
  // on its own; --disable-slash-commands: a task that starts with "/" is a task, not a command
  if (cfg.cli === 'agy') return ['agy', '-p', prompt, '--output-format', 'stream-json', '--mode', mode === 'read' ? 'plan' : 'accept-edits',
    '--add-dir', cwd, '--disable-slash-commands', ...model, ...(session ? ['--conversation', session] : [])]
  return ['claude', '-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', mode === 'read' ? 'plan' : 'acceptEdits', ...model,
    '--settings', CLAUDE_SANDBOX,
    ...(session ? ['--resume', session] : []), '--allowedTools', 'Read', 'Glob', 'Grep', 'TaskCreate', 'TaskUpdate', ...(mode === 'edit' ? ['Edit', 'Write', ...(cfg.allow ?? [])] : [])]
}

export type ExtEvent =
  | { kind: 'session'; id: string }
  | { kind: 'tool'; id: string; phase: 'start' | 'end'; name: string; input: Record<string, unknown>; ok?: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'plan'; items: string[]; done: number }
  | { kind: 'usage'; usage: Usage; scope: 'turn' | 'session' }
  | { kind: 'denied'; tool: string; arg: string }
  | { kind: 'done'; result: string; ok: boolean }

const normalized = (name: string, args: Record<string, unknown>): { name: string; input: Record<string, unknown> } => {
  const names: Record<string, string> = { RunCommand: 'Bash', command_execution: 'Bash', run_command: 'Bash', file_change: 'Edit', replace_file_content: 'Edit', multi_replace_file_content: 'Edit', write_to_file: 'Write', view_file: 'Read' }
  const tool = names[name] ?? name
  return { name: tool, input: { ...args,
    ...(tool === 'Bash' ? { command: args['command'] ?? args['CommandLine'] ?? '' } : {}),
    ...(['Read', 'Write', 'Edit'].includes(tool) ? { file_path: args['file_path'] ?? args['AbsolutePath'] ?? args['TargetFile'] ?? args['path'] ?? '' } : {}) } }
}

/** Parser state belongs to one process turn; tool IDs never leak into its continuation. */
export function externalParser(cli: ExternalCli): (line: string) => ExtEvent[] {
  const tools = new Map<string, { name: string; input: Record<string, unknown> }>()
  const tasks = new Map<string, { text: string; done: boolean }>()
  const seen = new Set<string>()
  let finalSeen = false
  return line => {
    let o: unknown
    try { o = JSON.parse(line) } catch { return [] }
    if (!obj(o)) return []
    const out: ExtEvent[] = []
    const session = (id: unknown) => { if (text(id)) out.push({ kind: 'session', id: text(id) }) }
    const tool = (id: string, phase: 'start' | 'end', name: string, input: Record<string, unknown>, ok?: boolean) => {
      if (!id || !name) return
      const key = `${id}:${phase}`
      if (seen.has(key)) return
      seen.add(key)
      const t = normalized(name, input)
      if (phase === 'start') tools.set(id, t)
      out.push({ kind: 'tool', id, phase, ...t, ...(ok === undefined ? {} : { ok }) })
    }
    const plan = () => { const ordered = [...tasks.values()].sort((a, b) => Number(b.done) - Number(a.done)); out.push({ kind: 'plan', items: ordered.map(t => t.text), done: ordered.filter(t => t.done).length }) }
    const usage = (u: unknown, codex = false) => {
      if (!obj(u)) return
      const cached = count(u[codex ? 'cached_input_tokens' : 'cache_read_tokens'] ?? u['cache_read_input_tokens'])
      out.push({ kind: 'usage', scope: codex ? 'session' : 'turn', usage: { input: Math.max(0, count(u['input_tokens']) - (codex ? cached : 0)), output: count(u['output_tokens']), cacheRead: cached, cacheWrite: count(u['cache_creation_input_tokens']) } })
    }
    if (cli === 'codex') {
      if (o['type'] === 'thread.started') session(o['thread_id'])
      const it = o['item']
      if (obj(it) && (o['type'] === 'item.started' || o['type'] === 'item.completed')) {
        const phase = o['type'] === 'item.started' ? 'start' : 'end'
        const id = text(it['id']), name = text(it['type'])
        if (name === 'command_execution') { if (phase === 'end' && !tools.has(id)) tool(id, 'start', name, { command: it['command'] }); tool(id, phase, name, { command: it['command'] }, it['exit_code'] === 0) }
        if (name === 'file_change' && Array.isArray(it['changes'])) for (const [i, c] of it['changes'].entries()) if (obj(c)) {
          const key = `${id}:${i}`
          tool(key, 'start', name, { path: c['path'] })
          if (phase === 'end') tool(key, 'end', name, { path: c['path'] }, it['status'] !== 'failed')
        }
        if (name === 'agent_message' && phase === 'end' && text(it['text'])) out.push({ kind: 'text', text: text(it['text']) })
        if (name === 'todo_list' && Array.isArray(it['items'])) {
          for (const [i, t] of it['items'].entries()) if (obj(t)) tasks.set(String(i), { text: text(t['text']), done: t['completed'] === true })
          plan()
        }
      }
      if (o['type'] === 'turn.completed' && !finalSeen) { finalSeen = true; usage(o['usage'], true); out.push({ kind: 'done', result: '', ok: true }) }
      if (o['type'] === 'turn.failed' && !finalSeen) { finalSeen = true; out.push({ kind: 'done', result: obj(o['error']) ? text(o['error']['message']) : 'Codex turn failed', ok: false }) }
    } else if (cli === 'agy') {
      if (o['event'] === 'init') session(o['conversation_id'])
      const step = o['step_update']
      if (o['event'] === 'step_update' && obj(step)) {
        const info = obj(step['tool_info']) ? step['tool_info'] : {}
        const args = obj(info['parameters']) ? info['parameters'] : {}
        if (step['step_type'] === 'tool') {
          const id = String(step['step_index'])
          const name = text(step['tool_name'] ?? info['name'])
          if (step['state'] === 'ACTIVE') tool(id, 'start', name, args)
          else {
            if (!tools.has(id)) tool(id, 'start', name, args)
            const error = obj(info['error']) ? text(info['error']['message']) : ''
            const denied = /denied|not permitted|permission/i.test(text(info['output']) + error)
            tool(id, 'end', name, args, step['state'] !== 'ERROR' && !denied && !error)
            if (denied) out.push({ kind: 'denied', tool: normalized(name, args).name, arg: text(args['CommandLine'] ?? args['AbsolutePath'] ?? args['TargetFile'] ?? args['DirectoryPath']) })
          }
        }
        if (step['step_type'] === 'agent_response' && text(step['text_delta']).trim()) out.push({ kind: 'text', text: text(step['text_delta']) })
      }
      const r = o['result']
      if (o['event'] === 'result' && obj(r) && !finalSeen) {
        finalSeen = true
        session(r['conversation_id']); usage(r['usage'])
        for (const denied of Array.isArray(r['denied_actions']) ? r['denied_actions'] : []) out.push({ kind: 'denied', tool: obj(denied) ? normalized(text(denied['tool_name'] ?? denied['tool'] ?? denied['display_name']), {}).name : 'tool', arg: obj(denied) ? text(denied['reason'] ?? denied['command'] ?? denied['action']) : text(denied) })
        out.push({ kind: 'done', result: text(r['response'] ?? r['error']), ok: r['status'] === 'SUCCESS' })
      }
    } else {
      if (o['type'] === 'system' && o['subtype'] === 'init') session(o['session_id'])
      const msg = o['message']
      if (obj(msg) && Array.isArray(msg['content'])) for (const c of msg['content']) if (obj(c)) {
        if (c['type'] === 'text' && text(c['text']) && o['type'] === 'assistant') out.push({ kind: 'text', text: text(c['text']) })
        if (c['type'] === 'tool_use') {
          const id = text(c['id']), args = obj(c['input']) ? c['input'] : {}, name = text(c['name'])
          tool(id, 'start', name, args)
          if (name === 'TaskCreate' || name === 'TaskUpdate') {
            tasks.set(text(args['taskId']) || id, { text: text(args['subject']) || tasks.get(text(args['taskId']))?.text || 'Task', done: args['status'] === 'completed' })
            plan()
          }
        }
        if (c['type'] === 'tool_result') {
          const id = text(c['tool_use_id']), t = tools.get(id)
          if (t) tool(id, 'end', t.name, t.input, c['is_error'] !== true)
          if (t?.name === 'TaskCreate' && tasks.has(id)) {
            const rawResult = o['tool_use_result']
            const task = obj(rawResult) && obj(rawResult['task']) ? rawResult['task'] : undefined
            const content = typeof c['content'] === 'string' ? c['content'] : ''
            const key = task ? text(task['id']) : /Task #(\d+) created/.exec(content)?.[1]
            if (key) { tasks.set(key, tasks.get(id)!); tasks.delete(id) }
          }
        }
      }
      if (o['type'] === 'system' && o['subtype'] === 'permission_denied') out.push({ kind: 'denied', tool: text(o['tool_name']), arg: text(o['message']) })
      if (o['type'] === 'result' && !finalSeen) {
        finalSeen = true
        session(o['session_id']); usage(o['usage'])
        for (const d of Array.isArray(o['permission_denials']) ? o['permission_denials'] : []) if (obj(d)) out.push({ kind: 'denied', tool: text(d['tool_name']), arg: JSON.stringify(d['tool_input'] ?? {}) })
        out.push({ kind: 'done', result: text(o['result']), ok: o['is_error'] !== true && !text(o['subtype']).startsWith('error') })
      }
    }
    return out
  }
}

/** A chunk can span lines; discard oversized lines until their newline without unbounded growth. */
export function externalLines(emit: (line: string) => void, limit = 1048576, onDrop?: () => void): { push: (chunk: string) => void; end: () => void } {
  let buffer = '', dropping = false
  return {
    push(chunk) {
      for (const part of chunk.split(/(?<=\n)/)) {
        const ends = part.endsWith('\n')
        if (!dropping && buffer.length + part.length <= limit) buffer += part
        else { if (!dropping) onDrop?.(); buffer = ''; dropping = true }
        if (ends) { if (!dropping) emit(buffer.trimEnd()); buffer = ''; dropping = false }
      }
    },
    end() { if (buffer && !dropping) emit(buffer); buffer = ''; dropping = false },
  }
}

/** Codex resume reports the thread's cumulative usage, not just this process turn. */
export const externalUsageDelta = (current: Usage, previous?: Usage): Usage => {
  const prior = previous && (Object.keys(current) as (keyof Usage)[]).every(k => current[k] >= previous[k])
    ? previous : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  return { input: current.input - prior.input, output: current.output - prior.output,
    cacheRead: current.cacheRead - prior.cacheRead, cacheWrite: current.cacheWrite - prior.cacheWrite }
}
