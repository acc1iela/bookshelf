import { z } from 'zod';

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

/** DB の CHECK 制約もこの配列から作る（値の定義を1か所にまとめる） */
export const READING_STATUSES = ['want', 'reading', 'done', 'abandoned'] as const;
export const readingStatusSchema = z.enum(READING_STATUSES);
export type ReadingStatus = z.infer<typeof readingStatusSchema>;

/** YYYY-MM-DD（日付のみ） */
const dateOnly = z.iso.date();

// ---------------------------------------------------------------------------
// Book
// ---------------------------------------------------------------------------

/** ISBN-13。ハイフンなしの13桁 */
const isbn13 = z.string().regex(/^\d{13}$/, 'must be 13 digits without hyphens');

/**
 * Book の各フィールドの「値としての」ルール。default を持たせない。
 * create と update で「省略されたときの扱い」が違うため、それぞれ下で組み立てる。
 */
const bookFields = {
  isbn: isbn13.nullable(),
  title: z.string().trim().min(1).max(500),
  authors: z.array(z.string().trim().min(1).max(200)).max(20),
  publisher: z.string().trim().min(1).max(200).nullable(),
  publishedOn: dateOnly.nullable(),
  pageCount: z.int().positive().max(100_000).nullable(),
  coverUrl: z.url({ protocol: /^https?$/ }).nullable(),
};

/** POST /api/books のリクエストボディ。省略された項目は null / [] で埋める */
export const createBookSchema = z.object({
  ...bookFields,
  isbn: bookFields.isbn.default(null),
  authors: bookFields.authors.default([]),
  publisher: bookFields.publisher.default(null),
  publishedOn: bookFields.publishedOn.default(null),
  pageCount: bookFields.pageCount.default(null),
  coverUrl: bookFields.coverUrl.default(null),
});
export type CreateBookInput = z.input<typeof createBookSchema>;
export type CreateBook = z.output<typeof createBookSchema>;

/**
 * PATCH /api/books/:id のリクエストボディ（JSON Merge Patch 風）
 * - キーなし → 変更しない（default を付けないことで「省略」が保たれる）
 * - null → 値を消す（title / authors は消せないので nullable にしていない）
 * - 未知のキーは除去される。結果として空になったら 422（`{"titel": "x"}` のような typo を黙って通さない）
 */
export const updateBookSchema = z
  .object(bookFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one known field is required',
  });
export type UpdateBook = z.output<typeof updateBookSchema>;

/** GET /api/books のクエリパラメータ（クエリは常に文字列で来るので coerce する） */
export const listBooksQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: readingStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.ulid().optional(),
});
export type ListBooksQuery = z.output<typeof listBooksQuerySchema>;

/** レスポンスの Book（DB の形ではなく API の形） */
export type Book = {
  id: string;
  isbn: string | null;
  title: string;
  authors: string[];
  publisher: string | null;
  publishedOn: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BookListItem = Book & { currentStatus: ReadingStatus | null };

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type Reading = {
  id: string;
  bookId: string;
  status: ReadingStatus;
  startedOn: string | null;
  finishedOn: string | null;
  rating: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

/** GET /api/books/:id のレスポンス。readings は新しい順 */
export type BookDetail = Book & { currentStatus: ReadingStatus | null; readings: Reading[] };

export type BookList = {
  items: BookListItem[];
  nextCursor: string | null;
};

// ---------------------------------------------------------------------------
// Problem Details（RFC 9457）
// ---------------------------------------------------------------------------

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string }[];
};
