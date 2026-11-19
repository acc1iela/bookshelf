import { createBookSchema, listBooksQuerySchema } from '@bookshelf/schema';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Db } from '../db/client';
import { problem, validationHook } from '../lib/problem';
import { createBook, getBook, listBooks } from '../repositories/books';

// ルートは HTTP の責務（入力検証・ステータスコード・ヘッダー）だけを持つ。SQL は repositories に置く
export function booksRoute(db: Db) {
  return new Hono()
    .get('/', zValidator('query', listBooksQuerySchema, validationHook), (c) => {
      return c.json(listBooks(db, c.req.valid('query')), 200);
    })
    .post('/', zValidator('json', createBookSchema, validationHook), (c) => {
      const result = createBook(db, c.req.valid('json'));
      if (!result.ok) {
        return problem(c, {
          type: 'isbn-conflict',
          title: 'ISBN already registered',
          status: 409,
          detail: 'A book with the same ISBN already exists.',
        });
      }
      c.header('Location', `/api/books/${result.book.id}`);
      return c.json(result.book, 201);
    })
    .get('/:id', (c) => {
      const book = getBook(db, c.req.param('id'));
      if (!book) {
        return problem(c, { type: 'not-found', title: 'Book not found', status: 404 });
      }
      return c.json(book, 200);
    });
}
