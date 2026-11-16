import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * In-process DuckDB. Each CSV becomes a table; the agent (from Day 2) will
 * query these tables through tools that call the functions below.
 */
let connection: DuckDBConnection | undefined;

export async function initDb(): Promise<void> {
  const instance = await DuckDBInstance.create(":memory:");
  connection = await instance.connect();
}

function db(): DuckDBConnection {
  if (!connection) throw new Error("Database not initialised. Call initDb() first.");
  return connection;
}

/** Turn a file name like "Sales Q1-2024.csv" into a safe table name: sales_q1_2024 */
export function toTableName(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName));
  const cleaned = base.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const name = cleaned || "dataset";
  return /^[0-9]/.test(name) ? `t_${name}` : name;
}

/** Double-quote an identifier for SQL. Only ever called with names we validated or generated. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function loadCsv(tableName: string, filePath: string): Promise<void> {
  const literalPath = filePath.replace(/\\/g, "/").replace(/'/g, "''");
  const create = (reader: string) =>
    db().runAndReadAll(`CREATE OR REPLACE TABLE ${quoteIdent(tableName)} AS SELECT * FROM ${reader}`);
  try {
    await create(`read_csv_auto('${literalPath}')`);
  } catch (strictError) {
    // Real-world CSVs are often messy (mixed line endings, ragged rows). Retry leniently.
    try {
      await create(`read_csv('${literalPath}', strict_mode = false, null_padding = true)`);
    } catch {
      // Report the original error, first line only: DuckDB's full message is very long.
      const message = strictError instanceof Error ? strictError.message : String(strictError);
      throw new Error(message.split("\n")[0]);
    }
  }
}

/** Loads every CSV in a folder. One bad file is reported, not fatal. */
export async function loadCsvFolder(folder: string): Promise<{ loaded: string[]; failed: { file: string; error: string }[] }> {
  const result = { loaded: [] as string[], failed: [] as { file: string; error: string }[] };
  let files: string[] = [];
  try {
    files = (await readdir(folder)).filter((f) => f.toLowerCase().endsWith(".csv"));
  } catch {
    return result; // folder doesn't exist yet
  }
  for (const file of files) {
    const table = toTableName(file);
    try {
      await loadCsv(table, path.join(folder, file));
      result.loaded.push(table);
    } catch (error) {
      result.failed.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export interface TableSummary {
  name: string;
  rowCount: number;
  columnCount: number;
}

export async function listTables(): Promise<TableSummary[]> {
  const reader = await db().runAndReadAll(
    `SELECT table_name, column_count
       FROM duckdb_tables()
      WHERE schema_name = 'main'
      ORDER BY table_name`,
  );
  const summaries: TableSummary[] = [];
  for (const row of reader.getRowObjectsJson()) {
    const name = String(row.table_name);
    // Exact count (duckdb_tables().estimated_size is only an estimate).
    const count = await db().runAndReadAll(`SELECT count(*) AS n FROM ${quoteIdent(name)}`);
    summaries.push({
      name,
      rowCount: Number(count.getRowObjectsJson()[0]?.n ?? 0),
      columnCount: Number(row.column_count),
    });
  }
  return summaries;
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableDetail {
  name: string;
  rowCount: number;
  columns: ColumnInfo[];
  preview: Record<string, unknown>[];
}

/** Returns undefined when the table doesn't exist (callers turn that into a 404). */
export async function describeTable(name: string, previewRows: number): Promise<TableDetail | undefined> {
  const tables = await listTables();
  const table = tables.find((t) => t.name === name);
  if (!table) return undefined;

  const ident = quoteIdent(table.name);
  const schema = await db().runAndReadAll(`DESCRIBE ${ident}`);
  const columns = schema.getRowObjectsJson().map((row) => ({
    name: String(row.column_name),
    type: String(row.column_type),
  }));

  const count = await db().runAndReadAll(`SELECT count(*) AS n FROM ${ident}`);
  const rowCount = Number(count.getRowObjectsJson()[0]?.n ?? 0);

  const limit = Math.max(1, Math.min(previewRows, 200));
  const preview = await db().runAndReadAll(`SELECT * FROM ${ident} LIMIT ${limit}`);

  return { name: table.name, rowCount, columns, preview: preview.getRowObjectsJson() };
}
