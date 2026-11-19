// Small display helpers shared by the data browser and the run timeline.

const NUMERIC_TYPES = ["TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "FLOAT", "DOUBLE", "DECIMAL"];

export function isNumericType(type: string): boolean {
  // "DECIMAL(10,2)" -> "DECIMAL"
  return NUMERIC_TYPES.includes(type.split("(")[0]!.toUpperCase());
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString();
}
