// Types mirror the server's responses (server/src/db.ts and claude.ts).
export interface TableSummary {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface TableDetail {
  name: string;
  rowCount: number;
  columns: { name: string; type: string }[];
  preview: Record<string, unknown>[];
}

export type ClaudeCheck =
  | { ok: true; model: string; reply: string; inputTokens: number; outputTokens: number; ms: number }
  | { ok: false; error: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  listTables: () => request<{ tables: TableSummary[] }>("/api/tables").then((r) => r.tables),
  getTable: (name: string, limit: number) => request<TableDetail>(`/api/tables/${encodeURIComponent(name)}?limit=${limit}`),
  uploadCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ table: string }>("/api/tables/upload", { method: "POST", body: form });
  },
  checkClaude: () => request<ClaudeCheck>("/api/claude/check"),
};
