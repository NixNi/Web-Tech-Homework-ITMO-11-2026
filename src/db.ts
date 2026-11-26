import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;

export type DbPool = pg.Pool;

/**
 * Создает пул подключений PostgreSQL с опциональным TLS.
 */
export function createPool(connectionString: string | undefined): DbPool {
  if (!connectionString) {
    throw new Error('Не задана строка подключения к PostgreSQL (DATABASE_URL).');
  }

  const useTls = process.env.DATABASE_TLS === '1';
  const caPath = process.env.DATABASE_CA_FILE;
  const ssl = useTls
    ? {
        rejectUnauthorized: Boolean(caPath) || process.env.DATABASE_TLS_STRICT === '1',
        ca: caPath ? readFileSync(caPath, 'utf8') : undefined,
      }
    : undefined;

  return new Pool({
    connectionString,
    ssl,
    max: 5,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
}
