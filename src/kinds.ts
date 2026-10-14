// Pure task kind classification. Pure: no `$`, no Node globals, no network.
// Scores declared keywords against agent description and prompt.

/** The same bound the `prompt` criterion uses: a long prompt never reaches a pattern whole. */
export const KIND_TEXT_MAX = 400

export type KindDef = {
  words: RegExp[]
  description?: string
}

export type KindMatch = {
  kind: string
  score: number
}

/**
 * Deterministically classifies text (description + prompt) into a kind tag.
 * Returns the kind with the highest score (minimum 1 match). Ties are broken
 * alphabetically by kind ID to remain deterministic across environments.
 */
export function classifyDeterministic(
  kinds: Record<string, KindDef> | undefined,
  text: string,
): KindMatch | null {
  if (!kinds || Object.keys(kinds).length === 0 || !text || text.trim() === '') return null
  const clipped = text.slice(0, KIND_TEXT_MAX)
  const entries = Object.entries(kinds).sort(([a], [b]) => a.localeCompare(b))
  let best: KindMatch | null = null
  for (const [id, def] of entries) {
    let score = 0
    for (const w of def.words) {
      if (w.test(clipped)) score++
    }
    if (score >= 1) {
      if (!best || score > best.score) {
        best = { kind: id, score }
      }
    }
  }
  return best
}
