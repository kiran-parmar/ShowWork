import type { TimelineItem } from "../agent/buildTimeline";
import { toolLabel } from "../agent/buildTimeline";
import { formatCost, formatMs, formatTokens } from "../lib/format";
import { ResultTable } from "./ResultTable";

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;
type ModelItem = Extract<TimelineItem, { kind: "model" }>;

/**
 * One tool call. Collapsed: what it did and why. Expanded: the exact input
 * (e.g. the SQL) and the result the agent saw.
 */
export function StepCard({ item, index }: { item: ToolItem; index: number }) {
  const purpose = typeof item.input.purpose === "string" ? item.input.purpose : undefined;
  const sql = typeof item.input.sql === "string" ? item.input.sql : undefined;
  const table = typeof item.input.table === "string" ? item.input.table : undefined;

  const summary = purpose ?? (table ? `Look at the "${table}" table` : item.tool === "list_tables" ? "See which tables exist" : item.tool);

  return (
    <details className={`step-card ${item.status}`} open={item.tool === "run_query"}>
      <summary>
        <span className="step-index">{index}</span>
        <span className="step-main">
          <span className="step-label">{toolLabel(item.tool)}</span>
          <span className="step-summary">{summary}</span>
        </span>
        <span className="step-meta">
          {item.status === "running" ? <span className="spinner" aria-label="running" /> : null}
          {item.status === "error" ? <span className="badge error">failed</span> : null}
          {item.ms !== undefined ? <span className="muted small">{formatMs(item.ms)}</span> : null}
        </span>
      </summary>

      <div className="step-body">
        {sql ? (
          <>
            <div className="step-section-label">SQL</div>
            <pre className="code">{sql}</pre>
          </>
        ) : null}

        {item.display ? <ToolResultView display={item.display} /> : item.status === "running" ? <p className="muted small">Running…</p> : null}
      </div>
    </details>
  );
}

function ToolResultView({ display }: { display: NonNullable<ToolItem["display"]> }) {
  switch (display.kind) {
    case "error":
      return <div className="banner error small">{display.message}</div>;
    case "tables":
      return (
        <>
          <div className="step-section-label">Result</div>
          <ul className="plain-list">
            {display.tables.map((t) => (
              <li key={t.name}>
                <strong>{t.name}</strong> <span className="muted small">{t.rowCount.toLocaleString()} rows · {t.columnCount} columns</span>
              </li>
            ))}
          </ul>
        </>
      );
    case "schema":
      return (
        <>
          <div className="step-section-label">
            Columns <span className="muted">· {display.rowCount.toLocaleString()} rows</span>
          </div>
          <div className="chips">
            {display.columns.map((c) => (
              <span key={c.name} className="chip">
                {c.name} <span className="muted">{c.type}</span>
              </span>
            ))}
          </div>
          <div className="step-section-label">Sample rows</div>
          <ResultTable columns={display.columns} rows={display.sample} maxHeight={180} />
        </>
      );
    case "rows":
      return (
        <>
          <div className="step-section-label">
            Result <span className="muted">· {display.rowCount.toLocaleString()} row{display.rowCount === 1 ? "" : "s"}{display.rows.length < display.rowCount ? `, showing ${display.rows.length}` : ""}</span>
          </div>
          <ResultTable columns={display.columns} rows={display.rows} />
        </>
      );
  }
}

/** A thin line marking one call to the model, with its time, tokens and estimated cost. */
export function ModelCallRow({ item }: { item: ModelItem }) {
  const u = item.usage;
  return (
    <div className="model-row">
      <span className="model-dot" />
      {item.status === "running" ? (
        <span className="muted small">
          Model call {item.turn} <span className="spinner small" aria-label="waiting for the model" />
        </span>
      ) : (
        <span className="muted small" title={u ? `input ${formatTokens(u.inputTokens)} · cache read ${formatTokens(u.cacheReadTokens)} · cache write ${formatTokens(u.cacheWriteTokens)} · output ${formatTokens(u.outputTokens)}` : undefined}>
          Model call {item.turn} · {item.ms !== undefined ? formatMs(item.ms) : ""}
          {u ? ` · ${formatTokens(u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens + u.outputTokens)} tokens · ${formatCost(u.costUsd)}` : ""}
        </span>
      )}
    </div>
  );
}
