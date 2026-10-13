// What a model's tokens cost and how big its context window is. Pure: no `$`.
//
// No API answers a subagent's cost: Claude Code's ledger (`session.measure`) only totals the session.
// Each subagent's cost is therefore estimated from the usage its own requests reported (`turn.step`)
// at Anthropic's first-party list prices, and always shown with "≈". The session total stays the
// ledger's real figure; the master's share is that total minus the subagents' estimates.

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** $ per million tokens: input, output, cache read, cache write (5 min). */
type Rate = { in: number; out: number; read: number; write: number }

const rate = (i: number, o: number, read = i * 0.1, write = i * 1.25): Rate => ({ in: i, out: o, read, write })

// First match wins: more specific ids first. Prices as of 2026-10 (platform.claude.com pricing).
const RATES: readonly [RegExp, Rate, number][] = [
  [/(fable|mythos)-5/, rate(10, 50, 0.25), 1_000_000],
  [/opus-5-5/, rate(4, 20, 0.2), 1_000_000],
  [/opus-(5|4-[5-9])/, rate(5, 25), 1_000_000],
  [/opus-4/, rate(15, 75), 200_000],
  [/sonnet-5/, rate(2, 10, 0.2), 1_000_000],
  [/sonnet-4-[6-9]/, rate(3, 15), 1_000_000],
  [/sonnet/, rate(3, 15), 200_000],
  [/haiku-5/, rate(0.1, 0.5, 0.01), 1_000_000],
  [/haiku-4/, rate(1, 5), 200_000],
  [/haiku/, rate(0.8, 4), 200_000],
]
// unknown model: priced as the session's default tier (Opus 5.5)
const DEFAULT: [Rate, number] = [rate(4, 20, 0.2), 1_000_000]

const lookup = (model: string | undefined): [Rate, number] => {
  const m = (model ?? '').toLowerCase()
  for (const [re, r, w] of RATES) if (re.test(m)) return [r, w]
  // short aliases the Agent tool takes (`opus`, `sonnet`, `haiku`)
  if (m === 'sonnet') return [rate(2, 10, 0.2), 1_000_000]
  if (m === 'haiku') return [rate(0.1, 0.5, 0.01), 1_000_000]
  return DEFAULT
}

/** The context window of `model`, in tokens; a `[1m]` id is always 1M. */
export const windowOf = (model: string | undefined): number => ((model ?? '').includes('[1m]') ? 1_000_000 : lookup(model)[1])

/** Each part of the cost of `u` on `model`, in dollars. */
export const costParts = (u: Usage, model: string | undefined): { input: number; output: number; cacheRead: number; cacheWrite: number } => {
  const [r] = lookup(model)
  return {
    input: (u.input * r.in) / 1e6,
    output: (u.output * r.out) / 1e6,
    cacheRead: (u.cacheRead * r.read) / 1e6,
    cacheWrite: (u.cacheWrite * r.write) / 1e6,
  }
}

export const costOf = (u: Usage, model: string | undefined): number => {
  const p = costParts(u, model)
  return p.input + p.output + p.cacheRead + p.cacheWrite
}

export const addUsage = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite })

/** Tokens the request was answered over: uncached, cache-written and cache-read together (= context in use). */
export const promptTokens = (u: Usage): number => u.input + u.cacheRead + u.cacheWrite
