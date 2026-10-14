// Dev-only: renders scenes to PNG the way a terminal paints half-block cells, so the art can be
// reviewed without launching Claude Code. Not loaded by the mod (it uses node:zlib / node:fs).
//
//   node tools/preview.ts <out.png> [scale] [--light]          the built-in crew and a band
//   node tools/preview.ts --design <file|dir>... [--costume id] [--out x.png] [--scale 6]
//        a design before installing it: runs the fit check (problems printed in English, exit 1 if
//        any), then draws the costume in every action, on a dark and on a light background
import { deflateSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { BUILTIN } from '../src/builtin.ts'
import { loadPack } from '../src/fit.ts'
import { BUILTIN_ORIGIN, type DesignFile, type Pack } from '../src/pack.ts'
import { CARD_H, canvas, drawAgent, drawMaster, get, type Canvas, type Costume, type Mood } from '../src/art.ts'
import { agentCard, compose, layout, miniCard } from '../src/scene.ts'
import { emptyState, onComplete, onSend, onSpawn, onStep, onToolStart, onReceive, type AgentRec, type BusState } from '../src/model.ts'

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (b: Uint8Array): number => {
  let c = 0xffffffff
  for (const x of b) c = (crcTable[(c ^ x) & 255] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Uint8Array): Buffer => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
export const png = (w: number, h: number, rgb: Uint8Array): Buffer => {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    Buffer.from(rgb.subarray(y * w * 3, (y + 1) * w * 3)).copy(raw, y * (w * 3 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())])
}

/** A sheet of canvases; each art pixel is `s`x`s` (a terminal cell is s wide, 2s tall). */
const sheet = (rows: Canvas[][], s: number, bg: number, pad = 2): { w: number; h: number; rgb: Uint8Array } => {
  const cw = Math.max(...rows.map(r => r.reduce((a, c) => a + c.width + pad, pad)))
  const rh = rows.map(r => Math.max(...r.map(c => c.height)) + pad)
  const W = cw * s
  const H = (rh.reduce((a, b) => a + b, 0) + pad) * s
  const rgb = new Uint8Array(W * H * 3)
  for (let i = 0; i < W * H; i++) { rgb[i * 3] = (bg >> 16) & 255; rgb[i * 3 + 1] = (bg >> 8) & 255; rgb[i * 3 + 2] = bg & 255 }
  let oy = pad
  rows.forEach((r, ri) => {
    let ox = pad
    for (const c of r) {
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const v = get(c, x, y)
        if (v < 0) continue
        for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
          const i = ((oy + y) * s + dy) * W + (ox + x) * s + dx
          rgb[i * 3] = (v >> 16) & 255; rgb[i * 3 + 1] = (v >> 8) & 255; rgb[i * 3 + 2] = v & 255
        }
      }
      ox += c.width + pad
    }
    oy += rh[ri] as number
  })
  return { w: W, h: H, rgb }
}

const COSTUMES: Costume[] = ['fable', 'heavy', 'careful', 'medium', 'light', 'explore', 'other']
const MOODS: Mood[] = ['walk', 'reading', 'writing', 'testing', 'thinking', 'blocked', 'error', 'done', 'sleep']

const card = (f: (c: Canvas) => void): Canvas => { const c = canvas(18, CARD_H); f(c); return c }

export const scenario = (): BusState => {
  let s = emptyState()
  const now = 100000
  for (const [id, d] of [['a1', 'backend'], ['a2', 'frontend'], ['a3', 'tests']] as const) s = onSpawn(s, { id, type: 'general-purpose', description: d }, now - 30000)
  s = onToolStart(s, 'a1', 'Read', { file_path: 'x' }, now - 1000)
  s = onStep(s, 'a2', { plan: ['a', 'b', 'c'], done: 1 }, now - 2000)
  s = onToolStart(s, 'a3', 'Bash', { command: 'npm test' }, now - 500)
  s = onSend(s, 'a2', 'switch to JWT', true, now - 700)
  return s
}

const stack = (a: { w: number; h: number; rgb: Uint8Array }, b: { w: number; h: number; rgb: Uint8Array }) => {
  const w = Math.max(a.w, b.w)
  const rgb = new Uint8Array(w * (a.h + b.h) * 3)
  for (const [img, y0] of [[a, 0], [b, a.h]] as const)
    for (let y = 0; y < img.h; y++) rgb.set(img.rgb.subarray(y * img.w * 3, (y + 1) * img.w * 3), ((y0 + y) * w) * 3)
  return { w, h: a.h + b.h, rgb }
}

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function design(): void {
  const designIdx = Math.max(process.argv.indexOf('--design'), process.argv.indexOf('--diseno'))
  const paths: string[] = []
  if (designIdx >= 0) {
    for (let i = designIdx + 1; i < process.argv.length && !(process.argv[i] as string).startsWith('--'); i++) paths.push(process.argv[i] as string)
  }
  const files: DesignFile[] = []
  for (const p of paths) {
    const list = statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.json')).map(f => `${p}/${f}`) : [p]
    for (const f of list) files.push({ file: f.split('/').pop() as string, text: readFileSync(f, 'utf8') })
  }
  const selectedBody = arg('--body')
  const customBody = files.flatMap(f => { try { const o = JSON.parse(f.text ?? '{}'); return o.type === 'body' ? [o.id] : [] } catch { return [] } })[0]
  if (selectedBody || customBody) files.push({ file: '(preview body)', json: { type: 'rules', defaultBody: selectedBody ?? customBody } })
  const pack: Pack = loadPack(files, BUILTIN)
  const mine = new Set(files.map(f => f.file))
  const problems = pack.problems.filter(x => mine.has(x.file) || x.file === 'rules' || x.fatal)
  for (const x of problems) console.log(`${x.fatal ? 'PROBLEM' : 'warning'} ${x.file}${x.id ? ` (${x.id})` : ''}: ${x.msg}`)
  // the costume to show: the one asked for, else the first one the files define, else the files' pieces on a bare crab
  const own = Object.values(pack.costumes).filter(d => mine.has(d.origin))
  let costume = arg('--costume') ?? arg('--disfraz') ?? own[0]?.id
  if (!costume) {
    const pieces = Object.values(pack.pieces).filter(p => mine.has(p.origin)).map(p => p.id)
    costume = '(preview)'
    pack.costumes[costume] = { id: costume, name: 'preview', color: 0x888780, body: 0xd97757, pieces, origin: '', source: null }
  }
  if (!pack.costumes[costume]) {
    console.log(`PROBLEM: costume "${costume}" cannot be shown (see problems above)`)
    process.exit(1)
  }
  const actions = Object.keys(pack.actions).filter(a => !a.startsWith('master.'))
  const rows: Canvas[][] = [actions.map(m => card(c => drawAgent(c, 0, 0, costume, m, 1, pack)))]
  for (const m of ['walk', 'done', ...actions.filter(a => pack.actions[a]?.origin !== BUILTIN_ORIGIN && !pack.actions[a]?.play)])
    rows.push([...Array(8)].map((_, t) => card(c => drawAgent(c, 0, 0, costume, m, t, pack))))
  // plays, every tick from the start, split in rows of 12
  for (const m of actions.filter(a => pack.actions[a]?.play)) {
    const n = pack.actions[m]?.play?.ticks ?? 0
    for (let from = 0; from < n; from += 12) rows.push([...Array(Math.min(12, n - from))].map((_, i) => card(c => drawAgent(c, 0, 0, costume, m, from + i, pack))))
  }
  const sc = Number(arg('--scale') ?? 6)
  const img = stack(sheet(rows, sc, 0x1e1e1e), sheet(rows, sc, 0xffffff))
  const out = arg('--out') ?? `${costume.replace(/[^a-z0-9._-]/gi, '_')}.png`
  writeFileSync(out, png(img.w, img.h, img.rgb))
  console.log(`costume: ${costume} · actions (row 1): ${actions.join(', ')}`)
  console.log(`following rows: 8 ticks of walk, done${rows.length > 3 ? ` and ${rows.slice(3).length} custom action(s)` : ''}; dark background on top, light on bottom`)
  console.log(`wrote ${out} ${img.w}x${img.h}`)
  if (problems.some(x => x.fatal)) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--design') || process.argv.includes('--diseno') || process.argv.includes('--costume') || process.argv.includes('--disfraz')) design()
  else main()
}

function main(): void {
const out = process.argv[2] ?? 'preview.png'
const s = Number(process.argv[3] ?? 4)
const BG = process.argv.includes('--light') ? 0xfafafa : 0x1e1e1e

const rows: Canvas[][] = []
// 1. every costume x every mood, frame 1
for (const co of COSTUMES) rows.push(MOODS.map(m => card(c => drawAgent(c, 0, 0, co, m, 1))))
// 2. one costume through 8 frames of walk and of done; the master
rows.push([...Array(8)].map((_, t) => card(c => drawAgent(c, 0, 0, 'medium', 'walk', t))))
rows.push([...Array(8)].map((_, t) => card(c => drawAgent(c, 0, 0, 'light', 'done', t))))
rows.push([...Array(6)].map((_, t) => card(c => drawMaster(c, 0, 0, true, t))))
// 3. a full band: three agents, a message in flight, then delivered
let st = scenario()
const l = layout(st, 100000, 120, 12)
if (l.kind === 'stage') {
  rows.push([compose(st, l, 100000, 3)])
  st = onReceive(st, 'a2', 100100)
  rows.push([compose(st, l, 100200, 4)])
}
// 4. the panel's cards: working, thinking, waiting, blocked, done, failed with their state marks,
//    then the same at half size (rows mode) and every costume at half size
const ps = panelScenario()
const ids = ['w', 't', 'q', 'b', 'd', 'f']
rows.push(ids.map(id => agentCard(ps, ps.agents[id] as AgentRec, 100000, 0)))
rows.push(ids.map(id => miniCard(ps, ps.agents[id] as AgentRec, 100000, 0)))
rows.push(COSTUMES.map(co => miniCard(ps, { ...(ps.agents['w'] as AgentRec), costume: co }, 100000, 1)))
const img = sheet(rows, s, BG)
writeFileSync(out, png(img.w, img.h, img.rgb))
console.log(`wrote ${out} ${img.w}x${img.h}`)
}

function panelScenario(): BusState {
  let s = emptyState()
  for (const [id, co] of [['w', 'heavy'], ['t', 'explore'], ['q', 'careful'], ['b', 'light'], ['d', 'medium'], ['f', 'fable']] as const) {
    s = onSpawn(s, { id, type: 'general-purpose', description: id }, 0)
    s = { ...s, agents: { ...s.agents, [id]: { ...(s.agents[id] as AgentRec), costume: co } } }
  }
  s = onToolStart(s, 'w', 'Read', { file_path: 'x' }, 99000)
  s = onStep(s, 'q', { question: 'which db?' }, 99000)
  s = onStep(s, 'b', { blocker: 'needs a token' }, 99000)
  s = onComplete(s, 'd', { reason: 'answer' }, 99000)
  s = onComplete(s, 'f', { reason: 'error' }, 99000)
  return s
}
