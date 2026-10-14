import { test } from 'node:test'
import assert from 'node:assert/strict'
import { C, hex, nearest256, setTruecolor } from '../src/theme.ts'

const CUBE = [0, 95, 135, 175, 215, 255]
const inPalette = (n: number): boolean => {
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const cube = [r, g, b].every(v => CUBE.includes(v))
  const gray = r === g && g === b && r >= 8 && r <= 238 && (r - 8) % 10 === 0
  return cube || gray
}

test('palette: with truecolor the colors pass through unchanged', () => {
  setTruecolor(true)
  assert.equal(hex(C.master), '#ff8a6b')
})

test('palette: without truecolor every color becomes an exact 256-color entry', () => {
  setTruecolor(false)
  for (const v of Object.values(C)) assert.ok(inPalette(nearest256(v)), `${v.toString(16)} is not a 256-color entry`)
  setTruecolor(true)
})

test('palette: the design orange keeps its hue instead of turning pink', () => {
  setTruecolor(false)
  const n = nearest256(C.master) // #ff8a6b
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  assert.ok(r > g && g > b, `expected warm orange, got ${n.toString(16)}`)
  assert.ok(g > 90, `expected a visible green channel, got ${n.toString(16)}`)
  setTruecolor(true)
})

test('palette: the exact hex handed on maps back to the same entry', () => {
  setTruecolor(false)
  const n = nearest256(C.cyan)
  assert.equal(nearest256(n), n)
  assert.equal(hex(C.cyan), `#${n.toString(16).padStart(6, '0')}`)
  setTruecolor(true)
})
