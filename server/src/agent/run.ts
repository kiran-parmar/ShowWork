import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { describeApiError, fallbackOptions, getClient, getModel, type SupportedModel } from "../claude.js";
import type { EventBody, RunEvent, RunTotals, Usage } from "./events.js";
import { addUsage, toUsage, ZERO_USAGE } from "./pricing.js";
import { executeTool, TOOLS } from "./tools.js";

/**
 * The agent loop, written by hand (not the SDK's tool runner) because ShowWork
 * needs to record every step as an event, and later to pause for approval or
 * accept steering between steps.
 *
 * Loop: ask the model -> run any tools it requested -> send results back -> repeat,
 * until it answers (end_turn) or a safety cap is hit.
 */

// Safety caps so a confused agent can't loop (and spend) forever.
const MAX_MODEL_CALLS = 12;
const MAX_TOOL_CALLS = 20;
const MAX_TOKENS_PER_CALL = 16_000;

const SYSTEM_PROMPT = `You are ShowWork, a careful data analyst. The user asks questions about tables loaded into DuckDB, and you answer by querying them with your tools.

How to work:
- Start with list_tables, then describe_table for each table you'll use, before writing queries.
- Use DuckDB SQL. Aggregate in SQL (GROUP BY, window functions, ORDER BY ... LIMIT) rather than fetching raw rows.
- Give every run_query a clear purpose sentence; the user sees it next to the SQL.
- If a query fails, read the error, fix the query, and try again.
- Prefer a few well-chosen queries over many small ones.

Final answer:
- Lead with the direct answer in one or two sentences, then key figures as short "- " bullet lines.
- Every number you state must come from a query result in this conversation. Never estimate or invent figures.
- Mention any caveats (missing data, assumptions, ambiguous wording you resolved).
- Plain text only: no markdown tables, headings, or bold.`;

// ---------------------------------------------------------------------------
// Run store: keeps each run's events in memory and notifies live subscribers.
// (Day 5 persists these events to SQLite.)

type Listener = (event: RunEvent) => void;

interface RunRecord {
  id: string;
  events: RunEvent[];
  listeners: Set<Listener>;
  done: boolean;
}

const runs = new Map<string, RunRecord>();
const MAX_STORED_RUNS = 50;

export function getRun(id: string): RunRecord | undefined {
  return runs.get(id);
}

/** Only one run at a time: simpler to follow, and caps spend. */
export function isRunActive(): boolean {
  return [...runs.values()].some((r) => !r.done);
}

/**
 * Subscribe to a run: replays past events (after `afterSeq`, for reconnects), then
 * streams new ones. Returns an unsubscribe function.
 */
export function subscribe(id: string, listener: Listener, afterSeq = -1): () => void {
  const run = runs.get(id);
  if (!run) return () => {};
  for (const event of run.events) if (event.seq > afterSeq) listener(event);
  run.listeners.add(listener);
  return () => run.listeners.delete(listener);
}

function emit(run: RunRecord, body: EventBody) {
  const event: RunEvent = { ...body, seq: run.events.length, at: Date.now() };
  run.events.push(event);
  if (event.type === "run.completed" || event.type === "run.failed") run.done = true;
  for (const listener of run.listeners) listener(event);
}

// ---------------------------------------------------------------------------

/** Starts a run in the background and returns its id immediately. */
export function startRun(question: string): string {
  const id = randomUUID();
  const run: RunRecord = { id, events: [], listeners: new Set(), done: false };
  runs.set(id, run);
  if (runs.size > MAX_STORED_RUNS) runs.delete(runs.keys().next().value!);

  void agentLoop(run, question, getModel());
  return id;
}

async function agentLoop(run: RunRecord, question: string, model: SupportedModel): Promise<void> {
  const started = Date.now();
  let usage: Usage = ZERO_USAGE;
  let modelCalls = 0;
  let toolCalls = 0;
  const totals = (): RunTotals => ({ ...usage, ms: Date.now() - started, modelCalls, toolCalls });

  emit(run, { type: "run.started", runId: run.id, question, model });

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: question }];

  try {
    while (true) {
      if (modelCalls >= MAX_MODEL_CALLS) {
        emit(run, { type: "run.failed", error: `Stopped after ${MAX_MODEL_CALLS} model calls (safety limit).`, totals: totals() });
        return;
      }
      const turn = ++modelCalls;
      emit(run, { type: "model.started", turn });
      const callStarted = Date.now();
      
      const response = await getClient().beta.messages.create({
        model,
        max_tokens: MAX_TOKENS_PER_CALL,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
        // Summarized reasoning is shown in the timeline; the full reasoning is never exposed.
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "medium" },
        // Cache the stable prefix (system prompt, tools, earlier turns) so each step re-reads it cheaply.
        cache_control: { type: "ephemeral" },
        ...fallbackOptions(model),
      });

      const callUsage = toUsage(model, response.usage);
      usage = addUsage(usage, callUsage);
      emit(run, {
        type: "model.completed",
        turn,
        ms: Date.now() - callStarted,
        stopReason: response.stop_reason ?? "unknown",
        usage: callUsage,
      });

      // Always append the full content (including thinking blocks) so the next call has the complete history.
      messages.push({ role: "assistant", content: response.content });

      const isFinal = response.stop_reason === "end_turn";
      const texts: string[] = [];
      for (const block of response.content) {
        if (block.type === "thinking" && block.thinking.trim()) {
          emit(run, { type: "reasoning", turn, text: block.thinking.trim() });
        } else if (block.type === "text" && block.text.trim()) {
          texts.push(block.text.trim());
          if (!isFinal) emit(run, { type: "message", turn, text: block.text.trim() });
        }
      }

      if (response.stop_reason === "refusal") {
        emit(run, { type: "run.failed", error: "The model declined this request.", totals: totals() });
        return;
      }
      if (response.stop_reason === "max_tokens") {
        emit(run, { type: "run.failed", error: "The response hit the length limit before finishing.", totals: totals() });
        return;
      }
      if (isFinal) {
        emit(run, { type: "run.completed", answer: texts.join("\n\n"), totals: totals() });
        return;
      }
      if (response.stop_reason === "pause_turn") continue; // resend so the model can carry on

      // stop_reason "tool_use": run every requested tool, then return all results in one message.
      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        if (toolCalls >= MAX_TOOL_CALLS) {
          results.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: "Tool call limit reached. Answer with what you have." });
          continue;
        }
        toolCalls++;
        const input = (toolUse.input ?? {}) as Record<string, unknown>;
        emit(run, { type: "tool.started", stepId: toolUse.id, turn, tool: toolUse.name, input });
        const toolStarted = Date.now();
        const outcome = await executeTool(toolUse.name, input);
        emit(run, {
          type: "tool.completed",
          stepId: toolUse.id,
          ms: Date.now() - toolStarted,
          isError: outcome.isError,
          display: outcome.display,
        });
        results.push({ type: "tool_result", tool_use_id: toolUse.id, content: outcome.forModel, is_error: outcome.isError });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (error) {
    emit(run, { type: "run.failed", error: describeApiError(error), totals: totals() });
  }
}
