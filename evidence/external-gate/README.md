# External-agent runtime verification — 2026-10-14

External-agent v1 supports Codex, configured Claude profiles, and Antigravity **safe**.
Only Antigravity auto remains unsupported. This is the amended rollout decision for PR #9.

## Environment and results

- Codex CLI 0.160.0; Antigravity CLI 1.3.5; Claude Code 2.1.300.
- Linked worktrees under `.crabbus/worktrees/<id>`, branches `crabbus/<cli>-<id>`.
- External agents leave changes uncommitted. The plugin computes tracked diffstat and
  untracked paths with host Git, outside provider sandboxes, for every CLI.

| Probe | Observed result |
|---|---|
| Codex workspace-write: status, tracked edit, untracked file | Passed. |
| Codex excludes both /tmp and TMPDIR | Captured npm cache mkdir failed with EPERM; captured Python tempfile passed. The provider's final message also reports Node/heredoc failures, but those tool events are absent from the captured JSONL. |
| Codex excludes /tmp and permits per-user TMPDIR | Captured Python tempfile, Node mkdtemp, npm cache verify and git status all passed. This reused the worktree's existing two probe changes. |
| Real Claude plugin closes a silent process stream during a pending read | Passed: return took 3 ms; host PID check confirmed the child exited. |
| Antigravity sandbox edits | Passed; status failed first reading global gitconfig, then with `fatal: not a git repository: (null)` after omitting global configuration. |
| Antigravity safe edits and command denial | Passed: changed src/text.ts, created safe-probe.txt, and the run_command attempt was denied. Host Git reported both the new edits and previous probe changes. |
| bus_delegate → Antigravity safe in the actual Claude engine | Passed: isolated branch, src/text.ts diffstat (two inserted lines), external-safe.txt untracked, successful completion entry. See agy-safe-host-result.json. |
| bus_delegate → Codex in the actual Claude engine | Passed: isolated worktree edits and host-generated summary. |
| bus_delegate → configured Claude profile in the actual Claude engine | Passed: isolated worktree edits; explicit profile configuration, no API key. |
| bus_delegate → Codex continuation in the same actual engine session | Passed: same CrabBus ID, provider thread ID and worktree; appended a line to the existing external-safe.txt. |
| Busy-master batching, FIFO, concurrency, timeout, Stop and dropped-submit retry | Covered by kit tests, not claimed as an interactive installed-app observation. |

Probe branches/worktrees remain available for inspection; none were merged or committed
by an external agent. The two standalone sandbox probes started clean, but the second
Codex temporary-directory probe intentionally reused the first probe's dirty worktree.

## Reproduce

Configure the externalAgents option as documented in the project README. Load this branch's
plugin in a Claude Code session, with independent provider logins already configured.
Launch a safe agent with a prompt to create external-safe.txt and append one English comment
to src/text.ts, without running commands or committing. The returned agent card must finish,
and the completion notification must report the host's tracked diffstat and untracked path.
Compare those values with host git diff HEAD --stat and git ls-files --others --exclude-standard
in the returned worktree. The supplied agy-safe-host-result.json captures that notification.

The automated live harness used a temporary plugin command that called bus_delegate and
polled bus_status while the host remained alive. A prompt.submit observer saved the completion
payload instead of starting an extra model turn. Thus these runs verify the real process,
parser, reducers and host-Git summary, while the kit verifies main-turn batching. Actual
interactive panel appearance still needs visual review in terminal and Desktop.

For Codex, send a second prompt with to set to the returned CrabBus ID. Compare provider
session ID and worktree before/after; request a second line in the original file. For Claude,
set CLAUDE_CONFIG_DIR explicitly in that agent's env configuration; do not discover profiles
from shell files. The plugin clears the native nested-session marker only for the independently
authenticated Claude CLI.

To repeat the temporary-directory comparison, use a separate disposable worktree:

```sh
codex exec --json --sandbox workspace-write --skip-git-repo-check \
  -c sandbox_workspace_write.exclude_slash_tmp=true \
  -c sandbox_workspace_write.exclude_tmpdir_env_var=false \
  -C "$PROBE_WORKTREE" "$PROBE_PROMPT" </dev/null
```

Repeat with exclude_tmpdir_env_var=true. Ask for Python tempfile, Node mkdtemp and npm
cache verification under TMPDIR; do not request expanded permissions or installations.

Antigravity safe uses `agy -p "$PROBE_PROMPT" --output-format stream-json --mode accept-edits`.
Its denied command attempts are observable; the agent does not need Git for host summaries.
Auto (`--dangerously-skip-permissions --sandbox`) is explicitly rejected in v1 because the
linked Git metadata is outside its sandbox workspace (tested with 1.3.5).

The separate real-engine silent-child lifecycle probe used:

```ts
const child = $.process.spawn({ argv: ['/bin/sleep', '30'] })
void child.result.catch(() => undefined)
const pending = child.next().catch(() => undefined)
await $.process.run(['/bin/sleep', '0.2'])
await child.return({ code: null, signal: 'SIGTERM' })
await pending
```

The actual probe recorded its PID before exec and timed return. A kit hook skipped for an
unsupported API call is not evidence of success; the real command result and PID check
confirmed shutdown.

## Fixture provenance

spec/fixtures/external contains reduced real provider outputs. Only path prefixes and
identifiers are substituted, preserving filenames and error punctuation. UUID substitutions
are consistent. Unrelated Claude hook/transport metadata and thinking blocks are omitted;
assistant text/tool blocks and terminal result fields remain as captured. Provider response
text is sanitized, not replaced with an invented summary. The fixtures are inputs to parser
specs, not independent proof of every acceptance criterion.

The English scanner and Node spec glob already use explicit source targets. Their exclusion
of repository copies is retained and checked; TypeScript's explicit .crabbus exclusion also
protects future broadening of its include paths. The nested-copy regression records existing
scanner behavior rather than claiming a newly fixed scanner bug.

## Continuation usage regression

A real two-turn read probe retained the Codex session. Its terminal usage snapshots were
28,701 input / 8 output and 68,218 input / 16 output. CrabBus reports 68,218 / 16
after continuation, subtracting the previous snapshot before updating the ledger.
Codex snapshots cover the session; Claude result usage covers the invocation. The reduced
codex-resume-usage.json and claude-resume-usage.json fixtures record numeric telemetry
for this distinction, rather than pretending to be complete raw event streams.
Antigravity safe also completed two read turns with the same conversation identifier.
