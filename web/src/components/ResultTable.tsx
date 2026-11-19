import type { ColumnInfo } from "../../../server/src/agent/events";
import { formatCell, isNumericType } from "../lib/format";

/** A compact, scrollable table for query results and samples. */
export function ResultTable({ columns, rows, maxHeight = 280 }: { columns: ColumnInfo[]; rows: Record<string, unknown>[]; maxHeight?: number }) {
  if (rows.length === 0) return <p className="muted small">No rows.</p>;
  return (
    <div className="table-scroll" style={{ maxHeight }}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.name} className={isNumericType(c.type) ? "num" : undefined} title={c.type}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.name} className={isNumericType(c.type) ? "num" : undefined}>
                  {formatCell(row[c.name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
