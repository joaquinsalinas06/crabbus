// Native low-resolution pixel art for the terminal. Pure: no `$`, no Node.
//
// One terminal cell shows two pixels stacked (the upper half block ▀ in the foreground color over
// the lower pixel in the background color), so a sprite drawn here at W x H pixels takes W columns
// and H/2 rows and every pixel keeps its exact color. Cells are about twice as tall as wide, so the
// pixels come out square.
//
// The crab and the costume ideas (astronaut, detective, engineer, chef, racer, pirate) follow
// savvy-progress (JohnnyVizz/claude-kit, MIT), redrawn by hand at this size. See LICENSES/ATTRIBUTION.md.

export type Costume = 'fable' | 'heavy' | 'careful' | 'medium' | 'light' | 'explore' | 'other'
export type Mood =
  | 'walk' // a tool runs, nothing more specific known
  | 'reading'
  | 'writing'
  | 'testing'
  | 'thinking' // between tool calls: the model is generating
  | 'blocked'
  | 'error'
  | 'done'
  | 'sleep' // finished long ago or idle

export const CARD_W = 18
export const CARD_H = 14 // pixels: 7 terminal rows

export const TIER_COLOR: Record<Costume, number> = {
  fable: 0x7f77dd,
  heavy: 0xd85a30,
  careful: 0xba7517,
  medium: 0x378add,
  light: 0x1d9e75,
  explore: 0x9a8f80,
  other: 0x888780,
}

export const CLAY = 0xd97757
const INK = 0x1f1e1d

// ---- canvas

export type Canvas = { width: number; height: number; px: Int32Array } // -1 = transparent

export const canvas = (width: number, height: number): Canvas => ({ width, height, px: new Int32Array(width * height).fill(-1) })

export const set = (c: Canvas, x: number, y: number, color: number): void => {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return
  c.px[y * c.width + x] = color
}

export const get = (c: Canvas, x: number, y: number): number => (x < 0 || y < 0 || x >= c.width || y >= c.height ? -1 : (c.px[y * c.width + x] ?? -1))

export const mix = (a: number, b: number, t: number): number => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** Paints a picture written as strings; `.` and ' ' are transparent, every other letter looks up `pal`. */
export const stamp = (c: Canvas, x: number, y: number, rows: readonly string[], pal: Record<string, number>): void => {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx] as string
      const col = pal[ch]
      if (col !== undefined) set(c, x + dx, y + dy, col)
    }
  })
}

// ---- the crab

export type Pose = {
  bob: number // 0 or 1: body (and hat) one pixel lower
  lift: number // 0..3: whole crab up (jump)
  dx: number // horizontal shake
  legs: 0 | 1 // which leg pair is lifted
  armL: number // 0 down, 1 raised
  armR: number
  eyes: 'open' | 'blink' | 'left' | 'right' | 'up' | 'shut' | 'red'
}

const POSE0: Pose = { bob: 0, lift: 0, dx: 0, legs: 0, armL: 0, armR: 0, eyes: 'open' }

const BODY = [
  '....HHHHHHHHHH....',
  '...HBBBBBBBBBBS...',
  '...BBBBBBBBBBBS...',
  '...BBBBBBBBBBBS...',
  '...BBBBBBBBBBBS...',
  '....SSSSSSSSSS....',
]

const bodyPal = (body: number): Record<string, number> => ({ H: mix(body, 0xffffff, 0.22), B: body, S: mix(body, 0x000000, 0.28) })

/** Draws the bare crab at card origin (ox, oy); returns where its head starts (for the hat). */
const crab = (c: Canvas, ox: number, oy: number, body: number, p: Pose): void => {
  const by = oy + 6 + p.bob - p.lift
  const bx = ox + p.dx
  const pal = bodyPal(body)
  // legs stay on the ground unless jumping
  const ly = oy + 12 - p.lift
  const leg = pal['S'] as number
  for (const [x, up] of [[4, p.legs === 0], [6, p.legs === 1], [11, p.legs === 0], [13, p.legs === 1]] as const) {
    set(c, bx + x, ly, leg)
    if (!up) set(c, bx + x, ly + 1, leg)
  }
  stamp(c, bx, by, BODY, pal)
  // claws: 2x2, raised two pixels when the arm is up
  const claw = pal['B'] as number
  const clawHi = pal['H'] as number
  for (const [x, raised] of [[1, p.armL], [15, p.armR]] as const) {
    const y = by + 2 - raised * 2
    set(c, bx + x, y, clawHi); set(c, bx + x + 1, y, clawHi)
    set(c, bx + x, y + 1, claw); set(c, bx + x + 1, y + 1, claw)
  }
  // eyes: one pixel wide, two tall
  const ex = p.eyes === 'left' ? -1 : p.eyes === 'right' ? 1 : 0
  const ey = p.eyes === 'up' ? -1 : 0
  const col = p.eyes === 'red' ? 0xe5484d : INK
  for (const x of [5, 12]) {
    if (p.eyes === 'blink' || p.eyes === 'shut') set(c, bx + x + ex, by + 3, p.eyes === 'shut' ? mix(body, INK, 0.7) : INK)
    else {
      set(c, bx + x + ex, by + 2 + ey, col)
      set(c, bx + x + ex, by + 3 + ey, col)
    }
  }
}

// ---- costumes: hat drawn over the head, prop beside it. `t` is the agent's own tick.

type Prop = (c: Canvas, ox: number, oy: number, p: Pose, mood: Mood, t: number) => void

const HATS: Record<Costume, Prop> = {
  // astronaut: glass bubble over the head, blinking antenna tip, a star that twinkles
  fable: (c, ox, oy, p, mood, t) => {
    const y = oy + p.bob - p.lift
    const x = ox + p.dx
    const G = 0xc9ccd2
    const glass = 0x4f6d8a
    stamp(c, x, y + 2, [
      '.....GGGGGGGG.....',
      '....GgwggggggG....',
      '...GgwggggggggG...',
      '...GggggggggggG...',
    ], { G, g: glass, w: 0xdff2ff })
    set(c, x + 9, y + 1, mood === 'sleep' || t % 4 < 2 ? TIER_COLOR.fable : 0xf5c542)
    if (mood !== 'sleep' && t % 6 < 3) {
      set(c, ox + 16, oy + 1, 0xf5c542); set(c, ox + 15, oy + 2, 0xf5c542); set(c, ox + 17, oy + 2, 0xf5c542); set(c, ox + 16, oy + 3, 0xf5c542)
    }
  },
  // detective: deerstalker with a tier-color band, magnifier that sweeps while reading
  heavy: (c, ox, oy, p, mood, t) => {
    const y = oy + p.bob - p.lift
    const x = ox + p.dx
    stamp(c, x, y + 1, [
      '......dddddd......',
      '....ddcddcdddd....',
      '...dddddddddddd...',
      '..DDDDDDDDDDDDDD..',
      '...TTTTTTTTTTTT...',
    ], { d: 0x7a4a26, c: 0xa0703f, D: 0x5a3519, T: TIER_COLOR.heavy })
    const sweep = mood === 'reading' ? [0, -1, -1, 0][t % 4] ?? 0 : 0
    const mx = ox + 14 + sweep
    const my = y + 4 + (mood === 'reading' ? (t % 2) : 0)
    stamp(c, mx, my, ['.kk.', 'kllk', 'kllk', '.kk.', '..h.', '..h.'], { k: 0x4a4a4c, l: t % 8 === 0 ? 0xffffff : 0xa9d6f5, h: 0x7a4a26 })
  },
  // engineer: hard hat; the wrench turns while writing or testing
  careful: (c, ox, oy, p, mood, t) => {
    const y = oy + p.bob - p.lift
    const x = ox + p.dx
    stamp(c, x, y + 1, [
      '.......hh.........',
      '.....yyhhyyy......',
      '....yyyhhyyyy.....',
      '....yyyhhyyyy.....',
      '..YYYYYYYYYYYYYY..',
    ], { y: 0xf5c542, h: 0xfbe08a, Y: 0xc99a1e })
    const turn = (mood === 'writing' || mood === 'testing' || mood === 'walk') && t % 2 === 1
    stamp(c, x, y + 3, turn ? ['s.s.', 'sss.', '.s..', '.s..'] : ['.s.s', '.sss', '.s..', '.s..'], { s: 0x9aa0a8 })
  },
  // chef: toque with a band; the egg flips above the pan
  medium: (c, ox, oy, p, mood, t) => {
    const y = oy + p.bob - p.lift
    const x = ox + p.dx
    stamp(c, x, y + 1, [
      '.....owwwwwwo.....',
      '.....owgwwgwo.....',
      '......owwwwo......',
      '......owwwwo......',
      '....TTTTTTTTTT....',
    ], { w: 0xf4f3ee, g: 0xd2d1c8, o: 0xa9a79d, T: TIER_COLOR.medium })
    stamp(c, ox + 14, y + 6, ['pppp', '...p'], { p: 0x5a5a58 })
    const flip = mood === 'sleep' ? 0 : [0, 1, 3, 4, 3, 1][t % 6] ?? 0
    stamp(c, ox + 15, y + 5 - flip, ['oo'], { o: 0xf5b731 })
  },
  // racer: helmet with stripe and visor; checkered flag that flutters
  light: (c, ox, oy, p, mood, t) => {
    const y = oy + p.bob - p.lift
    const x = ox + p.dx
    stamp(c, x, y + 1, [
      '......TTwwTT......',
      '....TTTTwwTTTT....',
      '...TTTTTwwTTTTT...',
      '...TTTTTwwTTTTT...',
      '...VVVVVVVVVVVV...',
    ], { T: TIER_COLOR.light, w: 0xf8f6f1, V: 0x2a2a2e })
    const W = 0xf8f6f1
    const K = 0x2a2a2e
    for (let r = 0; r < 8; r++) set(c, ox + 17, oy + r, 0x9aa0a8)
    const wave = mood === 'sleep' ? 0 : t % 2
    for (let r = 0; r < 2; r++) for (let q = 0; q < 3; q++) set(c, ox + 14 + q, oy + r + (q === 0 ? wave : 0), (r + q + wave) % 2 === 0 ? W : K)
  },
  // pirate: tricorne with skull, eye patch, a cutlass that fences
  explore: (c, ox, oy, p, mood, t) => {
    const y = oy + p.bob - p.lift
    const x = ox + p.dx
    stamp(c, x, y + 1, [
      '...kk........kk...',
      '...kkk..kk..kkk...',
      '....kkkkwwkkkk....',
      '...gggggggggggg...',
    ], { k: 0x3d3a36, w: 0xf8f6f1, g: 0xf5c542 })
    // patch over the right eye with its strap
    // eye patch over the right eye, strap up to the hat
    stamp(c, x + 10, y + 6, ['k...', '.k..', '..kk', '..kk'], { k: 0x232326 })
    // cutlass: the blade tilts forward and back
    const lunge = mood !== 'sleep' && t % 4 < 2
    const blade = 0xd8dce2
    if (lunge) for (let r = 0; r < 5; r++) set(c, ox + 17 - (r < 2 ? 0 : 0), oy + 3 + r, blade)
    else for (let r = 0; r < 5; r++) set(c, ox + 16 + (r < 2 ? 1 : 0), oy + 2 + r, blade)
    set(c, ox + 15, oy + 8, 0x7a4a26); set(c, ox + 16, oy + 8, 0xc9a227); set(c, ox + 17, oy + 8, 0x7a4a26)
  },
  // everyone else: a propeller beanie whose propeller spins while working
  other: (c, ox, oy, p, mood, t) => {
    const y = oy + p.bob - p.lift
    const x = ox + p.dx
    const spin = mood === 'sleep' || mood === 'blocked' ? 0 : t % 2
    stamp(c, x, y + 2, spin ? ['......bbkbb.......'] : ['.......bkb........'], { b: 0x4ea0ff, k: 0x3a3a3c })
    stamp(c, x, y + 3, [
      '........k.........',
      '......rryybb......',
      '.....rrryybbb.....',
    ], { k: 0x3a3a3c, r: 0xe5484d, y: 0xf5c542, b: 0x4ea0ff })
  },
}

// ---- activity effects (CrabBus's own), drawn around the crab

const effect = (c: Canvas, ox: number, oy: number, mood: Mood, t: number, costume: Costume): void => {
  switch (mood) {
    case 'thinking': {
      const n = t % 8 < 2 ? 1 : t % 8 < 4 ? 2 : 3
      const dots: [number, number][] = [[15, 5], [16, 3], [17, 1]]
      dots.slice(0, n).forEach(([x, y]) => set(c, ox + x, oy + y, 0xb7b3ff))
      break
    }
    case 'reading': {
      if (costume === 'heavy') break // the magnifier does it
      const page = t % 4 < 2
      stamp(c, ox, oy + 5, ['bbb', page ? 'bwb' : 'wbb', 'bbb'], { b: 0x3b6fb6, w: 0xf4f3ee })
      break
    }
    case 'writing': {
      const up = t % 2
      stamp(c, ox + 15, oy + 2 + up, ['..k', '.y.', 'y..'], { k: 0x2a2a2e, y: 0xf5c542 })
      if (t % 3 === 0) set(c, ox + 14, oy + 11, 0xf5c542)
      break
    }
    case 'testing': {
      stamp(c, ox, oy + 4, ['.n.', 'fff', 'fGf', 'fff'], { n: 0xc9ccd2, f: 0x2ea05a, G: 0x7ee2a0 })
      const b = t % 3
      set(c, ox + 1, oy + 3 - b, 0x7ee2a0)
      break
    }
    case 'blocked': {
      if (t % 4 < 3) {
        for (const y of [0, 1, 2]) set(c, ox + 16, oy + y, 0xe5484d)
        set(c, ox + 16, oy + 4, 0xe5484d)
      }
      set(c, ox + 2, oy + 6 + (t % 3), 0x66b3ff)
      break
    }
    case 'error': {
      const s = t % 3
      set(c, ox + 8 + s, oy + 1, 0x8b8b8b); set(c, ox + 9, oy + 0, 0x6b6b6b)
      break
    }
    case 'done': {
      const sparks: [number, number][][] = [[[1, 1], [16, 3]], [[3, 0], [15, 1], [0, 5]], [[17, 0], [2, 3]], [[14, 0], [1, 2], [17, 5]]]
      for (const [x, y] of sparks[t % 4] ?? []) set(c, ox + x, oy + y, t % 2 ? 0xf5c542 : 0xfff3b0)
      break
    }
    case 'sleep': {
      const z = Math.floor(t / 2) % 4
      const Z = 0x8b949e
      if (z >= 1) stamp(c, ox + 14, oy + 4, ['zz', '.z', 'zz'], { z: Z })
      if (z >= 2) set(c, ox + 16, oy + 2, Z)
      if (z >= 3) set(c, ox + 17, oy + 0, Z)
      break
    }
    case 'walk':
      break
  }
}

/** The pose a mood implies at tick `t`. */
export const poseFor = (mood: Mood, t: number): Pose => {
  const odd = t % 2 === 1
  const blink = t % 16 === 0
  switch (mood) {
    case 'walk':
      return { ...POSE0, bob: odd ? 1 : 0, legs: odd ? 1 : 0, eyes: blink ? 'blink' : 'open' }
    case 'reading':
      return { ...POSE0, legs: odd ? 1 : 0, armL: 1, eyes: blink ? 'blink' : t % 8 < 4 ? 'left' : 'right' }
    case 'writing':
      return { ...POSE0, bob: odd ? 1 : 0, armR: odd ? 1 : 0, eyes: blink ? 'blink' : 'right' }
    case 'testing':
      return { ...POSE0, armL: 1, legs: odd ? 1 : 0, eyes: blink ? 'blink' : 'left' }
    case 'thinking':
      return { ...POSE0, armR: 1, eyes: t % 12 < 2 ? 'blink' : 'up' }
    case 'blocked':
      return { ...POSE0, eyes: t % 6 < 3 ? 'left' : 'right' }
    case 'error':
      return { ...POSE0, dx: odd ? 1 : 0, eyes: 'red' }
    case 'done':
      return { ...POSE0, lift: odd ? 1 : 0, armL: 1, armR: 1, eyes: odd ? 'up' : 'open' }
    case 'sleep':
      return { ...POSE0, bob: 1, eyes: 'shut' }
  }
}

/** One agent card at (ox, oy): the crab, its costume, the activity effect. */
export const drawAgent = (c: Canvas, ox: number, oy: number, costume: Costume, mood: Mood, t: number): void => {
  const p = poseFor(mood, t)
  const body = mood === 'sleep' ? mix(CLAY, 0x808080, 0.35) : CLAY
  crab(c, ox, oy, body, p)
  HATS[costume](c, ox, oy, p, mood, t)
  effect(c, ox, oy, mood, t, costume)
}

/** The master: a crowned crab with a headset mic, in Claude's clay. */
export const drawMaster = (c: Canvas, ox: number, oy: number, busy: boolean, t: number): void => {
  const p: Pose = { ...POSE0, armL: busy && t % 4 < 2 ? 1 : 0, eyes: t % 20 === 0 ? 'blink' : busy ? (t % 10 < 5 ? 'left' : 'open') : 'open', bob: busy && t % 2 === 1 ? 1 : 0 }
  crab(c, ox, oy, CLAY, p)
  const y = oy + p.bob
  const glint = t % 10 === 0 ? 0xffffff : 0xf5c542
  stamp(c, ox, y + 2, [
    '.....y..yy..y.....',
    '.....yyyyyyyy.....',
    '.....yryyyybyy....',
  ], { y: 0xf5c542, r: 0xe5484d, b: 0x4ea0ff })
  set(c, ox + 8, y + 2, glint)
  // headset mic on the right
  stamp(c, ox + 15, y + 5, ['k..', '.k.', '..m'], { k: 0x3a3a3c, m: 0x9aa0a8 })
}

/** A 5x4 envelope, paper with a flap in `flap`. */
export const drawEnvelope = (c: Canvas, x: number, y: number, flap: number): void => {
  stamp(c, x, y, ['ppppp', 'pfpfp', 'gpfpg', 'ggggg'], { p: 0xf0f6fc, g: 0x9aa3ad, f: flap })
}

/** "?" bubble for a pending question to the master. */
export const drawQuestion = (c: Canvas, x: number, y: number): void => {
  stamp(c, x, y, ['qqq', '..q', '.q.', '...', '.q.'], { q: 0xd2a8ff })
}

// ---- encoding to Raster cells

export const DEFAULT_COLOR = 0x01000000
const UPPER = 0x2580
const LOWER = 0x2584

/** Half-block cells, row-major u32 triplets [codePoint, fg, bg]; height rounds up to even. */
export const toWords = (c: Canvas): { columns: number; rows: number; words: Uint32Array } => {
  const columns = c.width
  const rows = Math.ceil(c.height / 2)
  const words = new Uint32Array(columns * rows * 3)
  for (let r = 0; r < rows; r++)
    for (let x = 0; x < columns; x++) {
      const top = get(c, x, r * 2)
      const bot = get(c, x, r * 2 + 1)
      const i = (r * columns + x) * 3
      if (top < 0 && bot < 0) {
        words[i] = 0x20; words[i + 1] = DEFAULT_COLOR; words[i + 2] = DEFAULT_COLOR
      } else if (bot < 0) {
        words[i] = UPPER; words[i + 1] = top; words[i + 2] = DEFAULT_COLOR
      } else if (top < 0) {
        words[i] = LOWER; words[i + 1] = bot; words[i + 2] = DEFAULT_COLOR
      } else if (top === bot) {
        words[i] = 0x2588; words[i + 1] = top; words[i + 2] = DEFAULT_COLOR
      } else {
        words[i] = UPPER; words[i + 1] = top; words[i + 2] = bot
      }
    }
  return { columns, rows, words }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const toBase64 = (u8: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < u8.length; i += 3) {
    const a = u8[i] ?? 0
    const b = u8[i + 1] ?? 0
    const c = u8[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += i + 1 < u8.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < u8.length ? B64[n & 63] : '='
  }
  return out
}

export const cellsOf = (c: Canvas): { columns: number; rows: number; cells: string } => {
  const w = toWords(c)
  return { columns: w.columns, rows: w.rows, cells: toBase64(new Uint8Array(w.words.buffer, w.words.byteOffset, w.words.byteLength)) }
}

/** RGBA bytes (for the optional Image path), `scale` pixels per art pixel. */
export const toRgba = (c: Canvas, scale = 1): Uint8Array => {
  const w = c.width * scale
  const h = c.height * scale
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = get(c, Math.floor(x / scale), Math.floor(y / scale))
      if (v < 0) continue
      const i = (y * w + x) * 4
      out[i] = (v >> 16) & 255; out[i + 1] = (v >> 8) & 255; out[i + 2] = v & 255; out[i + 3] = 255
    }
  return out
}
