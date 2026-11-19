import { z } from 'zod';

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

export const readingStatusSchema = z.enum(['want', 'reading', 'done', 'abandoned']);
export type ReadingStatus = z.infer<typeof readingStatusSchema>;

/** YYYY-MM-DD（日付のみ） */
const dateOnly = z.iso.date();

// ---------------------------------------------------------------------------
// Book
// ---------------------------------------------------------------------------

/** ISBN-13。ハイフンなしの13桁 */
const isbn13 = z.string().regex(/^\d{13}$/, 'must be 13 digits without hyphens');

/** POST /api/books のリクエストボディ */
export const createBookSchema = z.object({
  isbn: isbn13.nullable().default(null),
  title: z.string().trim().min(1).max(500),
  authors: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  publisher: z.string().trim().min(1).max(200).nullable().default(null),
  publishedOn: dateOnly.nullable().default(null),
  pageCount: z.int().positive().max(100_000).nullable().default(null),
  coverUrl: z.url({ protocol: /^https?$/ }).nullable().default(null),
});
export type CreateBookInput = z.input<typeof createBookSchema>;
export type CreateBook = z.output<typeof createBookSchema>;

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
