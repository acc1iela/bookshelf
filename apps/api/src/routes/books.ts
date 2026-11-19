import { createBookSchema, listBooksQuerySchema, updateBookSchema } from '@bookshelf/schema';
import { zValidator } from '@hono/zod-validator';
import { type Context, Hono } from 'hono';
import type { Db } from '../db/client';
import { problem, validationHook } from '../lib/problem';
import { createBook, deleteBook, getBook, listBooks, updateBook } from '../repositories/books';

const bookNotFound = (c: Context) =>
  problem(c, { type: 'not-found', title: 'Book not found', status: 404 });

const isbnConflict = (c: Context) =>
  problem(c, {
    type: 'isbn-conflict',
    title: 'ISBN already registered',
    status: 409,
    detail: 'A book with the same ISBN already exists.',
  });

// ルートは HTTP の責務（入力検証・ステータスコード・ヘッダー）だけを持つ。SQL は repositories に置く
export function booksRoute(db: Db) {
  return new Hono()
    .get('/', zValidator('query', listBooksQuerySchema, validationHook), (c) => {
      return c.json(listBooks(db, c.req.valid('query')), 200);
    })
    .post('/', zValidator('json', createBookSchema, validationHook), (c) => {
      const result = createBook(db, c.req.valid('json'));
      if (!result.ok) return isbnConflict(c);
      c.header('Location', `/api/books/${result.book.id}`);
      return c.json(result.book, 201);
    })
    .get('/:id', (c) => {
      const book = getBook(db, c.req.param('id'));
      if (!book) return bookNotFound(c);
      return c.json(book, 200);
    })
    .patch('/:id', zValidator('json', updateBookSchema, validationHook), (c) => {
      const result = updateBook(db, c.req.param('id'), c.req.valid('json'));
      if (!result.ok) {
        return result.reason === 'not_found' ? bookNotFound(c) : isbnConflict(c);
      }
      return c.json(result.book, 200);
    })
    .delete('/:id', (c) => {
      // 決定（docs/api.md）: 2回目の DELETE は 404。冪等性は「状態が変わらないこと」で満たす
      if (!deleteBook(db, c.req.param('id'))) return bookNotFound(c);
      return c.body(null, 204);
    });
}
