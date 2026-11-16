import { useRef, useState, type ChangeEvent } from "react";
import { api, type TableSummary } from "../api";

interface Props {
  tables: TableSummary[];
  selected: string | null;
  onSelect: (name: string) => void;
  onUploaded: (table: string) => void;
}

/** Sidebar: the list of loaded tables, plus a CSV upload button. */
export function TableList({ tables, selected, onSelect, onUploaded }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-uploading the same file later
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { table } = await api.uploadCsv(file);
      onUploaded(table);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="sidebar-header">
        <h2>Datasets ({tables.length})</h2>
        <button className="secondary" onClick={() => fileInput.current?.click()} disabled={uploading}>
          {uploading ? "Uploading…" : "Upload CSV"}
        </button>
        <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={handleFile} />
      </div>
      {uploadError && <div className="banner error small">{uploadError}</div>}

      <ul className="table-list">
        {tables.map((t) => (
          <li key={t.name}>
            <button className={t.name === selected ? "table-item active" : "table-item"} onClick={() => onSelect(t.name)}>
              <span className="table-name">{t.name}</span>
              <span className="muted small">
                {t.rowCount.toLocaleString()} rows · {t.columnCount} cols
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
