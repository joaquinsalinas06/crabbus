// Kit tests for the hooks module (claude plugin test). The pure logic has its own Node specs in spec/.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentSpawnInput, On, RenderNode, RenderPropsOf, SessionSendInput, SessionStartInput, ToolCallInput, TurnCompleteInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'


const spawn = (over: Partial<AgentSpawnInput>): AgentSpawnInput => ({
  tool_use_id: 't1', prompt: 'do the backend', description: 'backend', subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: true, fork: false, permissionMode: 'default', ...over,
})

function stubs(on: On, prompts: string[], ran: string[], sent: string[] = [], openPane = true): ReturnType<typeof mock.clock> {
  const clock = mock.clock(on)
  on('ui.close', () => ({ value: undefined }))
  if (openPane) on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__crabbus__${e.name}` } }))
  let spawned = 0
  on('agent.spawn', ($, e) => {
    prompts.push(e.prompt)
    return { model: 'claude-opus-5-5', agentId: `sub${++spawned}` }
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

const closePane = ($: Engine) => $.command.run({ command: 'test-close-pane', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

for (const surface of ['terminal', 'desktop'] as const) describe(`crabbus (${surface})`, () => {
  const start: SessionStartInput = { surface, isInteractive: true, cwd: '/work' }
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
  const mountPane = ($: Engine) => $.ui.mount({ plugin: 'crabbus', surface, component: 'Pane', props: PANE_PROPS, requestId: 'crabbus' })
  const ask = (id: string) => ({ tool: 'Bash', input: { command: 'rm -rf .cache' }, tool_use_id: id, agentId: 'sub1' })

  test('a subagent permission ask shows as blocked in the panel, the verdict untouched, until the call runs', async ($, on) => {
    stubs(on, [], [])
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    const r = await $.tool.check(ask('p1'))
    expect(r.decision).toBe('ask')
    expect(await status($, 'sub1')).toMatch(/PERMISSION requested in Claude Code; a background loop may not expose an interactive dialog: Bash rm -rf \.cache/)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /asks permission: Bash rm -rf \.cache/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /permission requested in Claude Code/ })).toBeDefined()
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
    for (const t of [/^agents $/, /METRICS/i, /DELEGATION/i, /SUBAGENTS/i, /ACTIVITY/i, /^master$/]) expect(await ui.find({ type: 'Text', text: t })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/3 stages/ })).toBeDefined()
    await ui.press({ key: 'mode' })
    expect(await ui.find({ type: 'Text', text: /cards/ })).toBeDefined()
    await ui.press({ key: 'b-sub1' })
    expect(await ui.find({ type: 'Text', text: /DETAILS/i })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /STAGES/i })).toBeDefined()
    await ui.input({ key: 'msg-sub1', text: 'use JWT' })
    await clock.settle()
    expect(sent).toContain('use JWT')
    expect(await status($, 'sub1')).toMatch(/"use JWT": accepted/)
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: /METRICS/i })).toBeDefined()
    await ui.unmount()
  })

  test('every section, tab and mode of the panel draws a tree the surface accepts', async ($, on) => {
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
    const ui = await $.ui.mount({ plugin: 'crabbus', surface, component: 'Pane', props: { ...PANE_PROPS, bodyColumns: 40 }, requestId: 'crabbus' })
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: / ✓ done / })).toBeUndefined()
      expect((await ui.findAll({ type: 'Text', text: /^ ✓ $/ })).length).toBeGreaterThan(0)
    } else expect(await ui.find({ type: 'Text', text: / ✓ done / })).toBeDefined()
    // the crab itself is a Raster: a Button under the pointer inverts, which would flip its half-block rows
    for (const k of ['b-sub1', 'cl-sub1-tool', 'cl-sub1-ctx']) {
      await ui.press({ key: k })
      expect(await ui.find({ type: 'Text', text: /DETAILS/i })).toBeDefined()
      await ui.press({ key: 'back' })
    }
    await ui.unmount()
  })

  test('/costume opens the wardrobe: costumes are picked and the user rules edited at once, saved behind it', async ($, on) => {
    stubs(on, [], [], [], false)
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
    on('ui.open', () => ({ value: { isPlaced: placed } as never }))
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
    for (const t of [/wardrobe/, /COSTUMES/i, /MY RULES/i, /BUILT-IN RULES/i]) await drawn(t)

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
    await drawn(/METRICS/i)
    // and the tab row takes the person back to the wardrobe without a command
    await ui.press({ key: 'view-wardrobe' })
    await drawn(/COSTUMES/i)
    await ui.unmount()

    // without a panel the command prints the same facts as text
    placed = false
    const fallback = await text('')
    expect(fallback).toMatch(/WEARING NOW:/)
    expect(fallback).toMatch(/RULES IN ORDER/)
  })

  test('sprites update their state, reduced-motion Desktop stays fixed, and only terminal blits', { options: { reduceMotion: surface === 'desktop' }, plugins: [{ name: 'pane-closer', register: on => { on('command.run', { command: 'test-close-pane' }, async $ => { await $.ui.close({ id: 'crabbus' }); return { text: '' } }) } }] }, async ($, on) => {
    const clock = stubs(on, [], [])
    const blits: string[] = []
    on('ui.blit', ($, e) => { blits.push(e.requestId); return { value: {} } })
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    const ui = await mountPane($)
    const type = surface === 'terminal' ? 'Raster' : 'Svg'
    expect((await ui.findAll({ type })).length).toBeGreaterThan(0)
    expect(await ui.find({ type: surface === 'terminal' ? 'Svg' : 'Raster' })).toBeUndefined()
    const agentSprite = async () => surface === 'terminal' ? ui.find({ key: 'cs-sub1' }) : (await ui.findAll({ type: 'Svg' })).find(x => x.props.alt === 'Crab: backend')
    const before = (await agentSprite())?.props
    if (surface === 'desktop') {
      expect(before?.width).toBe(72)
      expect(before?.height).toBe(56)
      expect(before?.isInteractive).toBeUndefined()
    }
    await clock.advance(1000)
    expect(surface === 'desktop' ? blits.length === 0 : blits.length > 0).toBe(true)
    if (surface === 'desktop') {
      expect((await agentSprite())?.props.source).toBe(before?.source)
    }
    await $.tool.call({ tool: 'mcp__crabbus__bus_step', blocker: 'waiting for input', tool_use_id: 'block', agentId: 'sub1' } as ToolCallInput)
    await clock.advance(1100)
    expect(await ui.find({ type: 'Text', text: /blocked/ })).toBeDefined()
    if (surface === 'desktop') expect((await agentSprite())?.props.source).not.toBe(before?.source)
    await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 'tt', agentId: 'sub1', reason: 'answer' })
    await clock.advance(1100)
    expect(await ui.find({ type: 'Text', text: /done/ })).toBeDefined()
    await ui.unmount()
    await closePane($)
    const count = blits.length
    await clock.advance(1000)
    expect(blits.length).toBe(count)
    const reopened = await mountPane($)
    expect((await reopened.findAll({ type })).length).toBeGreaterThan(0)
    await reopened.unmount()
  })

  for (const band of ['auto', 'stage', 'off'] as const) test(`AbovePrompt respects ${band}, surveys, room and panel visibility`, { options: { band, openOnStart: false, reduceMotion: surface === 'desktop' }, plugins: [{ name: 'pane-closer', register: on => { on('command.run', { command: 'test-close-pane' }, async $ => { await $.ui.close({ id: 'crabbus' }); return { text: '' } }) } }] }, async ($, on) => {
    const clock = stubs(on, [], [])
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'Original prompt content' }))
    await $.session.start(start)
    await $.agent.spawn(spawn({}))
    const props = { bodyColumns: 120, maxRows: 10, hasSurvey: false, isWorking: false, scroll: { offset: 0, bodyRows: 10 }, view: {} }
    const mount = () => $.ui.mount({ plugin: 'crabbus', surface, component: 'AbovePrompt', requestId: `band-${surface}`, props })
    const ui = await mount()
    expect(await ui.find({ type: 'Text', text: 'Original prompt content' })).toBeDefined()
    expect((await ui.find({ type: surface === 'desktop' ? 'Svg' : 'Raster' })) !== undefined).toBe(band === 'stage')
    if (surface === 'desktop' && band === 'stage') {
      const source = (await ui.find({ type: surface === 'desktop' ? 'Svg' : 'Raster' }))?.props.source
      await clock.advance(1100)
      expect((await ui.find({ type: surface === 'desktop' ? 'Svg' : 'Raster' }))?.props.source).toBe(source)
    }
    await ui.redraw({ ...props, hasSurvey: true })
    expect(await ui.find({ type: surface === 'desktop' ? 'Svg' : 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Original prompt content' })).toBeDefined()
    await ui.redraw({ ...props, bodyColumns: 30, maxRows: 7 })
    expect(await ui.find({ type: surface === 'desktop' ? 'Svg' : 'Raster' })).toBeUndefined()
    const pane = await mountPane($)
    await ui.redraw(props)
    expect(await ui.find({ type: surface === 'desktop' ? 'Svg' : 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Original prompt content' })).toBeDefined()
    await pane.unmount()
    await closePane($)
    await ui.redraw(props)
    expect((await ui.find({ type: surface === 'desktop' ? 'Svg' : 'Raster' })) !== undefined).toBe(band === 'stage')
    await ui.unmount()
  })

})

// Both render sites can be attached to one session without sharing blit targets.
test('terminal and Desktop keep separate pane and band registrations', { options: { band: 'stage' } }, async ($, on) => {
  const clock = stubs(on, [], [])
  const keys: string[] = []
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'Original prompt content' }))
  on('ui.blit', ($, e) => { keys.push(e.key); return { value: {} } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawn({}))
  const paneProps = { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
  const bandProps = { bodyColumns: 120, maxRows: 10, hasSurvey: false, isWorking: false, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  const terminal = await $.ui.mount({ plugin: 'crabbus', surface: 'terminal', component: 'Pane', props: paneProps, requestId: 'crabbus' })
  const desktopBand = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'AbovePrompt', props: bandProps, requestId: 'desktop-band' })
  expect(await desktopBand.find({ type: 'Client' })).toBeDefined()
  await clock.advance(500)
  expect(keys.includes('bus-stage')).toBe(false)
  expect(keys.includes('p-master')).toBe(true)
  const desktop = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', props: paneProps, requestId: 'crabbus' })
  await desktopBand.redraw(bandProps)
  expect(await desktopBand.find({ type: 'Client' })).toBeUndefined()
  const before = (await desktop.findAll({ type: 'Client' })).map(x => x.key).join(',')
  await clock.advance(1100)
  expect((await desktop.findAll({ type: 'Client' })).map(x => x.key).join(',')).toBe(before)
  expect(await terminal.find({ type: 'Raster' })).toBeDefined()
  expect(await desktop.find({ type: 'Raster' })).toBeUndefined()
  await desktopBand.unmount()
  await desktop.unmount()
  await terminal.unmount()
})

test('Desktop drawing budget replaces pictures while preserving working controls', async ($, on) => {
  stubs(on, [], [])
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  for (let i = 0; i < 16; i++) await $.agent.spawn(spawn({ description: `agent ${i}` }))
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(1)
  expect((await ui.findAll({ type: 'Svg' }))[0]!.props.alt).toBe('Master crab')
  expect(JSON.stringify(await ui.drawn()).length < 100000).toBe(true)
  await ui.press({ key: 'b-sub1' })
  expect(await ui.find({ type: 'Text', text: /DETAILS/i })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('Desktop reloads designs within two seconds even at one fps with reduced motion', { options: { fps: 1, reduceMotion: true } }, async ($, on) => {
  const clock = stubs(on, [], [])
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' })
  let version = 1
  let master = 'fable'
  on('fs.exists', ($, e) => ({ value: e.path === '/cfg/crabbus' }))
  on('fs.list', () => ({ value: [{ name: 'rules.json', kind: 'file', size: 100, mtimeMs: version, isLink: false }] }))
  on('fs.read', () => ({ value: JSON.stringify({ type: 'rules', master }) }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  const source = async () => (await ui.findAll({ type: 'Svg' })).find(x => x.props.alt === 'Master crab')?.props.source
  const before = await source()
  version = 2
  master = 'light'
  await clock.advance(1000)
  expect(await source()).toBe(before)
  await clock.advance(1000)
  expect(await source()).not.toBe(before)
  await ui.unmount()
})

test('an oversized Desktop stage source becomes alternative text rather than truncated SVG', { options: { band: 'stage', openOnStart: false }, timeoutMs: 10000 }, async ($, on) => {
  stubs(on, [], [])
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'Original prompt content' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  for (let i = 0; i < 60; i++) await $.agent.spawn(spawn({ description: `agent ${i}` }))
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'AbovePrompt', requestId: 'large-stage', props: { bodyColumns: 2000, maxRows: 10, hasSurvey: false, isWorking: false, scroll: { offset: 0, bodyRows: 10 }, view: {} } })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'CrabBus crew' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Original prompt content' })).toBeDefined()
  await ui.unmount()
})

for (const bodyColumns of [36, 56, 90]) test(`Desktop uses graphical meters and flexible full names at ${bodyColumns} columns`, async ($, on) => {
  stubs(on, [], [])
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const name = 'Review the authentication module and explain the session refresh behavior'
  await $.agent.spawn(spawn({ description: name }))
  await $.tool.call({ tool: 'mcp__crabbus__bus_step', plan: ['read', 'review'], done: 1, current: 'reviewing', tool_use_id: 'steps', agentId: 'sub1' } as ToolCallInput)
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  const picture = await ui.find({ type: 'Svg', in: 'cs-sub1' })
  expect(picture?.props.width).toBe(72)
  expect((await ui.find({ key: 'b-sub1' }))?.props.label).toContain(name)
  expect((await ui.find({ key: 'mode' }))?.props.plain).toBeUndefined()
  expect((await ui.find({ key: 'f-all' }))?.props.plain).toBeUndefined()
  expect((await ui.findAll({ type: 'Svg' })).some(x => x.props.alt === 'Master context: unknown' && x.props.height === 6)).toBe(true)
  const labels = async () => (await ui.findAll({ type: 'Text' })).map(x => x.text).join('\n')
  expect(await labels()).not.toMatch(/[─━▰▱▮▁▂▃▄▅▆▇█└├]/)
  expect(await ui.find({ type: 'Text', text: /declared stages/ })).toBeDefined()
  await ui.press({ key: 'mode' })
  expect((await ui.find({ key: 'b-sub1' }))?.props.label).toContain(name)
  expect(await labels()).not.toMatch(/[─━▰▱▮▁▂▃▄▅▆▇█└├]/)
  await ui.press({ key: 'b-sub1' })
  for (const key of ['dCost', 'dTok', 'dTime']) await ui.press({ key: `sec-${key}` })
  expect((await ui.findAll({ type: 'Svg' })).some(x => x.props.alt === 'Agent context: unknown')).toBe(true)
  expect(await labels()).not.toMatch(/[─━▰▱▮▁▂▃▄▅▆▇█└├]/)
  await ui.press({ key: 'back' })
  await ui.press({ key: 'view-wardrobe' })
  const next = await ui.find({ key: 'wd-next-1' })
  expect(next?.props.label).toBe('Next')
  expect(next?.props.plain).toBeUndefined()
  expect((await ui.find({ key: 'wd-row-0' }))?.props.flexDirection).toBe('row')
  expect((await ui.find({ key: 'wd-row-1' }))?.props.flexDirection).toBe('row')
  expect((await ui.findAll({ type: 'Client' })).length).toBe(4)
  for (const cell of await ui.findAll({ type: 'Box' })) {
    if (cell.key?.startsWith('wd-cell-')) {
      expect(cell.props.width).toBe('48%')
      expect(cell.props.flexShrink).toBe(1)
    }
  }
  await ui.press({ key: 'wd-next-1' })
  expect(await labels()).not.toMatch(/[─━▰▱▮▁▂▃▄▅▆▇█└├╱╲]/)
  await ui.unmount()
})

for (const fps of [1, 6, 10]) test(`Desktop Client requests changing art frames at ${fps} fps without terminal blits`, { options: { fps } }, async ($, on) => {
  const clock = stubs(on, [], [])
  const blits: string[] = []
  on('ui.blit', ($, e) => { blits.push(e.key); return { value: {} } })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawn({}))
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  expect((await ui.findAll({ type: 'Client' })).length).toBe(2)
  const source = async () => (await ui.find({ type: 'Svg', in: 'cs-sub1' }))?.props.source
  const frames = new Set([await source()])
  const ms = Math.round(1000 / fps)
  for (let i = 0; i < 8; i++) {
    await clock.advance(ms)
    await ui.advance(ms)
    frames.add(await source())
    if (fps > 1 && i === 2) expect(frames.size).toBeGreaterThan(1)
  }
  expect(frames.size).toBeGreaterThan(1)
  expect(blits.length).toBe(0)
  await ui.press({ key: 'b-sub1' })
  expect(await ui.find({ type: 'Client', key: 'p-sub1' })).toBeDefined()
  await clock.advance(ms)
  await ui.advance(ms)
  expect(await ui.find({ type: 'Svg', in: 'p-sub1' })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'view-wardrobe' })
  const costume = (await ui.findAll({ type: 'Client' }))[0]!
  const before = (await ui.find({ type: 'Svg', in: costume.key! }))?.props.source
  let changed = false
  for (let i = 0; i < 6; i++) {
    await clock.advance(ms)
    await ui.advance(ms)
    if ((await ui.find({ type: 'Svg', in: costume.key! }))?.props.source !== before) changed = true
  }
  expect(changed).toBe(true)
  await ui.unmount()
})

test('Desktop AbovePrompt animates its entire stage through one Client', { options: { band: 'stage', openOnStart: false } }, async ($, on) => {
  const clock = stubs(on, [], [])
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'Original prompt content' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawn({}))
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'AbovePrompt', requestId: 'desktop-stage', props: { bodyColumns: 120, maxRows: 10, hasSurvey: false, isWorking: false, scroll: { offset: 0, bodyRows: 10 }, view: {} } })
  expect((await ui.findAll({ type: 'Client' })).length).toBe(1)
  const before = (await ui.find({ type: 'Svg', in: 'bus-stage' }))?.props.source
  const frames = new Set([before])
  for (let i = 0; i < 6; i++) {
    await clock.advance(167)
    await ui.advance(167)
    frames.add((await ui.find({ type: 'Svg', in: 'bus-stage' }))?.props.source)
    if (i === 2) expect(frames.size).toBeGreaterThan(1)
  }
  expect(frames.size).toBeGreaterThan(1)
  expect(await ui.find({ type: 'Text', text: 'Original prompt content' })).toBeDefined()
  await ui.unmount()
})

test('a failed Desktop Client falls back to a fixed pose and leaves agent controls working', {
  plugins: [{ name: 'client-fault-injector', tier: 'prepend', register(on) {
    let injected = false
    on('ui.render', { component: 'Pane', requestId: 'crabbus' }, async ($, e, next) => {
      const tree = await next(e)
      const breakOnce = (node: RenderNode): RenderNode => {
        if (typeof node === 'string') return node
        if (!injected && node.type === 'Client' && node.props.key === 'cs-sub1') {
          injected = true
          return { ...node, props: { ...node.props, props: { ...(node.props.props as Record<string, unknown>), ms: -1 } } }
        }
        if ('children' in node && node.children) return { ...node, children: node.children.map(breakOnce) } as RenderNode
        return node
      }
      return breakOnce(tree) as Exclude<RenderNode, string>
    })
  } }],
}, async ($, on) => {
  const clock = stubs(on, [], [])
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawn({}))
  const mount = () => $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  let refused = false
  try { await mount() } catch { refused = true }
  expect(refused).toBe(true)
  const ui = await mount()
  expect(await ui.find({ type: 'Client', key: 'cs-sub1' })).toBeUndefined()
  const source = async () => (await ui.findAll({ type: 'Svg' })).find(x => x.props.alt === 'Crab: backend')?.props.source
  const before = await source()
  expect(before).toBeDefined()
  await clock.advance(1100)
  expect(await source()).toBe(before)
  await ui.press({ key: 'b-sub1' })
  expect(await ui.find({ type: 'Text', text: /Details/ })).toBeDefined()
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) test(`the master is visible in an empty ${surface} pane after reload`, async ($, on) => {
  stubs(on, [], [])
  // A reload can render an already open pane before session.start runs again.
  const ui = await $.ui.mount({ plugin: 'crabbus', surface, component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  expect(await ui.find({ type: 'Text', text: /master/i })).toBeDefined()
  expect(await ui.find({ type: surface === 'desktop' ? 'Client' : 'Raster' })).toBeDefined()
  await ui.unmount()
})

test('Desktop keeps the master above the prompt when there are no subagents', { options: { openOnStart: false } }, async ($, on) => {
  const clock = stubs(on, [], [])
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'Prompt' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const props = { bodyColumns: 120, maxRows: 10, hasSurvey: false, isWorking: false, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'AbovePrompt', requestId: 'idle-band', props })
  expect(await ui.find({ type: 'Text', text: 'Master' })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'bus-stage' })).toBeDefined()
  await clock.advance(500)
  await ui.advance(500)
  expect(await ui.find({ type: 'Svg', in: 'bus-stage' })).toBeDefined()
  await ui.redraw({ ...props, hasSurvey: true })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

test('Desktop falls back to SVG when its element table has no Client constructor', {
  plugins: [{ name: 'older-desktop', tier: 'prepend', register(on) {
    on('ui.resolve', async ($, e, next) => {
      const table = await next(e)
      if (e.surface !== 'desktop') return table
      const { Client, ...rest } = table as Record<string, unknown>
      return rest as never
    })
  } }],
}, async ($, on) => {
  stubs(on, [], [])
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawn({}))
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Svg' })).some(x => x.props.alt === 'Master crab')).toBe(true)
  await ui.press({ key: 'b-sub1' })
  expect(await ui.find({ type: 'Text', text: /Details/ })).toBeDefined()
  await ui.unmount()
})

test('a first panel render failure shows the master and the error, then recovers', {
  plugins: [{ name: 'render-failure', tier: 'prepend', register(on) {
    let drawing = false
    let broken = false
    on('ui.render', { component: 'Pane', requestId: 'crabbus' }, async ($, e, next) => {
      drawing = true
      try { return await next(e) } finally { drawing = false }
    })
    on('state.get', { plugin: 'crabbus', key: 'bus' }, ($, e, next) => {
      if (drawing && !broken) { broken = true; return { value: null } as never }
      return next(e)
    })
  } }],
}, async ($, on) => {
  stubs(on, [], [])
  const props = { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props })
  expect(await ui.find({ type: 'Text', text: 'Master' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /could not refresh/ })).toBeDefined()
  await ui.redraw(props)
  expect(await ui.find({ type: 'Text', text: /could not refresh/ })).toBeUndefined()
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await ui.unmount()
})

test('a later panel render failure retains a static master and rebuilds controls on recovery', {
  plugins: [{ name: 'later-render-failure', tier: 'prepend', register(on) {
    let drawing = 0
    on('ui.render', { component: 'Pane', requestId: 'crabbus' }, async ($, e, next) => {
      drawing++
      return next(e)
    })
    on('state.get', { plugin: 'crabbus', key: 'bus' }, ($, e, next) => drawing === 2 ? { value: null } as never : next(e))
  } }],
}, async ($, on) => {
  stubs(on, [], [])
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawn({}))
  const props = { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props })
  await ui.redraw(props)
  expect((await ui.findAll({ type: 'Svg' })).some(x => x.props.alt === 'Master crab')).toBe(true)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  if (!(await ui.find({ type: 'Text', text: /refresh failed/ }))) throw new Error('Recovery notice missing')
  await ui.redraw(props)
  await ui.press({ key: 'b-sub1' })
  expect(await ui.find({ type: 'Text', text: /Details/ })).toBeDefined()
  await ui.unmount()
})

test('Desktop wardrobe animation does not rebuild its panel on maintenance ticks', {
  plugins: [{ name: 'render-counter', tier: 'prepend', register(on) {
    let renders = 0
    on('ui.render', { component: 'Pane', requestId: 'crabbus' }, async ($, e, next) => ({
      type: 'Box', props: { flexDirection: 'column' }, children: [
        await next(e), { type: 'Text', props: {}, children: [`Render count: ${++renders}`] },
      ],
    }))
  } }],
}, async ($, on) => {
  const clock = stubs(on, [], [])
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  await ui.press({ key: 'view-wardrobe' })
  const count = async () => (await ui.find({ type: 'Text', text: /Render count:/ }))?.text
  const before = await count()
  const costume = (await ui.findAll({ type: 'Client' }))[0]!
  const frames = new Set<string>()
  for (let i = 0; i < 36; i++) {
    await clock.advance(167)
    await ui.advance(167)
    const source = (await ui.find({ type: 'Svg', in: costume.key! }))?.props.source
    if (typeof source === 'string') frames.add(source)
  }
  expect(await count()).toBe(before)
  expect(frames.size).toBeGreaterThan(1)
  await ui.press({ key: 'wd-next-1' })
  expect(await count()).not.toBe(before)
  expect(await ui.find({ key: 'wd-row-0' })).toBeDefined()
  await ui.unmount()
})

for (const bodyColumns of [36, 56, 90]) test(`Desktop wardrobe keeps four fixed slots across pages at ${bodyColumns} columns`, async ($, on) => {
  stubs(on, [], [])
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  await ui.press({ key: 'view-wardrobe' })
  const geometry = async () => (await ui.findAll({ type: 'Box' }))
    .filter(x => x.key?.startsWith('wd-cell-slot-') || x.key?.startsWith('wd-row-'))
    .map(x => ({ key: x.key, width: x.props.width, height: x.props.height, minHeight: x.props.minHeight }))
  const before = await geometry()
  expect(before.length).toBe(6)
  for (let i = 0; i < 3; i++) {
    await ui.press({ key: 'wd-next-1' })
    expect(await geometry()).toEqual(before)
    await ui.press({ key: 'wd-prev-1' })
    expect(await geometry()).toEqual(before)
  }
  for (const node of await ui.findAll({ type: 'Client' })) {
    expect(node.props.width).toBe(9)
    expect(node.props.height).toBe(4)
  }
  await ui.unmount()
})

test('Desktop pagination keeps the existing Client timer in occupied slots', async ($, on) => {
  const clock = stubs(on, [], [])
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'Pane', requestId: 'crabbus', props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  await ui.press({ key: 'view-wardrobe' })
  await ui.advance(100)
  await ui.press({ key: 'wd-next-1' })
  const source = async () => (await ui.find({ type: 'Svg', in: 'wd-slot-0' }))?.props.source
  const before = await source()
  await clock.advance(501)
  // The 167ms surface timer has 67ms left. A remount would restart it at 100ms.
  await ui.advance(67)
  expect(await source()).not.toBe(before)
  await ui.unmount()
})
