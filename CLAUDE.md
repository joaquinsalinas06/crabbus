# CLAUDE.md

Read `AGENTS.md`: it describes the project and the knowledge graph in `graphify-out/`.

## graphify

For questions about this codebase, check `graphify-out/GRAPH_REPORT.md` and run `graphify query "<question>"` (or `/graphify query "<question>"`) before reading files one by one. Verify what the graph says against the source before acting on it, and treat `AMBIGUOUS` edges as hints.

Do not rewrite `graphify-out/` as part of other work. Refreshing it is a separate step before a release: `/graphify . --update`, then commit `graph.json` and `GRAPH_REPORT.md` (see `AGENTS.md`).
