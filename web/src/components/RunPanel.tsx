import { useMemo, useState, type FormEvent } from "react";
import { buildTimeline } from "../agent/buildTimeline";
import { useRun } from "../agent/useRun";
import { formatCost, formatMs, formatTokens } from "../lib/format";
import { ModelCallRow, StepCard } from "./StepCard";

const EXAMPLES = [
  "Which region had the highest revenue in 2025, and how did it compare to its target?",
  "How do holiday months (Nov–Dec) compare with the rest of the year?",
  "Which products have the highest average discount, and which channel drives it?",
];

/** The "Ask" tab: question box, live step timeline, and the final answer. */
export function RunPanel() {
  const [question, setQuestion] = useState("");
  const { events, status, startError, streamError, start } = useRun(); 

  // Recompute the view only when events change.
  const view = useMemo(() => buildTimeline(events), [events]);
  const busy = status === "starting" || status === "running";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (question.trim() && !busy) void start(question.trim());
  }

  let stepNumber = 0;

  return (
    <div className="run-panel">
      <form className="ask-box" onSubmit={submit}>
        <label htmlFor="question" className="step-section-label">
          Ask a question about your data
        </label>
        <textarea
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter submits
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
          }}
          rows={3}
          placeholder="e.g. Which region grew fastest from 2023 to 2025?"
          disabled={busy}
        />
        <div className="ask-actions">
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button type="button" key={ex} className="example" onClick={() => setQuestion(ex)} disabled={busy}>
                {ex}
              </button>
            ))}
          </div>
          <button type="submit" disabled={busy || !question.trim()}>
            {busy ? "Working…" : "Ask"}
          </button>
        </div>
        {startError && <div className="banner error small">{startError}</div>}
      </form>

      {view.question && (
        <section className="run" aria-live="polite">
          <header className="run-header">
            <div>
              <div className="step-section-label">Question</div>
              <p className="run-question">{view.question}</p>
            </div>
            <RunStats view={view} />
          </header>

          <div className="timeline">
            {view.items.map((item) => {
              switch (item.kind) {
                case "model":
                  return <ModelCallRow key={item.key} item={item} />;
                case "reasoning":
                  return (
                    <details key={item.key} className="note reasoning">
                      <summary>Reasoning</summary>
                      <p>{item.text}</p>
                    </details>
                  );
                case "message":
                  return (
                    <p key={item.key} className="note message">
                      {item.text}
                    </p>
                  );
                case "tool":
                  return <StepCard key={item.key} item={item} index={++stepNumber} />;
              }
            })}
            {/* view.activity comes from the events alone, which can't know the stream died, so also check status. */}
            {view.activity && status === "running" && (
              <div className="activity">
                <span className="spinner" /> {view.activity}
              </div>
            )}
          </div>

          {view.answer !== undefined && (
            <div className="answer">
              <div className="step-section-label">Answer</div>
              <p>{view.answer}</p>
            </div>
          )}
          {view.error && <div className="banner error">Run stopped: {view.error}</div>}
          {streamError && <div className="banner error">{streamError}</div>}
        </section>
      )}
    </div>
  );
}

function RunStats({ view }: { view: ReturnType<typeof buildTimeline> }) {
  const t = view.totals;
  if (!t) return <div className="run-stats muted small">{view.model}</div>;
  const tokens = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens + t.outputTokens;
  return (
    <div className="run-stats small" title="Cost is estimated from list prices; see the Claude Console for billing.">
      <span>{view.model}</span>
      <span>{formatMs(t.ms)}</span>
      <span>
        {t.modelCalls} model call{t.modelCalls === 1 ? "" : "s"} · {t.toolCalls} step{t.toolCalls === 1 ? "" : "s"}
      </span>
      <span>{formatTokens(tokens)} tokens</span>
      <span className="cost">≈ {formatCost(t.costUsd)}</span>
    </div>
  );
}
