// Safe editing of the user's rules file: pure functions over the design files in memory.
// An edit is planned first (new text, the pack it would give, or the reason it is refused) and only
// then shown and written, so a click is instant and a bad edit never reaches the disk.
import { BUILTIN } from './builtin.ts'
import { compilePack, type DesignFile, type Pack, type Problem } from './pack.ts'

/** What a rule can look at; each one is a regular expression except `kind`, which names a kind, and `date`, a range of days. */
export const CRITERIA = ['description', 'prompt', 'type', 'name', 'mode', 'model', 'kind', 'date'] as const
export type Criterion = (typeof CRITERIA)[number]

/** `file` and `index` (1-based, as the rules file lists them) say which rule of the user's an op touches. */
export type RuleOp =
  | { op: 'toggleActive'; costume: string }
  | { op: 'setMaster'; costume: string }
  | { op: 'addRule'; criterion: Criterion; pattern: string; costume: string }
  | { op: 'removeRule'; file: string; index: number }
  | { op: 'moveRule'; file: string; index: number; by: -1 | 1 }
  | { op: 'setRuleCostume'; file: string; index: number; costume: string }
  | { op: 'toggleIfFree'; file: string; index: number }

type Obj = Record<string, unknown>

const skeleton = (active: readonly string[]): Obj => ({ type: 'rules', active: [...active], rules: [] })

/**
 * One edit of a rules file's text.
 * `active` is kept as the file has it, or taken from the rotation in use when the file does not say.
 * A file that is not a JSON rules object is never replaced: the edit throws and the file stays as it was.
 */
export function editRulesJson(rawJson: string | null, op: RuleOp, currentActive: readonly string[]): { text: string; summary: string } {
  let obj: Obj
  if (rawJson === null || rawJson.trim() === '') {
    obj = skeleton(currentActive)
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawJson)
    } catch (e) {
      throw new Error(`the rules file is not valid JSON (${(e as Error).message}); fix it by hand first`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('the rules file must be a JSON object; fix it by hand first')
    obj = parsed as Obj
    if (obj['type'] !== 'rules') throw new Error('the file is not a rules file ("type" is not "rules")')
  }

  const rules = (): Obj[] => {
    if (obj['rules'] === undefined) obj['rules'] = []
    if (!Array.isArray(obj['rules'])) throw new Error('"rules" in the file is not a list; fix it by hand first')
    return obj['rules'] as Obj[]
  }
  const at = (list: Obj[], index: number): Obj => {
    const r = list[index - 1]
    if (typeof r !== 'object' || r === null) throw new Error(`there is no rule ${index} in the file`)
    return r
  }

  let summary = ''
  if (op.op === 'toggleActive') {
    const raw = obj['active']
    const list = Array.isArray(raw) ? [...(raw as string[])] : [...currentActive]
    if (list.includes(op.costume)) {
      obj['active'] = list.filter(c => c !== op.costume)
      summary = `Removed ${op.costume} from the rotation.`
    } else {
      obj['active'] = [...list, op.costume]
      summary = `Added ${op.costume} to the rotation.`
    }
  } else if (op.op === 'setMaster') {
    if (obj['master'] === op.costume) {
      delete obj['master']
      summary = 'The master wears its default costume again.'
    } else {
      obj['master'] = op.costume
      summary = `The master wears ${op.costume}.`
    }
  } else if (op.op === 'addRule') {
    const pattern = op.pattern.trim()
    if (pattern === '') throw new Error('write what the rule should look for')
    if (op.criterion === 'date') {
      // "12-01..12-31", "12-01 to 12-31", "12-01 12-31"
      const d = /^(\d\d-\d\d)\s*(?:\.\.|to|→|\s)\s*(\d\d-\d\d)$/.exec(pattern)
      if (!d) throw new Error('write the dates as MM-DD..MM-DD, like 12-01..12-31')
      rules().push({ if: { from: d[1], to: d[2] }, costume: op.costume })
    } else rules().push({ if: { [op.criterion]: pattern }, costume: op.costume })
    summary = `New rule: ${op.criterion} ${pattern} → ${op.costume}.`
  } else if (op.op === 'removeRule') {
    const list = rules()
    at(list, op.index)
    list.splice(op.index - 1, 1)
    summary = `Removed rule ${op.index}.`
  } else if (op.op === 'moveRule') {
    const list = rules()
    at(list, op.index)
    const to = op.index - 1 + op.by
    if (to < 0 || to >= list.length) throw new Error('the rule is already at the end of the list')
    const [r] = list.splice(op.index - 1, 1)
    list.splice(to, 0, r as Obj)
    summary = `Moved rule ${op.index} ${op.by < 0 ? 'up' : 'down'}.`
  } else if (op.op === 'setRuleCostume') {
    at(rules(), op.index)['costume'] = op.costume
    summary = `Rule ${op.index} now gives ${op.costume}.`
  } else {
    const r = at(rules(), op.index)
    if (r['ifFree'] === true) delete r['ifFree']
    else r['ifFree'] = true
    summary = `Rule ${op.index} ${r['ifFree'] === true ? 'only applies while the costume is free' : 'applies even if the costume is worn'}.`
  }

  return { text: `${JSON.stringify(obj, null, 2)}\n`, summary }
}

const typeOf = (f: DesignFile): { type?: unknown; items?: unknown } | undefined => {
  try {
    const o: unknown = f.json ?? JSON.parse(f.text ?? '')
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as { type?: unknown; items?: unknown }) : undefined
  } catch {
    return undefined
  }
}

const isRulesFile = (f: DesignFile): boolean => typeOf(f)?.type === 'rules'

/** A file that can carry rules: a rules file, or a bundle with a rules item in it. */
const carriesRules = (f: DesignFile): boolean => {
  const o = typeOf(f)
  if (!o) return false
  if (o.type === 'rules') return true
  return (o.type === 'bundle' || o.type === 'pack') && Array.isArray(o.items) && o.items.some(x => typeof x === 'object' && x !== null && (x as { type?: unknown }).type === 'rules')
}

/** The file an edit goes to: the user's first rules file, or a new `rules.json`. */
export const rulesFileOf = (files: readonly DesignFile[]): string => files.find(isRulesFile)?.file ?? 'rules.json'

/**
 * The pack `current` becomes when only rules change. Pieces, costumes and actions stay as they were
 * checked; only the files that carry rules (and `touched`, even if it is broken) are read again. This is
 * what keeps a click instant: checking every costume again takes over half a second and stops the crabs.
 */
export const withRules = (current: Pack, files: readonly DesignFile[], touched: string): Pack => {
  const fed = files.filter(f => f.file === touched || carriesRules(f))
  const base: Pack = {
    ...current,
    rules: BUILTIN.rules,
    active: [...BUILTIN.active],
    labels: { ...BUILTIN.labels },
    kinds: { ...(BUILTIN.kinds ?? {}) },
    rulesSource: [...BUILTIN.rulesSource],
    rulesFiles: [...BUILTIN.rulesFiles],
    problems: [],
  }
  if (BUILTIN.master) base.master = BUILTIN.master
  else delete base.master
  const p = compilePack(fed, base)
  // the other files' problems are kept; whatever the rules give is computed again, once
  const names = new Set(fed.map(f => f.file))
  const seen = new Set<string>()
  const problems: Problem[] = []
  for (const x of [...current.problems.filter(x => !names.has(x.file) && x.file !== 'rules'), ...p.problems]) {
    const k = `${x.file}|${x.id ?? ''}|${x.msg}`
    if (!seen.has(k)) {
      seen.add(k)
      problems.push(x)
    }
  }
  return { ...p, problems }
}

export type Plan = { ok: true; unchanged?: boolean; file: string; text: string; files: DesignFile[]; pack: Pack; summary: string } | { ok: false; error: string }

/**
 * Plans an edit over the design files now loaded: the new text of the file it changes and the pack the
 * files would give, or why it is refused (a file that is not valid JSON, a pattern the pack rejects).
 * Nothing is written here.
 */
export function planRuleEdit(files: readonly DesignFile[], op: RuleOp, current: Pack): Plan {
  const file = 'file' in op ? op.file : rulesFileOf(files)
  const before = files.find(f => f.file === file)
  let edited: { text: string; summary: string }
  try {
    edited = editRulesJson(before ? before.text ?? '' : null, op, current.active)
  } catch (e) {
    return { ok: false, error: `Not changed: ${(e as Error).message}.` }
  }
  const next: DesignFile[] = before ? files.map(f => (f.file === file ? { file, text: edited.text } : f)) : [...files, { file, text: edited.text }]
  const pack = withRules(current, next, file)
  const fatal = pack.problems.filter(p => p.file === file && p.fatal)
  if (fatal.length > 0) return { ok: false, error: `Not changed: ${fatal.map(p => p.msg).join('; ')}` }
  return { ok: true, file, text: edited.text, files: next, pack, summary: edited.summary }
}
