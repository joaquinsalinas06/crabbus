import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildFlowGraph, inferNodeRole, tierConnectors } from '../src/flow.ts'
import { emptyState, onExternal, onReceive, onSend, onSpawn, onStep, parseStep } from '../src/model.ts'

describe('flow graph & multi-agent topology engine', () => {
  it('detects idle and single-agent delegation topologies', () => {
    const s0 = emptyState()
    const g0 = buildFlowGraph(s0, 1000)
    assert.equal(g0.pattern, 'idle')
    assert.equal(g0.nodes.length, 1)
    assert.equal(g0.tiers.length, 1)
    assert.equal(g0.nodes[0]?.role, 'orchestrator')

    const s1 = onSpawn(s0, { id: 'a1', type: 'general-purpose', description: 'Fix button alignment', name: 'ui-fixer' }, 1000)
    const g1 = buildFlowGraph(s1, 1500)
    assert.equal(g1.pattern, 'single')
    assert.equal(g1.nodes.length, 2)
    assert.equal(g1.tiers.length, 2)
    const c1 = tierConnectors(g1, g1.tiers[0]!, g1.tiers[1]!, 56)
    assert.ok(c1.lines.some(l => l.includes('▼')))
  })

  it('detects fan-out (1 -> N) parallel worker topology and builds fan-out connectors', () => {
    let s = emptyState()
    s = onSpawn(s, { id: 'w1', type: 'general-purpose', description: 'Refactor auth module', name: 'worker-auth' }, 1000)
    s = onSpawn(s, { id: 'w2', type: 'general-purpose', description: 'Refactor billing module', name: 'worker-billing' }, 1010)
    s = onSpawn(s, { id: 'w3', type: 'general-purpose', description: 'Refactor notifications', name: 'worker-notify' }, 1020)

    const g = buildFlowGraph(s, 2000)
    assert.equal(g.pattern, 'fan-out')
    assert.equal(g.tiers.length, 2)
    assert.equal(g.tiers[0]?.nodes.length, 1)
    assert.equal(g.tiers[1]?.nodes.length, 3)

    const conn = tierConnectors(g, g.tiers[0]!, g.tiers[1]!, 56)
    assert.ok(conn.lines.some(l => l.includes('┌') && l.includes('┐')))
    assert.ok(conn.lines.some(l => l.includes('▼')))
  })

  it('detects orchestrator -> workers -> verifier (3-tier pipeline with feedback loop)', () => {
    let s = emptyState()
    s = onSpawn(s, { id: 'w1', type: 'general-purpose', description: 'Implement API endpoint', name: 'worker-api' }, 1000)
    s = onSpawn(s, { id: 'w2', type: 'general-purpose', description: 'Implement DB queries', name: 'worker-db' }, 1010)
    s = onSpawn(s, { id: 'v1', type: 'general-purpose', description: 'Verify tests and review diffs', name: 'qa-verifier' }, 1020)

    const stepW1 = parseStep({ plan: ['Code', 'Test'], done: 1, role: 'worker', next: ['qa-verifier'] })
    s = onStep(s, 'w1', stepW1, 1100)
    const stepV1 = parseStep({ plan: ['Check diffs', 'Run suite'], done: 0, role: 'verifier', next: ['master'] })
    s = onStep(s, 'v1', stepV1, 1150)

    // Verifier sends feedback message back to master
    s = onSend(s, '', 'All 42 unit tests pass', true, 1200, 'v1')

    const g = buildFlowGraph(s, 1500)
    assert.equal(g.pattern, 'orchestrator-workers-verifier')
    assert.equal(g.tiers.length, 3)
    assert.equal(g.tiers[0]?.nodes.length, 1) // Master
    assert.equal(g.tiers[1]?.nodes.length, 2) // w1, w2
    assert.equal(g.tiers[2]?.nodes.length, 1) // v1 (verifier)
    assert.equal(g.tiers[2]?.nodes[0]?.role, 'verifier')
    assert.equal(g.hasFeedbackLoop, true)
    assert.ok(g.feedbackText?.includes('All 42 unit tests pass'))

    // Fan-in connector from 2 workers to 1 verifier
    const fanIn = tierConnectors(g, g.tiers[1]!, g.tiers[2]!, 56)
    assert.ok(fanIn.lines.some(l => l.includes('└') && l.includes('┘')))
  })

  it('detects hierarchical tree when subagents spawn child subagents via parentId', () => {
    let s = emptyState()
    s = onSpawn(s, { id: 'lead1', type: 'general-purpose', description: 'Backend domain lead', name: 'lead-backend' }, 1000)
    s = onSpawn(s, { id: 'child1', type: 'general-purpose', description: 'Write SQL migration', name: 'sql-worker', parentId: 'lead1' }, 1100)

    const g = buildFlowGraph(s, 1500)
    assert.equal(g.pattern, 'hierarchical')
    assert.equal(g.tiers.length, 3)
    assert.equal(g.tiers[1]?.nodes[0]?.id, 'lead1')
    assert.equal(g.tiers[1]?.nodes[0]?.role, 'lead')
    assert.equal(g.tiers[2]?.nodes[0]?.id, 'child1')
    assert.equal(g.tiers[2]?.nodes[0]?.parentId, 'lead1')
  })

  it('tracks peer-to-peer SendMessage channels in an agent team mesh', () => {
    let s = emptyState()
    s = onSpawn(s, { id: 't1', type: 'general-purpose', description: 'Frontend teammate', name: 'fe-peer', isTeammate: true }, 1000)
    s = onSpawn(s, { id: 't2', type: 'general-purpose', description: 'Backend teammate', name: 'be-peer', isTeammate: true }, 1010)

    // t1 sends a peer message directly to t2
    s = onSend(s, 't2', 'Updated GraphQL schema types', true, 1200, 't1')

    const g = buildFlowGraph(s, 1300)
    assert.equal(g.pattern, 'team-mesh')
    assert.equal(g.flyingCount, 1)
    const peerEdge = g.edges.find(e => e.from === 't1' && e.to === 't2')
    assert.ok(peerEdge)
    assert.equal(peerEdge.kind, 'peer')
    assert.equal(peerEdge.msgCount, 1)
    assert.equal(peerEdge.inFlight, true)

    // Once t2 receives the message, inFlight clears
    s = onReceive(s, 't2', 1400)
    const gAfter = buildFlowGraph(s, 1500)
    assert.equal(gAfter.flyingCount, 0)
  })

  it('detects hybrid multi-CLI topologies when external agents (codex, agy) participate', () => {
    let s = emptyState()
    s = onSpawn(s, { id: 'c1', type: 'general-purpose', description: 'Explore codebase', name: 'explorer' }, 1000)
    s = onSpawn(s, { id: 'ext-1', type: 'codex', description: 'Implement parser in sandbox', name: 'codex' }, 1020)
    s = onExternal(s, 'ext-1', { cli: 'codex', profile: 'codex', label: 'Codex' })

    const g = buildFlowGraph(s, 1500)
    assert.equal(g.pattern, 'hybrid-cli')
    const extNode = g.nodes.find(n => n.id === 'ext-1')
    assert.equal(extNode?.roleBadge, 'CODEX')
  })

  it('infers node roles from explicit declaration, children, or task keywords', () => {
    let s = emptyState()
    s = onSpawn(s, { id: 'a1', type: 'general-purpose', description: 'Adversarial security critic' }, 1000)
    s = onSpawn(s, { id: 'a2', type: 'general-purpose', description: 'Standard worker task' }, 1010)
    const list = Object.values(s.agents)
    assert.equal(inferNodeRole(s.agents['a1']!, list), 'critic')
    assert.equal(inferNodeRole(s.agents['a2']!, list), 'worker')
  })
})
