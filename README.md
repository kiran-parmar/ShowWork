# ShowWork

**A data-analysis agent that shows its work.**

Ask a question about your CSV data in plain English. ShowWork's agent plans the analysis, writes and runs SQL, and builds charts and a summary. You can inspect every step, approve risky actions, and steer the agent mid-run.

> Status: Day 1. A dataset browser and Claude connection check are working; the agent arrives on Day 2.

## Run it locally

Requirements: Node.js 22 or later is recommended (it runs on Node 20, with warnings).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your Claude API key. Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Set a monthly spend limit in the Claude Console first. `MODEL` picks the Claude model: `claude-haiku-5-5` (cheapest, for development, and the default when unset), `claude-sonnet-5-5`, or `claude-opus-5-5` (best quality, for demos).

3. Start the server and web app together:

   ```bash
   npm run dev
   ```

4. Open http://localhost:5173

The server loads every CSV in `server/data/sample/` at startup. To regenerate the synthetic sample data:

```bash
npm run sample-data
```

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite |
| Backend | Node.js + TypeScript + Fastify |
| Data | DuckDB (in-process SQL over CSV files) |
| Agent | Claude API (`claude-opus-5-5`) via `@anthropic-ai/sdk` |

## Project layout

```
server/
  src/index.ts      HTTP routes
  src/db.ts         DuckDB: load CSVs, list and describe tables
  src/claude.ts     Claude API client
  scripts/          sample data generator
  data/sample/      synthetic demo CSVs
web/
  src/App.tsx       page layout and shared state
  src/components/   UI components
  src/api.ts        typed calls to the server
docs/               learning notes
DEVLOG.md           daily build log
```

## Sample data

`server/data/sample/` contains **synthetic** data (made up by a script, not real sales), with built-in patterns for the agent to find: regional differences, seasonality, a growth trend, and partner discounts.
