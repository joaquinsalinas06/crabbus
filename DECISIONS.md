# Decisions

| Decision | Rejected alternative | Why |
|---|---|---|
| Native `SendMessage` for master→agent messages | A file/`$.store` mailbox delivered through `tool.call` deny/result | Exp. A: SendMessage reaches a running background subagent at its next tool round and keeps its context. Injecting through `tool.call` would alter tool results. |
| Observe `session.send` / `session.receive` (pass-through) | Rewriting messages | Gives "accepted" and "delivered" without touching content. |
| `bus_step` tool + ~140-token brief on `agent.spawn` | Inferring plan/stages from transcripts | Progress must be declared by the agent; inferring it would invent numbers. |
| Three separate layers (observed/declared/verified) | One percentage | Required: 4/5 declared ≠ 80 % of the work. |
| Hand-drawn 18x14 sprites, half-block cells | Downscaling savvy-progress's 30x28 SVG crab (v0.1) | The downscale lost hats and props; half-blocks keep exact colors. |
| One `Raster` for the whole stage + `$.ui.blit` | Redraw on every tick via state | Fewer redraws; envelopes can fly across cards. |
| Cells only | `Image` (kitty/iTerm2) | Pixel art at native size is exact in cells; Image needs terminal support and a flag in iTerm2, and was not verified. |
| Extra agents counted in the master's label | A "+N" card | A card cost 19 columns and broke the 40-column layout (caught by a test). |
| English schema & identifiers with v0.4 legacy normalization (`src/legacy.ts`) | Hard break dropping Spanish v0.4 JSON / IDs | Existing `.json` designs, `/disfraz`, `.cangrejo.json`, and built-in IDs continue loading with 0 pixel diffs; `/costume migrate` upgrades files safely with `.bak` backups. |
| Permission asks are shown, not answered: `tool.check` → `ask` in a person-decides mode marks the agent blocked until the call runs | Approve/deny buttons in the panel (the v3 design) | Tried live (2026-10-13) through `tool.check` and `classic.PermissionRequest`: Claude Code shows its own dialog regardless and the call waits on it; a plugin's answer neither closes it nor runs the call. Buttons would pretend. In auto mode an `ask` goes to the classifier, so nothing is shown. |
| Per-agent usage from `turn.step` results; cost = usage × list price, shown with `≈` | Cost from `session.measure` deltas attributed to "the last agent that stepped" | No API gives a subagent's cost; deltas mis-attribute when agents run in parallel. The session total stays the ledger's real number. |
| Declared stages shown as `done/total` in METRICS | The design's `TASKS 57%` | A percentage of declared stages reads as % of the work, which the three-layer rule forbids. |
| Cards use the full 18x7 crab; rows and the half-size view use a 9x4 halving that keeps rare colors | Re-drawing every costume at small size | Halving keeps any costume (including users' designs) recognizable with no extra art. |
| Card backgrounds are neutral grays; the state's color is the border, chips use tints with every channel ≤ 25 | Tinted card backgrounds (the design's) | Claude Code may draw in 256 colors (it does inside tmux even with COLORTERM=truecolor): a gray lands on the gray ramp, a dark tint rounds to the cube's #5f5f5f (seen live). |
| List crabs are text (half blocks) inside Buttons, redrawn twice a second | Rasters repainted with `$.ui.blit` at the configured fps | A Raster cannot be pressed; the design asks for a press anywhere on a card. Two frames a second matches the design's stepped bob. The detail's crab stays a Raster. |

## Unverified assumptions (what breaks if wrong)

- `session.receive` fires for every SendMessage delivery to a subagent (verified once in a real run; if it does not, "delivered" stays unset and only the declared ack shows).
- The band's `maxRows` is the only height limit (if not, the stage may scroll).
- `$.state` survives a hot reload (designed for, unverified); module timers restart on reload.
- `$.session.messages({ agentId, as: 'api' })` reads a running background subagent's transcript (if not, the detail falls back to the hooks' tool log).
