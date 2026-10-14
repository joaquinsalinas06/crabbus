// The state contract must be self-contained (validate refuses any import), so these shapes
// repeat src/model.ts's BusState structurally. tests/contract.test.ts keeps the two in step.
declare module 'claude-code' {
  interface McpToolInputs {
    mcp__crabbus__bus_delegate: { agent: string; prompt: string; description?: string; to?: string; mode?: 'edit' | 'read' }
  }
  interface PluginState {
    'crabbus': {
      bus: {
        agents: Record<
          string,
          {
            id: string
            ext?: { cli: 'codex' | 'agy' | 'claude'; profile: string; session?: string; worktree?: string; branch?: string }
            type: string
            description: string
            name?: string
            model?: string
            costume: string
            nickname?: string
            by?: string
            mode?: string
            status: 'running' | 'done' | 'failed' | 'killed'
            startedAt: number
            endedAt?: number | undefined
            lastEventAt: number
            lastTool?: string
            lastToolInput?: string
            lastToolAt?: number
            toolCount: number
            inTool: boolean
            anim: string
            filesModified: string[]
            tests: { cmd: string; ok: boolean | null; at: number }[]
            lastError?: string
            tokensIn?: number
            tokensOut?: number
            usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }
            lastPrompt?: number
            usedModel?: string
            requests?: number
            usageHist?: number[]
            toolLog?: { id?: string; tool: string; arg: string; at: number; ms?: number; ok?: boolean }[]
            askedAt?: number | undefined
            plan: string[]
            done: number
            current?: string
            note?: string
            declaredAt?: number
            evidence: Record<number, string>
            blockers: string[]
            questions: string[]
            replies: string[]
          }
        >
        msgs: { id: string; to: string; text: string; sentAt: number; accepted: boolean; receivedAt?: number; ackedAt?: number; appliedAt?: number; ackNote?: string }[]
        seq: number
        activity?: { at: number; id: string; st: 'working' | 'thinking' | 'waiting' | 'blocked' | 'done' | 'failed'; text: string; g?: string }[]
        pending?: { id: string; agentId: string; tool: string; arg: string; at: number }[]
        session?: {
          usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }
          lastPrompt?: number
          model?: string
          requests?: number
          usageHist?: number[]
          lastTool?: string
          lastToolInput?: string
          lastToolAt?: number
          inTool?: boolean
          costUsd?: number
          ctxTokens?: number
          ctxWindow?: number
          ctxPercent?: number
          costHist?: number[]
        }
      }
      selected: string | null
      showAll: boolean
      /** The panel's collapsible sections: true = open. */
      open: Record<string, boolean>
      filter: 'all' | 'active' | 'attention' | 'done'
      mode: 'cards' | 'rows'
      tab: 'all' | 'tools' | 'reasoning'
      view: 'agents' | 'wardrobe'
      /** The costume picked in the wardrobe grid, and what a new rule looks at. */
      wdSel: string | null
      wdPage: number
      wdCrit: 'description' | 'prompt' | 'type' | 'name' | 'mode' | 'model' | 'kind' | 'date'
    }
  }
}
