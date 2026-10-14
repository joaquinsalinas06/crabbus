// Body edits change pixels: validate the complete candidate before writing any user file.
import { BUILTIN } from './builtin.ts'
import { bodyCompatibility, checkPack, defaultBodyCompatibility } from './fit.ts'
import { normalizeDesignJson } from './legacy.ts'
import { BUILTIN_ORIGIN, compilePack, type DesignFile, type Pack } from './pack.ts'
import { rulesFileOf, type Plan } from './rules-edit.ts'

export type BodyOp = { op: 'setBody'; costume: string; body?: string } | { op: 'setDefaultBody'; body?: string }
type Obj = Record<string, unknown>
const object = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const readJson = (f: DesignFile): unknown => f.json === undefined ? JSON.parse(f.text ?? '') : JSON.parse(JSON.stringify(f.json))

export function planBodyEdit(files: readonly DesignFile[], op: BodyOp, current: Pack): Plan {
  try {
    const body = op.body ?? (op.op === 'setBody' ? current.defaultBody ?? 'crab' : 'crab')
    const issues = op.op === 'setBody' ? bodyCompatibility(current, op.costume, body) : defaultBodyCompatibility(current, body)
    if (issues.length) throw new Error(issues.map(p => p.msg).join('; '))
    let file: string
    let raw: unknown
    if (op.op === 'setDefaultBody') {
      file = rulesFileOf(files)
      const before = files.find(f => f.file === file)
      raw = before ? readJson(before) : { type: 'rules' }
      if (!object(raw) || raw['type'] !== 'rules') throw new Error('the destination is not a rules file')
      if (op.body) raw['defaultBody'] = op.body
      else delete raw['defaultBody']
    } else {
      const costume = current.costumes[op.costume]
      if (!costume) throw new Error(`unknown costume "${op.costume}"`)
      const user = costume.origin !== BUILTIN_ORIGIN
      file = user ? costume.origin : `body-${costume.id}.crab.json`
      const before = files.find(f => f.file === file)
      if (!user && before) throw new Error(`"${file}" already exists; refusing to replace another design`)
      raw = user && before ? readJson(before) : JSON.parse(JSON.stringify(costume.source))
      let found = false
      const replace = (v: unknown): unknown => {
        if (!object(v)) return v
        if ((v['type'] === 'bundle' || v['type'] === 'pack') && Array.isArray(v['items'])) return { ...v, items: v['items'].map(replace) }
        const normalized = normalizeDesignJson(v)
        if (!object(normalized) || normalized['type'] !== 'costume' || normalized['id'] !== costume.id) return v
        if (found) throw new Error('the file defines the costume more than once')
        found = true
        const colors = object(normalized['body']) ? { ...normalized['body'] } : {}
        if (op.body) colors['id'] = op.body
        else delete colors['id']
        return { ...normalized, body: colors }
      }
      raw = replace(raw)
      if (!found) throw new Error('the source file no longer defines this costume')
    }
    const text = `${JSON.stringify(raw, null, 2)}\n`
    const next = [...files.filter(f => f.file !== file), { file, text }]
    const pack = compilePack(next, BUILTIN)
    const fatal = pack.problems.filter(p => p.fatal)
    if (fatal.length) throw new Error(fatal.map(p => `${p.file}: ${p.msg}`).join('; '))
    const fit = checkPack(pack)
    if (fit.problems.length) throw new Error(fit.problems.map(p => p.msg).join('; '))
    return { ok: true, file, text, files: next, pack, summary: op.op === 'setBody'
      ? `${op.costume} body: ${op.body ?? 'inherit'}.` : `Default body: ${op.body ?? 'crab (built-in fallback)'}.` }
  } catch (e) {
    return { ok: false, error: `Not changed: ${(e as Error).message}` }
  }
}
