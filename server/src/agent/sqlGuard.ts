import type { DuckDBConnection } from "@duckdb/node-api";

/**
 * Guards the agent's run_query tool. The agent may only read the loaded tables:
 *  - exactly one statement, and it must be a SELECT (DuckDB's own parser decides,
 *    via json_serialize_sql, which only accepts SELECT statements)
 *  - no table functions (read_csv, glob, ...) and no file-path "tables"
 *    (DuckDB can read `FROM 'C:/some/file.csv'` directly), so a query can't
 *    reach files on disk such as .env
 *  - no functions from a deny-list that read files or system state
 *
 * The parser does the heavy lifting; we only walk its syntax tree.
 */

const DENIED_FUNCTION = /^(read_|glob$|sniff_csv$|parquet_|query$|query_table$|getenv$|current_setting$|duckdb_|pragma_|which_secret$|load_|install_)/i;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type GuardResult = { ok: true } | { ok: false; reason: string };

export async function checkReadOnlySelect(connection: DuckDBConnection, sql: string): Promise<GuardResult> {
  const literal = sql.replace(/'/g, "''");
  let parsed: { error: boolean; error_message?: string; statements?: unknown[] };
  try {
    const reader = await connection.runAndReadAll(`SELECT json_serialize_sql('${literal}') AS ast`);
    parsed = JSON.parse(String(reader.getRowObjectsJson()[0]?.ast));
  } catch (error) {
    return { ok: false, reason: `Could not parse SQL: ${firstLine(error)}` };
  }

  if (parsed.error) {
    const message = parsed.error_message ?? "invalid SQL";
    return {
      ok: false,
      reason: /Only SELECT/i.test(message) ? "Only read-only SELECT queries are allowed." : `Invalid SQL: ${message}`,
    };
  }
  if (!parsed.statements || parsed.statements.length !== 1) {
    return { ok: false, reason: "Send exactly one SELECT statement per query." };
  }

  const problem = findProblem(parsed.statements[0]);
  return problem ? { ok: false, reason: problem } : { ok: true };
}

/** Depth-first walk of DuckDB's JSON syntax tree, returning the first disallowed construct. */
function findProblem(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProblem(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;

  if (obj.type === "TABLE_FUNCTION") {
    return "Table functions (such as read_csv) are not allowed. Query the loaded tables by name.";
  }
  if (obj.type === "BASE_TABLE" && typeof obj.table_name === "string" && !IDENTIFIER.test(obj.table_name)) {
    return `"${obj.table_name}" is not a table name. Query the loaded tables by name.`;
  }
  if (typeof obj.function_name === "string" && DENIED_FUNCTION.test(obj.function_name)) {
    return `The function ${obj.function_name}() is not allowed.`;
  }
  for (const value of Object.values(obj)) {
    const found = findProblem(value);
    if (found) return found;
  }
  return undefined;
}

export function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0]!;
}
