// The panel's palette, states and small text helpers, taken 1:1 from the v3 panel design. Pure: no `$`.

export const C = {
  bg: 0x0f1318,
  card: 0x11151b,
  cardSel: 0x151a21,
  chip: 0x1a2029,
  line: 0x1d232c,
  line2: 0x232a34,
  track: 0x1f2630,
  edge: 0x262e39,
  edgeHi: 0x3a4452,
  text: 0xd7dce4,
  dim: 0x8a93a3,
  faint: 0x5b6472,
  pink: 0xff7da6,
  peach: 0xffab7a,
  yellow: 0xffd68f,
  mint: 0x95e095,
  cyan: 0x4dc4ee,
  lav: 0xb3bcff,
  thought: 0x9aa2cf,
  master: 0xff8a6b,
} as const

// A terminal without truecolor draws 256 colors: the 6x6x6 cube and the gray ramp. Claude Code rounds each
// hex to whichever of them it likes, which is how the design's orange came out pink. Here each color picks
// its nearest entry itself, and the hex it hands on is that entry's exact value, which maps back to it.
const CUBE_STEPS = [0, 95, 135, 175, 215, 255]
const ANSI256: readonly number[] = [
  ...CUBE_STEPS.flatMap(r => CUBE_STEPS.flatMap(g => CUBE_STEPS.map(b => (r << 16) | (g << 8) | b))),
  ...Array.from({ length: 24 }, (_, i) => { const v = 8 + i * 10; return (v << 16) | (v << 8) | v }),
]

let truecolor = true
const snapped = new Map<number, number>()

/** Called once at start: `false` when the terminal does not declare truecolor (no COLORTERM=truecolor|24bit). */
export const setTruecolor = (on: boolean): void => {
  truecolor = on
  snapped.clear()
}

/** The 256-color entry nearest to `n`, by squared distance in RGB. */
export const nearest256 = (n: number): number => {
  const hit = snapped.get(n)
  if (hit !== undefined) return hit
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  let best = ANSI256[0] as number, bestD = Infinity
  for (const c of ANSI256) {
    const dr = ((c >> 16) & 255) - r, dg = ((c >> 8) & 255) - g, db = (c & 255) - b
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) { bestD = d; best = c }
  }
  snapped.set(n, best)
  return best
}

export const hex = (n: number): string => `#${(truecolor ? n : nearest256(n)).toString(16).padStart(6, '0')}`

/** What the panel calls an agent's state (derived from recorded facts in model.ts `uiStatus`). */
export type UiStatus = 'working' | 'thinking' | 'waiting' | 'blocked' | 'done' | 'failed'

export const ORDER: readonly UiStatus[] = ['working', 'thinking', 'waiting', 'blocked', 'done']

// Chip backgrounds keep every channel at or under 25: on a terminal Claude Code draws in 256 colors
// they round to black instead of to the cube's #5f5f5f gray, and in truecolor they are the design's tints.
export const ST: Readonly<Record<UiStatus, { g: string; l: string; c: number; bg: number }>> = {
  working: { g: '●', l: 'working', c: C.mint, bg: 0x0c1910 },
  thinking: { g: '…', l: 'thinking', c: C.lav, bg: 0x111319 },
  waiting: { g: '◔', l: 'waiting', c: C.yellow, bg: 0x19160c },
  blocked: { g: '▲', l: 'blocked', c: C.pink, bg: 0x190d13 },
  done: { g: '✓', l: 'done', c: C.cyan, bg: 0x0a1519 },
  failed: { g: '✗', l: 'failed', c: C.pink, bg: 0x190d13 },
}

export const TOOL_COLOR: Readonly<Record<string, number>> = {
  Bash: C.mint, Read: C.cyan, Edit: C.peach, MultiEdit: C.peach, Grep: C.lav, Glob: C.lav, Task: C.pink, Agent: C.pink,
  Write: C.yellow, SendMessage: C.yellow, WebFetch: C.cyan, WebSearch: C.cyan,
}
export const toolColor = (tool: string): number => TOOL_COLOR[tool] ?? C.dim

export const ctxColor = (pct: number): number => (pct < 50 ? C.mint : pct < 75 ? C.yellow : C.pink)

/** A usage window's short name: five_hour -> "5h", seven_day -> "week", a gateway's spend_limit -> "spend". */
export const limitName = (kind: string): string => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? 'week' : kind === 'spend_limit' ? 'spend' : kind.replace(/_/g, ' '))

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** When a window resets, in local time: "21:10" within the next 24 hours, else "Sat 13:00". */
export const resetClock = (at: number, now: number): string => {
  const d = new Date(at)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return at - now < 24 * 3_600_000 ? hm : `${DAYS[d.getDay()]} ${hm}`
}

/** Time left until a reset: "4d 6h", "2h 13m", "9m"; "now" once it has passed. */
export const untilTxt = (ms: number): string => {
  const m = Math.floor(ms / 60000)
  if (m <= 0) return 'now'
  const d = Math.floor(m / 1440), h = Math.floor(m / 60) % 24
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${pad(m % 60)}m` : `${m}m`
}

/** 182400 -> "182.4k", 1.2e6 -> "1.20M". */
export const fk = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${(n / 1000).toFixed(1)}k`)
/** Dollars; `approx` marks an estimate. Under ten cents a third decimal keeps small spends visible. */
export const fc = (n: number, approx = false): string => `${approx ? '≈' : ''}$${n > 0 && n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`

const mixRgb = (a: number, b: number, t: number): number => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/**
 * A card's background: a neutral gray a step above a dark terminal's. Gray on purpose: in 256 colors a
 * gray lands on the gray ramp, while a tinted dark color becomes the cube's #5f5f5f. The state's color
 * goes on the border instead.
 */
export const CARD_BG = 0x2c2c2c
export const cardBg = (_st: UiStatus, hot = false): number => (hot ? 0x343434 : CARD_BG)
/** A card's border: its state's color, half-way to the background (full under the pointer). */
export const cardEdge = (st: UiStatus, hot = false): number => (hot ? ST[st].c : mixRgb(ST[st].c, CARD_BG, 0.5))

const pad = (n: number): string => String(n).padStart(2, '0')
/** Wall-clock time of `ms` (local), hh:mm:ss. */
export const clock = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
/** "4m 07s", "1h 02m". */
export const dur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${pad(Math.floor(s / 60) % 60)}m` : `${Math.floor(s / 60)}m ${pad(s % 60)}s`
}
/** "12s ago", "3m ago", "2h ago". */
export const agoTxt = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`
}

const SPARK = '▁▂▃▄▅▆▇█'
/** One glyph per value, scaled to the largest; '' until two values moved (one bar says nothing). */
export const spark = (vals: readonly number[]): string => {
  const max = Math.max(0, ...vals)
  if (vals.filter(v => v > 0).length < 2) return ''
  return vals.map(v => SPARK[max <= 0 ? 0 : Math.min(7, Math.round((v / max) * 7))]).join('')
}

/** `▰▰▱▱` for done of total (one cell per stage, at most `max` cells). */
export const prog = (done: number, total: number, max = 12): string => {
  if (total <= 0) return ''
  const w = Math.min(total, max)
  const n = Math.max(0, Math.min(w, Math.round((done / total) * w)))
  return '▰'.repeat(n) + '▱'.repeat(w - n)
}

/** A thin bar `━━━──` of `width` cells filled to `pct`. */
export const meter = (pct: number, width: number): [string, string] => {
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return ['━'.repeat(n), '─'.repeat(width - n)]
}

/**
 * Text that came from agents, transcripts or design files, made safe to paint: C0/C1 control characters
 * (ESC and friends, which could move the cursor or rewrite the screen) and bidi overrides (which could
 * reorder what is shown) are dropped; tabs and newlines become spaces.
 */
export const clean = (s: string): string => s.replace(/[\t\n\r]/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')

export const fit = (s: string, w: number): string => {
  const t = clean(s)
  return w <= 0 ? '' : t.length <= w ? t : `${t.slice(0, Math.max(0, w - 1))}…`
}
