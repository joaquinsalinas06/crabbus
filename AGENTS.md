# AGENTS.md

CrabBus is a Claude Code plugin: subagent observability (`bus_step` / `bus_status`), SendMessage tracking and animated pixel crabs. See `README.md` for what it does and `DECISIONS.md` for why.

## Knowledge graph

`graphify-out/` holds a knowledge graph of this repo, built with [graphify](https://github.com/Graphify-Labs/graphify): the code (AST), the docs, the evidence runs and the images, with doc concepts linked to the code that implements them.

- `graphify-out/GRAPH_REPORT.md` — communities, hub nodes and suggested questions. Read it first for an overview.
- `graphify-out/graph.json` — the graph itself. Every edge is tagged `EXTRACTED`, `INFERRED` or `AMBIGUOUS`; treat `AMBIGUOUS` as a hint to verify, not a fact.
- Interactive view: `graphify export html`, then open `graphify-out/graph.html` (not committed: it is regenerated whole on every build).

For architecture questions ("how does X work", "what calls Y", "where is Z decided"), query the graph before reading files one by one:

```bash
pip install graphifyy            # or: uv tool install graphifyy
graphify query "how are costume designs migrated?"
graphify explain "normalizeDesignJson()"
graphify path "Fit validator" "checkPack()"
```

Then confirm in the source: the graph points to the right files, the code is the authority.

## Keeping it current

The graph is a snapshot of the commit in `graph.json`'s `built_at_commit`. Contributors do not need to touch it: pull requests leave `graphify-out/` alone, which keeps the graph free of merge conflicts.

The maintainer refreshes it before a release, in Claude Code:

```
/graphify . --update
```

That re-extracts only what changed (code structurally, docs and images with the model), prunes deleted files, renames the communities and rewrites `graph.json` and `GRAPH_REPORT.md`; commit both. `graphify update .` alone is enough to see code changes locally, but it renames the communities after files, so it is not the one to commit. No commit hook: one would rewrite `graph.json` after every commit and leave the tree dirty.

`.graphifyignore` keeps `AGENTS.md`, `CLAUDE.md` and empty experiment logs out of the graph.
