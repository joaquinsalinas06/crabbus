// What the scene draws: agents, the master, envelopes and question marks. Pure: no `$`, no Node.
//
// The crab's body and anchors live in rig.ts, every costume and action is data (pack.ts, with the
// built-in crew in builtin.ts), and fit.ts checks that a design sits on the body before it is used.

import { BUILTIN } from './builtin.ts'
import { putOn, stamp, type Canvas } from './canvas.ts'
import { resolveLegacyId } from './legacy.ts'
import { poseOf, renderAgent, type Pack } from './pack.ts'
import type { Pose } from './rig.ts'

export { CARD_H, CARD_W, DEFAULT_COLOR, canvas, cellsOf, get, mix, set, stamp, toBase64, toRgba, toWords, type Canvas } from './canvas.ts'
export { CLAY, POSE0, type Pose } from './rig.ts'

/** A costume id (built-in: fable, heavy, careful, medium, light, explore, other; or a user design). */
export type Costume = string
/** An action id (built-in: walk, reading, writing, testing, thinking, blocked, error, done, sleep). */
export type Mood = string

/** The pose an action implies at tick `t`. */
export const poseFor = (mood: Mood, t: number, pack: Pack = BUILTIN): Pose => poseOf(pack.actions[mood] ?? pack.actions[resolveLegacyId('action', mood)], t)

/** One agent card at (ox, oy): the crab in its costume, doing `mood`. */
export const drawAgent = (c: Canvas, ox: number, oy: number, costume: Costume, mood: Mood, t: number, pack: Pack = BUILTIN): void =>
  renderAgent(putOn(c), ox, oy, pack, costume, mood, t)

/** The master: the `master` costume, busy while any agent runs. */
export const drawMaster = (c: Canvas, ox: number, oy: number, busy: boolean, t: number, pack: Pack = BUILTIN): void =>
  renderAgent(putOn(c), ox, oy, pack, pack.costumes['master'] ? 'master' : 'other', busy ? 'master.busy' : 'master.free', t)

/** A 5x4 envelope, paper with a flap in `flap`. */
export const drawEnvelope = (c: Canvas, x: number, y: number, flap: number): void => {
  stamp(c, x, y, ['ppppp', 'pfpfp', 'gpfpg', 'ggggg'], { p: 0xf0f6fc, g: 0x9aa3ad, f: flap })
}

/** "?" bubble for a pending question to the master. */
export const drawQuestion = (c: Canvas, x: number, y: number): void => {
  stamp(c, x, y, ['qqq', '..q', '.q.', '...', '.q.'], { q: 0xd2a8ff })
}
