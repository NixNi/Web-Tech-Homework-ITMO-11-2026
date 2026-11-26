import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/db.js';

const {
  APP_URL = 'http://localhost:3000',
  CHECKER_DATABASE_URL,
  DATABASE_URL,
  API_TOKEN,
  MOODLE_LOGIN,
  MOODLE_FULL_NAME,
} = process.env;

if (!API_TOKEN || !MOODLE_LOGIN || !MOODLE_FULL_NAME) {
  throw new Error('Задайте API_TOKEN, MOODLE_LOGIN и MOODLE_FULL_NAME.');
}

const dbUrl = CHECKER_DATABASE_URL || DATABASE_URL;
const db = createPool(dbUrl);
const runId = `verify_${randomUUID()}`;
const listUrl = `/api/tasks/?runId=${runId}`;

let createdId: string | undefined;
let sqlInsertedId: string | undefined;

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function callApi(
  path: string,
  expectedStatus: number,
  { method = 'GET', body, token = API_TOKEN }: RequestOptions = {},
): Promise<unknown> {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  const res = await fetch(new URL(path, APP_URL), {
    method,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  assert.equal(res.status, expectedStatus, `${method} ${path} -> ${res.status}`);

  if (expectedStatus === 204) {
    assert.equal(await res.text(), '');
    return null;
  }

  if (path === '/login/') {
    assert.match(res.headers.get('content-type') ?? '', /^text\/plain\b/);
    return res.text();
  }

  assert.match(res.headers.get('content-type') ?? '', /^application\/json\b/);
  const json: unknown = await res.json();
  if (expectedStatus >= 400 && typeof json === 'object' && json !== null) {
    assert.equal(typeof (json as { error?: unknown }).error, 'string');
  }
  return json;
}

try {
  assert.equal(await callApi('/login/', 200, { token: '' }), MOODLE_LOGIN);
  await callApi('/api/author/', 401, { token: '' });
  await callApi('/api/author/', 401, { token: 'wrong-token' });
  assert.deepEqual(await callApi('/api/author/', 200), {
    login: MOODLE_LOGIN,
    fullName: MOODLE_FULL_NAME,
  });

  await callApi('/api/tasks/', 400);
  await callApi('/api/tasks/?runId=a&runId=b', 400);
  await callApi('/api/tasks/', 400, { method: 'POST', body: '{broken-json' });
  await callApi('/api/tasks/', 400, { method: 'POST', body: { title: 'x', runId, done: true } });
  await callApi('/api/tasks/not-a-uuid/', 400);
  assert.deepEqual(await callApi(listUrl, 200), []);

  const created = (await callApi('/api/tasks/', 201, {
    method: 'POST',
    body: { title: '  Тестовое дело  ', runId },
  })) as {
    id: string;
    ownerLogin: string;
    title: string;
    done: boolean;
    runId: string;
    createdAt: string;
  };

  createdId = created.id;
  assert.match(createdId, /^[0-9a-f-]{36}$/i);
  assert.equal(created.createdAt, new Date(created.createdAt).toISOString());
  assert.deepEqual(Object.keys(created).sort(), [
    'createdAt',
    'done',
    'id',
    'ownerLogin',
    'runId',
    'title',
  ]);
  assert.equal(created.ownerLogin, MOODLE_LOGIN);
  assert.equal(created.title, 'Тестовое дело');
  assert.equal(created.done, false);
  assert.equal(created.runId, runId);

  const taskPath = `/api/tasks/${createdId}/`;
  const readFromDb = async () =>
    (await db.query<{ title: string; done: boolean }>('SELECT title, done FROM todo.tasks WHERE id = $1', [createdId])).rows;

  assert.deepEqual(await readFromDb(), [{ title: 'Тестовое дело', done: false }]);

  await callApi(taskPath, 400, { method: 'PATCH', body: { done: 'yes' } });
  await callApi(taskPath, 400, { method: 'PATCH', body: {} });
  await callApi(taskPath, 200, { method: 'PATCH', body: { title: 'Обновлено API', done: true } });
  await callApi(taskPath, 200, { method: 'PATCH', body: { done: false } });
  assert.deepEqual(await readFromDb(), [{ title: 'Обновлено API', done: false }]);

  await db.query('UPDATE todo.tasks SET title = $1 WHERE id = $2', ['Обновлено SQL', createdId]);
  assert.equal(((await callApi(taskPath, 200)) as { title: string }).title, 'Обновлено SQL');

  sqlInsertedId = randomUUID();
  await db.query(
    'INSERT INTO todo.tasks (id, owner_login, title, run_id) VALUES ($1, $2, $3, $4)',
    [sqlInsertedId, MOODLE_LOGIN, 'Вставлено SQL', runId],
  );
  const listAfterSql = (await callApi(listUrl, 200)) as Array<{ id: string; title: string }>;
  assert.equal(listAfterSql.find((t) => t.id === sqlInsertedId)?.title, 'Вставлено SQL');

  await db.query('DELETE FROM todo.tasks WHERE id = $1', [sqlInsertedId]);
  await callApi(`/api/tasks/${sqlInsertedId}/`, 404);

  await callApi(taskPath, 204, { method: 'DELETE' });
  assert.deepEqual(await readFromDb(), []);
  await callApi(taskPath, 404);
  await callApi(taskPath, 404, { method: 'PATCH', body: { done: true } });
  await callApi(taskPath, 404, { method: 'DELETE' });
  assert.deepEqual(await callApi(listUrl, 200), []);

  console.log('Все проверки HTTP-контракта и двусторонней синхронизации с PostgreSQL пройдены.');
} finally {
  try {
    if (createdId || sqlInsertedId) {
      await db.query('DELETE FROM todo.tasks WHERE run_id = $1 AND owner_login = $2', [
        runId,
        MOODLE_LOGIN,
      ]);
    }
  } finally {
    await db.end();
  }
}
