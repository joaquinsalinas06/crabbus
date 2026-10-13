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

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`

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

export const fit = (s: string, w: number): string => (w <= 0 ? '' : s.length <= w ? s : `${s.slice(0, Math.max(0, w - 1))}…`)
