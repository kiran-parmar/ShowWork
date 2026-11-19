import type { RunEvent, RunTotals, ToolDisplay, Usage } from "../../../server/src/agent/events";

/**
 * Turns the flat event list into what the UI shows. Keeping this a pure function
 * (events in, view out) means the same code will work for replaying stored runs later.
 */

export type TimelineItem =
  | { kind: "model"; key: string; turn: number; status: "running" | "done"; ms?: number; usage?: Usage; stopReason?: string }
  | { kind: "reasoning"; key: string; turn: number; text: string }
  | { kind: "message"; key: string; turn: number; text: string }
  | {
      kind: "tool";
      key: string;
      turn: number;
      tool: string;
      input: Record<string, unknown>;
      status: "running" | "done" | "error";
      ms?: number;
      display?: ToolDisplay;
    };

export interface RunView {
  question?: string;
  model?: string;
  items: TimelineItem[];
  answer?: string;
  error?: string;
  totals?: RunTotals;
  /** What the agent is doing right now, for the live status line. */
  activity: string | null;
}

export function buildTimeline(events: RunEvent[]): RunView {
  const view: RunView = { items: [], activity: null };
  const byKey = new Map<string, TimelineItem>();

  for (const event of events) {
    switch (event.type) {
      case "run.started":
        view.question = event.question;
        view.model = event.model;
        break;
      case "model.started": {
        const item: TimelineItem = { kind: "model", key: `model-${event.turn}`, turn: event.turn, status: "running" };
        byKey.set(item.key, item);
        view.items.push(item);
        break;
      }
      case "model.completed": {
        const item = byKey.get(`model-${event.turn}`);
        if (item?.kind === "model") Object.assign(item, { status: "done", ms: event.ms, usage: event.usage, stopReason: event.stopReason });
        break;
      }
      case "reasoning":
      case "message":
        view.items.push({ kind: event.type, key: `${event.type}-${event.seq}`, turn: event.turn, text: event.text });
        break;
      case "tool.started": {
        const item: TimelineItem = {
          kind: "tool",
          key: event.stepId,
          turn: event.turn,
          tool: event.tool,
          input: event.input,
          status: "running",
        };
        byKey.set(item.key, item);
        view.items.push(item);
        break;
      }
      case "tool.completed": {
        const item = byKey.get(event.stepId);
        if (item?.kind === "tool") Object.assign(item, { status: event.isError ? "error" : "done", ms: event.ms, display: event.display });
        break;
      }
      case "run.completed":
        view.answer = event.answer;
        view.totals = event.totals;
        break;
      case "run.failed":
        view.error = event.error;
        view.totals = event.totals;
        break;
    }
  }

  if (!view.totals) {
    const running = [...view.items].reverse().find((i) => (i.kind === "model" || i.kind === "tool") && i.status === "running");
    if (running?.kind === "tool") view.activity = `Running ${toolLabel(running.tool).toLowerCase()}…`;
    else if (running?.kind === "model") view.activity = running.turn === 1 ? "Thinking about the question…" : "Reading results and deciding the next step…";
    else if (events.length) view.activity = "Working…";
  }
  return view;
}

export function toolLabel(tool: string): string {
  switch (tool) {
    case "list_tables":
      return "List tables";
    case "describe_table":
      return "Describe table";
    case "run_query":
      return "Query";
    default:
      return tool;
  }
}
