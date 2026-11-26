import { readFile } from 'node:fs/promises';

const { MOODLE_BASE_URL, MOODLE_WS_TOKEN, MOODLE_TEACHER_ID } = process.env;
const messageFile = process.argv[2];

if (!MOODLE_WS_TOKEN || !/^[1-9]\d*$/.test(MOODLE_TEACHER_ID ?? '') || !messageFile) {
  throw new Error('Укажите MOODLE_WS_TOKEN, MOODLE_TEACHER_ID и путь к файлу с текстом.');
}

const baseUrl = new URL(MOODLE_BASE_URL || 'https://node-server.ru/m/');
if (!baseUrl.pathname.endsWith('/')) {
  baseUrl.pathname += '/';
}

const text = (await readFile(messageFile, 'utf8')).trim();
if (!text) {
  throw new Error('Файл сообщения пуст.');
}

const endpoint = new URL('webservice/rest/server.php', baseUrl);
const res = await fetch(endpoint, {
  method: 'POST',
  redirect: 'error',
  signal: AbortSignal.timeout(20_000),
  body: new URLSearchParams({
    wstoken: MOODLE_WS_TOKEN,
    wsfunction: 'core_message_send_instant_messages',
    moodlewsrestformat: 'json',
    'messages[0][touserid]': MOODLE_TEACHER_ID,
    'messages[0][text]': text,
    'messages[0][textformat]': '2',
  }),
});

if (!res.ok) {
  throw new Error(`Moodle API вернул статус ${res.status}`);
}

const data = await res.json();
if (!Array.isArray(data) || !Number.isSafeInteger(data[0]?.msgid) || data[0].msgid <= 0) {
  const errCode = data?.errorcode ? ` (${data.errorcode})` : '';
  throw new Error(`Не удалось подтвердить отправку сообщения${errCode}.`);
}

console.log(`Сообщение доставлено в Moodle. msgid=${data[0].msgid}`);
