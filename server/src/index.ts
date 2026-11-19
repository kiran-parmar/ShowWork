import { config as loadEnv } from "dotenv";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { mkdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeTable, initDb, listTables, loadCsv, loadCsvFolder, toTableName } from "./db.js";
import { checkClaude, getModel, hasInvalidModelSetting, SUPPORTED_MODELS } from "./claude.js";
import { getRun, isRunActive, startRun, subscribe } from "./agent/run.js";
import { HEARTBEAT_MS } from "./agent/events.js";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../.env"), quiet: true }); 

const SAMPLE_DIR = path.resolve(here, "../data/sample");
const UPLOAD_DIR = path.resolve(here, "../data/uploads");
// API_PORT, not PORT: tools that launch the web app often set PORT for Vite.
const PORT = Number(process.env.API_PORT ?? 3001);

const app = Fastify({ logger: { level: "info" } });
if (hasInvalidModelSetting()) {
  app.log.warn(`MODEL="${process.env.MODEL}" isn't supported (use one of: ${SUPPORTED_MODELS.join(", ")}). Using ${getModel()}.`); 
}
app.log.info(`Claude model: ${getModel()}`);
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

await initDb();
const samples = await loadCsvFolder(SAMPLE_DIR);
app.log.info(`Loaded sample tables: ${samples.loaded.join(", ") || "(none - run npm run sample-data)"}`);
// Uploaded CSVs are kept on disk, so reload them after a restart (uploads override samples with the same name).
const uploads = await loadCsvFolder(UPLOAD_DIR);
if (uploads.loaded.length) app.log.info(`Reloaded uploaded tables: ${uploads.loaded.join(", ")}`);
for (const { file, error } of [...samples.failed, ...uploads.failed]) {
  app.log.warn(`Skipped ${file}: ${error}`);
}

app.get("/api/health", async () => ({
  ok: true,
  model: getModel(),
  apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
}));

app.get("/api/tables", async () => ({ tables: await listTables() }));

// The path only matches the URL path. Query-string values like ?limit=20 arrive in request.query,
// always as strings, so convert and validate before use (NaN would otherwise reach the SQL).
app.get<{ Params: { name: string }; Querystring: { limit?: string } }>("/api/tables/:name", async (request, reply) => {
  const limit = request.query.limit === undefined ? 20 : Number(request.query.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    return reply.code(400).send({ error: "limit must be a positive whole number" });
  }
  const detail = await describeTable(request.params.name, limit);
  if (!detail) return reply.code(404).send({ error: `No table named "${request.params.name}"` });
  return detail;
});

app.post("/api/tables/upload", async (request, reply) => {
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: "No file uploaded" });
  if (!file.filename.toLowerCase().endsWith(".csv")) {
    return reply.code(400).send({ error: "Only .csv files are supported" });
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  const table = toTableName(file.filename);
  const dest = path.join(UPLOAD_DIR, `${table}.csv`);
  await pipeline(file.file, createWriteStream(dest));
  if (file.file.truncated) return reply.code(413).send({ error: "File is larger than 50 MB" });

  try {
    await loadCsv(table, dest);
  } catch (error) {
    await rm(dest, { force: true }); // don't keep files we can't read
    return reply.code(422).send({ error: `Couldn't read that CSV: ${error instanceof Error ? error.message : error}` });
  }
  return { table };
});

app.get("/api/claude/check", async () => checkClaude());

// --- Agent runs -------------------------------------------------------------

app.post<{ Body: { question?: unknown } }>("/api/runs", async (request, reply) => {
  const question = typeof request.body?.question === "string" ? request.body.question.trim() : "";
  if (!question) return reply.code(400).send({ error: "Ask a question first." });
  if (question.length > 2000) return reply.code(400).send({ error: "Keep the question under 2,000 characters." });
  if (!process.env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: "ANTHROPIC_API_KEY is not set in .env." });
  if (isRunActive()) return reply.code(409).send({ error: "A run is already in progress. Wait for it to finish." });
  return { runId: startRun(question) };
});

/**
 * Server-Sent Events: a long-lived response the server keeps writing to.
 * Each event is sent as `id: <seq>` + `data: <json>`. If the connection drops,
 * the browser reconnects with a Last-Event-ID header and we resume from there.
 */
app.get<{ Params: { id: string } }>("/api/runs/:id/events", (request, reply) => {
  if (!getRun(request.params.id)) return reply.code(404).send({ error: "No such run" });

  const lastId = Number(request.headers["last-event-id"]);
  reply.hijack(); // we write the raw response ourselves from here on
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const unsubscribe = subscribe(
    request.params.id,
    (event) => reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`),
    Number.isInteger(lastId) ? lastId : -1,
  );
  // Comment lines keep proxies from closing an idle connection while the model is thinking.
  // A heartbeat every 15 s, even while the model or a query is slow. It's a named
  // "ping" event, not an SSE comment (": ..."), because the browser drops comments
  // before page code sees them. The page treats a long silence as "this run is gone".
  // It also stops proxies from closing an idle connection.
  const heartbeat = setInterval(() => reply.raw.write("event: ping\ndata: {}\n\n"), HEARTBEAT_MS);
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

await app.listen({ port: PORT, host: "127.0.0.1" });
