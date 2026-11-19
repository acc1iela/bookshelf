import { READING_STATUSES } from '@bookshelf/schema';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const now = () => new Date().toISOString();

const timestamps = {
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
};

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  // SQLite の UNIQUE は NULL 同士を重複とみなさない → ISBN なしの本は何冊でも登録できる
  isbn: text('isbn').unique(),
  title: text('title').notNull(),
  // 決定: authors は正規化せず JSON 文字列で持つ（docs/api.md）
  authors: text('authors', { mode: 'json' }).$type<string[]>().notNull(),
  publisher: text('publisher'),
  publishedOn: text('published_on'),
  pageCount: integer('page_count'),
  coverUrl: text('cover_url'),
  ...timestamps,
});

export const readings = sqliteTable(
  'readings',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    status: text('status', { enum: READING_STATUSES }).notNull(),
    startedOn: text('started_on'),
    finishedOn: text('finished_on'),
    rating: integer('rating'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    // 「最新の Reading」を本ごとに引くサブクエリが毎行走るので book_id に索引を張る
    index('readings_book_id_idx').on(t.bookId),
    // ロジックが前提にしている不変条件は、API を通らない書き込みに備えて DB でも守る。
    // （文字数は SQLite が型の長さを無視するので、Zod の検証に任せる）
    // DDL にはプレースホルダーが使えないので sql.raw で埋め込む。値は上のコード内の定数だけ
    check(
      'readings_status_check',
      sql`${t.status} IN (${sql.raw(READING_STATUSES.map((s) => `'${s}'`).join(', '))})`,
    ),
    check('readings_rating_check', sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 5`),
  ],
);
