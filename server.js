import { createApp } from './src/app.js';
import { createPool } from './src/db.js';

const {
  MOODLE_LOGIN: login,
  MOODLE_FULL_NAME: fullName,
  API_TOKEN: token,
  DATABASE_URL: databaseUrl,
} = process.env;

if (!login?.trim() || !fullName?.trim() || !token || /\s/.test(token)) {
  throw new Error('Необходимо задать MOODLE_LOGIN, MOODLE_FULL_NAME и API_TOKEN без пробелов.');
}

const db = createPool(databaseUrl);
db.on('error', (err) => {
  console.error('PostgreSQL pool background error:', err.code ?? err.message);
});

const port = Number(process.env.PORT ?? 3000);
const app = createApp({ db, login: login.trim(), fullName: fullName.trim(), token });

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => {
      db.end();
    });
  });
}
