import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client';
import { books, readings } from '../src/db/schema';

const realMigrations = fileURLToPath(new URL('../drizzle', import.meta.url));

type Journal = { entries: { idx: number; when: number; tag: string }[] };

/**
 * 本物のマイグレーションに「books テーブルを作り直す」偽のマイグレーションを1本足したフォルダを作る。
 * SQL は drizzle-kit が CHECK 制約を足すときに生成するもの（0001 の readings 版）と同じ形にしている。
 */
function migrationsWithBooksRecreation(dir: string): string {
  const folder = join(dir, 'drizzle');
  cpSync(realMigrations, folder, { recursive: true });

  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  const last = journal.entries.at(-1);
  if (!last) throw new Error('journal is empty');
  const tag = '9999_recreate_books';
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag });
  writeFileSync(journalPath, JSON.stringify(journal));

  writeFileSync(
    join(folder, `${tag}.sql`),
    [
      'PRAGMA foreign_keys=OFF;',
      `CREATE TABLE \`__new_books\` (
        \`id\` text PRIMARY KEY NOT NULL, \`isbn\` text, \`title\` text NOT NULL, \`authors\` text NOT NULL,
        \`publisher\` text, \`published_on\` text, \`page_count\` integer, \`cover_url\` text,
        \`created_at\` text NOT NULL, \`updated_at\` text NOT NULL,
        CONSTRAINT "books_title_check" CHECK(length("__new_books"."title") > 0)
      );`,
      'INSERT INTO `__new_books` SELECT * FROM `books`;',
      'DROP TABLE `books`;',
      'ALTER TABLE `__new_books` RENAME TO `books`;',
      'PRAGMA foreign_keys=ON;',
      'CREATE UNIQUE INDEX `books_isbn_unique` ON `books` (`isbn`);',
    ].join('--> statement-breakpoint\n'),
  );
  return folder;
}

describe('親テーブル（books）を作り直すマイグレーション', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bookshelf-migration-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('子テーブル（readings）のデータを CASCADE で消さない', () => {
    const file = join(dir, 'test.db');

    // 1. 現在のマイグレーションで DB を作り、データを入れる
    const before = createDb(file);
    before.insert(books).values({ id: 'b1', title: 'A', authors: [] }).run();
    before
      .insert(readings)
      .values([
        { id: 'r1', bookId: 'b1', status: 'done' },
        { id: 'r2', bookId: 'b1', status: 'want' },
      ])
      .run();
    before.$client.close();

    // 2. books を作り直すマイグレーションを当てる
    const after = createDb(file, { migrationsFolder: migrationsWithBooksRecreation(dir) });

    expect(after.select().from(books).all()).toHaveLength(1);
    expect(after.select().from(readings).all().map((r) => r.id)).toEqual(['r1', 'r2']);
    after.$client.close();
  });

  it('マイグレーションの後も外部キー制約は有効なまま', () => {
    const db = createDb(join(dir, 'test.db'), {
      migrationsFolder: migrationsWithBooksRecreation(dir),
    });

    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    db.$client.close();
  });
});
