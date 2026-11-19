import { sql } from 'drizzle-orm';
import { ulid } from 'ulidx';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from '../src/db/client';
import { books, readings } from '../src/db/schema';

// API を通らない書き込み（DB を直接触るスクリプトなど）に対しても、不変条件が守られることを確認する
describe('readings の CHECK 制約', () => {
  let db: Db;
  let bookId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    bookId = ulid();
    db.insert(books).values({ id: bookId, title: 'A', authors: [] }).run();
  });

  // 型チェックをすり抜ける値を入れるため、生の SQL で INSERT する
  function insertRaw(status: string, rating: number | null) {
    db.run(sql`
      INSERT INTO readings (id, book_id, status, rating, created_at, updated_at)
      VALUES (${ulid()}, ${bookId}, ${status}, ${rating}, '2026-01-01', '2026-01-01')
    `);
  }

  /** Drizzle は SQLite のエラーを DrizzleQueryError で包むので、cause のエラーコードを取り出す */
  function sqliteErrorCode(fn: () => void): unknown {
    try {
      fn();
    } catch (err) {
      const cause = err instanceof Error ? err.cause : undefined;
      return cause instanceof Error && 'code' in cause ? cause.code : 'no sqlite error in cause';
    }
    return 'did not throw';
  }

  it('正しい値なら入る', () => {
    insertRaw('done', 5);
    insertRaw('want', null);

    expect(db.select().from(readings).all()).toHaveLength(2);
  });

  it('未知の status は拒否する', () => {
    expect(sqliteErrorCode(() => insertRaw('lol', null))).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it.each([0, 6])('rating=%i は拒否する', (rating) => {
    expect(sqliteErrorCode(() => insertRaw('done', rating))).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('テーブルを作り直したマイグレーションの後も、索引が残っている', () => {
    const indexes = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'readings'`,
    );

    expect(indexes.map((i) => i.name)).toContain('readings_book_id_idx');
  });
});
