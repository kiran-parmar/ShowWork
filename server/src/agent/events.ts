/**
 * Everything that happens in a run is recorded as an event, in order.
 * The UI is built entirely from this event list, which is what makes a run
 * inspectable, and (later) replayable from a stored log.
 *
 * This file has no imports so the web app can import its types directly.
 */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated from list prices; the Console's Usage page is the source of truth. */
  costUsd: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
}

/** Structured tool results for the UI to render. */
export type ToolDisplay =
  | { kind: "tables"; tables: { name: string; rowCount: number; columnCount: number }[] }
  | { kind: "schema"; table: string; rowCount: number; columns: ColumnInfo[]; sample: Record<string, unknown>[] }
  | { kind: "rows"; columns: ColumnInfo[]; rows: Record<string, unknown>[]; rowCount: number }
  | { kind: "error"; message: string };

export interface RunTotals extends Usage {
  ms: number;
  modelCalls: number;
  toolCalls: number;
}

export type EventBody =
  | { type: "run.started"; runId: string; question: string; model: string }
  /** One request to the model. A run makes several: one per round of tool use, plus the final answer. */
  | { type: "model.started"; turn: number }
  | { type: "model.completed"; turn: number; ms: number; stopReason: string; usage: Usage }
  /** A summary of the model's reasoning before it acted. */
  | { type: "reasoning"; turn: number; text: string }
  /** Text the model wrote alongside tool calls (progress notes). */
  | { type: "message"; turn: number; text: string }
  | { type: "tool.started"; stepId: string; turn: number; tool: string; input: Record<string, unknown> }
  | { type: "tool.completed"; stepId: string; ms: number; isError: boolean; display: ToolDisplay }
  | { type: "run.completed"; answer: string; totals: RunTotals }
  | { type: "run.failed"; error: string; totals: RunTotals };

export type RunEvent = EventBody & { seq: number; at: number };

/**
 * While a run's stream is open, the server sends a "ping" at least this often.
 * The page uses it to tell "the agent is slow" from "the run is gone".
 */
export const HEARTBEAT_MS = 15_000;
export type RunEventType = RunEvent["type"];
