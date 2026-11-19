import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * DB を開いてマイグレーションを当てる。
 * テストでは `:memory:` を渡せば、テストごとにまっさらな DB が手に入る。
 */
export function createDb(filename: string): Db {
  const sqlite = new Database(filename);
  // SQLite は外部キー制約が「既定で無効」。これがないと ON DELETE CASCADE が黙って効かない
  sqlite.pragma('foreign_keys = ON');
  if (filename !== ':memory:') sqlite.pragma('journal_mode = WAL');

  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder });
  return db;
}
