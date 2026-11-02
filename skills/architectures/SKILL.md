---
name: architectures
description: Orchestrate subagents using industry-standard multi-agent architectures (Fan-Out / Map-Reduce, Orchestrator -> Workers -> Verifier, Hierarchical Tree, Agent Teams Peer-to-Peer Mesh, Evaluator-Optimizer, Hybrid Multi-CLI) and inter-agent SendMessage channels, visualized live in the CrabBus flow tab. Use when spawning multiple subagents, coordinating parallel workers, adding a QA/Verifier gate, or setting up inter-agent communication.
---

# Multi-Agent Architectures & Communication Topologies

CrabBus renders your subagents and their live communication channels in the **`flow`** tab (`/bus flow` or hotkey `f` in the side panel, with `d` to toggle between **⇅ Top-Down** and **⇄ Left-to-Right** pipeline views).

Whenever a task involves multiple files, parallel investigation, implementation + verification, or cross-domain work, select one of the six architectures below, wire your subagents with `role` and `next` in `bus_step`, and use `SendMessage` to coordinate them in real time.

---

## Decision Matrix: Picking an Architecture

| Task Shape | Recommended Architecture | Topology Pattern |
|---|---|---|
| 2–6 independent subtasks (multi-file refactor, parallel search, test suite split) | **1. Fan-Out / Map-Reduce** | `Master ──► [Worker 1, Worker 2, Worker 3]` |
| Implementation that requires strict QA / verification before finishing | **2. Orchestrator → Workers → Verifier** | `Master ──► [Workers 1..N] ──► Verifier ──↺ Master` |
| Large multi-domain feature (e.g. Frontend + Backend + Database) | **3. Hierarchical Tree** | `Master ──► [Domain Leads] ──► [Specialist Workers]` |
| Cross-cutting feature where agents must negotiate contracts/interfaces live | **4. Agent Team (Peer-to-Peer Mesh)** | `Master ──► [Teammate A ⇄ Teammate B ⇄ Teammate C]` |
| High-precision code, security audit, or iterative optimization | **5. Evaluator-Optimizer Loop** | `Master ──► Generator ⇄ Critic` |
| Combining native Claude agents with external CLIs (`codex`, `agy`) | **6. Hybrid Multi-CLI Topology** | `Master ──► [Claude + Codex + Antigravity] ──► Verifier` |

---

## Topology Reporting Contract (`bus_step`)

Instruct every subagent in its prompt to declare its architectural `role` and optional downstream `next` targets on its first `mcp__crabbus__bus_step` call so the `flow` visualizer places every crab in the exact tier and draws pipeline arrows:

- **`role`**: `"orchestrator" | "lead" | "worker" | "verifier" | "critic"`
- **`next`**: `string[]` — names or IDs of downstream agents (e.g. `["verifier"]` or `["master"]`)

Example first call from a worker in an Orchestrator → Workers → Verifier pipeline:
```json
{
  "plan": ["Read target module", "Implement changes", "Run unit tests"],
  "done": 0,
  "current": "Reading target module",
  "role": "worker",
  "next": ["verifier"]
}
```

Example first call from the Verifier agent:
```json
{
  "plan": ["Inspect worker diffs", "Run full test suite", "Report verdict to master"],
  "done": 0,
  "current": "Inspecting worker diffs",
  "role": "verifier",
  "next": ["master"]
}
```

---

## The 6 Architectures in Detail

### 1. Fan-Out / Map-Reduce (`1 → N`)

```text
                ┌──────────────────┐
                │   🦀 MASTER      │
                │  [ORCHESTRATOR]  │
                └────────┬─────────┘
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌─────────────┐┌─────────────┐┌─────────────┐
   │ 🦀 worker-1 ││ 🦀 worker-2 ││ 🦀 worker-3 │
   │  [WORKER]   ││  [WORKER]   ││  [WORKER]   │
   └─────────────┘└─────────────┘└─────────────┘
```

**How to execute:**
1. Partition the problem into $N$ non-overlapping scopes (disjoint files or modules).
2. Spawn all $N$ workers in a **single turn** (parallel tool calls) with clear `name` attributes (`worker-auth`, `worker-api`, `worker-ui`) and instruct each to pass `role: "worker"` to `bus_step`.
3. Use `bus_status` to monitor their progress and `SendMessage` if one discovers a shared constraint that others need to know.
4. Synthesize all worker outputs once they complete.

---

### 2. Orchestrator → Workers → Verifier (`1 → N → 1 ↺`)

```text
                ┌──────────────────┐
                │   🦀 MASTER      │◄───────────┐
                │  [ORCHESTRATOR]  │            │
                └────────┬─────────┘            │
          ┌──────────────┼──────────────┐       │
          ▼              ▼              ▼       │
   ┌─────────────┐┌─────────────┐┌─────────────┐│
   │ 🦀 worker-1 ││ 🦀 worker-2 ││ 🦀 worker-3 ││
   │  [WORKER]   ││  [WORKER]   ││  [WORKER]   ││
   └──────┬──────┘└──────┬──────┘└──────┬──────┘│
          └──────────────┼──────────────┘       │
                         ▼                      │
                ┌──────────────────┐            │
                │  🦀 verifier     │────────────┘
                │   [VERIFIER]     │  feedback loop
                └──────────────────┘
```

**How to execute:**
1. **Stage 1 (Fan-Out Workers):** Spawn 2–4 parallel `worker` subagents (`role: "worker"`, `next: ["verifier"]`). Each worker implements its assigned slice.
2. **Mid-flight Steering (`SendMessage`):** If a worker reports a `question` or `blocker` via `bus_step`, answer it immediately with `SendMessage` (referencing the agent's `id` or `name` from `bus_status`).
3. **Stage 2 (Single Verifier Gate):** Spawn one `verifier` subagent (`name: "verifier"`, `role: "verifier"`, `next: ["master"]`) that reviews the combined changes, runs the test suite and typechecker, and reports Stage `evidence` in `bus_step`.
4. **Stage 3 (Closed Feedback Loop):** If the `verifier` finds regressions, steer the responsible worker via `SendMessage` (or resume it) with the exact failure output from the verifier until the verifier's checks pass.

---

### 3. Hierarchical Tree (`Lead → Sub-Leads → Workers`)

**How to execute:**
1. Spawn domain leads (`name: "lead-backend"`, `name: "lead-frontend"`, `role: "lead"`).
2. Each lead coordinates or spawns its own specialist subagents (`parentAgentId` is automatically tracked by CrabBus and placed in Tier 2 under its parent in Tier 1).
3. Use `SendMessage` to pass cross-domain API contracts between leads.

---

### 4. Agent Team / Peer-to-Peer Mesh (`⇄`)

**How to execute:**
1. When agents run as teammates or long-running collaborators, give each a clear `name` (`api-worker`, `schema-worker`, `test-worker`).
2. Share the roster of active teammate names in each agent's prompt so they can use `SendMessage` (`to: "schema-worker"`) to coordinate directly peer-to-peer.
3. CrabBus captures every subagent-to-subagent `SendMessage` (`from` -> `to`) and draws horizontal `⇄ peer channel` links and message envelopes (`✉`) in the `flow` view.

---

### 5. Evaluator-Optimizer Loop (`Generator ⇄ Critic`)

**How to execute:**
1. Spawn a `worker` generator (`name: "generator"`, `role: "worker"`, `next: ["critic"]`) and a `critic` (`name: "critic"`, `role: "critic"`, `next: ["master"]`).
2. Feed the critic's structured review back into the generator via `SendMessage` until zero blocking issues remain.

---

### 6. Hybrid Multi-CLI (`Claude + Codex + Antigravity`)

**How to execute:**
1. Combine native Claude subagents (`Agent`) with external CLI workers (`bus_delegate` to `codex` or `agy`).
2. Every external CLI worker appears as a `[CODEX]` or `[ANTIGRAVITY]` node in the `flow` graph alongside native Claude subagents.
3. Follow up with a `verifier` node or `bus_delegate` continuation (`to: "<ext-id>"`) to iterate on external worktrees, then clean up finished worktrees with `bus_cleanup`.

---

## Promoting Active `SendMessage` Communication

Do not treat subagents as fire-and-forget black boxes:
- **Check `bus_status`** while subagents are running to read their declared `plan`, `done` stages, `question`, or `blocker`.
- **Send targeted updates via `SendMessage`** whenever requirements clarify or one worker's output affects another worker.
- **Instruct subagents to acknowledge messages:** when a subagent receives a message, it calls `bus_step` with `ack: true`, and once it acts on the instruction, `applied: true` with a short `note`. The `flow` tab updates the channel badge from `✉ in transit` to `✓ delivered` in real time.
