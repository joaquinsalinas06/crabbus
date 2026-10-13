// Backwards-compatibility normalizer for v0.4 Spanish design files (.json / .cangrejo.json).
// Pure: no `$`, no Node. Walks the JSON structure by item `type` so user data (drawing names,
// palette letters, tick keys, regex values, custom IDs) is never altered.

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export const LEGACY_PIECE_IDS: Readonly<Record<string, string>> = {
  'casco-astronauta': 'astronaut-helmet',
  estrella: 'star',
  'sombrero-detective': 'detective-hat',
  lupa: 'magnifier',
  'casco-ingeniero': 'hard-hat',
  llave: 'wrench',
  'gorro-chef': 'chef-hat',
  sarten: 'pan',
  'casco-piloto': 'pilot-helmet',
  bandera: 'flag',
  'sombrero-pirata': 'pirate-hat',
  parche: 'eyepatch',
  sable: 'cutlass',
  'gorro-helice': 'propeller-cap',
  corona: 'crown',
  microfono: 'headset-mic',
}

export const LEGACY_COSTUME_IDS: Readonly<Record<string, string>> = {
  maestro: 'master',
}

export const LEGACY_ACTION_IDS: Readonly<Record<string, string>> = {
  giro: 'spin',
  'futbol-a': 'football-a',
  'futbol-b': 'football-b',
  'futbol-c': 'football-c',
  'futbol-d': 'football-d',
  'futbol-recibe-a': 'football-receive-a',
  'futbol-recibe-b': 'football-receive-b',
  'futbol-recibe-c': 'football-receive-c',
  'futbol-recibe-d': 'football-receive-d',
  'maestro.ocupado': 'master.busy',
  'maestro.libre': 'master.free',
}

export const LEGACY_GROUP_IDS: Readonly<Record<string, string>> = {
  futbol: 'football',
  recibe: 'receive',
  giro: 'spin',
}

const LEGACY_SLOTS: Readonly<Record<string, string>> = {
  espalda: 'behind',
  torso: 'torso',
  cuello: 'neck',
  'cara.boca': 'face.mouth',
  'cara.ojos': 'face.eyes',
  cabeza: 'head',
  'mano.izq': 'hand.left',
  'mano.der': 'hand.right',
  adorno: 'trim',
}

const LEGACY_ANCHORS: Readonly<Record<string, string>> = {
  tarjeta: 'card',
  cuerpo: 'body',
  cabeza: 'head',
  cara: 'face',
  'pinza.izq': 'claw.left',
  'pinza.der': 'claw.right',
  suelo: 'ground',
}

const LEGACY_STATES: Readonly<Record<string, string>> = {
  dormido: 'asleep',
  terminado: 'finished',
  fallo: 'failed',
  bloqueado: 'blocked',
  error: 'error',
  pensando: 'thinking',
  trabajando: 'working',
  inicio: 'starting',
  'tests-ok': 'tests-ok',
}

const LEGACY_SIDES: Readonly<Record<string, string>> = {
  izq: 'left',
  der: 'right',
}

export type LegacyIdKind = 'piece' | 'costume' | 'action' | 'group'

export const resolveLegacyId = (kind: LegacyIdKind, id: string): string => {
  switch (kind) {
    case 'piece':
      return LEGACY_PIECE_IDS[id] ?? id
    case 'costume':
      return LEGACY_COSTUME_IDS[id] ?? id
    case 'action':
      return LEGACY_ACTION_IDS[id] ?? id
    case 'group':
      return LEGACY_GROUP_IDS[id] ?? id
  }
}

const mapSlot = (v: unknown): unknown => (typeof v === 'string' ? (LEGACY_SLOTS[v] ?? v) : v)
const mapAnchor = (v: unknown): unknown => (typeof v === 'string' ? (LEGACY_ANCHORS[v] ?? v) : v)
const mapState = (v: unknown): unknown => (typeof v === 'string' ? (LEGACY_STATES[v] ?? v) : v)
const mapSide = (v: unknown): unknown => (typeof v === 'string' ? (LEGACY_SIDES[v] ?? v) : v)

const normalizeLayerStep = (v: unknown): unknown => {
  if (!isObj(v)) return v
  const out: Obj = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === 'paleta') out['palette'] = val
    else if (k === 'oculto') out['hidden'] = val
    else out[k] = val
  }
  return out
}

const normalizePoseStep = (v: unknown): unknown => {
  if (!isObj(v)) return v
  const out: Obj = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === 'ojos') out['eyes'] = val
    else if (k === 'patas') out['legs'] = val
    else if (k === 'brazoIzq') out['leftArm'] = val
    else if (k === 'brazoDer') out['rightArm'] = val
    else if (k === 'salto') out['jump'] = val
    else if (k === 'temblor') out['shake'] = val
    else if (k === 'ancho') out['width'] = val
    else if (k === 'espalda') out['facingAway'] = val
    else if (k === 'patada') out['kick'] = mapSide(val)
    else if (k === 'kick') out['kick'] = mapSide(val)
    else out[k] = val
  }
  return out
}

const normalizeTrack = (v: unknown, stepFn: (s: unknown) => unknown): unknown => {
  if (!isObj(v)) return v
  const out: Obj = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === 'fijo' || k === 'fixed') out['fixed'] = stepFn(val)
    else if (k === 'pasos' || k === 'steps') out['steps'] = Array.isArray(val) ? val.map(stepFn) : val
    else if (k === 'cada') out['every'] = val
    else if (k === 'periodo') out['period'] = val
    else if (k === 'en' || k === 'at') {
      if (isObj(val)) {
        const atOut: Obj = {}
        for (const [tick, s] of Object.entries(val)) atOut[tick] = stepFn(s)
        out['at'] = atOut
      } else out['at'] = val
    } else out[k] = val
  }
  return out
}

const normalizeTracks = (v: unknown, stepFn: (s: unknown) => unknown): unknown =>
  Array.isArray(v) ? v.map(t => normalizeTrack(t, stepFn)) : v

const normalizeLayer = (v: unknown): unknown => {
  if (!isObj(v)) return v
  const out: Obj = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === 'dibujos') out['drawings'] = val // drawing names and pixel rows are user data: untouched
    else if (k === 'paleta') out['palette'] = val // palette letter keys are user data: untouched
    else if (k === 'libre') out['free'] = val
    else if (k === 'sale') out['leaves'] = val
    else if (k === 'anim') {
      if (isObj(val)) {
        const animOut: Obj = {}
        for (const [actKey, tr] of Object.entries(val)) {
          const mappedKey = actKey === '*' ? '*' : resolveLegacyId('action', actKey)
          animOut[mappedKey] = normalizeTracks(tr, normalizeLayerStep)
        }
        out['anim'] = animOut
      } else out['anim'] = val
    } else out[k] = val
  }
  return out
}

const normalizePiece = (raw: Obj): Obj => {
  const out: Obj = { type: 'piece' }
  for (const [k, val] of Object.entries(raw)) {
    if (k === 'tipo' || k === 'type') continue
    if (k === 'id') out['id'] = typeof val === 'string' ? resolveLegacyId('piece', val) : val
    else if (k === 'nombre') out['name'] = val
    else if (k === 'ranura' || k === 'slot') out['slot'] = mapSlot(val)
    else if (k === 'ancla' || k === 'anchor') out['anchor'] = mapAnchor(val)
    else if (k === 'ocupa' || k === 'occupies') out['occupies'] = Array.isArray(val) ? val.map(mapSlot) : val
    else if (k === 'tapaOjos') out['coversEyes'] = val
    else if (k === 'libre') out['free'] = val
    else if (k === 'cubreAccion' || k === 'coversAction')
      out['coversAction'] = Array.isArray(val) ? val.map(x => (typeof x === 'string' ? resolveLegacyId('action', x) : x)) : val
    else if (k === 'capas' || k === 'layers') out['layers'] = Array.isArray(val) ? val.map(normalizeLayer) : val
    else out[k] = val
  }
  return out
}

const normalizeCostume = (raw: Obj): Obj => {
  const out: Obj = { type: 'costume' }
  for (const [k, val] of Object.entries(raw)) {
    if (k === 'tipo' || k === 'type') continue
    if (k === 'id') out['id'] = typeof val === 'string' ? resolveLegacyId('costume', val) : val
    else if (k === 'nombre') out['name'] = val
    else if (k === 'cuerpo' || k === 'body') {
      if (isObj(val)) {
        const bodyOut: Obj = {}
        for (const [bk, bv] of Object.entries(val)) {
          if (bk === 'ojos') bodyOut['eyes'] = bv
          else bodyOut[bk] = bv
        }
        out['body'] = bodyOut
      } else out['body'] = val
    } else if (k === 'piezas' || k === 'pieces')
      out['pieces'] = Array.isArray(val) ? val.map(x => (typeof x === 'string' ? resolveLegacyId('piece', x) : x)) : val
    else out[k] = val
  }
  return out
}

// `git commit` patterns the design skill used to write: nested repetition, refused since v0.5 (see
// unsafePattern in pack.ts). They become an equivalent pattern with a single bounded repetition.
const SAFE_COMMIT = '\\bgit\\b[^|;&\\n]{0,120}\\scommit\\b'
const LEGACY_COMMIT: readonly string[] = [
  '\\bgit\\b(\\s+-C\\s+\\S+|\\s+-c\\s+\\S+)*\\s+commit\\b',
  '\\bgit\\b(\\s+-C\\s+\\S+)*\\s+commit\\b',
]
const safeInput = (v: unknown): unknown => (typeof v === 'string' && LEGACY_COMMIT.includes(v) ? SAFE_COMMIT : v)

const normalizeCond = (v: unknown): unknown => {
  if (!isObj(v)) return v
  const out: Obj = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === 'herramienta') out['tool'] = val
    else if (k === 'entrada' || k === 'input') out['input'] = safeInput(val)
    else if (k === 'estado' || k === 'state') out['state'] = mapState(val)
    else if (k === 'azar') out['chance'] = val
    else out[k] = val
  }
  return out
}

const normalizePlay = (v: unknown): unknown => {
  if (!isObj(v)) return v
  const out: Obj = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === 'grupo' || k === 'group') out['group'] = typeof val === 'string' ? resolveLegacyId('group', val) : val
    else if (k === 'pase' || k === 'pass') {
      if (isObj(val)) {
        const passOut: Obj = {}
        for (const [pk, pv] of Object.entries(val)) {
          if (pk === 'enTick' || pk === 'en') passOut['atTick'] = pv
          else if (pk === 'recibe' || pk === 'to') {
            passOut['to'] =
              typeof pv === 'string'
                ? resolveLegacyId('action', pv)
                : Array.isArray(pv)
                  ? pv.map(x => (typeof x === 'string' ? resolveLegacyId('action', x) : x))
                  : pv
          } else passOut[pk] = pv
        }
        out['pass'] = passOut
      } else out['pass'] = val
    } else out[k] = val
  }
  return out
}

const normalizeAction = (raw: Obj): Obj => {
  const out: Obj = { type: 'action' }
  for (const [k, val] of Object.entries(raw)) {
    if (k === 'tipo' || k === 'type') continue
    if (k === 'id') out['id'] = typeof val === 'string' ? resolveLegacyId('action', val) : val
    else if (k === 'etiqueta') out['label'] = val
    else if (k === 'prioridad') out['priority'] = val
    else if (k === 'dura') out['duration'] = val
    else if (k === 'atenuar') out['dim'] = val
    else if (k === 'mano' || k === 'hand') out['hand'] = mapSide(val)
    else if (k === 'cuando' || k === 'when') out['when'] = Array.isArray(val) ? val.map(normalizeCond) : normalizeCond(val)
    else if (k === 'pose') out['pose'] = normalizeTracks(val, normalizePoseStep)
    else if (k === 'efecto' || k === 'effect') out['effect'] = Array.isArray(val) ? val.map(normalizeLayer) : val
    else if (k === 'jugada' || k === 'play') out['play'] = normalizePlay(val)
    else out[k] = val
  }
  return out
}

const normalizeRuleItem = (v: unknown): unknown => {
  if (!isObj(v)) return v
  const out: Obj = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === 'si' || k === 'if') {
      if (isObj(val)) {
        const ifOut: Obj = {}
        for (const [ik, iv] of Object.entries(val)) {
          // NOTE: si.tipo is a regex on subagentType (e.g. "^Explore$"), never an item type!
          if (ik === 'tipo') ifOut['type'] = iv
          else if (ik === 'nombre') ifOut['name'] = iv
          else if (ik === 'descripcion') ifOut['description'] = iv
          else if (ik === 'modelo') ifOut['model'] = iv
          else if (ik === 'desde') ifOut['from'] = iv
          else if (ik === 'hasta') ifOut['to'] = iv
          else ifOut[ik] = iv
        }
        out['if'] = ifOut
      } else out['if'] = val
    } else if (k === 'disfraz' || k === 'costume') out['costume'] = typeof val === 'string' ? resolveLegacyId('costume', val) : val
    else if (k === 'siLibre') out['ifFree'] = val
    else if (k === 'apodo') out['nickname'] = val
    else out[k] = val
  }
  return out
}

const normalizeRules = (raw: Obj): Obj => {
  const out: Obj = { type: 'rules' }
  for (const [k, val] of Object.entries(raw)) {
    if (k === 'tipo' || k === 'type') continue
    if (k === 'activos' || k === 'active')
      out['active'] = Array.isArray(val) ? val.map(x => (typeof x === 'string' ? resolveLegacyId('costume', x) : x)) : val
    else if (k === 'reglas' || k === 'rules') out['rules'] = Array.isArray(val) ? val.map(normalizeRuleItem) : val
    else if (k === 'textos' || k === 'labels') {
      if (isObj(val)) {
        const labelsOut: Obj = {}
        for (const [lk, lv] of Object.entries(val)) labelsOut[resolveLegacyId('action', lk)] = lv
        out['labels'] = labelsOut
      } else out['labels'] = val
    } else out[k] = val
  }
  return out
}

const normalizeBundle = (raw: Obj): Obj => {
  const out: Obj = { type: 'bundle' }
  for (const [k, val] of Object.entries(raw)) {
    if (k === 'tipo' || k === 'type') continue
    if (k === 'formato') out['format'] = val
    else if (k === 'nombre') out['name'] = val
    else if (k === 'items') out['items'] = Array.isArray(val) ? val.map(normalizeDesignJson) : val
    else out[k] = val
  }
  return out
}

/**
 * Normalizes a parsed design JSON object from the v0.4 Spanish schema (or a mix) into the
 * canonical v0.5 English schema. Idempotent: running it twice produces the exact same object.
 */
export const normalizeDesignJson = (raw: unknown): unknown => {
  if (!isObj(raw)) return raw
  const t = raw['type'] ?? raw['tipo']
  if (t === 'pieza' || t === 'piece') return normalizePiece(raw)
  if (t === 'disfraz' || t === 'costume') return normalizeCostume(raw)
  if (t === 'accion' || t === 'action') return normalizeAction(raw)
  if (t === 'reglas' || t === 'rules') return normalizeRules(raw)
  if (t === 'paquete' || t === 'bundle' || t === 'pack') return normalizeBundle(raw)
  if ('tipo' in raw && !('type' in raw)) {
    const out: Obj = { type: raw['tipo'] }
    for (const [k, v] of Object.entries(raw)) if (k !== 'tipo') out[k] = v
    return out
  }
  return raw
}
