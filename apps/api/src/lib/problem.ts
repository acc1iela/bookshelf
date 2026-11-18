import type { Problem } from '@bookshelf/schema';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const TYPE_BASE = 'https://bookshelf.local/problems/';

type ProblemInit = Omit<Problem, 'type' | 'status'> & {
  /** `validation-error` のような短い識別子。URI にはここで組み立てる */
  type: string;
  status: ContentfulStatusCode;
};

/** RFC 9457 Problem Details を `application/problem+json` で返す */
export function problem(c: Context, init: ProblemInit): Response {
  const body: Problem = { ...init, type: TYPE_BASE + init.type };
  return c.body(JSON.stringify(body), init.status, {
    'Content-Type': 'application/problem+json',
  });
}

type ValidationResult =
  | { success: true; target: string }
  | {
      success: false;
      target: string;
      error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
    };

/**
 * `@hono/zod-validator` のフック。検証に失敗したら Problem Details を返す。
 * 決定（docs/api.md）: パースできた body の検証エラー = 422 / クエリ・パスの型エラー = 400
 */
export function validationHook(result: ValidationResult, c: Context): Response | undefined {
  if (result.success) return undefined;

  const isBody = result.target === 'json';
  const errors = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));

  return problem(c, {
    type: 'validation-error',
    title: 'Validation failed',
    status: isBody ? 422 : 400,
    detail: `Request ${isBody ? 'body' : result.target} has ${errors.length} invalid field(s).`,
    errors,
  });
}
