---
trigger: always_on
description: "Autonomously select and manage multi-agent architectures and SendMessage channels when delegating to subagents, without requiring @ or explicit architecture names."
---

# CrabBus Autonomous Orchestration

Whenever delegating work to subagents or when the user asks to use subagents or parallelize a task, select the appropriate skill from `skills/` (`architectures` for multi-agent topologies and `SendMessage` coordination, `external-delegation` for Codex/Antigravity, `design` for crab costumes) without requiring `@` or a slash command.

Do not ask the user which subagent architecture to use. Autonomously analyze the task and choose the best topology:
- **Fan-Out / Map-Reduce (`1 -> N`)**: for 2-6 independent parallel subtasks.
- **Orchestrator -> Workers -> Verifier (`1 -> N -> 1 ↺`)**: for implementation tasks that require a dedicated verification/QA gate before completion.
- **Hierarchical Tree**: for multi-domain work with domain leads (`role: "lead"`) and child workers.
- **Agent Team Mesh (`⇄`)**: when peer teammates need to exchange interfaces or findings directly via `SendMessage`.
- **Evaluator-Optimizer (`Generator ⇄ Critic`)**: for iterative refinement or security/quality audits.
- **Hybrid Multi-CLI**: when combining native Claude subagents with `bus_delegate` (`codex`, `agy`).

Always instruct spawned subagents to declare their `role` (`"worker" | "verifier" | "lead" | "critic"`) and optional downstream `next` targets in their first `mcp__crabbus__bus_step` call, monitor progress with `mcp__crabbus__bus_status`, and coordinate active agents with `SendMessage` so the CrabBus `flow` tab displays the live topology.
