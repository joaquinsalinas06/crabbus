---
name: agy-delegation
description: Delegate work to Google Antigravity (agy) through bus_delegate and review it as the master. Use when asked to hand a task to Antigravity or agy, use it as a subagent or worker ("que antigravity lo haga", "delegalo a agy", "usa antigravity como subagente", "let agy implement the amendments"), or when a bus_delegate result from agy comes back empty, denied or unclear.
---

# Delegating to Antigravity (agy)

You are the master: agy writes, you decide. Nothing agy reports is true until you have checked it.

## What agy can and cannot do here

- **File tools only.** agy runs headless (`agy -p`): every shell command is denied, and so is any tool
  that asks for approval. It cannot run tests, builds, git or package managers. Plan the work so the
  commands are yours.
- **Its workspace is the job's `cwd`.** CrabBus passes `--add-dir <cwd>`. A path outside it is denied,
  and the turn ends with an empty result and `denied: ["Denied by Antigravity: ViewFile read_file"]`.
  Work in another repository by passing `cwd`, never by pasting absolute paths of another repo.
- **No questions.** `ask_question` is never answered. Put every decision it may need in the brief.
- **Read mode is not a sandbox.** It runs `--mode plan` plus a read-only instruction, and headless plan
  mode does not reliably block writes (antigravity-cli #1181). After a read task, check `git status` of
  that repository.
- **Edit mode is isolated.** It works in `.crabbus/worktrees/<id>` on its own branch, without commits.
- **auto level is unsupported** (git fails inside its sandbox).

Every agy task automatically carries the worker contract (`AGY_WORKER_BRIEF` in `src/external.ts`):
stay in scope, file tools only, no questions, no commits, never claim a command passed, and always end
with `## Result`, `## Files`, `## Verify`, `## Assumptions and risks`, `## Pending`. Do not repeat it in
your prompt; write the task.

## Writing the brief

agy starts cold: the brief is all it knows. Make it self-contained:

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
