/**
 * Checks that run_query only allows read-only SELECTs over loaded tables.
 *   npm run test:guard -w server
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, loadCsvFolder } from "../src/db.js";
import { executeTool } from "../src/agent/tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
await initDb();
await loadCsvFolder(path.resolve(here, "../data/sample"));

const cases: { sql: string; allowed: boolean }[] = [
  { sql: "SELECT region, sum(revenue) FROM orders GROUP BY region", allowed: true },
  { sql: "WITH t AS (SELECT * FROM orders) SELECT count(*) FROM t;", allowed: true },
  { sql: "SELECT o.region FROM orders o JOIN region_targets r USING (region) LIMIT 1", allowed: true },
  { sql: "DROP TABLE orders", allowed: false },
  { sql: "DELETE FROM orders", allowed: false },
  { sql: "CREATE TABLE x AS SELECT 1", allowed: false },
  { sql: "SELECT 1; DROP TABLE orders", allowed: false },
  { sql: "SELECT * FROM read_csv('../../.env')", allowed: false },
  { sql: "SELECT * FROM '../../.env'", allowed: false },
  { sql: "SELECT * FROM read_text('../../.env')", allowed: false },
  { sql: "SELECT * FROM glob('*')", allowed: false },
  { sql: "SELECT * FROM (SELECT * FROM read_csv_auto('x.csv'))", allowed: false },
  { sql: "SELECT current_setting('home_directory')", allowed: false },
  { sql: "COPY orders TO 'out.csv'", allowed: false },
  { sql: "ATTACH 'other.db'", allowed: false },
  { sql: "INSTALL httpfs", allowed: false },
];

let failures = 0;
for (const { sql, allowed } of cases) {
  const result = await executeTool("run_query", { purpose: "test", sql });
  const ok = result.isError !== allowed;
  if (!ok) failures++;
  const detail = result.display.kind === "error" ? result.display.message : `${result.display.kind}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${allowed ? "allow" : "block"}  ${sql}\n      -> ${detail}`);
}
console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
