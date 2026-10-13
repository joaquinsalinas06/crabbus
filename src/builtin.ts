// The built-in crew, written in the same format a user's design files use (see pack.ts and
// skills/design). Copy any of these as a starting point: `/costume export <id>`.
//
// The crab and the costume ideas (astronaut, detective, engineer, chef, racer, pirate) follow
// savvy-progress (JohnnyVizz/claude-kit, MIT), redrawn by hand at this size. See LICENSES/ATTRIBUTION.md.

import { BUILTIN_ORIGIN, compilePack, type Pack } from './pack.ts'

const hx = (n: number): string => `#${n.toString(16).padStart(6, '0')}`

/** A drawing with single pixels at card coordinates, as rows from the top of the card. */
const dots = (pts: readonly (readonly [number, number])[], ch = 's'): string[] => {
  const h = Math.max(...pts.map(p => p[1])) + 1
  const rows = Array.from({ length: h }, () => Array<string>(18).fill('.'))
  for (const [x, y] of pts) (rows[y] as string[])[x] = ch
  return rows.map(r => r.join('').replace(/\.+$/, ''))
}

const blink16 = { period: 16, at: { 0: { eyes: 'blink' } } }
const legs = { steps: [{ legs: 0 }, { legs: 1 }] }
const four = <T>(a: T, b: T) => [a, a, b, b]

// a full turn: narrowing to the side, the back, the other side, and facing us again with a hop
const SPIN = [
  { width: 1 }, { width: 0.66 }, { width: 0.34 }, { width: 0.34, facingAway: true }, { width: 0.66, facingAway: true }, { width: 1, facingAway: true },
  { width: 0.66, facingAway: true }, { width: 0.34, facingAway: true }, { width: 0.34 }, { width: 0.66 }, { width: 1, jump: 1 }, { width: 1 },
]

/**
 * Football. A variant is a side (the foot that plays), how the ball arrives (rolling in along the
 * floor, or dropping in from a pass), how many juggles, and how the kick flies (high or flat).
 * The right-footed variants are the left-footed ones mirrored, so the ball leaves either way.
 * The director starts one variant of the group at random and, when the kick lands, passes the
 * ball to the next crab, which starts one of the receiving variants.
 */
type Side = 'left' | 'right'
const RECEIVE = ['football-receive-a', 'football-receive-b', 'football-receive-c', 'football-receive-d']
const football = (id: string, group: string, side: Side, arrival: 'roll' | 'drop', touches: number, arc: 'high' | 'flat', when: object[] | undefined) => {
  const entry: [number, number][] = arrival === 'roll' ? [[-3, 10], [-2, 10], [-1, 10], [0, 10]] : [[-2, -2], [0, 1], [1, 4], [0, 7]]
  const juggle: [number, number][] = [[0, 10], [0, 7], [0, 4], [0, 3], [0, 5], [0, 8]]
  const flight: [number, number][] = arc === 'high' ? [[3, 6], [7, 2], [11, 0], [15, 1], [18, 3], [21, 6]] : [[3, 8], [7, 6], [11, 5], [15, 6], [18, 8], [21, 10]]
  const left = [...entry, ...Array.from({ length: touches }, () => juggle).flat(), [0, 10] as [number, number], ...flight]
  const path = side === 'left' ? left : left.map(([x, y]) => [15 - x, y] as [number, number])
  const kickAt = entry.length + touches * 6
  const kicks = new Set([...Array.from({ length: touches }, (_, i) => entry.length + i * 6), kickAt])
  const toward = side === 'left' ? 'right' : 'left'
  const away = side === 'left' ? 'left' : 'right'
  return {
    type: 'action', id, label: '⚽ playing', color: hx(0x3fb96b),
    ...(when ? { when } : {}),
    play: { ticks: path.length + 1, group, pass: { atTick: kickAt + 4, to: RECEIVE } },
    pose: [{
      steps: [
        ...path.map((_, t) =>
          kicks.has(t) ? { kick: side, eyes: away, ...(side === 'left' ? { rightArm: 1 } : { leftArm: 1 }) }
          : t > kickAt ? { eyes: toward, leftArm: 1, rightArm: 1 }
          : { eyes: t % 6 < 3 ? 'up' : away, bob: t % 2 }),
        { eyes: toward },
      ],
    }],
    effect: [{
      drawings: { b: ['gwg', 'wkw', 'gwg'] },
      palette: { g: hx(0xa9adb3), w: hx(0xf4f3ee), k: hx(0x2a2a2e) },
      leaves: true,
      anim: { '*': [{ steps: [...path.map(([x, y]) => ({ x, y })), { hidden: true }] }] },
    }],
  }
}
const KICKOFF = [{ state: 'finished' }, { state: 'thinking', chance: 0.02 }]
const FOOTBALL = [
  football('football-a', 'football', 'left', 'roll', 2, 'high', KICKOFF),
  football('football-b', 'football', 'right', 'roll', 1, 'flat', KICKOFF),
  football('football-c', 'football', 'left', 'roll', 3, 'flat', KICKOFF),
  football('football-d', 'football', 'right', 'roll', 2, 'high', KICKOFF),
  football('football-receive-a', 'receive', 'left', 'drop', 1, 'high', undefined),
  football('football-receive-b', 'receive', 'right', 'drop', 2, 'flat', undefined),
  football('football-receive-c', 'receive', 'left', 'drop', 2, 'flat', undefined),
  football('football-receive-d', 'receive', 'right', 'drop', 1, 'high', undefined),
]

// ---- actions: what the crab does, from what the hooks saw

const ACTIONS = [
  {
    type: 'action', id: 'walk', label: '● working', color: hx(0x9aa0a8), priority: 5,
    when: [{ state: 'working' }, { state: 'starting' }],
    pose: [{ steps: [{ bob: 0, legs: 0 }, { bob: 1, legs: 1 }] }, blink16],
  },
  {
    type: 'action', id: 'reading', label: '◉ reading', color: hx(0x5b9cf0), priority: 50,
    when: { tool: 'Read|Grep|Glob|WebFetch|WebSearch' },
    pose: [{ fixed: { leftArm: 1 } }, legs, { steps: [...Array(4).fill({ eyes: 'left' }), ...Array(4).fill({ eyes: 'right' })] }, blink16],
    hand: 'left',
    effect: [{ pos: [0, 5], drawings: { a: ['bbb', 'bwb', 'bbb'], b: ['bbb', 'wbb', 'bbb'] }, palette: { b: hx(0x3b6fb6), w: hx(0xf4f3ee) }, anim: { '*': [{ steps: four({ d: 'a' }, { d: 'b' }) }] } }],
  },
  {
    type: 'action', id: 'writing', label: '✎ writing', color: hx(0xf5c542), priority: 50,
    when: { tool: 'Edit|Write|MultiEdit|NotebookEdit' },
    pose: [{ fixed: { eyes: 'right' } }, { steps: [{ bob: 0, rightArm: 0 }, { bob: 1, rightArm: 1 }] }, blink16],
    hand: 'right',
    effect: [
      { pos: [15, 2], drawings: { a: ['..k', '.y.', 'y..'] }, palette: { k: hx(0x2a2a2e), y: hx(0xf5c542) }, anim: { '*': [{ steps: [{}, { y: 1 }] }] } },
      { pos: [14, 11], drawings: { a: ['y'] }, palette: { y: hx(0xf5c542) }, anim: { '*': [{ steps: [{}, { hidden: true }, { hidden: true }] }] } },
    ],
  },
  {
    type: 'action', id: 'testing', label: '⚗ testing', color: hx(0x3fb96b), priority: 55,
    when: {
      tool: 'Bash',
      input: '\\b(pytest|vitest|jest|mocha|ava|tap|phpunit|rspec|go test|cargo test|npm (run )?test|pnpm (run )?test|yarn test|bun test|node --test|deno test|swift test|claude plugin test)\\b',
    },
    pose: [{ fixed: { leftArm: 1, eyes: 'left' } }, legs, blink16],
    hand: 'left',
    effect: [
      { pos: [0, 4], drawings: { a: ['.n.', 'fff', 'fGf', 'fff'] }, palette: { n: hx(0xc9ccd2), f: hx(0x2ea05a), G: hx(0x7ee2a0) } },
      { pos: [1, 3], drawings: { a: ['g'] }, palette: { g: hx(0x7ee2a0) }, free: true, anim: { '*': [{ steps: [{}, { y: -1 }, { y: -2 }] }] } },
    ],
  },
  {
    type: 'action', id: 'thinking', label: '… thinking', color: hx(0xb7b3ff), priority: 10,
    when: { state: 'thinking' },
    pose: [{ fixed: { rightArm: 1, eyes: 'up' } }, { period: 12, at: { 0: { eyes: 'blink' }, 1: { eyes: 'blink' } } }],
    effect: [{
      drawings: { n1: dots([[15, 5]]), n2: dots([[15, 5], [16, 3]]), n3: dots([[15, 5], [16, 3], [17, 1]]) },
      palette: { s: hx(0xb7b3ff) },
      anim: { '*': [{ steps: [{ d: 'n1' }, { d: 'n1' }, { d: 'n2' }, { d: 'n2' }, { d: 'n3' }, { d: 'n3' }, { d: 'n3' }, { d: 'n3' }] }] },
    }],
  },
  {
    type: 'action', id: 'blocked', label: '⚠ blocked', color: hx(0xe5484d), priority: 90,
    when: { state: 'blocked' },
    pose: [{ steps: [...Array(3).fill({ eyes: 'left' }), ...Array(3).fill({ eyes: 'right' })] }],
    effect: [
      { pos: [16, 0], drawings: { a: ['r', 'r', 'r', '.', 'r'] }, palette: { r: hx(0xe5484d) }, anim: { '*': [{ steps: [{}, {}, {}, { hidden: true }] }] } },
      { pos: [2, 6], drawings: { a: ['w'] }, palette: { w: hx(0x66b3ff) }, anim: { '*': [{ steps: [{}, { y: 1 }, { y: 2 }] }] } },
    ],
  },
  {
    type: 'action', id: 'error', label: '✗ error', color: hx(0xe5484d), priority: 40,
    when: [{ state: 'failed' }, { state: 'error' }],
    // shivers in place: a sideways shake would push what the crab holds at the card's edge off it
    pose: [{ fixed: { eyes: 'red' } }, { steps: [{ bob: 0 }, { bob: 1 }] }],
    effect: [{
      pos: [8, 0],
      drawings: { s0: ['.k.', 'g..'], s1: ['.k.', '.g.'], s2: ['.k.', '..g'] },
      palette: { k: hx(0x6b6b6b), g: hx(0x8b8b8b) },
      anim: { '*': [{ steps: [{ d: 's0' }, { d: 's1' }, { d: 's2' }] }] },
    }],
  },
  {
    type: 'action', id: 'done', label: '✓ done', color: hx(0x3fb96b), priority: 99,
    when: { state: 'finished' },
    pose: [{ fixed: { leftArm: 1, rightArm: 1 } }, { steps: [{ jump: 0, eyes: 'open' }, { jump: 1, eyes: 'up' }] }],
    effect: [{
      drawings: { f0: dots([[1, 1], [16, 3]]), f1: dots([[3, 0], [15, 1], [0, 5]]), f2: dots([[17, 0], [2, 3]]), f3: dots([[14, 0], [1, 2], [17, 5]]) },
      palette: { s: hx(0xfff3b0) },
      anim: { '*': [{ steps: [{ d: 'f0' }, { d: 'f1', palette: { s: hx(0xf5c542) } }, { d: 'f2' }, { d: 'f3', palette: { s: hx(0xf5c542) } }] }] },
    }],
  },
  {
    type: 'action', id: 'sleep', label: '✓ asleep', color: hx(0x7d8590), priority: 100,
    when: { state: 'asleep' },
    pose: [{ fixed: { bob: 1, eyes: 'shut' } }],
    dim: 0.35,
    effect: [{
      drawings: {
        z1: dots([[14, 4], [15, 4], [15, 5], [14, 6], [15, 6]]),
        z2: dots([[14, 4], [15, 4], [15, 5], [14, 6], [15, 6], [16, 2]]),
        z3: dots([[14, 4], [15, 4], [15, 5], [14, 6], [15, 6], [16, 2], [17, 0]]),
      },
      palette: { s: hx(0x8b949e) },
      anim: { '*': [{ every: 2, steps: [{ hidden: true }, { d: 'z1' }, { d: 'z2' }, { d: 'z3' }] }] },
    }],
  },
  // ---- plays: one-shot, started by the director when their condition becomes true (see director.ts)
  {
    type: 'action', id: 'spin', label: '↻ spin', color: hx(0xf5c542),
    when: [{ state: 'finished' }, { state: 'tests-ok' }],
    play: { ticks: 12 },
    pose: [
      { fixed: { leftArm: 1, rightArm: 1, eyes: 'up' } },
      { steps: SPIN },
    ],
    effect: [{ pos: [0, 0], drawings: { a: dots([[1, 2], [16, 2], [0, 6], [17, 6]]) }, palette: { s: hx(0xfff3b0) }, free: true, anim: { '*': [{ steps: [...Array(9).fill({ hidden: true }), {}, {}, {}] }] } }],
  },
  ...FOOTBALL,
  // the master's two moods: chosen by the scene, never by a rule
  {
    type: 'action', id: 'master.busy', label: 'master', color: hx(0xd97757), priority: 0,
    pose: [
      { steps: [{ leftArm: 1, bob: 0 }, { leftArm: 1, bob: 1 }, { leftArm: 0, bob: 0 }, { leftArm: 0, bob: 1 }] },
      { steps: [...Array(5).fill({ eyes: 'left' }), ...Array(5).fill({ eyes: 'open' })] },
      { period: 20, at: { 0: { eyes: 'blink' } } },
    ],
  },
  // free, the master is never still: a slow bob, a look around, now and then a wave
  {
    type: 'action', id: 'master.free', label: 'master', color: hx(0xd97757), priority: 0,
    pose: [
      { every: 3, steps: [{ bob: 0 }, { bob: 1 }] },
      { steps: [...Array(8).fill({ eyes: 'open' }), ...Array(4).fill({ eyes: 'left' }), ...Array(6).fill({ eyes: 'open' }), ...Array(4).fill({ eyes: 'right' })] },
      { period: 36, at: { 24: { rightArm: 1 }, 25: { rightArm: 0 }, 26: { rightArm: 1 }, 27: { rightArm: 0 } } },
      { period: 20, at: { 0: { eyes: 'blink' } } },
    ],
  },
  // the master's idle plays: started by the director at random moments (director.ts MASTER_IDLE), never by a rule
  {
    type: 'action', id: 'master.hop', label: 'master', color: hx(0xd97757), priority: 0, play: { ticks: 8 },
    pose: [{ steps: [{ jump: 0 }, { jump: 1, leftArm: 1, rightArm: 1 }, { jump: 1, leftArm: 1, rightArm: 1, eyes: 'up' }, { jump: 0 }, { jump: 1, leftArm: 1, rightArm: 1 }, { jump: 1, leftArm: 1, rightArm: 1, eyes: 'up' }, { jump: 0 }, { jump: 0 }] }],
  },
  {
    type: 'action', id: 'master.wave', label: 'master', color: hx(0xd97757), priority: 0, play: { ticks: 12 },
    pose: [{ steps: [{ rightArm: 1, eyes: 'right' }, { rightArm: 0, eyes: 'right' }, { rightArm: 1, eyes: 'right' }, { rightArm: 0 }, { rightArm: 1 }, { rightArm: 0 }, { leftArm: 1, eyes: 'left' }, { leftArm: 0, eyes: 'left' }, { leftArm: 1, eyes: 'left' }, { leftArm: 0 }, { eyes: 'blink' }, {}] }],
  },
  {
    type: 'action', id: 'master.dance', label: 'master', color: hx(0xd97757), priority: 0, play: { ticks: 12 },
    pose: [{ steps: [
      { leftArm: 1, legs: 0, eyes: 'left' }, { bob: 1 }, { rightArm: 1, legs: 1, eyes: 'right' }, { bob: 1 },
      { leftArm: 1, legs: 0, eyes: 'left' }, { bob: 1 }, { rightArm: 1, legs: 1, eyes: 'right' }, { bob: 1 },
      { jump: 1, leftArm: 1, rightArm: 1, eyes: 'up' }, { jump: 0, leftArm: 1, rightArm: 1 }, { eyes: 'blink' }, {},
    ] }],
  },
]

// ---- pieces: drawn where they sit on the resting crab (head top at card row 6)

const PIECES = [
  {
    type: 'piece', id: 'astronaut-helmet', name: 'astronaut helmet', slot: 'head', anchor: 'head',
    layers: [{
      pos: [0, 1],
      drawings: { a: ['.........a', '.....GGGGGGGG.....', '....GgwggggggG....', '...GgwggggggggG...', '...GggggggggggG...'] },
      palette: { G: hx(0xc9ccd2), g: hx(0x4f6d8a), w: hx(0xdff2ff), a: hx(0x7f77dd) },
      anim: { '*': [{ steps: [{}, {}, { palette: { a: hx(0xf5c542) } }, { palette: { a: hx(0xf5c542) } }] }], sleep: [] },
    }],
  },
  {
    type: 'piece', id: 'star', name: 'star', slot: 'trim', anchor: 'card', free: true,
    layers: [{
      pos: [15, 1], drawings: { a: ['.s.', 's.s', '.s.'] }, palette: { s: hx(0xf5c542) },
      anim: { '*': [{ steps: [{}, {}, {}, { hidden: true }, { hidden: true }, { hidden: true }] }], sleep: [{ fixed: { hidden: true } }] },
    }],
  },
  {
    type: 'piece', id: 'detective-hat', name: 'deerstalker', slot: 'head', anchor: 'head',
    layers: [{
      pos: [0, 1],
      drawings: { a: ['......dddddd......', '....ddcddcdddd....', '...dddddddddddd...', '..DDDDDDDDDDDDDD..', '...TTTTTTTTTTTT...'] },
      palette: { d: hx(0x7a4a26), c: hx(0xa0703f), D: hx(0x5a3519), T: hx(0xd85a30) },
    }],
  },
  {
    type: 'piece', id: 'magnifier', name: 'magnifying glass', slot: 'hand.right', anchor: 'body', coversAction: ['reading'],
    layers: [{
      pos: [14, 4],
      drawings: { a: ['.kk.', 'kllk', 'kllk', '.kk.', '..h.', '..h.'] },
      palette: { k: hx(0x4a4a4c), l: hx(0xa9d6f5), h: hx(0x7a4a26) },
      anim: {
        reading: [{ steps: [{ x: 0, y: 0 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 1 }] }, { period: 8, at: { 0: { palette: { l: '#ffffff' } } } }],
        '*': [{ period: 8, at: { 0: { palette: { l: '#ffffff' } } } }],
      },
    }],
  },
  {
    type: 'piece', id: 'hard-hat', name: 'hard hat', slot: 'head', anchor: 'head',
    layers: [{
      pos: [0, 1],
      drawings: { a: ['.......hh.........', '.....yyhhyyy......', '....yyyhhyyyy.....', '....yyyhhyyyy.....', '..YYYYYYYYYYYYYY..'] },
      palette: { y: hx(0xf5c542), h: hx(0xfbe08a), Y: hx(0xc99a1e) },
    }],
  },
  {
    type: 'piece', id: 'wrench', name: 'wrench', slot: 'hand.left', anchor: 'body',
    layers: [{
      pos: [0, 3],
      drawings: { a: ['.s.s', '.sss', '.s..', '.s..'], b: ['s.s.', 'sss.', '.s..', '.s..'] },
      palette: { s: hx(0x9aa0a8) },
      anim: { writing: [{ steps: [{ d: 'a' }, { d: 'b' }] }], testing: [{ steps: [{ d: 'a' }, { d: 'b' }] }], walk: [{ steps: [{ d: 'a' }, { d: 'b' }] }] },
    }],
  },
  {
    type: 'piece', id: 'chef-hat', name: 'chef toque', slot: 'head', anchor: 'head',
    layers: [{
      pos: [0, 1],
      drawings: { a: ['.....owwwwwwo.....', '.....owgwwgwo.....', '......owwwwo......', '......owwwwo......', '....TTTTTTTTTT....'] },
      palette: { w: hx(0xf4f3ee), g: hx(0xd2d1c8), o: hx(0xa9a79d), T: hx(0x378add) },
    }],
  },
  {
    type: 'piece', id: 'pan', name: 'frying pan with egg', slot: 'hand.right', anchor: 'body',
    layers: [
      { pos: [14, 6], drawings: { a: ['pppp', '...p'] }, palette: { p: hx(0x5a5a58) } },
      { pos: [15, 5], drawings: { a: ['oo'] }, palette: { o: hx(0xf5b731) }, free: true, anim: { '*': [{ steps: [{}, { y: -1 }, { y: -3 }, { y: -4 }, { y: -3 }, { y: -1 }] }], sleep: [] } },
    ],
  },
  {
    type: 'piece', id: 'pilot-helmet', name: 'racing helmet', slot: 'head', anchor: 'head',
    layers: [{
      pos: [0, 1],
      drawings: { a: ['......TTwwTT......', '....TTTTwwTTTT....', '...TTTTTwwTTTTT...', '...TTTTTwwTTTTT...', '...VVVVVVVVVVVV...'] },
      palette: { T: hx(0x1d9e75), w: hx(0xf8f6f1), V: hx(0x2a2a2e) },
    }],
  },
  {
    type: 'piece', id: 'flag', name: 'checkered flag', slot: 'behind', anchor: 'card', free: true,
    layers: [{
      pos: [14, 0],
      drawings: {
        a: ['WKWp', 'KWKp', '...p', '...p', '...p', '...p', '...p', '...p'],
        b: ['.WKp', 'KKWp', 'W..p', '...p', '...p', '...p', '...p', '...p'],
      },
      palette: { W: hx(0xf8f6f1), K: hx(0x2a2a2e), p: hx(0x9aa0a8) },
      anim: { '*': [{ steps: [{ d: 'a' }, { d: 'b' }] }], sleep: [] },
    }],
  },
  {
    type: 'piece', id: 'pirate-hat', name: 'tricorne', slot: 'head', anchor: 'head',
    layers: [{
      pos: [0, 2],
      drawings: { a: ['...kk........kk...', '...kkk..kk..kkk...', '....kkkkwwkkkk....', '...gggggggggggg...'] },
      palette: { k: hx(0x3d3a36), w: hx(0xf8f6f1), g: hx(0xf5c542) },
    }],
  },
  {
    type: 'piece', id: 'eyepatch', name: 'eyepatch', slot: 'face.eyes', anchor: 'face', coversEyes: true,
    layers: [{ pos: [10, 6], drawings: { a: ['k...', '.k..', '..kk', '..kk'] }, palette: { k: hx(0x232326) } }],
  },
  {
    // held by the right claw: it rises with the claw when the pirate cheers
    type: 'piece', id: 'cutlass', name: 'cutlass', slot: 'hand.right', anchor: 'claw.right',
    layers: [{
      pos: [15, 3],
      drawings: { a: ['..b', '..b', '..b', '..b', '..b', 'hgh'], b: ['..b', '..b', '.b.', '.b.', '.b.', 'hgh'] },
      palette: { b: hx(0xd8dce2), h: hx(0x7a4a26), g: hx(0xc9a227) },
      anim: { '*': [{ steps: four({ d: 'a' }, { d: 'b' }) }], sleep: [{ fixed: { d: 'b' } }] },
    }],
  },
  {
    type: 'piece', id: 'propeller-cap', name: 'propeller cap', slot: 'head', anchor: 'head',
    layers: [
      { pos: [0, 2], drawings: { a: ['.......bkb'], b: ['......bbkbb'] }, palette: { b: hx(0x4ea0ff), k: hx(0x3a3a3c) }, anim: { '*': [{ steps: [{ d: 'a' }, { d: 'b' }] }], sleep: [], blocked: [] } },
      { pos: [0, 3], drawings: { a: ['........k.........', '......rryybb......', '.....rrryybbb.....'] }, palette: { k: hx(0x3a3a3c), r: hx(0xe5484d), y: hx(0xf5c542), b: hx(0x4ea0ff) } },
    ],
  },
  {
    type: 'piece', id: 'crown', name: 'crown', slot: 'head', anchor: 'head',
    layers: [{
      pos: [0, 3],
      drawings: { a: ['.....y..Gy..y.....', '.....yyyyyyyy.....', '.....yryyyybyy....'] },
      palette: { y: hx(0xf5c542), G: hx(0xf5c542), r: hx(0xe5484d), b: hx(0x4ea0ff) },
      anim: { '*': [{ period: 10, at: { 0: { palette: { G: '#ffffff' } } } }] },
    }],
  },
  {
    type: 'piece', id: 'headset-mic', name: 'headset microphone', slot: 'face.mouth', anchor: 'head',
    layers: [{ pos: [15, 5], drawings: { a: ['k..', '.k.', '..m'] }, palette: { k: hx(0x3a3a3c), m: hx(0x9aa0a8) } }],
  },
]

// ---- costumes

const COSTUMES = [
  { type: 'costume', id: 'fable', name: 'astronaut', color: hx(0x7f77dd), pieces: ['astronaut-helmet', 'star'] },
  { type: 'costume', id: 'heavy', name: 'detective', color: hx(0xd85a30), pieces: ['detective-hat', 'magnifier'] },
  { type: 'costume', id: 'careful', name: 'engineer', color: hx(0xba7517), pieces: ['hard-hat', 'wrench'] },
  { type: 'costume', id: 'medium', name: 'chef', color: hx(0x378add), pieces: ['chef-hat', 'pan'] },
  { type: 'costume', id: 'light', name: 'pilot', color: hx(0x1d9e75), pieces: ['pilot-helmet', 'flag'] },
  { type: 'costume', id: 'explore', name: 'pirate', color: hx(0x9a8f80), pieces: ['pirate-hat', 'eyepatch', 'cutlass'] },
  { type: 'costume', id: 'other', name: 'propeller', color: hx(0x888780), pieces: ['propeller-cap'] },
  { type: 'costume', id: 'master', name: 'master', color: hx(0xd97757), pieces: ['crown', 'headset-mic'] },
]

// ---- wardrobe: savvy-flow tiers always get their own costume; known types get theirs when free

const RULES = {
  type: 'rules',
  active: ['fable', 'heavy', 'careful', 'medium', 'light', 'explore'],
  rules: [
    ...['fable', 'heavy', 'careful', 'medium', 'light'].map(t => ({ if: { type: `${t}$` }, costume: t })),
    { if: { type: '^Explore$' }, costume: 'explore', ifFree: true },
    { if: { type: '^Plan$' }, costume: 'heavy', ifFree: true },
    { if: { type: '^general-purpose$' }, costume: 'medium', ifFree: true },
    { if: { type: '^claude-code-guide$' }, costume: 'fable', ifFree: true },
    { if: { type: '^statusline-setup$' }, costume: 'careful', ifFree: true },
  ],
}

export const BUILTIN_ITEMS: readonly unknown[] = [...ACTIONS, ...PIECES, ...COSTUMES, RULES]

export const BUILTIN: Pack = compilePack([{ file: BUILTIN_ORIGIN, json: { type: 'bundle', items: BUILTIN_ITEMS } }])
