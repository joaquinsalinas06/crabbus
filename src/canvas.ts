// Pixel canvas and its encodings. Pure: no `$`, no Node.
//
// One terminal cell shows two pixels stacked (the upper half block ▀ in the foreground color over
// the lower pixel in the background color), so a sprite W x H pixels takes W columns and H/2 rows
// and every pixel keeps its exact color.

export const CARD_W = 18
export const CARD_H = 14 // pixels: 7 terminal rows

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

/** Where drawing goes: a pixel, its color and who drew it (the fit check reads the tag). */
export type Put = (x: number, y: number, color: number, tag: string) => void

export const putOn = (c: Canvas): Put => (x, y, color) => set(c, x, y, color)

/** Paints a picture written as strings; `.` and ' ' are transparent, every other letter looks up `pal`. */
export const stampWith = (put: Put, x: number, y: number, rows: readonly string[], pal: Readonly<Record<string, number>>, tag: string): void => {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const col = pal[row[dx] as string]
      if (col !== undefined) put(x + dx, y + dy, col, tag)
    }
  })
}

export const stamp = (c: Canvas, x: number, y: number, rows: readonly string[], pal: Readonly<Record<string, number>>): void =>
  stampWith(putOn(c), x, y, rows, pal, '')

/** Every pixel toward its own gray by `amount` and darker by `dark`: how a finished crab looks. */
export const desaturate = (c: Canvas, amount: number, dark = 0): void => {
  for (let i = 0; i < c.px.length; i++) {
    const v = c.px[i] as number
    if (v < 0) continue
    const l = Math.round(((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11)
    c.px[i] = mix(mix(v, (l << 16) | (l << 8) | l, amount), 0, dark)
  }
}

/**
 * Half the size: each 2x2 block becomes one pixel. Colors rarer than the body's (hats, props, eyes)
 * win their block even from a single pixel, so a costume stays recognizable at 9 columns.
 */
export const halve = (c: Canvas): Canvas => {
  const out = canvas(Math.ceil(c.width / 2), Math.ceil(c.height / 2))
  const freq = new Map<number, number>()
  for (const v of c.px) if (v >= 0) freq.set(v, (freq.get(v) ?? 0) + 1)
  const body = new Set([...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]))
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const block = [get(c, x * 2, y * 2), get(c, x * 2 + 1, y * 2), get(c, x * 2, y * 2 + 1), get(c, x * 2 + 1, y * 2 + 1)].filter(v => v >= 0)
      if (block.length === 0) continue
      const accent = block.filter(v => !body.has(v))
      const pool = accent.length > 0 ? accent : block.length >= 2 ? block : []
      if (pool.length === 0) continue
      const count = new Map<number, number>()
      for (const v of pool) count.set(v, (count.get(v) ?? 0) + 1)
      set(out, x, y, [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1)
    }
  return out
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

/** Raster cells; `bg` paints the transparent parts (a card's background) instead of the terminal's default. */
export const cellsOf = (c: Canvas, bg?: number): { columns: number; rows: number; cells: string } => {
  const w = toWords(c)
  if (bg !== undefined) for (let i = 1; i < w.words.length; i++) if (i % 3 !== 0 && w.words[i] === DEFAULT_COLOR) w.words[i] = bg
  return { columns: w.columns, rows: w.rows, cells: toBase64(new Uint8Array(w.words.buffer, w.words.byteOffset, w.words.byteLength)) }
}

export type Run = { t: string; fg: number; bg: number }

/**
 * The same half-block picture as runs of colored text, one list per terminal row: what a `Text`
 * can draw, so a sprite can sit inside a `Button` (a Raster cannot). `bg` fills transparent cells.
 */
export const textRows = (c: Canvas, bg: number): Run[][] => {
  const rows: Run[][] = []
  for (let r = 0; r < Math.ceil(c.height / 2); r++) {
    const row: Run[] = []
    for (let x = 0; x < c.width; x++) {
      const top = get(c, x, r * 2)
      const bot = get(c, x, r * 2 + 1)
      const cell: Run = top < 0 && bot < 0 ? { t: ' ', fg: bg, bg } : bot < 0 ? { t: '▀', fg: top, bg } : top < 0 ? { t: '▄', fg: bot, bg } : { t: '▀', fg: top, bg: bot }
      const last = row[row.length - 1]
      // a blank cell joins any run on the same background; a drawn one only its own colors
      if (last && last.bg === cell.bg && (last.fg === cell.fg || (cell.t === ' ' && last.t.trim() === ''))) last.t += cell.t
      else row.push(cell)
    }
    rows.push(row)
  }
  return rows
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
