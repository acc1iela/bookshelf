import type {
  Book,
  BookDetail,
  BookList,
  CreateBook,
  ListBooksQuery,
  Reading,
  ReadingStatus,
} from '@bookshelf/schema';
import { type SQL, and, desc, eq, getTableColumns, getTableName, lt, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { monotonicFactory } from 'ulidx';
import type { Db } from '../db/client';
import { books, readings } from '../db/schema';

// 同じミリ秒内に複数生成しても単調増加する ULID。id 順 = 作成順を保証する
const ulid = monotonicFactory();

/**
 * `"table"."column"` の形で必ずテーブル名付きで出力する。
 * Drizzle は単一テーブルの SELECT 句ではカラムを `"id"` のように修飾なしで出すため、
 * 相関サブクエリの中で使うと内側のテーブル（readings.id）に解決されてしまう。
 */
function qualified(column: AnySQLiteColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

/**
 * 本ごとの「最新の Reading」の status を返す相関サブクエリ。
 * 決定（docs/api.md）: 開始日（なければ登録日）の降順 → 登録日時の降順
 * NOTE: date(created_at) は UTC の日付。JST の朝 9 時前に登録すると前日扱いになる。
 */
const currentStatus = sql<ReadingStatus | null>`(
  SELECT ${qualified(readings.status)} FROM ${readings}
  WHERE ${qualified(readings.bookId)} = ${qualified(books.id)}
  ORDER BY COALESCE(${qualified(readings.startedOn)}, date(${qualified(readings.createdAt)})) DESC,
           ${qualified(readings.createdAt)} DESC
  LIMIT 1
)`;

/** LIKE のワイルドカード（% と _）をエスケープする。しないと q=% で全件ヒットする */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// DB の行 → API の形。カラムを足しても勝手にレスポンスに漏れないよう、明示的に詰め替える
function toBook(row: typeof books.$inferSelect): Book {
  return {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    authors: row.authors,
    publisher: row.publisher,
    publishedOn: row.publishedOn,
    pageCount: row.pageCount,
    coverUrl: row.coverUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toReading(row: typeof readings.$inferSelect): Reading {
  return {
    id: row.id,
    bookId: row.bookId,
    status: row.status,
    startedOn: row.startedOn,
    finishedOn: row.finishedOn,
    rating: row.rating,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listBooks(db: Db, query: ListBooksQuery): BookList {
  const conditions: SQL[] = [];

  if (query.cursor) conditions.push(lt(books.id, query.cursor));
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    conditions.push(
      sql`(${books.title} LIKE ${pattern} ESCAPE '\\' OR ${books.authors} LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (query.status) conditions.push(sql`${currentStatus} = ${query.status}`);

  // limit + 1 件取って、はみ出た 1 件の有無で「次のページがあるか」を判定する（COUNT(*) を打たない）
  const rows = db
    .select({ ...getTableColumns(books), currentStatus })
    .from(books)
    .where(and(...conditions))
    .orderBy(desc(books.id))
    .limit(query.limit + 1)
    .all();

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  return {
    items: page.map((row) => ({ ...toBook(row), currentStatus: row.currentStatus })),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}

export function getBook(db: Db, id: string): BookDetail | null {
  const row = db
    .select({ ...getTableColumns(books), currentStatus })
    .from(books)
    .where(eq(books.id, id))
    .get();
  if (!row) return null;

  const readingRows = db
    .select()
    .from(readings)
    .where(eq(readings.bookId, id))
    .orderBy(
      desc(sql`COALESCE(${readings.startedOn}, date(${readings.createdAt}))`),
      desc(readings.createdAt),
    )
    .all();

  return {
    ...toBook(row),
    currentStatus: row.currentStatus,
    readings: readingRows.map(toReading),
  };
}

export type CreateBookResult = { ok: true; book: Book } | { ok: false; reason: 'isbn_conflict' };

export function createBook(db: Db, input: CreateBook): CreateBookResult {
  try {
    const row = db
      .insert(books)
      .values({ id: ulid(), ...input })
      .returning()
      .get();
    return { ok: true, book: toBook(row) };
  } catch (err) {
    // 事前に SELECT で重複チェックすると、チェックと INSERT の間に割り込まれうる。
    // 一意制約に判定を任せて、違反したらそのエラーを翻訳する
    if (isUniqueViolation(err)) return { ok: false, reason: 'isbn_conflict' };
    throw err;
  }
}

/** better-sqlite3 の一意制約エラーか（Drizzle がラップしている場合は cause を辿る） */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  while (current instanceof Error) {
    if ('code' in current && current.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
    current = current.cause;
  }
  return false;
}
