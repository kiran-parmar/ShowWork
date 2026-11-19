import type Anthropic from "@anthropic-ai/sdk";
import { describeTable, listTables, openQueryConnection } from "../db.js";
import { checkReadOnlySelect, firstLine } from "./sqlGuard.js";
import type { ToolDisplay } from "./events.js";

/**
 * The agent's tools. All three are read-only, so they run without approval.
 * (Tools that change data arrive in week 2, behind an approval gate.)
 *
 * Every tool returns two views of its result:
 *  - forModel: compact JSON text the model reads
 *  - display: structured data the UI renders in the step card
 */

const ROWS_FOR_MODEL = 50; // keeps tool results (and cost) small; the model is told when rows are cut
const ROWS_FOR_UI = 200;
const QUERY_TIMEOUT_MS = 15_000;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_tables",
    description: "List every table available to query, with row and column counts. Call this first.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "describe_table",
    description: "Get a table's columns with their types, its row count, and 5 example rows.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { table: { type: "string", description: "Exact table name from list_tables" } },
      required: ["table"],
      additionalProperties: false,
    },
  },
  {
    name: "run_query",
    description:
      "Run one read-only DuckDB SQL SELECT query against the loaded tables. " +
      `Returns at most ${ROWS_FOR_MODEL} rows, so aggregate (GROUP BY, ORDER BY ... LIMIT) instead of fetching raw rows. ` +
      "Only SELECT is allowed; reading files and table functions such as read_csv are blocked.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        purpose: {
          type: "string",
          description: "One short sentence for the user: what this query finds out and why. Shown in the UI.",
        },
        sql: { type: "string", description: "A single DuckDB SELECT statement" },
      },
      required: ["purpose", "sql"],
      additionalProperties: false,
    },
  },
];

export interface ToolOutcome {
  forModel: string;
  display: ToolDisplay;
  isError: boolean;
}

function fail(message: string): ToolOutcome {
  return { forModel: `Error: ${message}`, display: { kind: "error", message }, isError: true };
}

export async function executeTool(name: string, input: unknown): Promise<ToolOutcome> {
  
  try {
    switch (name) {
      case "list_tables":
        return await runListTables();
      case "describe_table":
        return await runDescribeTable(input as { table: string });
      case "run_query":
        return await runQuery(input as { purpose: string; sql: string });
      default:
        return fail(`Unknown tool "${name}"`);
    }
  } catch (error) {
    return fail(firstLine(error));
  }
}

async function runListTables(): Promise<ToolOutcome> {
  const tables = await listTables();
  return {
    forModel: JSON.stringify({ tables }),
    display: { kind: "tables", tables },
    isError: false,
  };
}

async function runDescribeTable({ table }: { table: string }): Promise<ToolOutcome> {
  if (typeof table !== "string" || !table) return fail("Missing table name");
  const detail = await describeTable(table, 5);
  if (!detail) return fail(`No table named "${table}". Call list_tables to see the available tables.`);
  return {
    forModel: JSON.stringify(detail),
    display: { kind: "schema", table: detail.name, rowCount: detail.rowCount, columns: detail.columns, sample: detail.preview },
    isError: false,
  };
}

async function runQuery({ sql }: { purpose: string; sql: string }): Promise<ToolOutcome> {
  if (typeof sql !== "string" || !sql.trim()) return fail("Missing SQL");
  const statement = sql.trim().replace(/;+\s*$/, "");

  const connection = await openQueryConnection();
  try {
    const guard = await checkReadOnlySelect(connection, statement);
    if (!guard.ok) return fail(guard.reason);

    // Interrupt queries that run too long (e.g. an accidental huge join).
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      connection.interrupt();
    }, QUERY_TIMEOUT_MS);

    let reader;
    try {
      reader = await connection.runAndReadAll(statement);
    } catch (error) {
      return fail(timedOut ? `Query took longer than ${QUERY_TIMEOUT_MS / 1000}s and was stopped.` : firstLine(error));
    } finally {
      clearTimeout(timer);
    }

    const columns = reader.columnNames().map((name, i) => ({ name, type: reader.columnTypes()[i]!.toString() }));
    const rows = reader.getRowObjectsJson();
    const modelRows = rows.slice(0, ROWS_FOR_MODEL);

    return {
      forModel: JSON.stringify({
        rowCount: rows.length,
        columns,
        rows: modelRows,
        ...(rows.length > ROWS_FOR_MODEL && {
          note: `Showing ${ROWS_FOR_MODEL} of ${rows.length} rows. Aggregate or add LIMIT if you need specific rows.`,
        }),
      }),
      display: { kind: "rows", columns, rows: rows.slice(0, ROWS_FOR_UI), rowCount: rows.length },
      isError: false,
    };
  } finally {
    connection.closeSync();
  }
}
