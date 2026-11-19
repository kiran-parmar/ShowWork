import { useCallback, useEffect, useRef, useState } from "react";
import { HEARTBEAT_MS, type RunEvent } from "../../../server/src/agent/events";

export type RunStatus = "idle" | "starting" | "running" | "completed" | "failed";

/**
 * If nothing at all (no event, no ping) arrives for this long, the run is gone,
 * e.g. the server restarted and lost it. Long enough to survive a couple of
 * missed pings and a brief reconnect.
 */
const SILENCE_LIMIT_MS = HEARTBEAT_MS * 3;
const LOST_MESSAGE = "Lost the connection to this run (the server may have restarted). Ask again.";

/**
 * Starts an agent run and streams its events into React state.
 *
 * The server sends events over Server-Sent Events (SSE). The browser's built-in
 * EventSource handles the connection and reconnects automatically if it drops,
 * sending the last event id it saw so the server can resume.
 *
 * Two ways a run can be lost, and how each is caught:
 *  - The reconnect is refused (the new server has never heard of this run, so 404).
 *    EventSource gives up, readyState becomes CLOSED, and onerror fires.
 *  - The connection just goes silent (e.g. a proxy holds it open after the server
 *    died). No error ever fires, so a watchdog timer notices that the server's
 *    regular pings have stopped.
 */
export function useRun() {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [startError, setStartError] = useState<string | null>(null);
  /** The stream broke. A browser-side problem, so it isn't one of the server's events. */
  const [streamError, setStreamError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const watchdogRef = useRef<number | undefined>(undefined);

  const close = () => {
    window.clearTimeout(watchdogRef.current);
    sourceRef.current?.close();
    sourceRef.current = null;
  };

  // Close the stream if the component using this hook unmounts.
  useEffect(() => close, []);

  const start = useCallback(async (question: string) => {
    close();
    setEvents([]);
    setStartError(null);
    setStreamError(null);
    setStatus("starting");

    let runId: string;
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      runId = body.runId;
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
      setStatus("idle");
      return;
    }

    setStatus("running");
    const source = new EventSource(`/api/runs/${runId}/events`);
    sourceRef.current = source;

    const giveUp = () => {
      close();
      setStreamError(LOST_MESSAGE);
      setStatus("failed");
    };

    // Restart the countdown every time anything arrives. If it ever reaches zero, give up.
    const resetWatchdog = () => {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(giveUp, SILENCE_LIMIT_MS);
    };
    resetWatchdog();

    source.onmessage = (message) => {
      resetWatchdog();
      const event = JSON.parse(message.data) as RunEvent;
      // Append, skipping anything we already have (defensive, in case of a replay after reconnect).
      setEvents((current) => (current.some((e) => e.seq === event.seq) ? current : [...current, event]));
      if (event.type === "run.completed" || event.type === "run.failed") {
        setStatus(event.type === "run.completed" ? "completed" : "failed");
        close(); // otherwise EventSource would reconnect forever
      }
    };

    // Named "ping" events don't trigger onmessage; they need their own listener.
    source.addEventListener("ping", resetWatchdog);

    source.onerror = () => {
      // CONNECTING: the browser is already retrying by itself, so leave it alone (a brief blip).
      // CLOSED: the browser gave up, e.g. the reconnect got a 404. The run is gone.
      if (source.readyState === EventSource.CLOSED) giveUp();
    };
  }, []);

  return { events, status, startError, streamError, start };
}
