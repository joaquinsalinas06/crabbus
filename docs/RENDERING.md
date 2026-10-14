# How the crabs are drawn

CrabBus draws into one pure pixel canvas, then chooses its transport from `e.surface`. Terminal
uses `Raster` cells and `$.ui.blit`; Desktop uses Client-driven `Svg` frames. Both share the
same state, models and `Box`/`Text`/`Button`/`Input` controls. No Node or model tokens are needed
at runtime. The terminal's cells-versus-Image decision is recorded in `DECISIONS.md`.

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
| SVG | `src/svg.ts` | `toSvg`: horizontal runs of equal-color pixels become rectangles; transparent pixels stay transparent unless a card background is supplied. The SVG preserves the canvas dimensions and uses `crispEdges`. |
| Paint | `hooks/register.tsx` | `renderCanvas` selects Raster for terminal and Svg for Desktop. Terminal swaps frames with `blit` at `fps` (default 6, 1–10). Desktop requests the same shared `paneCanvas` or `compose` frame via `ui.message`. Reduced motion fixes the pose at tick 1 and omits director plays on both surfaces. Sprites sit beside shared buttons in the list, detail and wardrobe. |

The band adapts to the terminal: fewer than two cards' width or fewer than 8 rows gives one colored
text line; extra agents are counted in the master's label instead of taking a card
(`spec/art.spec.ts`, "layout scales with width and height").

## Desktop layout

The panel keeps the terminal's state, models, control keys and callbacks, but uses the host's
native controls and bold/color text hierarchy on Desktop. Spacing uses numeric cells. Metrics
wrap into two columns in a narrow pane. Card text fills the available width and wraps; terminal
character-count truncation and padding do not run on Desktop.

Primary view, filter, navigation and wardrobe controls use native Button chrome. Delegation is
flexible rows with a name, declared stage count and a status label, without ASCII tree branches.
Separators use Box borders rather than repeated line characters. The wardrobe uses two explicit rows of two flexible-width cards per page, independent of terminal
column estimates. The four slot keys are stable across pagination; empty slots remain in the last
page. Each card and row reserves ten cells vertically, and the art reserves four before its Client
loads. Client regions also carry explicit dimensions, so loading does not collapse the layout.
The same occupied slots keep their surface clock on Previous/Next; only props and costume data
change. Previous/Next controls sit below the grid rather than taking its side space.

`barSvg` and `sparkSvg` draw actual tracks and history plots for context, usage, cost and token
history. There is no native progress element in this mods table, so these read-only graphics use
Svg while all controls remain native. Stage completion stays a declared count: Desktop does not
present it as a percentage of real work. Pixel-art sprites remain unchanged; the director and frame counter drive both renderers.

Tests cover full long names at 36, 56 and 90 columns, graphical bars instead of block glyphs in
list and detail, native controls, wardrobe pagination and the terminal's existing behavior.

Desktop can run a bundled Claude Code engine older than the `claude` binary on PATH. The installed
app session used 2.1.295 while the shell used 2.1.300. In 2.1.295, named Box spacing (`xs`, `sm`)
and Text `size`, `weight`, `tabular` props reject the entire drawing after the render hook returns;
even `tabular: false` is rejected. That validation happens outside the hook's catch, so no fallback
can rescue that tree. The plugin therefore uses numeric spacing and omits those Text props on
both surfaces. The full kit passes with both engines; run `plugin test .` with the app's bundled
binary as well as PATH's CLI when validating Desktop changes. A passing newer kit alone does
not establish compatibility with the running app. Actual post-fix paint still needs a plugin reload.

## Desktop transport and bounds

`Svg` receives the complete document in `source`, required `alt`, and CSS dimensions at four
pixels per art pixel. It has no children. `isInteractive` is omitted: the surface draws an image,
not an interactive frame. Svg has no addressable key; a surrounding Client supplies its animation
address, while terminal Raster keys remain targets for `blit`.

`hooks/crab-client.js` has no mods API or business state. It starts one `surface.every` timer,
posts `{ kind: 'frame' }`, and draws the SVG from its props. `ui.message` verifies the engine's
component, site and element against the mounted records, then returns the current art as props.
`paneCanvas` is shared with terminal blit; `compose` is shared for the stage. The same director,
frame counter and costume phases apply on both surfaces. Width and height stay stable between
frames, and panel buttons remain outside Client.

`reduceMotion` uses a plain Svg with no Client timer. A `ui.fault` leaves the failed Client out
on the next drawing and uses a still pose while retaining controls. Reloading the plugin clears
that fault record and permits a retry. Each Client props payload is also checked against its
100,000-character serialized limit. A missing/withheld Client constructor, or one that throws
while constructing the tree, falls back to plain Svg immediately. Client faults record their
reason in the engine debug log and request a redraw.

The master is present in an empty agents pane, including when a reload draws it before
`session.start`. Desktop also draws the master above the prompt with no subagents, unless the
band is off, a survey is visible, or its own pane already shows the master. A failed pane render
retains a static snapshot of the last successful tree (old callbacks are never replayed); a failure before the first drawing shows a static crowned
master and a short diagnostic. Recovery does not call the engine: re-entry failures forbid those
calls, so a catch that merely delegates to `next` could leave the pane empty. These regressions
are tested in the kit; recovery in the installed Desktop app still needs a reload and visual check.

The maintenance clock does not invalidate the Desktop wardrobe: its Clients update art directly,
and state/design/control changes redraw the panel when needed. Agent lists and AbovePrompt time
labels refresh every five seconds; detail/transcript and reduced-motion views refresh every second; saved designs are polled
by elapsed time every two seconds, including at low fps and with reduced motion. State and control
changes can trigger additional redraws. The shared clock only blits registered terminal sites;
Desktop registration still counts when hiding its own AbovePrompt band. Closing the pane clears
its sites on all attached surfaces.

The local kit accepts a single SVG source above 100,000 characters, multiple sources above
100,000 together, and sources plus text above 100,000. It rejects a source above the documented
131,072-character limit. `tests/svg.test.ts` retains these cases and a two-rectangle static probe
as test fixtures; they are not rendered by the normal plugin.

This does not establish the installed app's aggregate limit. Until that is checked, a Desktop
render tree above 100,000 serialized characters retains a static master and substitutes other SVG pictures with their alternative
text, preserving the controls and their handlers. An individual source above 131,072 characters
also falls back to alternative text. Existing text/control content is not truncated by this
picture fallback; a tree whose controls alone exceed the budget remains a limit to investigate.
SVG markup is never truncated.

`spec/svg.spec.ts` independently reconstructs every pixel from the emitted rectangles, including
transparent pixels, backgrounds, odd dimensions, built-in costumes/actions, miniatures and a
scene with an envelope. The kit tests exercise the same panel controls on terminal and Desktop,
state changes, reduced-motion poses, close/reopen, simultaneous surfaces and live design reload.
Animation tests advance both host and surface clocks at 1, 6 and 10 fps, verify changing frames
in list, detail, wardrobe and stage, and cover recovery after an injected Client failure. A pure
Client test verifies that props updates do not create duplicate timers. Pagination tests compare
the four slot geometries at 36, 56 and 90 columns and verify that a timer already partway through
its interval does not restart on Next. A maintenance test checks changing wardrobe frames over
six seconds without rebuilding the panel.

## Desktop verification

User screenshots confirmed the initial Desktop renderer paints the master, subagent sprites,
metrics and cards. They also exposed terminal glyph bars, character-based clipping and ASCII
branches; the Desktop layout above addresses those issues.

**Pending:** final visual review of the updated native layout, focus, zoom, themes and performance
in the real app. Kit tests validate trees and host contracts; they do not replace that review.

1. Load this worktree's plugin in a Desktop session that supports mods. For the minimal image
   check, use the literal SVG and 72×56 props from the static probe in `tests/svg.test.ts` in a
   temporary Desktop AbovePrompt branch. Expect red at the upper left, green at the lower right,
   transparent space between them, and a prompt that remains usable. Remove that branch afterward.
2. Open `/bus`: expect a master crab and the same metrics, filters and collapsible sections.
   Start an agent, block it, then finish it: both the text and pose must reflect each state,
   with walking, director plays and flying envelopes unless `reduceMotion` is enabled.
3. Open agent detail, switch transcript tabs, send a message and return to the list. Open the
   wardrobe, select a costume, change a rule and confirm that the change persists and reloads.
4. With the pane closed, exercise `band=auto`, `stage` and `off`, then reopen it. Resize, change
   theme and zoom: check clipping, crispness, proportions, transparency, scroll, focus and hotkeys.
5. Repeat the SVG bounds fixtures in the app before lifting the conservative aggregate budget.
   Measure app performance separately; the README's existing CPU figures are terminal samples.

Desktop animation is implemented and kit-tested. Smoothness and actual frame latency still need
review in the installed app; kit clock tests cannot establish paint performance or transport
latency. At most one request per Client timer tick crosses to the hook, and no model is called.

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
