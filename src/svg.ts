// Pixel canvas to SVG. Pure: no `$`, no Node, no dependencies.
import type { Canvas } from './canvas.ts'

/** Exact art pixels; the surface chooses the CSS size independently. */
export const toSvg = (c: Canvas, bg?: number): string => {
  const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}" shape-rendering="crispEdges">`]
  if (bg !== undefined) parts.push(`<rect x="0" y="0" width="${c.width}" height="${c.height}" fill="${hex(bg)}"/>`)
  for (let y = 0; y < c.height; y++) {
    let x = 0
    while (x < c.width) {
      const color = c.px[y * c.width + x] ?? -1
      const start = x++
      while (x < c.width && c.px[y * c.width + x] === color) x++
      if (color >= 0) parts.push(`<rect x="${start}" y="${y}" width="${x - start}" height="1" fill="${hex(color)}"/>`)
    }
  }
  parts.push('</svg>')
  return parts.join('')
}

/** A graphical meter, independent of character widths. Unknown percentages leave an empty track. */
export const barSvg = (pct: number | undefined, color: number, track: number, width = 140): string => {
  const hex = (v: number) => `#${v.toString(16).padStart(6, '0')}`
  const fill = width * Math.max(0, Math.min(100, Number.isFinite(pct) ? pct! : 0)) / 100
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6"><rect width="${width}" height="6" rx="3" fill="${hex(track)}"/>${fill > 0 ? `<rect width="${fill}" height="6" rx="3" fill="${hex(color)}"/>` : ''}</svg>`
}

/** A small history plot; a single sample is a dot, a flat history stays level. */
export const sparkSvg = (samples: readonly number[], color: number, width = 100): string => {
  const values = samples.filter(Number.isFinite)
  const low = Math.min(...values), high = Math.max(...values)
  const points = values.map((v, i) => `${values.length === 1 ? 2 : 2 + i * (width - 4) / (values.length - 1)},${high === low ? 12 : 22 - (v - low) * 20 / (high - low)}`)
  const stroke = `#${color.toString(16).padStart(6, '0')}`
  const shape = values.length === 1 ? `<circle cx="2" cy="12" r="2" fill="${stroke}"/>` : values.length > 1 ? `<polyline points="${points.join(' ')}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">${shape}</svg>`
}
