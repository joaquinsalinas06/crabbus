---
name: design
description: Design or customize the appearance of CrabBus crabs (the animated subagents). Use when asked for a hat, outfit, clothing, mustache, glasses, or new item ("quiero un gorrito de capibara", "ponle un saco", "un gorro para el agente", "ropa", "vestir", "diseñar", "give it a coat"), a costume or theme (Christmas, holiday, "disfraz de navidad"), a new action or animation ("cuando haga git commit que salte", "que baile al terminar", "jump when git commit runs"), custom text or names, costume assignment rules ("quién lleva qué disfraz", "que el que planifica lleve el detective", "cambia el master", "saca al dino de la rotación", "who wears what"), or sharing designs (/costume export, import, /disfraz).
---

# Designing CrabBus Crabs

## Skin or New Creature?

**Default: a skin.** A request for clothes, a hat, a theme or "a capybara costume" is a skin
(costume) on a body that already exists: the crab unless they say otherwise. Draw pieces on
that body and stop there.

**Only make a new body when they say so explicitly**: "a new creature", "a body of X",
"not a costume", "make it a real dog". Then:

1. Look at real references first: photos of the animal, and pixel art of it at a similar
   size (search the web). Note what makes it readable: silhouette, proportions, the 2-3
   features that identify it (a capybara from the front: a round head with small dark ears
   at its corners, a long darker muzzle with a wide nose on top, a pear-shaped body).
2. Draw it **from scratch**, front-facing and chibi like the rest of the crew (a big head
   with two eyes that blink and look, a body below, filling the card). Do not start from
   the crab: a reshaped crab reads as a crab. A side view reads flat at this size.
3. Give it volume with flat, warm colors: a highlight along the top, base, a shadow
   under the head (a collar line) and on the sides, a lighter chest, a separate muzzle
   or face patch, dark ears and paws. Avoid a heavy dark outline: it dulls the sprite.
   Use the body `palette` for fixed colors (outline, nose, ear, legs) and `color` for its
   base. Look at the built-in `capybara` (`/costume export capybara`) as a worked example.
4. Preview it bare, look at the PNG at a large scale, and iterate until it is recognizable.
5. Then make at least one skin for it with pieces drawn **for that body** (`"body": "<id>"`
   on the piece), and preview the skin across every action.

Every costume names its own body with `"body": { "id": "capybara" }`; a costume without an
id is a crab. There is no crew-wide default: a crew mixes crabs, robots and capybaras by
which skin each agent wears. `defaultBody` in rules is no longer read. Changing a built-in
costume's body in the wardrobe writes a user override with the same id; never edit the
installed built-in source.

### Body Contract

A `type: "body"` object contains `id`, `name`, `layers`, `anchors`, `armLift`, and `eyes`:

- Optional `color` (`#rrggbb`) is the body's base color when a costume names none (the
  crab's is clay); a costume's `body.color` still wins. Optional `palette` maps up to 12
  single characters (not H, B, S, dot or space) to fixed colors: outline, nose, ears, legs.
- Each layer has integer `x`, `y`, `rows`, and `motion`. Rows use `H` (highlight), `B`
  (body color), `S` (shadow), palette characters, and dots/spaces (transparent), within
  the 18 by 14 card.
- `motion` is `body`, `ground`, `claw.left`, `claw.right`, or `card`. Body follows bob,
  lift and horizontal shake; ground skips bob; claws also follow the corresponding arm.
  `armLift.left` and `.right` specify the displacement at raised arm state 1.
- A layer may add `frames` (up to 8 other drawings by name) and `anim`, per-action tracks
  like a piece's (`"*"` for every other action) whose steps take `d` (a frame), `x`/`y`
  (-3 to 3) and `hidden`: ears that twitch, a nose that sniffs while `reading`, a mouth that
  chews while `writing`. Keep moves inside the card through jumps (`done`, `master.hop`):
  move sideways near the top row.
- Optional layer `when.legs` is 0 or 1; `when.kick` lists `left`, `right`, or `none`.
  Supply normal and kicking leg layers as needed. Layer order is paint order.
- Every anchor (`card`, `body`, `head`, `face`, `claw.left`, `claw.right`, `ground`)
  supplies resting integer `x`, `y`, and `motion`. `card` must be fixed at 0, 0.
  A piece with `"body": "<id>"` is drawn in that body's own coordinates and moves only with
  its anchor; it is refused on any other body. A piece without one was drawn on the crab
  and is moved by the body's anchor minus the crab's. Held action props (book, pen, test
  tube) go to the body's `claw.left`/`claw.right` anchors: put them where its paws are.
- `eyes` may add `color`; a profile animal has one eye point.
- `eyes.points` gives 1 to 8 positions; `height` is 1 to 3, `blink` is the closed-eye
  row offset, and `look` is the gaze displacement. The renderer handles open, blink,
  shut, left, right, up, red and facing-away poses. Width turns the whole sprite together.

Keep the whole body, with jumps and shakes, inside the card: leave row 0 free and keep
x within 0-17. Fit checks all
body/eye pixels, accessory attachment, eye coverage, contrast and card bounds over actions.
Incompatible wardrobe choices are noninteractive and display the first reason with body,
costume, action and tick; repair the design before selecting them.

Preview a body alone with `node tools/preview.ts --design capybara.json --scale 12 --out capybara.png`,
a skin with `--design capybara.json skin.json --costume <id>`, or try a costume on another body
with `--body <id>` (the same fit check the wardrobe runs). Complete preview and fit before installation.


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
  "when": { "tool": "Bash", "input": "\\bgit\\b[^|;&\\n]{0,120}\\scommit\\b" }, "priority": 60, "duration": 2500,
  "pose": [{ "fixed": { "leftArm": 1, "rightArm": 1 } }, { "steps": [{ "jump": 0 }, { "jump": 1 }] }],
  "effect": [{ "drawings": { "a": ["s.....s"] }, "palette": { "s": "#f5c542" }, "anim": { "*": [{ "steps": [{}, { "hidden": true }] }] } }]
}
```
- Patterns must be safe to run on every tool call: a group cannot be repeated (`(ab)+`, `(\s+\S+)*`), backreferences are not allowed, and a pattern holds at most 2 repetitions (`*`, `+`, `{n,m}`). Repeat a single character or class instead (`[^;]{0,120}`).
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
  "master": "fable",
  "active": ["fable", "heavy", "careful", "medium", "light", "explore", "french"],
  "kinds": {
    "planning": {
      "words": ["\\bplan(ning)?\\b", "\\bdesign\\b"],
      "description": "Planning and design tasks"
    }
  },
  "rules": [
    { "if": { "kind": "planning", "from": "12-01", "to": "12-31" }, "costume": "french" },
    { "if": { "name": "^tester$", "prompt": "test", "mode": "^acceptEdits$" }, "costume": "medium", "nickname": "Chef Tester", "ifFree": true }
  ],
  "labels": { "thinking": "… pondering" }
}
```
- Rules evaluate in order (user rules before built-in defaults). Criteria: `type`, `name`, `description`, `model`, `prompt` (first 400 characters), `mode` (permission mode), `kind` (matched kind category), and `from`/`to` ("MM-DD"). `ifFree`: only assign if not currently in use by an active agent.
- `master`: optional costume ID for the session's master crab (defaults to `"master"`, then `"other"`).
- `kinds`: keyword-based task classifiers scoring the first 400 characters of `description` + `prompt` against safe regex `words`. The kind with the most matching words wins; a tie goes to the kind id first in alphabetical order. Deterministic, no network.
- If no rules match, rotation cycles through `active` costumes.
- `nickname`: overrides displayed name. `labels`: overrides action labels by ID.
- Single rules file is recommended; multiple files merge together.

### Editing who wears what (when the person asks)

People ask in their own words, in any language: "the one who plans wears the detective", "make the dino the master", "take the capybara out of the rotation", "everyone in Christmas clothes in December". Turn that into an edit of **their rules file**, and nothing else.

1. **Read what is there first.** Run `/costume rules`: it prints the agents running now with the rule that dressed each one (`my-rules.json #2`, `(built-in) #6`, `rotation`), every rule in order, the master and the rotation. `/costume folder` prints the folder.
2. **Edit the existing rules file**: the first file in the folder with `"type": "rules"` (often `rules.json`, or a name in the person's language). Create `rules.json` only when there is none. Keep every rule, kind and label you were not asked to change, and keep the JSON valid.
3. **Map the request to the smallest change:**

| They ask | Change |
|---|---|
| "X is the master" / "cambia el master" | `"master": "X"` (remove the key to go back to the default crown) |
| "take X out of / put X in the rotation" | edit `"active"`; when the file has none, start from the rotation `/costume rules` shows |
| "agents that plan wear X" | a rule on `type` (`"^Plan$"`), on `description` or `prompt` words, or on a `kind` |
| "the reviewer wears X" | a rule on `name` (`"^reviewer$"`) or `description` (`"review"`) |
| "only one at a time" | `"ifFree": true` on that rule |
| "in December" | `"from": "12-01", "to": "12-31"` together |

4. **Write patterns as plain words.** Every pattern ignores case. `|` is "or", `^` "starts with", `$` "ends with": `"bug|fix|error"`, `"^Explore$"`. Patterns that could make Claude Code hang (nested repeats like `(a+)+`) are refused with the reason. Words in the person's language are fine in patterns and kinds, since task titles come in that language: add both, as in `"plan|planif"`.
5. **Order matters.** The first rule that fits gives the costume, and the person's rules are tried before the built-in ones. Put a specific rule above a general one.
6. **Check it.** The folder reloads in about two seconds. Run `/costume rules` again and confirm the rule is listed as you meant, and `/costume list` shows no problems. The person can also see and change all this in the side panel: the `wardrobe` tab (key `w`).

What each criterion looks at:

| Criterion | What it reads | Example |
|---|---|---|
| `description` | the short task title Claude gives the agent | `"bug|fix"` |
| `type` | the agent type: `Explore`, `Plan`, `general-purpose`, a plugin agent | `"^Plan$"` |
| `name` | the name the agent was given, when it has one | `"^reviewer$"` |
| `prompt` | the first 400 characters of the agent's instructions | `"refactor|migrate"` |
| `mode` | its permission mode: `default`, `plan`, `acceptEdits`, `auto` | `"^plan$"` |
| `model` | the model it runs on | `"haiku"` |
| `kind` | a kind defined under `kinds` in the same file | `"planning"` |
| `from` / `to` | today's date, `"MM-DD"`, both together | `"12-01"` / `"12-31"` |

A rule for "agents that plan wear the detective", for task titles in English or in a language that writes "planif...":

```
{ "if": { "description": "plan|planif|design" }, "costume": "heavy" }
```

The same with a kind, so several rules can share the word list:

```
"kinds": { "planning": { "words": ["plan", "planif", "design"], "description": "planning and design" } },
"rules": [{ "if": { "kind": "planning" }, "costume": "heavy", "ifFree": true }]
```

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
