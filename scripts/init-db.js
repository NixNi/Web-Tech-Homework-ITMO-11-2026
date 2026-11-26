import { readFile } from 'node:fs/promises';
import { createPool } from '../src/db.js';

const connStr = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
const db = createPool(connStr);

try {
  const schemaSql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await db.query(schemaSql);
  console.log('Схема todo и таблица todo.tasks успешно инициализированы.');
} finally {
  await db.end();
}
