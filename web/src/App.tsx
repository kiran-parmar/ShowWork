import { useCallback, useEffect, useState } from "react";
import { api, type TableSummary } from "./api";
import { ConnectionCheck } from "./components/ConnectionCheck";
import { TableList } from "./components/TableList";
import { TableView } from "./components/TableView";

/**
 * Top-level layout. App owns the shared state (the table list and which table is
 * selected) and passes it down to child components as props.
 */
export default function App() {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // useCallback keeps the same function between renders, so it's safe to use in useEffect.
  const refreshTables = useCallback(async () => {
    try {
      const list = await api.listTables();
      setTables(list);
      setError(null);
      // Select the first table if nothing is selected yet.
      setSelected((current) => current ?? list[0]?.name ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Runs once after the first render: load the table list. In dev the web app often
  // starts before the server, so retry a few times before showing the error.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 10 && !cancelled; attempt++) {
        try {
          const list = await api.listTables();
          if (cancelled) return;
          setTables(list);
          setError(null);
          setSelected((current) => current ?? list[0]?.name ?? null);
          return;
        } catch (e) {
          if (attempt === 9 && !cancelled) setError(e instanceof Error ? e.message : String(e));
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUploaded(table: string) {
    await refreshTables();
    setSelected(table);
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>ShowWork</h1>
          <p className="tagline">A data-analysis agent that shows its work.</p>
        </div>
        <ConnectionCheck />
      </header>

      {error && <div className="banner error">Can't reach the server: {error}</div>}

      <main className="app-main">
        <aside className="sidebar">
          <TableList tables={tables} selected={selected} onSelect={setSelected} onUploaded={handleUploaded} />
        </aside>
        <section className="content">
          {selected ? <TableView name={selected} /> : <p className="muted">Upload a CSV to get started.</p>}
        </section>
      </main>
    </div>
  );
}
