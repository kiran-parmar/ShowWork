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

## Day 2: Tue Nov 17, 2026

**Built**
- Agent loop (`server/src/agent/run.ts`): model call -> run requested tools -> send results back -> repeat until the answer. Every step is recorded as an event.
- Three read-only tools: `list_tables`, `describe_table`, `run_query`. `run_query` asks the model for a one-line *purpose* alongside the SQL, shown on the step card.
- Live streaming over Server-Sent Events, with resume-on-reconnect via `Last-Event-ID`.
- Ask tab: question box, timeline of model calls (time, tokens, estimated cost), reasoning summaries, expandable step cards (SQL + result table), final answer, and run totals.

**Decisions**
- *Hand-written loop instead of the SDK's tool runner:* I need an event for every step now, and pause/approve/steer between steps later.
- *Event list as the single source of truth:* the UI is a pure function of events (`buildTimeline`), which makes replaying stored runs (Day 5) almost free.
- *SQL safety guard:* DuckDB's own parser (`json_serialize_sql`) only accepts SELECT, and I walk its syntax tree to block table functions (`read_csv`, `glob`), file-path tables (`FROM '../.env'`) and risky functions. 16 test cases: `npm run test:guard -w server`.
- *Cost controls:* max 12 model calls and 20 tool calls per run; only 50 result rows go back to the model; prompt caching on the stable prefix; one run at a time.
- *Agent queries on their own DuckDB connection,* so a runaway query can be interrupted after 15 s without cancelling the UI's requests.
- *Reasoning shown as summaries:* the API returns a readable summary of the model's thinking (`display: "summarized"`), never the raw chain of thought.

**Next (Day 3)**
- Make step cards richer: chart tool (`make_chart`), better reasoning display, polish.

## Day 3: Wed Nov 18, 2026

The day went to understanding Day 2's code and fixing a real bug in it, instead of the planned chart tool.

**Done**
- Walked through every Day 2 file in the order a question travels (`docs/day2-code-tour.md`).
- Set up VS Code debugging for both the server and the web app (`.vscode/launch.json`), and stepped through `GET /api/tables/:name` line by line.
- Upgraded Node from 20.20.2 to 24.
- Fixed the stuck-run bug below.

**Bug fixed: a run lost to a server restart spun forever**
- *Symptom:* restart the server mid-run (tsx watch restarts it on every save). The page then shows "Reading results…" with a spinner forever, and Ask stays locked until you reload.
- *Cause, three parts:*
  - Runs live in server memory, so a restart forgets them.
  - The page stopped waiting only when a final event (`run.completed` or `run.failed`) arrived, and a forgotten run never sends one.
  - Through the Vite dev proxy the stream often doesn't even error. It just goes silent, so there's nothing to react to.
- *Fix:*
  - **Server:** sends a real `ping` event every 15 s (`HEARTBEAT_MS` in `events.ts`). The old `: keep-alive` line was an SSE comment, which browsers hide from page code.
  - **Page (`useRun.ts`):**
    - a watchdog timer that gives up after 45 s with no event and no ping
    - `onerror` gives up immediately only when `readyState` is `CLOSED` (the reconnect was refused). While it's `CONNECTING`, the browser is still retrying a brief drop, so it's left alone.
    - on giving up, it shows "Lost the connection to this run" and unlocks Ask
  - **`RunPanel`:** the spinner now also requires `status === "running"`.
- *Decision:* the lost-connection error is browser-side state (`streamError`), not a fake `run.failed` event, because the timeline should only show what the server actually recorded.
- *Tested:*
  - restart mid-run: the message appeared after 35 s and Ask unlocked
  - a normal run still completed, with pings visible in the stream
  - a brief network drop wasn't tested directly
- Details: `docs/bug-day2.md`.

**Bug fixed: VS Code breakpoints never bound** (always a hollow grey circle)
- *Cause:* VS Code's debugger finds its connection by listing Windows named pipes (`\\.\pipe\`). On Node 20.20.2 that call fails with `ENOTDIR`, so the debugger silently never attached. The VS Code debugger's own log showed it: `Set debug mode { mode: 2 }`, which means inactive.
- *Fix:* Node 24, where the same check passes. The README now requires Node 22 or later.
- *Lesson:* when a tool fails silently, turn on its log (`"trace": true`) before guessing. My first theory, a VS Code auto-attach setting, was wrong.

**Noticed**
- In the synthetic sample data, every region misses its 2025 target; the best reaches 60%. The targets may be too high for an interesting demo.

**Next (Day 4)**
- Catch up: `make_chart` tool and richer step cards (from Day 3), then plan-before-act.
