// Body edits change pixels: validate the complete candidate before writing any user file.
import { BUILTIN } from './builtin.ts'
import { bodyCompatibility, loadPack } from './fit.ts'
import { normalizeDesignJson } from './legacy.ts'
import { BUILTIN_ORIGIN, type DesignFile, type Pack } from './pack.ts'
import { rulesFileOf, type Plan } from './rules-edit.ts'

/** A costume's body; `crab` (or none) removes the explicit id. There is no crew-wide default. */
export type BodyOp = { op: 'setBody'; costume: string; body?: string }
type Obj = Record<string, unknown>
const object = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const readJson = (f: DesignFile): unknown => f.json === undefined ? JSON.parse(f.text ?? '') : JSON.parse(JSON.stringify(f.json))

export function planBodyEdit(files: readonly DesignFile[], op: BodyOp, current: Pack): Plan {
  try {
    if (op.body === 'crab') op = { ...op, body: undefined }
    if ((current.costumes[op.costume]?.bodyId ?? 'crab') === (op.body ?? 'crab')) return {
      ok: true, unchanged: true, file: '', text: '', files: [...files], pack: current, summary: 'Body unchanged.',
    }
    const body = op.body ?? 'crab'
    const issues = bodyCompatibility(current, op.costume, body)
    if (issues.length) throw new Error(issues.map(p => p.msg).join('; '))
    let file: string
    let raw: unknown
    {
      const costume = current.costumes[op.costume]
      if (!costume) throw new Error(`unknown costume "${op.costume}"`)
      const user = costume.origin !== BUILTIN_ORIGIN
      file = user ? costume.origin : `body-${costume.id}.crab.json`
      const before = files.find(f => f.file === file)
      const priorJson = before ? readJson(before) : undefined
      const vacant = object(priorJson) && priorJson['type'] === 'bundle' && Array.isArray(priorJson['items']) && priorJson['items'].length === 0 && Object.keys(priorJson).every(k => k === 'type' || k === 'items')
      if (!user && before && !vacant) throw new Error(`"${file}" already exists; refusing to replace another design`)
      raw = user && before ? readJson(before) : JSON.parse(JSON.stringify(costume.source))
      let found = false
      const replace = (v: unknown): unknown => {
        if (!object(v)) return v
        const normalized = normalizeDesignJson(v)
        if (object(normalized) && normalized['type'] === 'bundle' && Array.isArray(v['items'])) return { ...v, items: v['items'].map(replace).filter(x => x !== undefined) }
        if (!object(normalized) || normalized['type'] !== 'costume' || normalized['id'] !== costume.id) return v
        if (found) throw new Error('the file defines the costume more than once')
        found = true
        const colors = object(normalized['body']) ? { ...normalized['body'] } : {}
        if (op.body) colors['id'] = op.body
        else delete colors['id']
        const updated = { ...normalized }
        if (Object.keys(colors).length) updated['body'] = colors
        else delete updated['body']
        const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
        const builtin = BUILTIN.costumes[costume.id]
        if (!op.body && builtin && JSON.stringify(canonical(updated)) === JSON.stringify(canonical(builtin.source))) return undefined
        return updated
      }
      raw = replace(raw) ?? { type: 'bundle', items: [] }
      if (!found) throw new Error('the source file no longer defines this costume')
    }
    const text = `${JSON.stringify(raw, null, 2)}\n`
    const next = files.some(f => f.file === file) ? files.map(f => f.file === file ? { file, text } : f) : [...files, { file, text }]
    const pack = loadPack(next, BUILTIN)
    const key = (p: { file: string; id?: string; msg: string }) => `${p.file}:${p.id ?? ''}:${p.msg}`
    const prior = new Set(current.problems.filter(p => p.fatal).map(key))
    const rejected = new Set(current.problems.filter(p => p.fatal && p.id).map(p => `${p.file}:${p.id}`))
    const fatal = pack.problems.filter(p => {
      if (!p.fatal || prior.has(key(p))) return false
      if (p.costume && !current.costumes[p.costume] && op.costume !== p.costume) return false
      if (p.id && rejected.has(`${p.file}:${p.id}`) && !current.costumes[p.id] && !current.pieces[p.id] && !current.actions[p.id] && !current.bodies[p.id]) return false
      return true
    })
    if (fatal.length) throw new Error(fatal.map(p => `${p.file}: ${p.msg}`).join('; '))
    if (!pack.costumes[op.costume]) throw new Error('the edited costume did not pass validation')
    return { ok: true, file, text, files: next, pack, summary: `${op.costume} body: ${op.body ?? 'crab'}.` }
  } catch (e) {
    return { ok: false, error: `Not changed: ${(e as Error).message}` }
  }
}
