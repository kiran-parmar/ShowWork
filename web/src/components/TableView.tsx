import { useEffect, useState } from "react";
import { api, type TableDetail } from "../api";
import { formatCell, isNumericType } from "../lib/format";

/** Shows one table's columns and first rows. Reloads whenever `name` changes. */
export function TableView({ name }: { name: string }) {
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(20);

  useEffect(() => {
    // If the user clicks another table before this request finishes, ignore the stale response.
    let cancelled = false;
    setDetail(null);
    setError(null);
    api
      .getTable(name, limit)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [name, limit]);

  if (error) return <div className="banner error">{error}</div>;
  if (!detail) return <p className="muted">Loading {name}…</p>;

  return (
    <div>
      <h2>{detail.name}</h2>
      <p className="muted">
        {detail.rowCount.toLocaleString()} rows · {detail.columns.length} columns · showing first {detail.preview.length}
      </p>

      <h3>Columns</h3>
      <div className="chips">
        {detail.columns.map((c) => (
          <span key={c.name} className="chip">
            {c.name} <span className="muted">{c.type}</span>
          </span>
        ))}
      </div>

      <h3>Preview</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {detail.columns.map((c) => (
                <th className={isNumericType(c.type) ? "num" : undefined} key={c.name}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.preview.map((row, i) => (
              <tr key={i}>
                {detail.columns.map((c) => (
                  <td className={isNumericType(c.type) ? "num" : undefined} key={c.name}>{formatCell(row[c.name])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <select value={limit} onChange={(e) => setLimit(parseInt(e.target.value))}>
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">50</option>
        </select>
      </div>
    </div>
  );
}
