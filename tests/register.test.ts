// Kit tests for the hooks module (claude plugin test). The pure logic has its own Node specs in spec/.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentSpawnInput, On, RenderPropsOf, SessionSendInput, SessionStartInput, ToolCallInput, TurnCompleteInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const start: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

const spawn = (over: Partial<AgentSpawnInput>): AgentSpawnInput => ({
  tool_use_id: 't1', prompt: 'do the backend', description: 'backend', subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: true, fork: false, permissionMode: 'default', ...over,
})

function stubs(on: On, prompts: string[], ran: string[], sent: string[] = []): ReturnType<typeof mock.clock> {
  const clock = mock.clock(on)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__crabbus__${e.name}` } }))
  on('agent.spawn', ($, e) => {
    prompts.push(e.prompt)
    return { model: 'claude-opus-5-5', agentId: 'sub1' }
  })
  on('tool.call', { tool: 'Read' }, ($, e) => {
    ran.push(e.tool)
    return { result: { type: 'text', file: { filePath: 'a.ts', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } } as never }
  })
  on('session.send', ($, e) => {
    sent.push(e.text)
    return { isDelivered: true }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // beneath the plugins: the engine would put every call to the person
  on('tool.check', () => ({ decision: 'ask' as const }))
  return clock
}

const status = async ($: Engine, agent?: string): Promise<string> => {
  const r = await $.tool.call({ tool: 'mcp__crabbus__bus_status', ...(agent ? { agent } : {}) })
  return String((r as { result?: unknown }).result)
}

describe('crabbus', () => {
  test('a spawn gets the reporting brief and shows up observed, then declared, then done', async ($, on) => {
    const prompts: string[] = []
    const ran: string[] = []
    stubs(on, prompts, ran)
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    expect(prompts[0]).toContain('do the backend')
    expect(prompts[0]).toContain('mcp__crabbus__bus_step')

    expect(await status($)).toMatch(/DECLARED {2}nothing/)

    const read: ToolCallInput = { tool: 'Read', file_path: '/w/a.ts', tool_use_id: 'c1', agentId: 'sub1' }
    await $.tool.call(read)
    expect(ran).toEqual(['Read'])
    expect(await status($)).toMatch(/last tool: Read \/w\/a\.ts/)

    const step: ToolCallInput = { tool: 'mcp__crabbus__bus_step', plan: ['a', 'b', 'c', 'd', 'e'], done: 4, tool_use_id: 'c2', agentId: 'sub1' } as ToolCallInput
    const ack = await $.tool.call(step)
    expect(String((ack as { result?: unknown }).result)).toBe('recorded')
    const declared = await status($)
    expect(declared).toMatch(/4\/5 stages declared done/)
    expect(declared).not.toMatch(/80 ?%/)

    const done: TurnCompleteInput = { answer: 'ok', durationMs: 5, isAborted: false, turnId: 'tt', agentId: 'sub1', reason: 'answer' }
    await $.turn.complete(done)
    expect(await status($)).toMatch(/— done/)
  })

  test('bus_step from the master and bus_status from a subagent are refused, nothing recorded', async ($, on) => {
    stubs(on, [], [])
    await $.session.start(start)
    const fromMain: ToolCallInput = { tool: 'mcp__crabbus__bus_step', done: 1, tool_use_id: 'c3' } as ToolCallInput
    expect(String((await $.tool.call(fromMain) as { result?: unknown }).result)).toMatch(/ignored/)
    const fromSub: ToolCallInput = { tool: 'mcp__crabbus__bus_status', tool_use_id: 'c4', agentId: 'sub1' } as ToolCallInput
    expect(String((await $.tool.call(fromSub) as { result?: unknown }).result)).toMatch(/ignored/)
    expect(await status($)).toBe('No subagents seen in this session yet.')
  })

  test('a master SendMessage is recorded as accepted and its delivery left to the agent', async ($, on) => {
    stubs(on, [], [])
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    const send: SessionSendInput = { to: 'sub1', text: 'switch to JWT', origin: { kind: 'model' } }
    const sent = await $.session.send(send)
    expect(sent).toMatchObject({ isDelivered: true })
    expect(await status($, 'sub1')).toMatch(/m1 "switch to JWT": accepted, not yet delivered, not acknowledged/)
  })

  test('observing never changes a tool result', async ($, on) => {
    const ran: string[] = []
    stubs(on, [], ran)
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    const read: ToolCallInput = { tool: 'Read', file_path: '/w/a.ts', tool_use_id: 'c5', agentId: 'sub1' }
    const r = await $.tool.call(read)
    expect(r).toMatchObject({ result: { type: 'text' } })
    expect('deny' in r && r.deny !== undefined).toBe(false)
  })

  test('design files load live: a good one is worn, a broken one is reported, the rest keeps working', async ($, on) => {
    stubs(on, [], [])
    mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' })
    const files: Record<string, string> = {
      'french.json': JSON.stringify({ type: 'pack', items: [
        { type: 'piece', id: 'beret', slot: 'head', anchor: 'head', layers: [{ pos: [0, 3], drawings: { a: ['.........k........', '.....rrrrrrrrr....', '...rrrrrrrrrrrrr..'] }, palette: { r: '#b8322a', k: '#5a1a14' } }] },
        { type: 'costume', id: 'french', name: 'french', color: '#b8322a', pieces: ['beret'] },
      ] }),
      'rules.json': JSON.stringify({ type: 'rules', rules: [{ if: { description: '^backend$' }, costume: 'french', nickname: 'Pierre' }] }),
      'broken.json': '{ "type": "piece", ',
    }
    on('fs.exists', ($, e) => ({ value: e.path === '/cfg/crabbus' }))
    on('fs.list', () => ({ value: Object.entries(files).map(([name, t]) => ({ name, kind: 'file' as const, size: t.length, mtimeMs: 1, isLink: false })) }))
    on('fs.read', ($, e) => ({ value: files[e.path.replace('/cfg/crabbus/', '')] ?? '' }))
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    const report = await status($)
    expect(report).toMatch(/Pierre · backend .*costume french/)
    expect(report).toMatch(/Designs: 1 problem\(s\) in 1 file\(s\)/)
    const list = await $.command.run({ command: 'costume', args: 'list', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(String((list as { text?: string }).text)).toMatch(/french «french»: beret \[french\.json\]/)
    expect(String((list as { text?: string }).text)).toMatch(/broken\.json: malformed JSON/)
  })

  // legacy-spanish-test-start
  test('legacy Spanish design files load live via /disfraz and migrate idempotently via /costume migrate', async ($, on) => {
    stubs(on, [], [])
    mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' })
    const files: Record<string, string> = {
      'frances.json': JSON.stringify({ tipo: 'paquete', items: [
        { tipo: 'pieza', id: 'boina', ranura: 'cabeza', ancla: 'cabeza', capas: [{ pos: [0, 3], dibujos: { a: ['.........k........', '.....rrrrrrrrr....', '...rrrrrrrrrrrrr..'] }, paleta: { r: '#b8322a', k: '#5a1a14' } }] },
        { tipo: 'disfraz', id: 'frances', nombre: 'francés', color: '#b8322a', piezas: ['boina'] },
      ] }),
      'reglas.json': JSON.stringify({ tipo: 'reglas', reglas: [{ si: { descripcion: '^backend$' }, disfraz: 'frances', apodo: 'Pierre' }] }),
      'roto.json': '{ "tipo": "pieza", ',
    }
    on('fs.exists', ($, e) => ({ value: e.path === '/cfg/crabbus' || files[e.path.replace('/cfg/crabbus/', '')] !== undefined }))
    on('fs.list', () => ({ value: Object.entries(files).map(([name, t]) => ({ name, kind: 'file' as const, size: t.length, mtimeMs: 1, isLink: false })) }))
    on('fs.read', ($, e) => ({ value: files[e.path.replace('/cfg/crabbus/', '')] ?? '' }))
    on('fs.write', ($, e) => {
      files[e.path.replace('/cfg/crabbus/', '')] = e.text
      return { value: undefined }
    })
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    const report = await status($)
    expect(report).toMatch(/Pierre · backend .*costume frances/)
    expect(report).toMatch(/Designs: 1 problem\(s\) in 1 file\(s\)/)
    const list = await $.command.run({ command: 'disfraz', args: 'lista', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(String((list as { text?: string }).text)).toMatch(/frances «francés»: boina \[frances\.json\]/)
    expect(String((list as { text?: string }).text)).toMatch(/roto\.json: malformed JSON/)

    const dry = await $.command.run({ command: 'costume', args: 'migrate --dry-run', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(String((dry as { text?: string }).text)).toMatch(/frances\.json: would migrate to English \(--dry-run\)/)
    expect(String((dry as { text?: string }).text)).toMatch(/roto\.json: skipped \(malformed JSON/)
    expect(files['frances.json.bak']).toBeUndefined()

    const mig1 = await $.command.run({ command: 'costume', args: 'migrate', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(String((mig1 as { text?: string }).text)).toMatch(/frances\.json: migrated \(backup: frances\.json\.bak\)/)
    expect(files['frances.json.bak']).toContain('"tipo":"paquete"')
    expect(files['frances.json']).toContain('"type": "bundle"')

    const mig2 = await $.command.run({ command: 'costume', args: 'migrate', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(String((mig2 as { text?: string }).text)).toMatch(/frances\.json: already in English \(unchanged\)/)
  })
  // legacy-spanish-test-end

  // ---- the v3 panel

  const PANE_PROPS: RenderPropsOf['Pane'] = { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
  const mountPane = ($: Engine) => $.ui.mount({ plugin: 'crabbus', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'crabbus' })
  const ask = (id: string) => ({ tool: 'Bash', input: { command: 'rm -rf .cache' }, tool_use_id: id, agentId: 'sub1' })

  test('a subagent permission ask shows as blocked in the panel, the verdict untouched, until the call runs', async ($, on) => {
    stubs(on, [], [])
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    const r = await $.tool.check(ask('p1'))
    expect(r.decision).toBe('ask')
    expect(await status($, 'sub1')).toMatch(/PERMISSION waiting for the person's answer in Claude Code's dialog: Bash rm -rf \.cache/)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /asks permission: Bash rm -rf \.cache/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /answer it in Claude Code/ })).toBeDefined()
    await ui.unmount()
    await $.tool.call({ tool: 'Bash', command: 'rm -rf .cache', tool_use_id: 'p1', agentId: 'sub1' } as ToolCallInput)
    expect(await status($, 'sub1')).not.toMatch(/PERMISSION/)
    // the main loop's own asks are not the panel's
    const main = await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'p4' })
    expect(main.decision).toBe('ask')
  })

  test('in auto mode an ask goes to the classifier untouched', async ($, on) => {
    stubs(on, [], [])
    await $.session.start(start)
    await $.agent.spawn(spawn({ permissionMode: 'auto' }))
    const r = await $.tool.check({ tool: 'Read', input: { file_path: '/x' }, tool_use_id: 'q1', agentId: 'sub1' })
    expect(r.decision).toBe('ask')
    expect(await status($, 'sub1')).not.toMatch(/PERMISSION/)
  })

  test('the panel lists the master and subagents with the design sections, opens a detail, and sends a message', async ($, on) => {
    const sent: string[] = []
    const clock = stubs(on, [], [], sent)
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    await $.tool.call({ tool: 'mcp__crabbus__bus_step', plan: ['read', 'fix', 'test'], done: 1, current: 'fixing', tool_use_id: 's1', agentId: 'sub1' } as ToolCallInput)
    const ui = await mountPane($)
    for (const t of [/^agents $/, /METRICS/, /DELEGATION/, /SUBAGENTS/, /ACTIVITY/, /^master$/]) expect(await ui.find({ type: 'Text', text: t })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/3 stages/ })).toBeDefined()
    await ui.press({ key: 'mode' })
    expect(await ui.find({ type: 'Text', text: /cards/ })).toBeDefined()
    await ui.press({ key: 'b-sub1' })
    expect(await ui.find({ type: 'Text', text: /DETAILS/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /STAGES/ })).toBeDefined()
    await ui.input({ key: 'msg-sub1', text: 'use JWT' })
    await clock.settle()
    expect(sent).toContain('use JWT')
    expect(await status($, 'sub1')).toMatch(/"use JWT": accepted/)
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: /METRICS/ })).toBeDefined()
    await ui.unmount()
  })

  test('every section, tab and mode of the panel draws a tree the terminal accepts', async ($, on) => {
    const clock = stubs(on, [], [])
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    await $.tool.call({ tool: 'mcp__crabbus__bus_step', plan: ['read', 'fix'], done: 1, evidence: [{ stage: 1, proof: 'read 3 files' }], tool_use_id: 's1', agentId: 'sub1' } as ToolCallInput)
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts', tool_use_id: 'c1', agentId: 'sub1' } as ToolCallInput)
    await $.session.send({ to: 'sub1', text: 'switch to JWT', origin: { kind: 'model' } })
    const ui = await mountPane($)
    const sections = ['metrics', 'deleg', 'subs', 'act']
    for (const k of sections) { await ui.press({ key: `sec-${k}` }); await ui.drawn(); await ui.press({ key: `sec-${k}` }); await ui.drawn() }
    await ui.press({ key: 'mode' }); await ui.drawn(); await ui.press({ key: 'mode' })
    for (const f of ['active', 'attention', 'done', 'all']) { await ui.press({ key: `f-${f}` }); await ui.drawn() }
    await ui.press({ key: 'b-sub1' })
    for (const k of ['details', 'dCost', 'dTok', 'dCtx', 'dTime', 'dTools', 'dTasks']) { await ui.press({ key: `sec-${k}` }); await ui.drawn(); await ui.press({ key: `sec-${k}` }); await ui.drawn() }
    for (const x of ['tools', 'reasoning', 'all']) { await ui.press({ key: `tab-${x}` }); await ui.drawn() }
    await clock.settle()
    await ui.unmount()
  })

  test('a narrow panel keeps chips whole and every text row of a card is one press target', async ($, on) => {
    stubs(on, [], [])
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 'tt', agentId: 'sub1', reason: 'answer' })
    const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'terminal', component: 'Pane', props: { ...PANE_PROPS, bodyColumns: 40 }, requestId: 'crabbus' })
    expect(await ui.find({ type: 'Text', text: / ✓ done / })).toBeUndefined()
    expect((await ui.findAll({ type: 'Text', text: /^ ✓ $/ })).length).toBeGreaterThan(0)
    // the crab itself is a Raster: a Button under the pointer inverts, which would flip its half-block rows
    for (const k of ['b-sub1', 'cl-sub1-tool', 'cl-sub1-ctx']) {
      await ui.press({ key: k })
      expect(await ui.find({ type: 'Text', text: /DETAILS/ })).toBeDefined()
      await ui.press({ key: 'back' })
    }
    await ui.unmount()
  })

  test('/costume opens the wardrobe: costumes are picked and the user rules edited at once, saved behind it', async ($, on) => {
    stubs(on, [], [])
    mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' })
    const files: Record<string, string> = {
      'mine.json': JSON.stringify({ type: 'rules', active: ['fable', 'heavy'], rules: [{ if: { description: 'dino' }, costume: 'light' }] }),
    }
    const wrote: string[] = []
    on('fs.exists', ($, e) => ({ value: e.path === '/cfg/crabbus' }))
    on('fs.list', () => ({ value: Object.entries(files).map(([name, t]) => ({ name, kind: 'file' as const, size: t.length, mtimeMs: 1, isLink: false })) }))
    on('fs.read', ($, e) => ({ value: files[e.path.replace('/cfg/crabbus/', '')] ?? '' }))
    on('fs.write', ($, e) => { files[e.path.replace('/cfg/crabbus/', '')] = e.text; wrote.push(e.path); return { value: undefined } })
    let placed = true
    on('ui.open', () => ({ value: { isPlaced: placed } }))
    const told: string[] = []
    on('prompt.submit', ($, e) => { told.push(e.text); return { text: e.text } })
    await $.session.start(start)
    await $.agent.spawn(spawn({ description: 'architect' }))
    const cmd = (args: string) => $.command.run({ command: 'costume', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    const text = async (args: string) => String(((await cmd(args)) as { text?: string }).text)

    expect(await text('')).toMatch(/Wardrobe opened/)
    const ui = await mountPane($)
    // names what is missing when a find fails
    const drawn = async (text: RegExp) => expect((await ui.find({ type: 'Text', text })) ? String(text) : `not drawn: ${String(text)}`).toBe(String(text))
    for (const t of [/wardrobe/, /COSTUMES/, /MY RULES/, /BUILT-IN RULES/]) await drawn(t)

    // a costume is picked and taken out of the rotation: the rules text already says so, and the file follows
    // a card is picked by its name or its state line
    await ui.press({ key: 'wd-pick-heavy-st' })
    await drawn(/worn by 0/)
    await ui.press({ key: 'wd-rot-heavy' })
    expect(await text('rules')).toMatch(/ROTATION: fable\b(?!.*heavy)/)
    expect(JSON.parse(files['mine.json'] as string).active).toEqual(['fable'])

    // the master is chosen from the same card
    await ui.press({ key: 'wd-master-heavy' })
    expect(JSON.parse(files['mine.json'] as string).master).toBe('heavy')

    // asking CrabBus comes first in the card; the form by hand is folded under it, for those who want it
    await ui.input({ key: 'wd-tell-card', text: 'when it plans' })
    expect(told).toHaveLength(1)
    expect(told[0]).toContain('About the costume heavy: when it plans')
    await drawn(/Claude is on it/)
    await ui.press({ key: 'sec-wdManual' })

    // a rule of the user's is added for the picked costume, moved up, given another costume, and removed
    await ui.input({ key: 'wd-new-description', text: 'review' })
    expect(JSON.parse(files['mine.json'] as string).rules).toEqual([{ if: { description: 'dino' }, costume: 'light' }, { if: { description: 'review' }, costume: 'heavy' }])
    // and shows up marked as new
    await drawn(/^ new $/)
    await ui.press({ key: 'wd-up-2' })
    expect(JSON.parse(files['mine.json'] as string).rules[0].costume).toBe('heavy')
    await ui.press({ key: 'wd-del-1' })
    expect(JSON.parse(files['mine.json'] as string).rules).toEqual([{ if: { description: 'dino' }, costume: 'light' }])

    // the picked costume's card takes a date rule too, and lists it with its tag
    await ui.press({ key: 'wd-crit-date' })
    await ui.input({ key: 'wd-new-date', text: '12-01..12-31' })
    expect(JSON.parse(files['mine.json'] as string).rules[1]).toEqual({ if: { from: '12-01', to: '12-31' }, costume: 'heavy' })
    await drawn(/Dec 1 → Dec 31/)
    // and removes it from the card
    await ui.press({ key: 'wd-c-del-2' })
    expect(JSON.parse(files['mine.json'] as string).rules).toHaveLength(1)
    // a costume named in the full list opens its card
    await ui.press({ key: 'wd-goto-1' })
    await drawn(/\+ TELL CRABBUS ABOUT light/)
    await ui.press({ key: 'wd-crit-description' })

    // a pattern that could hang Claude Code is refused: nothing is written
    const before = wrote.length
    await ui.input({ key: 'wd-new-description', text: '(a+)+' })
    expect(wrote.length).toBe(before)

    // the costumes come a page at a time, at full size: opening light above turned to its page; the arrows turn it
    await drawn(/2\/2/)
    await ui.press({ key: 'wd-next-1' })
    await drawn(/1\/2/)
    await ui.press({ key: 'wd-pick-fable' })
    await ui.press({ key: 'wd-prev-1' })
    await drawn(/2\/2/)

    // a long message no longer fits the one-line field: it is shown whole under it while it is typed
    const long = 'make me a pumpkin crab like the september 2026 meme, with a stem and a big grin'
    await ui.input({ key: 'wd-tell', text: long, kind: 'change' })
    await drawn(/september 2026 meme, with a stem/)

    // "Tell CrabBus" sends the person's words to Claude, with what is set now
    await ui.input({ key: 'wd-tell', text: 'the one who plans wears the detective' })
    expect(told).toHaveLength(2)
    expect(told[1]).toContain('the person asks: "the one who plans wears the detective"')
    expect(told[1]).toContain('RULES IN ORDER')

    // back to the agents
    await ui.press({ key: 'view-agents' })
    await drawn(/METRICS/)
    // and the tab row takes the person back to the wardrobe without a command
    await ui.press({ key: 'view-wardrobe' })
    await drawn(/COSTUMES/)
    await ui.unmount()

    // without a panel the command prints the same facts as text
    placed = false
    const fallback = await text('')
    expect(fallback).toMatch(/WEARING NOW:/)
    expect(fallback).toMatch(/RULES IN ORDER/)
  })
})
