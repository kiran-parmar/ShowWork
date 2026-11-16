import { useState } from "react";
import { api, type ClaudeCheck } from "../api";

/** Button that sends one small request to Claude through the server and shows the result. */
export function ConnectionCheck() {
  const [status, setStatus] = useState<"idle" | "checking" | "done">("idle");
  const [result, setResult] = useState<ClaudeCheck | null>(null);

  async function run() {
    setStatus("checking");
    try {
      setResult(await api.checkClaude());
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    setStatus("done");
  }

  return (
    <div className="connection">
      <button onClick={run} disabled={status === "checking"}>
        {status === "checking" ? "Checking…" : "Check Claude connection"}
      </button>
      {result && (
        <div className={`connection-result ${result.ok ? "ok" : "fail"}`} role="status">
          {result.ok ? (
            <>
              <strong>Connected</strong> · {result.model} · {result.inputTokens + result.outputTokens} tokens ·{" "}
              {(result.ms / 1000).toFixed(1)}s
              <div className="reply">“{result.reply}”</div>
            </>
          ) : (
            <>
              <strong>Not connected:</strong> {result.error}
            </>
          )}
        </div>
      )}
    </div>
  );
}
