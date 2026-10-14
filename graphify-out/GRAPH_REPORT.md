# Graph Report - agent-bus  (2026-10-13)

## Corpus Check
- 91 files · ~178,403 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 91 file(s) not represented in the graph (top: .ansi 66, .log 11, (none) 7)

## Summary
- 654 nodes · 1746 edges · 23 communities (22 shown, 1 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 193 edges (avg confidence: 0.83)
- Token cost: 783,860 input · 0 output

## Community Hubs (Navigation)
- Sprite Cells and Scene
- Bus Model and Messaging
- Panel and Usage Views
- Hook Registration and Paint
- Attribution and Pack Specs
- Rendering Pipeline Doc
- Legacy Design Migration
- Legacy Art v0.3
- Pack Runtime
- Sprite Rig and Anchors
- Responsive Size Sweep
- Fit Validator
- Director Plays and Passes
- Design Skill and Pack Compiler
- Custom Action Parsing
- Sprite Sheets and Views
- Brand Assets
- Package Manifest
- Demo Panel Walkthrough
- TypeScript Config
- Message Flight Animation
- Pattern Safety
- Plugin Type Stubs

## God Nodes (most connected - your core abstractions)
1. `register()` - 50 edges
2. `compose()` - 20 edges
3. `onSpawn()` - 20 edges
4. `listModel` - 19 edges
5. `onToolStart()` - 18 edges
6. `loadPack()` - 18 edges
7. `onStep()` - 17 edges
8. `paint()` - 17 edges
9. `canvas` - 16 edges
10. `detailModel` - 16 edges

## Surprising Connections (you probably didn't know these)
- `One Raster for the whole stage with blit` --implements--> `paint()`  [AMBIGUOUS]
  DECISIONS.md → hooks/register.tsx
- `crab-buddy prior art` --implements--> `paint()`  [INFERRED]
  docs/RENDERING.md → hooks/register.tsx
- `/bus slash command` --references--> `register()`  [INFERRED]
  evidence/ui/screen-01-bus-pane.txt → hooks/register.tsx
- `Message ack and applied confirmation` --conceptually_related_to--> `detailModel`  [INFERRED]
  evidence/expD/bus_status_results.txt → src/panel.ts
- `Agent bus pane` --references--> `listModel`  [INFERRED]
  evidence/ui/screen-01-bus-pane.txt → src/panel.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Layout modes: full band, two-pane, wide band** — evidence_ui2_band_full_screenshot, evidence_ui2_pane_screenshot, evidence_ui2_wide_1_screenshot [INFERRED 0.65]
- **Animated pane perf comparison** — evidence_perf_animated_cpu_memory_samples, evidence_perf_baseline_cpu_memory_samples, evidence_perf_still_cpu_memory_samples, evidence_perf_animated_animated_pane_overhead [INFERRED 0.75]
- **Brand identity assets** — assets_logo_crabbus_logo, assets_wordmark_dark_crabbus_wordmark_dark, assets_wordmark_light_crabbus_wordmark_light, assets_social_preview_crabbus_social_preview [INFERRED 0.75]
- **Bus pane surfaces** — evidence_ui_screen_01_bus_pane_bus_pane, evidence_ui_screen_01_bus_pane_bus_slash_command, evidence_ui_screen_01_bus_pane_subagents_reader_writer_tester, evidence_ui_screen_01_bus_pane_semgrep_guardian_stop_hook, evidence_expd_bus_status_results_observed_declared_verified [INFERRED 0.75]
- **Costume roster visuals** — assets_crew_reading_crew_strip, assets_custom_crew_working_crew_strip, assets_social_preview_crabbus_social_preview [INFERRED 0.75]
- **CrabBus Visual Vocabulary** — evidence_art_sheet_dark_animated_crab_subagent, evidence_art_sheet_dark_costume_system, evidence_art_sheet_dark_status_overlays, evidence_ui3_list_subagent_roster [INFERRED 0.75]
- **Messaging protocol test flow** — evidence_expd_master_prompt_master_orchestrator_protocol, evidence_expd_bus_status_results_bus_status_snapshots, evidence_expd_bus_status_results_message_ack, evidence_expd_bus_status_results_corrected_suffix [INFERRED 0.75]
- **CrabBus panel UI views** — assets_demo_claude_code_session_demo, assets_panel_agent_panel_view, assets_detail_agent_detail_view [INFERRED 0.75]
- **Terminal size sweep (cols x rows)** — evidence_ui2_size_100_18x_screenshot, evidence_ui2_size_100_40x_screenshot, evidence_ui2_size_100x40_screenshot, evidence_ui2_size_120x16_screenshot, evidence_ui2_size_140x15_screenshot, evidence_ui2_size_140x18_screenshot, evidence_ui2_size_140x24_screenshot, evidence_ui2_size_140x30_screenshot, evidence_ui2_size_160x48_screenshot, evidence_ui2_size_30x40_screenshot, evidence_ui2_size_45_40x_screenshot, evidence_ui2_size_45x40_screenshot, evidence_ui2_size_70_40x_screenshot, evidence_ui2_size_70x40_screenshot [INFERRED 0.75]
- **Three-layer reporting through bus_step and bus_status** — readme_three_layer_model, readme_bus_step, readme_bus_status, decisions_bus_step_brief [INFERRED 0.75]
- **Costume design pipeline: write JSON, preview, validate, install** — skills_design_skill_design, skills_design_skill_preview_tool, skills_design_skill_fit_validator, readme_costume_json [INFERRED 0.85]
- **Band render flow: mood, card, layout, cells, blit** — docs_rendering_mood_resolution, docs_rendering_card, docs_rendering_scene_layout, docs_rendering_half_block_cells, docs_rendering_stage_blit [INFERRED 0.85]
- **Art verification: card, preview tool, golden tests** — docs_rendering_card, docs_rendering_preview_tool, docs_rendering_golden_tests [INFERRED 0.75]

## Communities (23 total, 1 thin omitted)

### Community 0 - "Sprite Cells and Scene"
Cohesion: 0.06
Nodes (85): Card drawing (drawAgent, drawMaster), Preview tool (tools/preview.ts), Scene composition (layout and compose), 18x14 card grid, tools/preview.ts design preview, card(), COSTUMES, key() (+77 more)

### Community 1 - "Bus Model and Messaging"
Cohesion: 0.06
Nodes (73): Unverified assumptions and what breaks if wrong, Background Agent launch, Final hand-back reply, Native SendMessage delivery test, bus_status snapshots, CORRECTED log suffix for beta, Message ack and applied confirmation, Run exit status (+65 more)

### Community 2 - "Panel and Usage Views"
Cohesion: 0.07
Nodes (63): transcript(), Plan usage limits display (5h and weekly), Activity, Permission, activityView, agentCost(), agentCtx(), agentView (+55 more)

### Community 3 - "Hook Registration and Paint"
Cohesion: 0.06
Nodes (50): Animated pane CPU overhead, Animated CPU and memory samples, Baseline CPU and memory samples, Still CPU and memory samples, autoOpen(), designsDir(), designSummary(), dir (+42 more)

### Community 4 - "Attribution and Pack Specs"
Cohesion: 0.05
Nodes (33): clawd (ideas only, not used), crab-buddy (Raster and blit pattern studied), Attribution document, image-peek (Image element pattern studied), MIT notice for reused drawing data, savvy-progress drawing (MIT), BERET, file() (+25 more)

### Community 5 - "Rendering Pipeline Doc"
Cohesion: 0.08
Nodes (25): RENDERING.md: how the crabs are drawn, Golden pixel tests, Open: second skin pack, Paint timer (fps and reduceMotion), clawd-actor prior art, clawd-spinner prior art, crab-buddy prior art, Hermes petSprite prior art (+17 more)

### Community 6 - "Legacy Design Migration"
Cohesion: 0.12
Nodes (32): isObj(), LEGACY_ACTION_IDS, LEGACY_ANCHORS, LEGACY_COMMIT, LEGACY_COSTUME_IDS, LEGACY_GROUP_IDS, LEGACY_PIECE_IDS, LEGACY_SIDES (+24 more)

### Community 7 - "Legacy Art v0.3"
Cohesion: 0.11
Nodes (28): BODY, bodyPal(), canvas, CARD_H, CARD_W, cellsOf(), CLAY, Costume (+20 more)

### Community 8 - "Pack Runtime"
Cohesion: 0.08
Nodes (25): Action, Bad, coin(), Cond, CostumeDef, ERROR_MS, evalTracks(), FALLBACK_ACTION (+17 more)

### Community 9 - "Sprite Rig and Anchors"
Cohesion: 0.11
Nodes (23): Anchors (head, face, body, claw, ground, card), mix(), Put, planOf(), Anchor, ANCHOR_HELP, anchorOffset(), ANCHORS (+15 more)

### Community 10 - "Responsive Size Sweep"
Cohesion: 0.10
Nodes (22): band-full screenshot, Crab subagent avatar, pane screenshot, Two-pane layout, Responsive layout breakpoints, size-100 18x screenshot, size-100 40x screenshot, size-100x40 screenshot (+14 more)

### Community 11 - "Fit Validator"
Cohesion: 0.16
Nodes (20): Fit validator, Fit validator (design skill), BACKGROUNDS, checkPack(), components(), contrast(), CYCLE, Drawn (+12 more)

### Community 12 - "Director Plays and Passes"
Cohesion: 0.21
Nodes (14): Single-run play actions, run(), direct(), Director, emptyDirector(), MASTER, MASTER_IDLE, MAX_PASSES (+6 more)

### Community 13 - "Design Skill and Pack Compiler"
Cohesion: 0.19
Nodes (14): design skill (CrabBus costume designer), Costume assignment rules, compilePack(), idOf(), inDates(), link(), monthDay(), parseCostume() (+6 more)

### Community 14 - "Custom Action Parsing"
Cohesion: 0.27
Nodes (13): Custom actions with when and pose, isObj(), num(), palette(), parseAction(), parseColor(), parseCond(), parseLayer() (+5 more)

### Community 15 - "Sprite Sheets and Views"
Cohesion: 0.31
Nodes (10): CrabBus Sprite Sheet (Dark Theme), Animated Crab Subagent, Costume and Accessory System, Status Indicator Overlays, CrabBus Sprite Sheet (Light Theme), Agent Detail View Screenshot, Agent Detail View, Terminal Panel Layout (+2 more)

### Community 16 - "Brand Assets"
Cohesion: 0.28
Nodes (9): Starfield banner backdrop, Subagent costume roster, Reading state crew strip, Working state crew strip, Crab mascot, CrabBus logo, CrabBus social preview card, CrabBus wordmark (dark variant) (+1 more)

### Community 17 - "Package Manifest"
Cohesion: 0.25
Nodes (7): name, private, scripts, preview, spec, type, version

### Community 18 - "Demo Panel Walkthrough"
Cohesion: 0.33
Nodes (6): Claude Code session demo with CrabBus panel, Parallel subagent orchestration, Agent detail view (auth subagent), Plan stage progress, Agent panel overview (shop-api), Subagent status states

### Community 19 - "TypeScript Config"
Cohesion: 0.33
Nodes (5): ./.claude-plugin/types/tsconfig.json, compilerOptions, allowImportingTsExtensions, extends, include

### Community 20 - "Message Flight Animation"
Cohesion: 0.50
Nodes (4): Message flight animation, msg-flight screenshot, Message at rest state, msg-rest screenshot

### Community 21 - "Pattern Safety"
Cohesion: 0.83
Nodes (3): Design file safety (hang, crash, validator escape), regex(), unsafePattern()

## Ambiguous Edges - Review These
- `paint()` → `One Raster for the whole stage with blit`  [AMBIGUOUS]
  DECISIONS.md · relation: implements
- `Run1 step 3 name-based addressing` → `Run1 exit status`  [AMBIGUOUS]
  evidence/expD-run1-permission-denied/exit.txt · relation: conceptually_related_to
- `Crab subagent avatar` → `size-120x16 screenshot`  [AMBIGUOUS]
  evidence/ui2/size-120x16.png · relation: conceptually_related_to
- `size-100 40x screenshot` → `size-100x40 screenshot`  [AMBIGUOUS]
  evidence/ui2/size-100x40.png · relation: conceptually_related_to
- `Status Indicator Overlays` → `Subagent Roster List`  [AMBIGUOUS]
  evidence/art/sheet-dark.png · relation: conceptually_related_to

## Knowledge Gaps
- **28 isolated node(s):** `./.claude-plugin/types/tsconfig.json`, `Unverified assumptions and what breaks if wrong`, `Secret word recall check`, `Semgrep Guardian stop hook status`, `Run exit status` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 168 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `statusReport()` connect `Bus Model and Messaging` to `Hook Registration and Paint`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `register()` (e.g. with `Still CPU and memory samples` and `/bus slash command`) actually correct?**
  _`register()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `./.claude-plugin/types/tsconfig.json`, `Unverified assumptions and what breaks if wrong`, `Secret word recall check` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Sprite Cells and Scene` be split into smaller, more focused modules?**
  _Cohesion score 0.056070913213770356 - nodes in this community are weakly interconnected._
- **Why does `BUILTIN` connect `Rendering Pipeline Doc` to `Sprite Cells and Scene`, `Bus Model and Messaging`, `Panel and Usage Views`, `Hook Registration and Paint`, `Attribution and Pack Specs`, `Director Plays and Passes`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `paint()` and `One Raster for the whole stage with blit`?**
  _Edge tagged AMBIGUOUS (relation: implements) - confidence is low._
- **What is the exact relationship between `Run1 step 3 name-based addressing` and `Run1 exit status`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._