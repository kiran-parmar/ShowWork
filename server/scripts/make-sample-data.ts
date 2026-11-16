/**
 * Generates a synthetic (made-up) sales dataset for demos and testing.
 * Deterministic: the same seed always produces the same files.
 *
 *   npm run sample-data
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../data/sample");

// Small seeded random generator (mulberry32) so output is repeatable.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261116);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

const regions = ["Northeast", "Southeast", "Midwest", "Southwest", "West"] as const;
const channels = ["Online", "Retail", "Partner"] as const;
const catalog = [
  { category: "Laptops", product: "Aero 14", price: 1199 },
  { category: "Laptops", product: "Aero 16 Pro", price: 1899 },
  { category: "Monitors", product: "ClearView 27", price: 329 },
  { category: "Monitors", product: "ClearView 34 Ultrawide", price: 649 },
  { category: "Accessories", product: "Dock Hub", price: 149 },
  { category: "Accessories", product: "Quiet Keyboard", price: 89 },
  { category: "Accessories", product: "Glide Mouse", price: 49 },
  { category: "Audio", product: "Focus Headphones", price: 249 },
] as const;

// Regional demand multipliers and a mild upward trend give the agent real patterns to find.
const regionWeight: Record<string, number> = { Northeast: 1.2, Southeast: 0.9, Midwest: 0.8, Southwest: 1.0, West: 1.3 };

const rows: string[] = ["order_id,order_date,region,channel,product_category,product,units,unit_price,discount_pct,revenue"];
const start = Date.UTC(2023, 0, 1);
const days = 365 * 3;
let id = 100000;
for (let d = 0; d < days; d++) {
  const date = new Date(start + d * 86_400_000);
  const month = date.getUTCMonth();
  const seasonal = month === 10 || month === 11 ? 1.6 : month === 7 ? 1.25 : 1; // holiday + back-to-school
  const trend = 1 + d / days / 2;
  const ordersToday = Math.round(2 + rand() * 3 * seasonal * trend);
  for (let i = 0; i < ordersToday; i++) {
    const region = pick(regions);
    if (rand() > regionWeight[region]! / 1.3) continue;
    const item = pick(catalog);
    const channel = pick(channels);
    const units = 1 + Math.floor(rand() * (item.price > 1000 ? 3 : 8));
    const discount = channel === "Partner" ? 10 + Math.floor(rand() * 10) : rand() < 0.2 ? 5 + Math.floor(rand() * 15) : 0;
    const revenue = +(units * item.price * (1 - discount / 100)).toFixed(2);
    rows.push(
      [id++, date.toISOString().slice(0, 10), region, channel, item.category, item.product, units, item.price, discount, revenue].join(","),
    );
  }
}

const targets: string[] = ["region,year,revenue_target"];
for (const region of regions) {
  for (const year of [2023, 2024, 2025]) {
    targets.push([region, year, Math.round(regionWeight[region]! * 520_000 * (1 + (year - 2023) * 0.18))].join(","));
  }
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "orders.csv"), rows.join("\n") + "\n");
await writeFile(path.join(outDir, "region_targets.csv"), targets.join("\n") + "\n");
console.log(`Wrote ${rows.length - 1} orders and ${targets.length - 1} targets to ${outDir}`);
