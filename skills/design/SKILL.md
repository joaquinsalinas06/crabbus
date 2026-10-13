---
name: design
description: Design or customize the appearance of CrabBus crabs (the animated subagents). Use when asked for a hat, outfit, clothing, mustache, glasses, or new item ("quiero un gorrito de capibara", "ponle un saco", "un gorro para el agente", "ropa", "vestir", "diseñar", "give it a coat"), a costume or theme (Christmas, holiday, "disfraz de navidad"), a new action or animation ("cuando haga git commit que salte", "que baile al terminar", "jump when git commit runs"), custom text or names, costume assignment rules ("quién lleva qué disfraz"), or sharing designs (/costume export, import, /disfraz).
---

# Designing CrabBus Crabs

Everything a crab wears or does consists of **JSON data** in `~/.claude/crabbus/*.json` (find the exact path with `/costume folder`, or legacy `/disfraz folder`). Files reload automatically in ~2 seconds without restarting plugins. Never edit plugin source code directly for a costume design.

Before being used, each design runs through the **fit validator**: it is rendered across all actions and ticks, and rejected if it floats, overflows the card boundaries, covers the eyes unexpectedly, or lacks contrast against dark or light backgrounds. Your goal is to pass validation on the first try and look great.

## Workflow (Always Follow This)

1. Understand what is needed and which **slot** it occupies (see table below). If something already occupies that slot in the target costume, note it: only one piece fits per slot.
2. Write the JSON in the scratchpad (not directly in the designs folder yet).
3. Preview and validate:
   `node ~/uni/26-2/crabbus/tools/preview.ts --design <file-or-folder> [--costume <id>] --out <png>`
   (Note: `--costume` also works, as well as legacy `--diseno` / `--disfraz`).
   Prints fit issues in English (exits with status 1 if any issues exist) and renders the costume across all actions—on dark background at the top, light background at the bottom.
4. Inspect the rendered PNG. Iterate until there are zero validation issues **and** the design is clearly recognizable.
5. Present the PNG to the user and confirm before installing.
6. Install by copying the JSON to the designs folder (or use `/costume import <file>`, which validates again). Confirm with `/costume list`.

## The Card: 18x14 Pixels, Crab at Rest

Draw each piece **where it sits on this stationary crab**, in card coordinates (x 0–17, y 0–13). The anchor ensures it tracks the body when the crab moves.

```
     012345678901234567
  0  ..................   rows 0-5: space for hats (leave row 0 free:
  1  ..................   the crab jumps up 1 px upon completion)
  2  ..................
  3  ..................
  4  ..................
  5  ..................   <- base of a hat sits here (touches head)
  6  ....BBBBBBBBBB....   <- top of head (x 4-13)
  7  ...BBBBBBBBBBBB...
  8  .ccBBoBBBBBBoBBcc.   o = eyes (x 5 and x 12, rows 8-9; shift +-1 when looking)
  9  .ccBBoBBBBBBoBBcc.   c = claws (x 1-2 and 15-16; raise 2 rows when lifted)
 10  ...BBBBBBBBBBBB...   <- mouth / mustache: rows 10-11, center x 8-9
 11  ....BBBBBBBBBB....
 12  ....l.l....l.l....   l = legs
 13  ......l......l....
```

A terminal cell displays 2 pixels vertically; design in pixel units, which appear square in the terminal.

## Anchors (What the Piece Attaches To)

| anchor | moves with | intended for |
|---|---|---|
| `head` | entire body (bob, jump, shake) | hats, caps, antennas |
| `face` | same as head | mustaches, glasses, eyepatches |
| `body` | same | clothing, resting items |
| `claw.left` / `claw.right` | plus 2 px upwards when lifting that claw | held objects |
| `ground` | only jump vertical motion | shoes, puddles |
| `card` | stationary (fixed card frame) | floating stars, banners (set `"free": true`) |

## Slots (Contract: One Piece Per Slot) and Draw Order

`behind` -> *body* -> `torso` -> `neck` -> `face.mouth` -> `face.eyes` -> `head` -> `hand.left` -> `hand.right` -> `prop` -> *action effect*

- `behind`: behind the body (capes, backpacks). `torso`: jackets, shirts. `neck`: ties, scarves. `face.mouth`: mustaches, pipes. `face.eyes`: glasses, patches. `head`: a single hat. `hand.*`: held props. `prop`: loose decorative items.
- `"occupies": ["face.eyes"]`: use if a piece covers an additional slot (e.g. a helmet with visor), preventing other items from mounting there.
- Built-in actions use hands: reading and testing use the left hand; writing uses the right hand. If a costume already has an item in that hand, the action swaps to the opposite claw; if both are occupied, the hand item is tucked away during the action. No manual setup is needed, but keep this in mind when picking hands.

## Format

Each file is a single object with `"type"`, or a `"bundle"` with `"items": [...]`. All IDs must be lowercase alphanumeric strings (`a-z0-9._-`).

### piece
```json
{
  "type": "piece", "id": "beret", "name": "beret", "slot": "head", "anchor": "head",
  "layers": [{
    "pos": [0, 3],
    "drawings": { "a": ["......kk..........", "....rrrrrrrrr.....", "...rrrrrrrrrrr...."] },
    "palette": { "r": "#b8322a", "k": "#3b1d14" }
  }]
}
```
- `layers`: 1–6 layers. Each layer has `pos` [x, y] (top-left offset on card), `drawings` (1–8 named drawings; text rows where `.` is transparent and each character is in `palette`), `palette` (char -> `#rrggbb`), and optional `anim`.
- `"free": true` (on piece or layer) = deliberately allowed not to touch body pixels (e.g. floating stars).
- `"coversEyes": true` = deliberately allowed to obscure an eye (e.g. an eyepatch).
- `"coversAction": ["reading"]` = piece replaces the built-in action visual effect (e.g. detective magnifying glass).

### anim: Per-Action Tracks
`"anim": { "<action-id>": [tracks], "*": [fallback tracks] }`. `[]` for an action = stationary.
A track is one of:
- `{ "steps": [step, step, ...], "every": 1 }`: one step per tick (or every N ticks), looped.
- `{ "period": 16, "at": { "0": step } }`: step at specific ticks in period (twinkles, flashes).
- `{ "fixed": step }`: static pose offset.

Layer step: `{ "d": "drawing_name", "x": 0, "y": -1, "palette": { "r": "#ff0000" }, "hidden": true }`. Tracks merge in order; later tracks override earlier ones. At 6 fps, 6 ticks = 1 second.

### costume
```json
{ "type": "costume", "id": "french", "name": "french", "color": "#c0392b",
  "body": { "color": "#d97757", "eyes": "#1f1e1d" }, "pieces": ["beret"] }
```
`color` styles the name in the header and status line. `body` is optional (customizes crab body/eyes).

### action
```json
{
  "type": "action", "id": "commit", "label": "⎇ commit", "color": "#f78166",
  "when": { "tool": "Bash", "input": "\\bgit\\b(\\s+-C\\s+\\S+)*\\s+commit\\b" }, "priority": 60, "duration": 2500,
  "pose": [{ "fixed": { "leftArm": 1, "rightArm": 1 } }, { "steps": [{ "jump": 0 }, { "jump": 1 }] }],
  "effect": [{ "drawings": { "a": ["s.....s"] }, "palette": { "s": "#f5c542" }, "anim": { "*": [{ "steps": [{}, { "hidden": true }] }] } }]
}
```
- `when`: object or array of criteria: `tool` (regex matching tool name), `input` (regex matching input command/path), `state` (`asleep`, `finished`, `failed`, `blocked`, `error`, `thinking`, `working`, `starting`, `tests-ok`). Note: condition states use `finished` and `asleep`, while built-in action IDs are `done` and `sleep`.
- `priority`: highest matching priority wins. Defaults: sleep 100, done 99, blocked 90, testing 55, reading/writing 50, error 40, thinking 10, walk 5. Custom actions default to 60.
- `duration` (ms): keeps display active for specified ms after tool ends (useful for brief commands like `git commit`).
- `pose`: tracks with steps `{ bob, jump (0-2), shake (-1..1), legs, leftArm, rightArm (0/1), eyes (open, blink, left, right, up, shut, red) }`. Note: `shake` shifts held items outward; validator checks edge overflow.
- `hand`: `"left"` or `"right"` if effect is a held item.
- `effect`: layers like piece layers, in stationary card coordinates.
- `dim`: 0–1 dimming factor on crab body (as in sleep).

### play: Single-Run Action Plays (Spins, Soccer, Passes)
An action with `"play"` does not loop continuously: it triggers **when its condition becomes true**, plays from tick 0 for `ticks` duration, and returns to normal. It can pass a ball to another crab:
```json
{
  "type": "action", "id": "dance", "label": "♪ dance", "color": "#d2a8ff",
  "when": [{ "state": "finished" }, { "state": "thinking", "chance": 0.02 }],
  "play": { "ticks": 12, "pass": { "atTick": 9, "to": "football-receive-a" } },
  "pose": [{ "steps": [{ "width": 1 }, { "width": 0.66 }, { "width": 0.34, "facingAway": true }, { "kick": "right" }] }],
  "effect": [{ "drawings": { "b": ["gwg", "wkw", "gwg"] }, "palette": { "g": "#a9adb3", "w": "#f4f3ee", "k": "#2a2a2e" }, "leaves": true,
               "anim": { "*": [{ "steps": [{ "x": 0, "y": 10 }, { "x": 8, "y": 2 }, { "x": 20, "y": 4 }] }] } }]
}
```
- Built-ins: `spin` (360-degree rotation on finished or tests-ok) and `football` (`football-a`...`d`, passing to `football-receive-a`...`d`). Max 3 consecutive passes; master agent can join play; only one ball active at a time.
- `"group"`: variants in the same group share equal selection weight. `"to"` can be a single play ID or a list of play IDs.
- Extra pose properties for plays: `width` (1 facing front, 0.34 profile), `facingAway` (back facing, hides face/eyes), `kick` (`"left"`/`"right"`).
- Extra trigger conditions: `"chance": 0.02` (probability per second) and `"state": "tests-ok"`.
- `"leaves": true` on effect layer: allows effect to cross card boundaries (x/y -24 to 24).

To customize a built-in action, redefine its ID (`walk`, `reading`, `writing`, `testing`, `thinking`, `blocked`, `error`, `done`, `sleep`). Inspect defaults with `/costume export reading`.

### rules (Costume Assignment)
```json
{
  "type": "rules",
  "active": ["fable", "heavy", "careful", "medium", "light", "explore", "french"],
  "rules": [
    { "if": { "from": "12-01", "to": "12-31" }, "costume": "french" },
    { "if": { "name": "^tester$" }, "costume": "medium", "nickname": "Chef Tester", "ifFree": true }
  ],
  "labels": { "thinking": "… pondering" }
}
```
- Rules evaluate in order (user rules before built-in defaults). Criteria: `type`, `name`, `description`, `model` (regex patterns) and `from`/`to` ("MM-DD"). `ifFree`: only assign if not currently in use by an active agent.
- If no rules match, rotation cycles through `active` costumes.
- `nickname`: overrides displayed name. `labels`: overrides action labels by ID.
- Single rules file is recommended; multiple files merge together.

## Good Design Principles

- **Recognizable at 18 px**: Exaggerate identifying features (ears, hat brims). Limit distinct colors with strong contrast.
- **Two-theme outline**: Pure white vanishes on light backgrounds and pure black vanishes on dark backgrounds; border with midtones (e.g. chef hat uses `#a9a79d` outline around white).
- **Hat base sits on row 5**: Keep top within row 1 (the jump on completion shifts up 1 px).
- **Contiguous piece bodies**: Every pixel must connect to the body or neighboring pixel unless marked `"free": true`.
- **Preserve eyes**: Keep columns x 4–6 and 11–13 clear across rows 7–9 unless intentionally masked with `"coversEyes": true`.
- **Hand-held props**: Anchor `claw.left` or `claw.right`, handle touching claw coordinates (x 1-2 or 15-16, rows 8-9).
- **Subtle animation**: 2–4 drawings, `every` 1–2. Movement in `walk` adds life; keep stationary in `sleep` (`"sleep": []`).
- **Sharing**: `/costume export <id>` bundles costume and pieces into a `.crab.json` file (also compatible with legacy `.cangrejo.json`); import with `/costume import <file>`.

## Troubleshooting

`/costume list` (or `/disfraz lista`) details validation issues with file, ID, action, and tick (also reported in `/bus` and `bus_status`). Messages provide actionable fixes: floating pieces, overflow bounds, obscuring eyes, or low contrast. Invalid items are skipped safely while the rest of the costume loads normally.
