import type { Book, BookDetail, BookList, Problem } from '@bookshelf/schema';
import { ulid } from 'ulidx';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { type Db, createDb } from '../src/db/client';
import { readings } from '../src/db/schema';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = createDb(':memory:');
  app = createApp(db);
});

function postBook(body: unknown) {
  return app.request('/api/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function createBook(body: Record<string, unknown>): Promise<Book> {
  const res = await postBook(body);
  expect(res.status).toBe(201);
  return (await res.json()) as Book;
}

function addReading(
  bookId: string,
  values: { status: 'want' | 'reading' | 'done' | 'abandoned'; startedOn?: string; createdAt: string },
) {
  db.insert(readings)
    .values({ id: ulid(), bookId, startedOn: null, ...values, updatedAt: values.createdAt })
    .run();
}

describe('POST /api/books', () => {
  it('201 を返し、Location ヘッダーと省略項目の null を含む', async () => {
    const res = await postBook({ title: '  ノルウェイの森  ', authors: ['村上春樹'] });

    expect(res.status).toBe(201);
    const book = (await res.json()) as Book;
    expect(res.headers.get('Location')).toBe(`/api/books/${book.id}`);
    expect(book).toMatchObject({
      title: 'ノルウェイの森', // trim されている
      authors: ['村上春樹'],
      isbn: null,
      publisher: null,
      publishedOn: null,
      pageCount: null,
      coverUrl: null,
    });
    expect(book.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('値がルール違反なら 422 と、フィールドごとの errors を返す', async () => {
    const res = await postBook({ title: '', isbn: '978-4-06', pageCount: -1 });

    expect(res.status).toBe(422);
    expect(res.headers.get('Content-Type')).toBe('application/problem+json');
    const body = (await res.json()) as Problem;
    expect(body.type).toBe('https://bookshelf.local/problems/validation-error');
    expect(body.errors?.map((e) => e.path).sort()).toEqual(['isbn', 'pageCount', 'title']);
  });

  it('JSON が壊れていたら 400 を返す', async () => {
    const res = await postBook('{"title": ');

    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toBe('application/problem+json');
  });

  it('同じ ISBN は 409、ISBN なし同士は何冊でも登録できる', async () => {
    await createBook({ title: 'A', isbn: '9784062748681' });
    const dup = await postBook({ title: 'B', isbn: '9784062748681' });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as Problem).type).toBe(
      'https://bookshelf.local/problems/isbn-conflict',
    );

    await createBook({ title: 'C' });
    await createBook({ title: 'D' });
  });
});

describe('GET /api/books', () => {
  it('空なら items: [] と nextCursor: null を返す', async () => {
    const res = await app.request('/api/books');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it('新しい順に返し、cursor で続きを取れる（重複も欠落もない）', async () => {
    const created = [];
    for (const title of ['1', '2', '3']) created.push(await createBook({ title }));

    const page1 = (await (await app.request('/api/books?limit=2')).json()) as BookList;
    expect(page1.items.map((b) => b.title)).toEqual(['3', '2']);
    expect(page1.nextCursor).toBe(created[1]?.id);

    const page2 = (await (
      await app.request(`/api/books?limit=2&cursor=${page1.nextCursor}`)
    ).json()) as BookList;
    expect(page2.items.map((b) => b.title)).toEqual(['1']);
    expect(page2.nextCursor).toBeNull();
  });

  it('q はタイトルと著者を部分一致で検索し、% をワイルドカードとして扱わない', async () => {
    await createBook({ title: '100% Orange', authors: [] });
    await createBook({ title: 'Orange', authors: [] });
    await createBook({ title: '海辺のカフカ', authors: ['村上春樹'] });

    const byPercent = (await (await app.request('/api/books?q=%25')).json()) as BookList;
    expect(byPercent.items.map((b) => b.title)).toEqual(['100% Orange']);

    const byAuthor = (await (
      await app.request(`/api/books?q=${encodeURIComponent('村上')}`)
    ).json()) as BookList;
    expect(byAuthor.items.map((b) => b.title)).toEqual(['海辺のカフカ']);
  });

  it('status は「最新の Reading」で絞り込む（開始日なしは登録日で比較する）', async () => {
    // A: 2025 年に読了 → 今日「再読したい」を登録（startedOn なし） → 最新は want
    const a = await createBook({ title: 'A' });
    addReading(a.id, { status: 'done', startedOn: '2025-01-01', createdAt: '2025-01-01T00:00:00.000Z' });
    addReading(a.id, { status: 'want', createdAt: '2026-11-18T00:00:00.000Z' });

    // B: 今読んでいる本に、過去の読了記録を「後から」登録 → 最新は reading のまま
    const b = await createBook({ title: 'B' });
    addReading(b.id, { status: 'reading', startedOn: '2026-11-01', createdAt: '2026-11-01T00:00:00.000Z' });
    addReading(b.id, { status: 'done', startedOn: '2024-05-01', createdAt: '2026-11-18T00:00:00.000Z' });

    // C: 記録なし → currentStatus は null
    await createBook({ title: 'C' });

    const all = (await (await app.request('/api/books')).json()) as BookList;
    expect(Object.fromEntries(all.items.map((x) => [x.title, x.currentStatus]))).toEqual({
      A: 'want',
      B: 'reading',
      C: null,
    });

    const done = (await (await app.request('/api/books?status=done')).json()) as BookList;
    expect(done.items).toEqual([]);
  });

  it.each([
    ['limit=0'],
    ['limit=101'],
    ['limit=abc'],
    ['status=unknown'],
    ['cursor=not-a-ulid'],
  ])('クエリが不正なら 400 を返す（%s）', async (qs) => {
    const res = await app.request(`/api/books?${qs}`);

    expect(res.status).toBe(400);
    expect(((await res.json()) as Problem).type).toBe(
      'https://bookshelf.local/problems/validation-error',
    );
  });
});

describe('GET /api/books/:id', () => {
  it('readings を新しい順で含めて返す', async () => {
    const book = await createBook({ title: 'A' });
    addReading(book.id, { status: 'done', startedOn: '2024-01-01', createdAt: '2024-01-01T00:00:00.000Z' });
    addReading(book.id, { status: 'reading', startedOn: '2026-11-01', createdAt: '2026-11-01T00:00:00.000Z' });

    const res = await app.request(`/api/books/${book.id}`);

    expect(res.status).toBe(200);
    const detail = (await res.json()) as BookDetail;
    expect(detail.currentStatus).toBe('reading');
    expect(detail.readings.map((r) => r.status)).toEqual(['reading', 'done']);
  });

  it('存在しなければ 404 を problem+json で返す', async () => {
    const res = await app.request(`/api/books/${ulid()}`);

    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toBe('application/problem+json');
  });
});

describe('未定義のルート', () => {
  it('404 を problem+json で返す', async () => {
    const res = await app.request('/api/nope');

    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toBe('application/problem+json');
  });
});
