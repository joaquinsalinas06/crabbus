---
name: external-delegation
description: Delegate work to Antigravity (agy) or Codex through bus_delegate and review it as the master. Use when asked to hand a task to Antigravity, agy or Codex, use one as a subagent or worker ("que antigravity lo haga", "delegalo a codex", "usa antigravity como subagente", "let agy implement the amendments"), to work on another repository than the session's, or when a bus_delegate result comes back empty, denied or unclear.
---

# Delegating to Antigravity (agy) and Codex

You are the master: the external agent writes, you decide. Nothing it reports is true until you
have checked it.

## Which one

- **Codex** (`codex exec`): has a terminal inside its OS sandbox (`workspace-write` in edit mode,
  `read-only` in read mode). Worktrees automatically link root dependencies (`node_modules`, `.venv`),
  so it can run tests and builds in its worktree without network access. Its `## Verify`-style
  claims can come with output; still rerun them yourself.
- **Antigravity** (`agy`):
  - In `auto` level (`level: "auto"` in config): has terminal access via `--dangerously-skip-permissions`.
    It can run tests, builds and verification commands directly in the worktree.
  - In `safe` level (default): file tools only, no terminal. Use it for well-specified edits, docs,
    reviews and second opinions, where you run every check.

## Another repository

Both take `cwd` (an absolute path inside the repository). It must be inside a path the person listed
in `externalAgents.repos`: git runs there, and a repository's own config can make git run its code,
so an unlisted path is refused before anything runs. If the repository you need is not listed, ask
the person to add it; never work around it by pasting its paths into the prompt.

# Antigravity specifics

## What agy can and cannot do here

- **Safe vs Auto level:**
  - `level: "safe"` (default): file tools only. Every shell command is denied. Plan the work so commands are yours.
  - `level: "auto"`: terminal commands and test verification are enabled. agy can execute commands (`run_command`), run tests and report real results.
- **Its workspace is the job's `cwd`.** CrabBus passes `--add-dir <cwd>`. A path outside it is denied,
  and the turn ends with an empty result and `denied: ["Denied by Antigravity: ViewFile read_file"]`.
  Work in another repository by passing `cwd`, never by pasting absolute paths of another repo.
- **No questions.** `ask_question` is never answered. Put every decision it may need in the brief.
- **Read mode is not a sandbox.** It runs `--mode plan` plus a read-only instruction, and headless plan
  mode does not reliably block writes (antigravity-cli #1181). After a read task, check `git status` of
  that repository.
- **Edit mode is isolated.** It works in `.crabbus/worktrees/<id>` on its own branch, without commits.
  Dependencies (`node_modules`, `.venv`) from the project root are linked into the worktree so tests run smoothly.
- **Worktree GC:** CrabBus automatically prunes worktrees that finish without changes (`idle`) or get cancelled.
  Call `bus_cleanup` (or `/bus clean`) to prune completed worktrees when finished.

Every agy task carries a worker contract (`AGY_WORKER_BRIEF` or `AGY_AUTO_WORKER_BRIEF` in `src/external.ts`):
stay in scope, no questions, no commits/pushes, and always end with `## Result`, `## Files`, `## Verify`, `## Assumptions and risks`, `## Pending`. Do not repeat it in your prompt; write the task.

# For both

## Writing the brief

The agent starts cold: the brief is all it knows. Make it self-contained:

1. **Goal**: one sentence of the outcome, not the activity.
2. **Context**: the files to read first (paths relative to `cwd`) and the rule or review that motivates
   the change, quoted, not linked.
3. **Scope**: the files it may change, and what it must not touch (generated files, shared scripts,
   lockfiles, migrations already applied).
4. **Acceptance**: checks you will run afterwards, so it writes code that passes them.
5. **One task per agent.** Split a list of amendments into separate agents or continuations, in order.

## Running it

```
bus_delegate { agent: "agy", mode: "edit", cwd: "/abs/path/to/repo",
               description: "R63 fixture guard", prompt: "<brief>" }
```

The same call with `agent: "codex"` runs Codex. The brief rules below apply to both; Codex does not
get the agy worker contract, so ask it for the same final sections in your prompt.

- `mode: "read"` for analysis and second opinions; `"edit"` for changes.
- Watch it with `bus_status` (filter by the id). The result arrives as a plugin message; do not poll.
- Follow up in the same conversation with `to: "<id>"` and a new prompt (same mode, same cwd).

## Reviewing the result

1. **Empty result or denials**: read `denied`. A denied path means a wrong `cwd`; a denied command means
   the brief asked for one. Fix the brief and start again.
2. **Read the diff yourself**: the result's `changes` names the worktree and branch;
   `git -C <worktree> diff` and the untracked files. Compare it with its `## Files` section: a file it did
   not mention is a finding.
3. **Run its `## Verify` commands and your acceptance checks** (typecheck, tests, the real path). Its
   report is a claim, not evidence.
4. **Integrate deliberately**: commit in the worktree branch with your own message and merge, or apply
   only the parts you accept. Remove the worktree when done.
5. When it got something wrong, send the concrete failure back with `to`, with the command output.
