import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
    status: text('status', { enum: ['want', 'reading', 'done', 'abandoned'] }).notNull(),
    startedOn: text('started_on'),
    finishedOn: text('finished_on'),
    rating: integer('rating'),
    note: text('note'),
    ...timestamps,
  },
  // 「最新の Reading」を本ごとに引くサブクエリが毎行走るので book_id に索引を張る
  (t) => [index('readings_book_id_idx').on(t.bookId)],
);
