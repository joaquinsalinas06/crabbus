import { test } from 'node:test'
import assert from 'node:assert/strict'
import CrabClient from '../hooks/crab-client.js'

test('Desktop Client starts exactly one timer across prop updates and only draws server art', () => {
  let timers = 0
  let tick: (() => void) | undefined
  const posts: unknown[] = []
  const surface = {
    state: undefined as { started: boolean } | undefined,
    setState(state: { started: boolean }) { this.state = state },
    every(ms: number, fn: () => void) { assert.equal(ms, 167); timers++; tick = fn; return () => {} },
    post(data: unknown) { posts.push(data) },
  }
  const props = { source: '<svg/>', alt: 'Crab', width: 72, height: 56, ms: 167 }
  assert.deepEqual(CrabClient(props, surface), { type: 'Svg', props: { source: '<svg/>', alt: 'Crab', width: 72, height: 56 } })
  for (let i = 0; i < 10; i++) CrabClient({ ...props, source: `<svg id="${i}"/>` }, surface)
  assert.equal(timers, 1)
  assert.throws(() => CrabClient({ ...props, ms: -1 }, surface), /Invalid animation interval/)
  tick!()
  assert.deepEqual(posts, [{ kind: 'frame' }])
})
