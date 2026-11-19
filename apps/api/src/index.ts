import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createDb } from './db/client';

const db = createDb(process.env.DATABASE_PATH ?? 'bookshelf.db');
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: createApp(db).fetch, port }, (info) => {
  console.log(`bookshelf api listening on http://localhost:${info.port}/api`);
});
