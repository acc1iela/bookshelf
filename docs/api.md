# bookshelf API 設計（v0.2）

> 自分用の読書管理API。実装より先にこのドキュメントで契約を決める。
> `✅ 決定` はレビューで決着した事項。理由も一緒に残す。

---

## 1. 共通方針

| 項目         | 方針                                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| ベースURL    | `http://localhost:8787/api`                                                         |
| フォーマット | JSON（`Content-Type: application/json`）。エラー時のみ `application/problem+json`   |
| フィールド名 | `camelCase`                                                                         |
| ID           | 文字列（ULID）。例: `"01JD3K8Z9X..."`                                               |
| 日付         | 日付のみ → `YYYY-MM-DD`（例: `finishedOn`）／日時 → ISO 8601 UTC（例: `createdAt`） |
| 認証         | v0.x ではなし（localhost でしか動かさない前提）。公開時に再検討する                 |

- **ID を連番にしない理由**: 連番だと URL から件数が推測できるし（`/books/3` → 「3冊しかないのか」）、DB をまたいだ移行やマージで衝突する。ULID は時刻順に並ぶので、cursor にも使える。
### ✅ 決定: API バージョニング（`/v1`）は付けない

- API バージョニングとは、互換性を壊す変更（例: `authors: string[]` → `{ id, name }[]`）を `/v2` に分けて、古いクライアントに移行期間を与える仕組み。
- このAPIのクライアントは同じ monorepo にある web と MCP だけ。API と同時に変更・デプロイできるので、移行期間がいらない。
- 外部に公開する、またはリポジトリの外にクライアントができた時点で再検討する。

---

## 2. エラー形式（RFC 9457 Problem Details）

```json
{
  "type": "https://bookshelf.local/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "Request body has 2 invalid fields.",
  "errors": [
    { "path": "rating", "message": "must be between 1 and 5" },
    { "path": "finishedOn", "message": "must be on or after startedOn" }
  ]
}
```

- `type` は問題の種類ごとに固定のURI。クライアントは `title` の文言ではなく `type` で分岐する。
- `errors` は拡張メンバー（バリデーションエラーのときだけ付く）。

### ステータスコード一覧

| コード                      | 使う場面                                                    |
| --------------------------- | ----------------------------------------------------------- |
| `200 OK`                    | 取得・更新成功（ボディあり）                                |
| `201 Created`               | 作成成功。`Location` ヘッダーに新しいリソースのURLを入れる  |
| `204 No Content`            | 削除成功（ボディなし）                                      |
| `400 Bad Request`           | JSON として壊れている、クエリパラメータの型が違う           |
| `404 Not Found`             | リソースが存在しない                                        |
| `409 Conflict`              | 一意制約違反（同じ ISBN の本がすでにある、など）            |
| `422 Unprocessable Content` | JSON としては正しいが、値がルール違反                       |
| `500 Internal Server Error` | 想定外。`detail` に内部情報（スタックトレース等）を出さない |

### ✅ 決定: 400 と 422 の使い分け

| ケース                                                                     | コード |
| -------------------------------------------------------------------------- | ------ |
| JSON として壊れている（`{"title": `）、クエリの型が違う（`?limit=abc`）    | 400    |
| request body の Zod スキーマ検証に失敗（`"rating": "five"`、`rating: 7`）  | 422    |
| 複数フィールドにまたがるルール違反（`finishedOn` が `startedOn` より前）   | 422    |

- 判断基準は「パースできたか」。パースできなければ 400、パースできて中身がダメなら 422。
- body の型違いを 400 にする流派もあるが、Zod の検証エラーをまとめて 422 に寄せたほうが実装が単純になる。

---

## 3. リソース

### Book（本そのもの）

```ts
type Book = {
  id: string;
  isbn: string | null; // 13桁。同人誌などは null を許す
  title: string;
  authors: string[];
  publisher: string | null;
  publishedOn: string | null; // YYYY-MM-DD
  pageCount: number | null;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### Reading（1回の読書記録）

```ts
type ReadingStatus = 'want' | 'reading' | 'done' | 'abandoned';

type Reading = {
  id: string;
  bookId: string;
  status: ReadingStatus;
  startedOn: string | null;
  finishedOn: string | null;
  rating: 1 | 2 | 3 | 4 | 5 | null;
  note: string | null; // 感想（最大 10,000 文字）
  createdAt: string;
  updatedAt: string;
};
```

- **Book と Reading を分ける理由**: 同じ本を再読できるようにするため（1 Book : N Reading）。「本の情報」と「自分の体験」はライフサイクルが違う。
- 本の「現在のステータス」は **最新の Reading の status** とする（「最新」の決め方は下の決定事項を参照）。

### 整合性ルール（APIで検証する）

- `finishedOn` があるなら `finishedOn >= startedOn`
- `status = "done"` なら `finishedOn` は必須
- `rating` は `status` が `done` / `abandoned` のときだけ設定できる
- `isbn` は一意（null は重複してよい）

### ✅ 決定: 「最新の Reading」は開始日 → 登録日時の複合ソートで決める

```sql
ORDER BY COALESCE(started_on, date(created_at)) DESC, created_at DESC
```

- 過去の読書を後から登録しても、開始日が古ければ「最新」にならない。
- 同じ開始日の記録が複数あるときは、後から登録したほうを最新とする。
- **`COALESCE` が必要な理由**: `status = "want"` の記録は `startedOn` が null になる。SQLite は `DESC` で NULL を末尾に並べるため、そのままだと「読了後に再読したくなって want を登録した」ケースで want が最新にならない。開始日がない記録は、登録日を開始日とみなす。

### ✅ 決定: `authors` は文字列配列（正規化しない）

- DB には JSON のテキストカラムとして保存する。
- 後から `authors` / `book_authors` テーブルに正規化しても、レスポンスは `authors: string[]` のまま返せる。**DB の形と API の形は独立している**ので、クライアントには影響しない。
- 表記揺れ（`村上春樹` / `村上 春樹`）は正規化しても自動では解決しない。正規化すると「揺れを1か所で直せる」ようになるだけ。「この著者の本一覧」が欲しくなった時点で再検討する。

---

## 4. エンドポイント

### Books

| メソッド | パス         | 説明                               | 成功 | 主なエラー    |
| -------- | ------------ | ---------------------------------- | ---- | ------------- |
| `GET`    | `/books`     | 一覧（検索・絞り込み・ページング） | 200  | 400           |
| `POST`   | `/books`     | 本を登録                           | 201  | 409, 422      |
| `GET`    | `/books/:id` | 詳細（readings を含む）            | 200  | 404           |
| `PATCH`  | `/books/:id` | 部分更新                           | 200  | 404, 409, 422 |
| `DELETE` | `/books/:id` | 削除（紐づく readings も削除）     | 204  | 404           |

**`GET /books` のクエリ**

| パラメータ | 型              | 既定値 | 説明                              |
| ---------- | --------------- | ------ | --------------------------------- |
| `q`        | string          | -      | タイトル・著者の部分一致          |
| `status`   | `ReadingStatus` | -      | 最新 Reading の status で絞り込む |
| `limit`    | 1〜100          | 20     | 1ページの件数                     |
| `cursor`   | string          | -      | 前回のレスポンスの `nextCursor`   |

```json
// GET /books?status=done&limit=2
{
  "items": [{ "id": "01JD...", "title": "...", "authors": ["..."], "currentStatus": "done" }],
  "nextCursor": "01JC..." // 次がなければ null
}
```

### Readings

| メソッド | パス                  | 説明           | 成功 | 主なエラー |
| -------- | --------------------- | -------------- | ---- | ---------- |
| `POST`   | `/books/:id/readings` | 読書記録を追加 | 201  | 404, 422   |
| `PATCH`  | `/readings/:id`       | 読書記録を更新 | 200  | 404, 422   |
| `DELETE` | `/readings/:id`       | 読書記録を削除 | 204  | 404        |

- 作成は親（Book）の下にネストし、作成後の操作はフラットなパスにする。ID がわかればそれだけで一意に特定できるので、深いネストは避ける。

### Stats

| メソッド | パス               | 説明                                   |
| -------- | ------------------ | -------------------------------------- |
| `GET`    | `/stats?year=2026` | 月ごとの読了冊数・総ページ数・平均評価 |

```json
{
  "year": 2026,
  "totalBooks": 24,
  "totalPages": 7310,
  "averageRating": 3.9,
  "monthly": [{ "month": "2026-01", "books": 3, "pages": 820 }]
}
```

---

## 5. 更新のセマンティクス

- **PUT は用意しない。PATCH だけ。** 全項目送らせる必要がないため。
- PATCH のボディは JSON Merge Patch（RFC 7396）風に扱う:
  - キーがない → 変更しない
  - `null` → 値を消す
  - 値あり → 上書き
- 例: `PATCH /books/01JD... { "publisher": null }` → publisher を消す。title は変更しない。
- `title` と `authors` は必須項目なので `null` を送れない（422）。`authors` を空にしたいときは `[]` を送る。
- 未知のキーは無視する。ただし、無視した結果ボディが空になった場合は 422 を返す（`{"titel": "x"}` のような typo を黙って成功させないため）。
- 成功時は更新後の Book を 200 で返す。

### 冪等性

| メソッド | 冪等？             | 補足                                             |
| -------- | ------------------ | ------------------------------------------------ |
| GET      | ✅                 |                                                  |
| PATCH    | ✅（この設計では） | 同じボディを2回送っても結果は同じ                |
| DELETE   | ✅                 | 2回目は 404 を返すが、サーバーの状態は変わらない |
| POST     | ❌                 | 二重送信すると Reading が2件できる               |

### ✅ 決定: DELETE の2回目は 404 を返す

- 冪等性は「サーバーの状態が変わらないこと」であって、「毎回同じレスポンスを返すこと」ではない。

### ✅ 決定: POST の二重送信対策はフロントで行う（`Idempotency-Key` は使わない）

- Reading の二重送信は実害がある（同じ読了記録が2件できて、`/stats` の冊数が水増しされる）。
- ただ、クライアントは自分の web だけなので、送信中はボタンを `disabled` にすれば十分（TanStack Query の `isPending`）。
- ISBN 付きの Book は、サーバー側で 409 を返して防げる。

---

## 6. スコープ外（v0.x ではやらない）

- 認証・複数ユーザー
- ISBN からの書誌情報自動取得（Phase 4）
- タグ・本棚（コレクション）
- MCP 向けのエンドポイント（Phase 5。既存APIの上に乗せる）
