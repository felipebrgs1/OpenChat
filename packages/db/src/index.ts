import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

function loadRootEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

loadRootEnv();

export * from "./schema";

export function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  return drizzle(url, { schema });
}

export const db = createDb();
export type Database = ReturnType<typeof createDb>;
