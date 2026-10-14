# How the crabs are drawn

Everything CrabBus draws is cells: no `Image` protocol, no tokens, no Node at runtime. The mod runtime
gives the same primitives Claude Code uses for its own mascot: `Box`/`Text` (colored runs), `Raster`
(cells of `[codepoint, fg, bg]`) and `$.ui.blit` (swap a Raster's cells without redrawing the tree).
Why cells and not `Image` is in `DECISIONS.md`.

## The pipeline

| Step | Where | What it does |
|---|---|---|
| Records | `src/model.ts` | What hooks observed and what agents declared (`bus_step`), per agent. Nothing is drawn from anything else. |
| Mood | `src/pack.ts` (`resolveAction`) | Each frame turns an agent's record into facts and picks the highest-priority action whose condition they meet; with nothing specific known, the crab walks. |
| Plays | `src/director.ts` | One-shot actions (a spin, a kick-about) that start when a condition *becomes* true, and the passes between crabs (at most `MAX_PASSES`). |
| Pose and body | `src/rig.ts` | The crab's body, its anchors (head, face, body, claw, ground, card) and the pose an action implies at tick `t`. |
| Costume | `src/pack.ts`, `src/builtin.ts` | Costumes and actions are data: the built-in crew, plus the user's JSON designs checked by `src/fit.ts` before use. |
| Card | `src/art.ts` | `drawAgent` / `drawMaster`: one crab in its costume, doing its mood, on an 18 x 14 pixel card. |
| Scene | `src/scene.ts` | `layout` decides what fits (`none`, one text `line`, or the `stage`); `compose` draws the stage, envelopes in flight and question marks. Pure: callers pass `now` and the tick. |
| Cells | `src/canvas.ts` | `cellsOf`: one cell is two stacked pixels (`▀`, foreground over background), so a W x H sprite takes W columns and H/2 rows and every pixel keeps its exact color. |
| Paint | `hooks/register.tsx` | The band above the prompt (`AbovePrompt`) is one `Raster` for the whole stage, repainted with `$.ui.blit` by `paint()` on a `$.clock.every` timer (`fps`, default 6, 1-10; one frame a second with `reduceMotion`). The `/bus` pane draws its list crabs as half-block text inside buttons, so a card can be pressed, and the detail crab as a `Raster`. |

The band adapts to the terminal: fewer than two cards' width or fewer than 8 rows gives one colored
text line; extra agents are counted in the master's label instead of taking a card
(`spec/art.spec.ts`, "layout scales with width and height").

## Reviewing art without launching Claude Code

`tools/preview.ts` renders scenes to PNG the way a terminal paints half-block cells:

```bash
node tools/preview.ts out.png 4 [--light]                 # the built-in crew and a band
node tools/preview.ts --design my-design.json --out x.png   # fit check, then every action on dark and light
```

The golden tests (`spec/golden.spec.ts`) pin every built-in costume in every action, and the busy
master, by pixel fingerprint (the free master moves on purpose and has its own test), so a change to the
art or the rig shows up as a test failure, not as a surprise in the terminal.

## Prior art

Other mods and painters read while designing the renderer. Only savvy-progress contributed drawing
data; the rest are patterns, no code copied. Credits and licenses are in `LICENSES/ATTRIBUTION.md`.

| Source | Technique | In CrabBus |
|---|---|---|
| savvy-progress | crab and costume drawings | the crab, the first costume ideas, palette and tier colors (MIT); every sprite redrawn by hand at 18 x 14 |
| crab-buddy | `Raster` + `$.ui.blit` in-place repaint, one costume per agent type | the single blitted stage |
| clawd-actor | pure scene functions on an `AbovePrompt` stage, width tests | the same idea: pure scenes, layout tests |
| clawd-spinner | one scene per activity, a PNG contact-sheet preview script | the same idea: per-state actions, `tools/preview.ts` |
| Hermes `petSprite` | half-block painter: one cell = two vertical pixels | the same encoding in `cellsOf` |
| image-peek | `Image` with real pixels | not used (see `DECISIONS.md`) |

Clawd frames from the Claude desktop app are Anthropic's artwork; CrabBus does not carry them.

## Open

- `Image` mode (real pixels in Ghostty, kitty and iTerm2) has not been verified on screen; cells stay the
  renderer until it is. `toRgba` in `src/canvas.ts` already produces the pixels it would need.
- A second skin pack from CC0 sprite sheets, checking each sheet's license first.
