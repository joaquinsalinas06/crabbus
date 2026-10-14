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

export type BodyMotion = 'body' | 'ground' | 'claw.left' | 'claw.right' | 'card'
export type BodyPoint = { x: number; y: number }
export type BodyLayer = BodyPoint & {
  rows: string[]
  motion: BodyMotion
  when?: { legs?: 0 | 1; kick?: ('left' | 'right' | 'none')[] }
}
export type BodyDef = {
  id: string
  name: string
  layers: BodyLayer[]
  anchors: Record<Anchor, BodyPoint & { motion: BodyMotion }>
  armLift: { left: number; right: number }
  eyes: { points: BodyPoint[]; height: number; blink: number; look: number; color?: number }
  /** The body color a costume gets when it names none (the crab's is CLAY). */
  color?: number
  /** Fixed colors for the body's own row characters (a snout, ears, a belly), beside the H/B/S roles. */
  palette?: Record<string, number>
  origin: string
  source: unknown
}

/** Reference coordinates for pieces authored on the resting crab. */
export const CRAB_ANCHORS: Record<Anchor, BodyPoint> = {
  card: { x: 0, y: 0 }, body: { x: 9, y: 8 }, head: { x: 9, y: 6 },
  face: { x: 9, y: 9 }, 'claw.left': { x: 2, y: 9 },
  'claw.right': { x: 16, y: 9 }, ground: { x: 9, y: 13 },
}

const motionOffset = (body: BodyDef, motion: BodyMotion, p: Pose): BodyPoint => {
  if (motion === 'card') return { x: 0, y: 0 }
  return { x: p.dx, y: -p.lift + (motion === 'ground' ? 0 : p.bob) +
    (motion === 'claw.left' ? body.armLift.left * p.armL : motion === 'claw.right' ? body.armLift.right * p.armR : 0) }
}

export const bodyAnchorOffset = (body: BodyDef, anchor: Anchor, p: Pose): BodyPoint => {
  const a = body.anchors[anchor]
  const off = motionOffset(body, a.motion, p)
  const ref = CRAB_ANCHORS[anchor]
  return anchor === 'card' ? { x: 0, y: 0 } : { x: a.x - ref.x + off.x, y: a.y - ref.y + off.y }
}

/** How far an anchor has moved from its own resting point: for pieces drawn on that body itself. */
export const bodyAnchorMotion = (body: BodyDef, anchor: Anchor, p: Pose): BodyPoint =>
  anchor === 'card' ? { x: 0, y: 0 } : motionOffset(body, body.anchors[anchor].motion, p)

/** Where a body's anchor rests relative to the crab's: moves what was drawn for the crab onto this body. */
export const anchorShift = (body: BodyDef, anchor: Anchor): BodyPoint =>
  anchor === 'card' ? { x: 0, y: 0 } : { x: body.anchors[anchor].x - CRAB_ANCHORS[anchor].x, y: body.anchors[anchor].y - CRAB_ANCHORS[anchor].y }

const bodyPal = (color: number): Record<string, number> => ({ H: mix(color, 0xffffff, 0.22), B: color, S: mix(color, 0x000000, 0.28) })

export const drawBody = (put: Put, ox: number, oy: number, color: number, p: Pose, body: BodyDef, eyeColor = body.eyes.color ?? INK): void => {
  const pal = { ...bodyPal(color), ...body.palette }
  for (const layer of body.layers) {
    if (layer.when?.legs !== undefined && layer.when.legs !== p.legs) continue
    if (layer.when?.kick && !layer.when.kick.includes(p.kick ?? 'none')) continue
    const off = motionOffset(body, layer.motion, p)
    stampWith(put, ox + layer.x + off.x, oy + layer.y + off.y, layer.rows, pal, TAG.body)
  }
  if (p.facingAway) return
  const off = motionOffset(body, 'body', p)
  const ex = p.eyes === 'left' ? -body.eyes.look : p.eyes === 'right' ? body.eyes.look : 0
  const ey = p.eyes === 'up' ? -body.eyes.look : 0
  for (const eye of body.eyes.points) {
    const x = ox + eye.x + off.x + ex
    const y = oy + eye.y + off.y
    if (p.eyes === 'blink' || p.eyes === 'shut') put(x, y + body.eyes.blink, p.eyes === 'shut' ? mix(color, INK, 0.7) : eyeColor, TAG.eye)
    else for (let i = 0; i < body.eyes.height; i++) put(x, y + ey + i, p.eyes === 'red' ? 0xe5484d : eyeColor, TAG.eye)
  }
}

export { CARD_H, CARD_W }
