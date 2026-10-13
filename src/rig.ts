// Contract A: the body rig. Pure: no `$`, no Node.
//
// A body draws itself in a pose and says where its named anchors are in that pose. Every piece
// (hat, moustache, jacket, tool) is drawn on the 18x14 card *as it would sit on the crab at rest*
// and names the anchor it holds onto; when the body bobs, jumps, shakes or raises a claw, the
// piece moves exactly as its anchor does. That is what keeps a hat on the head in every frame.
//
// Contract B lives here too: the slots a piece can occupy and the fixed order they are drawn in.

import { CARD_H, CARD_W, mix, stampWith, type Put } from './canvas.ts'

export type Eyes = 'open' | 'blink' | 'left' | 'right' | 'up' | 'shut' | 'red'
export const EYES: readonly Eyes[] = ['open', 'blink', 'left', 'right', 'up', 'shut', 'red']

export type Pose = {
  bob: number // 0 or 1: body (and what it wears) one pixel lower
  lift: number // 0..3: whole crab up (jump)
  dx: number // horizontal shake
  legs: 0 | 1 // which leg pair is lifted
  armL: number // 0 down, 1 raised
  armR: number
  eyes: Eyes
  /** Turning: 1 = facing us, smaller = seen more from the side (the whole crab and what it wears narrows). */
  width: number
  /** Seen from behind: no eyes, nothing worn on the face. */
  facingAway: boolean
  /** A leg stretched out to kick. */
  kick: 'left' | 'right' | null
}

export const POSE0: Pose = { bob: 0, lift: 0, dx: 0, legs: 0, armL: 0, armR: 0, eyes: 'open', width: 1, facingAway: false, kick: null }

/** Mirrors a pose left/right: used when an action's prop has to move to the other claw. */
export const mirrorPose = (p: Pose): Pose => ({
  ...p,
  armL: p.armR,
  armR: p.armL,
  eyes: p.eyes === 'left' ? 'right' : p.eyes === 'right' ? 'left' : p.eyes,
  kick: p.kick === 'left' ? 'right' : p.kick === 'right' ? 'left' : null,
})

/** Slots hidden while the crab shows its back. */
export const FACE_SLOTS: readonly string[] = ['face.mouth', 'face.eyes']

/** Shared pixel-tag constants between the renderer (rig.ts / pack.ts) and the fit check (fit.ts). */
export const TAG = {
  body: 'body',
  eye: 'eye',
  piece: (id: string) => `piece:${id}`,
  effect: (id: string) => `effect:${id}`,
  free: (tag: string) => `${tag}:free`,
  leaves: (tag: string) => `${tag}:leaves`,
  isPiece: (tag: string) => tag.startsWith('piece:'),
  isEffect: (tag: string) => tag.startsWith('effect:'),
  pieceId: (tag: string) => tag.slice('piece:'.length).replace(/:(free|leaves)$/, ''),
  effectId: (tag: string) => tag.slice('effect:'.length).replace(/:(free|leaves)$/, ''),
  isFree: (tag: string) => tag.endsWith(':free'),
  isLeaves: (tag: string) => tag.endsWith(':leaves'),
  stripFlags: (tag: string) => tag.replace(/:(free|leaves)$/, ''),
} as const

/**
 * Turning, as a transform of everything drawn for the body and what it wears: columns squeeze
 * toward the crab's centre. Neighbouring pixels stay neighbours, so a piece that held on still does.
 */
export const turned = (put: Put, ox: number, p: Pose): Put => {
  if (p.width >= 1) return put
  const cx = ox + p.dx + CARD_W / 2
  return (x, y, col, tag) => put(Math.floor(cx + (x + 0.5 - cx) * p.width), y, col, tag)
}

// ---- anchors: where a piece holds on

export const ANCHORS = ['card', 'body', 'head', 'face', 'claw.left', 'claw.right', 'ground'] as const
export type Anchor = (typeof ANCHORS)[number]

export const ANCHOR_HELP: Record<Anchor, string> = {
  card: 'fixed on the card: does not move with the crab (stars, planted flags)',
  body: 'follows the whole body (clothes, resting props)',
  head: 'follows the head (caps, hats, antennae)',
  face: 'follows the face (moustaches, glasses, eyepatches)',
  'claw.left': 'follows the left claw, including when raised',
  'claw.right': 'follows the right claw, including when raised',
  ground: 'follows the legs: only rises when jumping',
}

/** How far an anchor has moved from the resting crab, in this pose. */
export const anchorOffset = (a: Anchor, p: Pose): { x: number; y: number } => {
  switch (a) {
    case 'card':
      return { x: 0, y: 0 }
    case 'ground':
      return { x: p.dx, y: -p.lift }
    case 'claw.left':
      return { x: p.dx, y: p.bob - p.lift - 2 * p.armL }
    case 'claw.right':
      return { x: p.dx, y: p.bob - p.lift - 2 * p.armR }
    default:
      return { x: p.dx, y: p.bob - p.lift }
  }
}

// ---- slots and layer order

export const SLOTS = ['behind', 'torso', 'neck', 'face.mouth', 'face.eyes', 'head', 'hand.left', 'hand.right', 'trim'] as const
export type Slot = (typeof SLOTS)[number]

export const SLOT_HELP: Record<Slot, string> = {
  behind: 'behind the body (capes, backpacks, planted flags)',
  torso: 'over the body (coats, shirts, vests)',
  neck: 'ties, scarves, collars',
  'face.mouth': 'moustaches, pipes, microphones',
  'face.eyes': 'glasses, eyepatches, masks',
  head: 'caps, hats, helmets (one at a time)',
  'hand.left': 'held by the left claw',
  'hand.right': 'held by the right claw',
  trim: 'loose decoration around the crab (stars, costume sparkles)',
}

/** The body is drawn after `behind` and before every other slot; action effects go last. */
export const slotLayer = (s: Slot): number => (s === 'behind' ? 0 : 2 + SLOTS.indexOf(s))
export const BODY_LAYER = 1

// ---- the crab body

export const CLAY = 0xd97757
const INK = 0x1f1e1d

const BODY = [
  '....HHHHHHHHHH....',
  '...HBBBBBBBBBBS...',
  '...BBBBBBBBBBBS...',
  '...BBBBBBBBBBBS...',
  '...BBBBBBBBBBBS...',
  '....SSSSSSSSSS....',
]

/** Card row of the top of the head when the crab rests. */
export const HEAD_TOP = 6

const bodyPal = (body: number): Record<string, number> => ({ H: mix(body, 0xffffff, 0.22), B: body, S: mix(body, 0x000000, 0.28) })

/** Draws the crab at card origin (ox, oy). Body pixels are tagged `TAG.body`, eye pixels `TAG.eye`. */
export const drawCrab = (put: Put, ox: number, oy: number, body: number, p: Pose, eyeColor = INK): void => {
  const by = oy + HEAD_TOP + p.bob - p.lift
  const bx = ox + p.dx
  const pal = bodyPal(body)
  // legs stay on the ground unless jumping
  const ly = oy + 12 - p.lift
  const leg = pal['S'] as number
  for (const [x, up] of [[4, p.legs === 0], [6, p.legs === 1], [11, p.legs === 0], [13, p.legs === 1]] as const) {
    // a kicking leg stretches sideways from the body instead of standing
    if ((p.kick === 'left' && x === 4) || (p.kick === 'right' && x === 13)) {
      const d = x === 4 ? -1 : 1
      put(bx + x, ly, leg, TAG.body); put(bx + x + d, ly, leg, TAG.body); put(bx + x + 2 * d, ly - 1, leg, TAG.body)
      continue
    }
    put(bx + x, ly, leg, TAG.body)
    if (!up) put(bx + x, ly + 1, leg, TAG.body)
  }
  stampWith(put, bx, by, BODY, pal, TAG.body)
  // claws: 2x2, raised two pixels when the arm is up
  const claw = pal['B'] as number
  const clawHi = pal['H'] as number
  for (const [x, raised] of [[1, p.armL], [15, p.armR]] as const) {
    const y = by + 2 - raised * 2
    put(bx + x, y, clawHi, TAG.body); put(bx + x + 1, y, clawHi, TAG.body)
    put(bx + x, y + 1, claw, TAG.body); put(bx + x + 1, y + 1, claw, TAG.body)
  }
  // eyes: one pixel wide, two tall; none from behind
  if (!p.facingAway) for (const [x, y, col] of eyePixels(p, ox, oy, body, eyeColor)) put(x, y, col, TAG.eye)
}

/** The eye pixels the crab draws in this pose (the fit check keeps pieces off them). */
export const eyePixels = (p: Pose, ox = 0, oy = 0, body = CLAY, eyeColor = INK): [number, number, number][] => {
  const by = oy + HEAD_TOP + p.bob - p.lift
  const bx = ox + p.dx
  const ex = p.eyes === 'left' ? -1 : p.eyes === 'right' ? 1 : 0
  const ey = p.eyes === 'up' ? -1 : 0
  const col = p.eyes === 'red' ? 0xe5484d : eyeColor
  const out: [number, number, number][] = []
  for (const x of [5, 12]) {
    if (p.eyes === 'blink' || p.eyes === 'shut') out.push([bx + x + ex, by + 3, p.eyes === 'shut' ? mix(body, INK, 0.7) : eyeColor])
    else out.push([bx + x + ex, by + 2 + ey, col], [bx + x + ex, by + 3 + ey, col])
  }
  return out
}

export { CARD_H, CARD_W }
