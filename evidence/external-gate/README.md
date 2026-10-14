# External-agent runtime gate — 2026-10-14

Status: blocked on Antigravity sandbox access to linked-worktree Git metadata.
The external-agent feature is not enabled by this change. Part B is independent.

## Environment

- Codex CLI 0.160.0
- Antigravity CLI 1.3.5 (newer than the handoff's 1.2.14)
- Claude Code 2.1.300
- Linked worktrees inside `.crabbus/worktrees/<id>`; branches `crabbus/<cli>-<id>`.
- Worktree Git metadata lives outside that working directory in the primary repository.
- Probes left their edits and new files uncommitted. They did not modify tracked files
  in the primary checkout. Test worktrees are retained for inspection.

## Results

| Probe | Observed result |
|---|---|
| Codex workspace-write: git status, tracked edit, untracked file | Passed. |
| Codex: exclude both `/tmp` and `TMPDIR` | Python tempfile succeeded after retry; Node mkdtemp and npm cache creation failed with EPERM. Shell heredocs also failed. |
| Codex: exclude `/tmp`, permit per-user `TMPDIR` | Python tempfile, Node mkdtemp, npm cache verify and git status all passed. |
| Claude engine: close a process stream during a pending read of a silent child | Passed: stream closure took 3 ms and the recorded child PID no longer existed. |
| Antigravity sandbox: tracked edit and untracked file | Passed. |
| Antigravity sandbox: git status | Failed reading the user's global gitconfig. |
| Antigravity sandbox: git status with `GIT_CONFIG_GLOBAL=/dev/null` | Failed: `fatal: not a git repository: (null)`. The linked metadata is outside the sandbox workspace. |
| Independent retry with global Git configuration disabled | Provider failed eligibility with UNAVAILABLE / HTTP 503 before running the task. |
| Multiple finalizations grouped into one master prompt | Pending; do not claim verified. |

## Reproduction

Create an isolated linked worktree, with its directory under the project's `.crabbus/worktrees/`,
and use that directory as the CLI working directory. Use the current HEAD, no pending changes.

Codex arguments:

```sh
codex exec --json --sandbox workspace-write --skip-git-repo-check \
  -c sandbox_workspace_write.exclude_slash_tmp=true \
  -c sandbox_workspace_write.exclude_tmpdir_env_var=false \
  -C "$PROBE_WORKTREE" "$PROBE_PROMPT" </dev/null
```

Antigravity arguments, first with no Git overrides, then the command-level override:

```sh
agy -p "$PROBE_PROMPT" --output-format stream-json \
  --dangerously-skip-permissions --sandbox </dev/null
```

The prompt requests only git status, one tracked English comment, one untracked text file,
and an exact error report. No commits, installs, project exploration or expanded permissions.
For the second Git command, request `GIT_CONFIG_GLOBAL=/dev/null git status --short`.

The silent-child probe runs from a real temporary Claude Code plugin command, not the kit:

```ts
const child = $.process.spawn({ argv: ['/bin/sleep', '30'] })
void child.result.catch(() => undefined)
const pending = child.next().catch(() => undefined)
await $.process.run(['/bin/sleep', '0.2'])
await child.return({ code: null, signal: 'SIGTERM' })
await pending
```

The actual probe additionally recorded its child PID before exec and timed return().
The kit needs process handlers supplied beneath the plugin; a skipped failing hook is
not a successful probe. The real command's result and a host PID check confirmed shutdown.

## Required resolution before A implementation

Find a supported way for Antigravity to read linked Git metadata without granting write
access to it, or explicitly revise the supported execution mode. Do not add the metadata
as a writable sandbox root to make commits possible. Agents must leave changes uncommitted.

Codex should permit per-user TMPDIR while excluding /tmp based on the successful probe.
Raw provider outputs are reduced and sanitized in `spec/fixtures/external/`; fixture events
retain their actual schemas and are evidence, not a passing adapter test suite.
