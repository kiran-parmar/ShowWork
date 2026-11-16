# Dev log

A few lines per day: what I built, what I decided and why. This becomes the README's design section and interview material.

## Day 1: Mon Nov 16, 2026

**Built**
- Monorepo with npm workspaces: `server` (Fastify + TypeScript) and `web` (React + Vite + TypeScript); `npm run dev` starts both.
- DuckDB in-process database: every CSV becomes a table. Upload CSVs from the UI; see columns, types, and a preview.
- Synthetic sample data (`orders`, `region_targets`) with patterns worth finding.
- Claude connection check: one small request to `claude-haiku-5-5`, showing model, tokens, and latency.

**Decisions**
- *DuckDB over Postgres/SQLite:* real analytical SQL directly over CSVs, no database server to run. Keeps the focus on the UI.
- *The browser never talks to Claude directly:* the API key stays on the server, and the server will own the agent loop so it can pause for approvals.
- *Server-side fallbacks enabled on Claude requests:* if a safety classifier declines a request, the API retries on a fallback model instead of failing.
- *`MODEL` setting in `.env`:* Haiku 5.5 (about 1/40 of Opus's price) while building the plumbing, Opus 5.5 for real testing and demos. Fallbacks are sent only to models that support them (not Haiku). Editing `.env` restarts the server automatically.
- *Showing tokens and latency from day 1:* cost and time visibility is part of "showing the work".

**Bugs found while testing**
- One unreadable CSV in the uploads folder crashed the server at startup. Now: bad files are skipped with a warning, and failed uploads are deleted instead of kept.
- CSVs with mixed line endings failed DuckDB's strict sniffer. Now: retry with a lenient reader before giving up, and show only the first line of DuckDB's long error.
- The server read `PORT`, which tools set for the web app, and collided with Vite. Renamed to `API_PORT`.
- app.get("/api/tables/:name?limit=:limit", ...). A Fastify route path matches only the path part of a URL, never the query string. Inside a path, ? means “the parameter before me is optional”, so Fastify read :name? as an optional name with more path after it. Optional parameters must come last.
Query-string values like ?limit=20 arrive separately, in request.query, and always as strings.

**Next (Day 2)**
- Agent loop with read-only tools: `list_tables`, `describe_table`, `run_query`.
- Stream each step to the UI over Server-Sent Events; first rough timeline.
