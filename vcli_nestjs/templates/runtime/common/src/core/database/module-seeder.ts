import type { openDatabase } from './database.js';

export type SeedCounts = Readonly<{ created: number; alreadyPresent: number }>;

export type ModuleSeeder = (
  database: Awaited<ReturnType<typeof openDatabase>>,
) => Promise<SeedCounts>;

export type ModuleSeed = Readonly<{ module: string; run: ModuleSeeder }>;
