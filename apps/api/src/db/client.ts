import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

/** drizzle() の戻り値と同じ形。$client は生の better-sqlite3 接続（close や pragma に使う） */
export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const defaultMigrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

type CreateDbOptions = {
  /** テストで、本物以外のマイグレーションを当てたいときだけ指定する */
  migrationsFolder?: string;
};

/**
 * DB を開いてマイグレーションを当てる。
 * テストでは `:memory:` を渡せば、テストごとにまっさらな DB が手に入る。
 */
export function createDb(filename: string, options: CreateDbOptions = {}): Db {
  const sqlite = new Database(filename);
  if (filename !== ':memory:') sqlite.pragma('journal_mode = WAL');

  const db = drizzle({ client: sqlite, schema });
  runMigrations(sqlite, db, options.migrationsFolder ?? defaultMigrationsFolder);

  // SQLite は外部キー制約が「既定で無効」。これがないと ON DELETE CASCADE が黙って効かない
  sqlite.pragma('foreign_keys = ON');
  return db;
}

/**
 * 外部キー制約を無効にした状態でマイグレーションを当てる。
 *
 * drizzle-kit はテーブルを作り直す SQL の先頭に `PRAGMA foreign_keys=OFF` を書くが、
 * Drizzle の migrator は全体を BEGIN〜COMMIT で包むため、トランザクション内の PRAGMA は無視される。
 * FK が有効なまま親テーブル（books）を DROP すると、暗黙の DELETE が ON DELETE CASCADE を発火させ、
 * 子テーブル（readings）が「エラーなしで」全件消える。
 * → SQLite 公式の手順（https://www.sqlite.org/lang_altertable.html#otheralter）に従い、
 *   トランザクションの外で OFF にし、移行後に foreign_key_check で整合性を確認する。
 *
 * NOTE: foreign_key_check は COMMIT 後に走るので、違反があってもロールバックはできない。
 *       その場合は起動を止め、データを壊したまま動き続けることだけは防ぐ。
 */
function runMigrations(sqlite: Database.Database, db: Db, migrationsFolder: string): void {
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder });

  const violations = sqlite.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `Foreign key violations after migration: ${JSON.stringify(violations.slice(0, 10))}`,
    );
  }
}
