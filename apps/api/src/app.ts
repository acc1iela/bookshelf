import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Db } from './db/client';
import { problem } from './lib/problem';
import { booksRoute } from './routes/books';

/**
 * DB を引数で受け取るファクトリにしておくと、テストで `:memory:` の DB を差し込める。
 */
export function createApp(db: Db) {
  const app = new Hono().basePath('/api').route('/books', booksRoute(db));

  app.notFound((c) => problem(c, { type: 'not-found', title: 'Not Found', status: 404 }));

  app.onError((err, c) => {
    // 壊れた JSON など、Hono 自身が投げる 4xx
    if (err instanceof HTTPException && err.status < 500) {
      return problem(c, {
        type: 'bad-request',
        title: 'Bad Request',
        status: err.status,
        detail: err.message,
      });
    }
    // 想定外のエラー。内部情報はログにだけ出し、レスポンスには含めない
    console.error(err);
    return problem(c, { type: 'internal-error', title: 'Internal Server Error', status: 500 });
  });

  return app;
}

/** web 側で Hono RPC（hc）の型として使う */
export type AppType = ReturnType<typeof createApp>;
