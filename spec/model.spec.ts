import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentReport, classify, costumeFor, emptyState, isTestCommand, onComplete, onSend, onSpawn, onStep, onToolEnd, onReceive, onToolStart, parseStep, pendingFor, resolveTarget, statusReport, stepReceipt, verifiedCount } from '../src/model.ts'

test('model: costumes differ across three simultaneous general-purpose agents', () => {
  let s = emptyState()
  for (const id of ['a1', 'a2', 'a3']) s = onSpawn(s, { id, type: 'general-purpose', description: id }, 0)
  assert.equal(new Set(Object.values(s.agents).map(a => a.costume)).size, 3)
  assert.equal(costumeFor('Explore', 'x'), 'explore')
})

test('model: classify maps tools to observed activity', () => {
  assert.equal(classify('Read'), 'reading')
  assert.equal(classify('Edit'), 'writing')
  assert.equal(classify('Bash', { command: 'npm test' }), 'testing')
  assert.equal(classify('Bash', { command: 'ls' }), 'walk')
  assert.ok(isTestCommand('node --test tests/'))
  assert.ok(!isTestCommand('echo pytest-free'.replace('pytest', 'x')))
})

test('model: observed vs declared vs verified stay separate', () => {
  let s = onSpawn(emptyState(), { id: 'a1', type: 'general-purpose', description: 'backend' }, 1000)
  s = onToolStart(s, 'a1', 'Edit', { file_path: '/p/a.ts' }, 2000)
  assert.equal(s.agents['a1']?.anim, 'writing')
  assert.deepEqual(s.agents['a1']?.filesModified, [])
  s = onToolEnd(s, 'a1', 'Edit', { file_path: '/p/a.ts' }, false, 2100)
  assert.deepEqual(s.agents['a1']?.filesModified, ['/p/a.ts'])
  s = onToolEnd(s, 'a1', 'Edit', { file_path: '/p/b.ts' }, true, 2200)
  assert.deepEqual(s.agents['a1']?.filesModified, ['/p/a.ts'], 'failed edit is not a modified file')
  assert.equal(s.agents['a1']?.anim, 'error')
  s = onStep(s, 'a1', { plan: ['a', 'b', 'c', 'd', 'e'], done: 4, evidence: [{ stage: 2, proof: 'test passed' }] }, 3000)
  const a = s.agents['a1'] as NonNullable<(typeof s.agents)[string]>
  assert.equal(a.done, 4)
  assert.equal(verifiedCount(a), 1)
  const rep = agentReport(a, s, 4000)
  assert.match(rep, /4\/5 stages declared done/)
  assert.match(rep, /1 of 4 declared-done stage\(s\) carry evidence/)
  assert.doesNotMatch(rep, /80\s?%/)
})

test('model: a report from an agent that never called bus_step says so', () => {
  const s = onSpawn(emptyState(), { id: 'a1', type: 'Explore', description: 'scout' }, 0)
  assert.match(statusReport(s, 5000), /DECLARED {2}nothing/)
})

test('model: blockers drive the blocked animation until cleared', () => {
  let s = onSpawn(emptyState(), { id: 'a1', type: 'Plan', description: 'x' }, 0)
  s = onStep(s, 'a1', { blocker: 'need API key' }, 10)
  assert.equal(s.agents['a1']?.anim, 'blocked')
  s = onToolStart(s, 'a1', 'Read', {}, 20)
  assert.equal(s.agents['a1']?.anim, 'blocked', 'observed activity does not hide a declared blocker')
  s = onStep(s, 'a1', { clear_blocker: true }, 30)
  assert.notEqual(s.agents['a1']?.anim, 'blocked')
})

test('messages: sent -> acknowledged -> applied, FIFO, per agent', () => {
  let s = onSpawn(onSpawn(emptyState(), { id: 'a1', type: 'x', description: 'one' }, 0), { id: 'a2', type: 'x', description: 'two' }, 0)
  s = onSend(s, 'a2', 'change auth', true, 100)
  s = onSend(s, 'a2', 'and rename', true, 110)
  assert.equal(pendingFor(s, 'a1').length, 0)
  assert.equal(pendingFor(s, 'a2').length, 2)
  s = onStep(s, 'a1', { ack: true }, 120)
  assert.equal(s.msgs.every(m => m.ackedAt === undefined), true, 'another agent cannot ack it')
  s = onStep(s, 'a2', { ack: true }, 130)
  assert.equal(s.msgs[0]?.ackedAt, 130)
  assert.equal(s.msgs[1]?.ackedAt, undefined)
  s = onStep(s, 'a2', { applied: true, note: 'switched to JWT' }, 140)
  assert.equal(s.msgs[0]?.appliedAt, 140)
  assert.equal(s.msgs[0]?.ackNote, 'switched to JWT')
})

test('messages: targets resolve by id, name or unique description', () => {
  let s = onSpawn(emptyState(), { id: 'a1', type: 'x', description: 'Backend', name: 'backend' }, 0)
  s = onSpawn(s, { id: 'a2', type: 'x', description: 'Frontend' }, 0)
  assert.equal(resolveTarget(s, 'a1'), 'a1')
  assert.equal(resolveTarget(s, 'backend'), 'a1')
  assert.equal(resolveTarget(s, 'frontend'), 'a2')
  assert.equal(resolveTarget(s, 'nobody'), null)
})

test('model: completion sets status and the celebration/error animation', () => {
  let s = onSpawn(emptyState(), { id: 'a1', type: 'x', description: 'd' }, 0)
  s = onComplete(s, 'a1', { reason: 'answer', tokensIn: 10, tokensOut: 5 }, 50)
  assert.equal(s.agents['a1']?.status, 'done')
  assert.equal(s.agents['a1']?.anim, 'done')
  s = onSpawn(s, { id: 'a2', type: 'x', description: 'd2' }, 0)
  s = onComplete(s, 'a2', { reason: 'error' }, 60)
  assert.equal(s.agents['a2']?.status, 'failed')
})

test('parseStep: ignores junk, keeps valid fields', () => {
  const r = parseStep({ plan: ['a', 3, '', 'b'], done: 1.9, current: 'x', blocker: 5, ack: 'yes', evidence: [{ stage: 1, proof: 'ok' }, { stage: 'x' }, null] })
  assert.deepEqual(r, { plan: ['a', 'b'], done: 1, current: 'x', evidence: [{ stage: 1, proof: 'ok' }] })
})

test('stepReceipt: lists unacknowledged messages for that agent only', () => {
  let s = onSpawn(onSpawn(emptyState(), { id: 'a1', type: 'x', description: 'one' }, 0), { id: 'a2', type: 'x', description: 'two' }, 0)
  s = onSend(s, 'a2', 'change auth', true, 1)
  assert.equal(stepReceipt(s, 'a1'), 'recorded')
  assert.match(stepReceipt(s, 'a2'), /\[m1\] change auth/)
  s = onStep(s, 'a2', { ack: true, applied: true }, 2)
  assert.equal(stepReceipt(s, 'a2'), 'recorded')
})

test('messages: a refused SendMessage is never pending and never acknowledged (regression from the first headless run)', () => {
  let s = onSpawn(emptyState(), { id: 'a1', type: 'x', description: 'beta' }, 0)
  s = onSend(s, 'a1', 'sent by name, refused', false, 1)
  s = onSend(s, 'a1', 'sent by id, accepted', true, 2)
  assert.deepEqual(pendingFor(s, 'a1').map(m => m.id), ['m2'])
  s = onStep(s, 'a1', { ack: true }, 3)
  assert.equal(s.msgs[0]?.ackedAt, undefined)
  assert.equal(s.msgs[1]?.ackedAt, 3)
  assert.doesNotMatch(stepReceipt(s, 'a1'), /refused/)
})

test('messages: delivery is observed separately from acknowledgement and application', () => {
  let s = onSpawn(emptyState(), { id: 'a1', type: 'x', description: 'one' }, 0)
  s = onSend(s, 'a1', 'change auth', true, 10)
  assert.match(agentReport(s.agents['a1'] as never, s, 20), /not yet delivered, not acknowledged, not marked applied/)
  s = onReceive(s, 'a1', 15)
  assert.equal(s.msgs[0]?.receivedAt, 15)
  assert.equal(s.msgs[0]?.ackedAt, undefined)
  assert.match(agentReport(s.agents['a1'] as never, s, 20), /delivered to its loop \[observed\].*not acknowledged/)
  s = onStep(s, 'a1', { ack: true }, 30)
  s = onStep(s, 'a1', { applied: true }, 40)
  assert.match(agentReport(s.agents['a1'] as never, s, 50), /acknowledged by agent \[declared\].*applied\/answered \[declared\]/)
  const other = onReceive(onSend(onSpawn(emptyState(), { id: 'b', type: 'x', description: 'b' }, 0), 'b', 't', false, 1), 'b', 2)
  assert.equal(other.msgs[0]?.receivedAt, undefined, 'a refused message is never "received"')
})
