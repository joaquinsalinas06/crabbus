# Visual layer — handoff for the Opus session

Status when written (2026-10-12): the functional core works and is evidenced (see `evidence/`). The
terminal drawing exists and renders (see `evidence/ui/screen-01-bus-pane.txt`: three crabs with
labels in `AbovePrompt`, detail in `/bus`), but it is a **first pass**: static-ish cells, small sprites,
no scenes. Everything below is research to make it much better.

## What exists in code
- `src/sprites.ts` — port of savvy-progress's crab + 6 costumes (MIT, see LICENSES/ATTRIBUTION.md),
  frame computed per (costume, anim, tick), `toCells()` half-block reduction, RGBA output.
- `hooks/register.tsx` — `AbovePrompt` band (Image or Raster per `detectGraphics`) and `/bus` pane.
  Clock: `$.clock.every` -> `tick` state -> redraw. Frame cache keyed by costume|anim|phase|mail|mode.
- Known weakness: 15x7 cell reduction loses the costume detail (hats, props); `image` mode
  (iTerm2 needs `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`, Ghostty/kitty work as is) has NOT been seen drawn.

## How others do it (all MIT/mod API, terminal-only, no tokens)
| Mod | Technique | Take from it |
|---|---|---|
| clawd-spinner (saiharsha03) | `ui.render` on `Spinner`; scenes in `hooks/scenes/`, `frame.ts` places the sprite; ~12 fps timer started in `session.start`; hides below 54 cols; `scripts/preview.ts` makes a PNG contact sheet | scene-per-activity design, dev preview script |
| clawd-actor (BrianHuang813) | `AbovePrompt` stage; pure `scenes.ts` -> 4-row grid of cells -> `frameRows()` coloured runs; ~7 fps via frame counter in `$.state`; `tools/render.py` renders README GIFs; 30/40/60-column tests | pure scene functions + width tests + GIF export |
| crab-buddy (ziedgithub) | `Raster` + `$.ui.blit` in-place repaint, `$.agent.list` 1/s, costume per agent type | blit avoids full redraw; per-agent crabs |
| image-peek (arasovic) | `Image({source:{file,format:'png'},columns,rows,alt})` | real pixels in Ghostty/kitty/iTerm2 |
| Hermes `petSprite.tsx` (Ink) | half-block cell = 2 vertical pixels with fg/bg color; separate kitty Unicode-placeholder path for real pixels | the half-block painter is exactly `toCells()` |

Libraries (not directly usable inside the mod runtime, which has no Node/DOM; use them offline to
author/convert assets): `term-image` (half blocks, braille, kitty, iTerm2), `dapple` (braille/quadrants/
sextants/sixel/kitty behind one Canvas), `bevy_kitty` (shows kitty sprite sheets: upload once, then
only reposition -> zero re-uploads).

## What Claude Code itself uses
The mascot at startup is drawn by Claude Code's own renderer (Ink-style React for terminals), not by a
library you can import; it is made of block/half-block characters with fg/bg colors, the same trick as
`Raster` cells. Mods get the same primitives: `Box`/`Text` (colored runs), `Raster` (base64 u32 triplets
[codepoint, fg, bg], up to 512x256 cells, 1024 color pairs), `Image` (PNG/RGBA, 255x255 cells, 2 MiB),
`$.ui.blit` to swap cells/image without redrawing the tree. No official mascot API.
Note: Clawd frames from the Claude desktop app are Anthropic's artwork; claude-mod-clawd carries them,
CrabBus must not.

## Suggested improvements (in order)
1. Bigger cell sprites: reduce 30x28 to ~30x14 cells (1 px per half-block, no 2x2 sampling) so hats and props
   survive; or use 15x14 with quadrant glyphs (U+2596-259F) for 2x2 sub-pixels.
2. Scenes per real state (reading/writing/testing/blocked/error/done) as pure functions, like clawd-actor,
   plus a contact-sheet PNG script to review without launching Claude.
3. `$.ui.blit` for in-place frames instead of redrawing the whole band.
4. Verify `image` mode in Ghostty and iTerm2 (flag) with real screenshots; keep cells as the fallback.
5. Width tests at 40/60/80/120 columns; hide or compress when narrow.
6. Optional second skin pack from CC0 OpenGameArt sheets (Bit Era Game Character - Extended etc.), verifying
   each page's license first.
