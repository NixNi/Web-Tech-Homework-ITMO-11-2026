import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { QueryResultRow } from 'pg';
import type { DbPool } from './db.js';

export interface AppConfig {
  db: DbPool;
  login: string;
  fullName: string;
  token: string;
}

export interface TaskDto {
  id: string;
  ownerLogin: string;
  title: string;
  done: boolean;
  runId: string;
  createdAt: string;
}

const TASK_PROJECTION =
  'id, owner_login AS "ownerLogin", title, done, run_id AS "runId", created_at AS "createdAt"';

const RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidRunId(value: unknown): value is string {
  return typeof value === 'string' && RUN_ID_RE.test(value);
}

function isValidTitle(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  const trimmedLen = Array.from(value.trim()).length;
  return trimmedLen >= 1 && trimmedLen <= 200;
}

function sendError(res: Response, status: number, message: string): Response {
  return res.status(status).json({ error: message });
}

/**
 * Создает и настраивает Express-приложение со списком дел.
 */
export function createApp({ db, login, fullName, token }: AppConfig): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.enable('strict routing');
  app.set('query parser', 'simple');

  const expectedTokenHash = sha256(token);

  // Публичный маршрут с логином Moodle
  app.get('/login/', (_req: Request, res: Response) => {
    res.type('text/plain').send(login);
  });

  // Авторизация по Bearer-токену для всех /api/*
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store');
    const authHeader = req.get('authorization') ?? '';
    const match = /^Bearer\s+([^\s]+)$/i.exec(authHeader);
    if (!match?.[1] || !timingSafeEqual(sha256(match[1]), expectedTokenHash)) {
      res.set('WWW-Authenticate', 'Bearer');
      return sendError(res, 401, 'Требуется корректный Bearer-токен.');
    }
    next();
  });

  app.use('/api', express.json({ limit: '16kb' }));

  app.get('/api/author/', (_req: Request, res: Response) => {
    res.json({ login, fullName });
  });

  app.param('id', (_req: Request, res: Response, next: NextFunction, id: string) => {
    if (!UUID_RE.test(id)) {
      return sendError(res, 400, 'Некорректный формат UUID.');
    }
    next();
  });

  async function runQuery<T extends QueryResultRow>(
    sql: string,
    params: unknown[],
  ): Promise<T[]> {
    try {
      const result = await db.query<T>(sql, params);
      return result.rows;
    } catch (cause) {
      throw new Error('Database query failed', { cause });
    }
  }

  app.post('/api/tasks/', async (req: Request, res: Response) => {
    const body: unknown = req.body;
    if (
      !isPlainObject(body) ||
      Object.keys(body).length !== 2 ||
      !isValidTitle(body.title) ||
      !isValidRunId(body.runId)
    ) {
      return sendError(res, 400, 'Ожидаются только корректные поля title и runId.');
    }

    const [created] = await runQuery<TaskDto>(
      `INSERT INTO todo.tasks (owner_login, title, run_id)
       VALUES ($1, $2, $3)
       RETURNING ${TASK_PROJECTION}`,
      [login, body.title.trim(), body.runId],
    );
    res.status(201).json(created);
  });

  app.get('/api/tasks/', async (req: Request, res: Response) => {
    if (!isValidRunId(req.query.runId)) {
      return sendError(res, 400, 'Параметр runId обязателен и должен соответствовать формату.');
    }

    const rows = await runQuery<TaskDto>(
      `SELECT ${TASK_PROJECTION}
       FROM todo.tasks
       WHERE owner_login = $1 AND run_id = $2
       ORDER BY created_at ASC, id ASC`,
      [login, req.query.runId],
    );
    res.json(rows);
  });

  app.get('/api/tasks/:id/', async (req: Request, res: Response) => {
    const rows = await runQuery<TaskDto>(
      `SELECT ${TASK_PROJECTION}
       FROM todo.tasks
       WHERE owner_login = $1 AND id = $2`,
      [login, req.params.id],
    );
    if (!rows.length) {
      return sendError(res, 404, 'Задача не найдена.');
    }
    res.json(rows[0]);
  });

  app.patch('/api/tasks/:id/', async (req: Request, res: Response) => {
    const body: unknown = req.body;
    const keys = isPlainObject(body) ? Object.keys(body) : [];
    const hasOnlyAllowed = keys.length > 0 && keys.every((k) => k === 'title' || k === 'done');

    if (
      !isPlainObject(body) ||
      !hasOnlyAllowed ||
      (Object.hasOwn(body, 'title') && !isValidTitle(body.title)) ||
      (Object.hasOwn(body, 'done') && typeof body.done !== 'boolean')
    ) {
      return sendError(res, 400, 'Укажите непустой набор корректных полей title и/или done.');
    }

    const nextTitle = Object.hasOwn(body, 'title') && typeof body.title === 'string'
      ? body.title.trim()
      : null;
    const nextDone = Object.hasOwn(body, 'done') && typeof body.done === 'boolean'
      ? body.done
      : null;

    const rows = await runQuery<TaskDto>(
      `UPDATE todo.tasks
       SET title = COALESCE($3, title),
           done = COALESCE($4, done)
       WHERE owner_login = $1 AND id = $2
       RETURNING ${TASK_PROJECTION}`,
      [login, req.params.id, nextTitle, nextDone],
    );

    if (!rows.length) {
      return sendError(res, 404, 'Задача не найдена.');
    }
    res.json(rows[0]);
  });

  app.delete('/api/tasks/:id/', async (req: Request, res: Response) => {
    const rows = await runQuery<{ id: string }>(
      `DELETE FROM todo.tasks
       WHERE owner_login = $1 AND id = $2
       RETURNING id`,
      [login, req.params.id],
    );
    if (!rows.length) {
      return sendError(res, 404, 'Задача не найдена.');
    }
    res.status(204).end();
  });

  // Обработка неизвестных маршрутов API и ошибок
  app.use('/api', (_req: Request, res: Response) => sendError(res, 404, 'Маршрут API не найден.'));

  app.use('/api', (err: Error & { type?: string; status?: number; code?: string; cause?: { code?: string } }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.parse.failed' || (typeof err.status === 'number' && err.status >= 400 && err.status < 500)) {
      return sendError(res, 400, 'Некорректное JSON-тело запроса.');
    }
    console.error('API database error:', err.cause?.code ?? err.code ?? err.message);
    return sendError(res, 503, 'База данных временно недоступна.');
  });

  const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));
  app.use(express.static(publicDir));

  return app;
}
