const byId = (id) => document.getElementById(id);

const authSection = byId('auth-section');
const loginForm = byId('login-form');
const tokenInput = byId('token-input');
const statusMsg = byId('status-msg');
const workspace = byId('workspace');
const authorName = byId('author-name');
const authorLogin = byId('author-login');
const logoutBtn = byId('logout-btn');
const runForm = byId('run-form');
const runInput = byId('run-input');
const createForm = byId('create-form');
const titleInput = byId('title-input');
const listSummary = byId('list-summary');
const taskList = byId('task-list');

let bearerToken = '';
let currentRunId = 'manual';
let busy = false;

async function apiFetch(endpoint, method = 'GET', payload) {
  const headers = {
    Authorization: `Bearer ${bearerToken}`,
  };
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`/api/${endpoint}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Ошибка HTTP ${response.status}`);
  }
  return data;
}

async function withBusy(fn) {
  if (busy) return;
  busy = true;
  statusMsg.textContent = '';

  const controls = [...document.querySelectorAll('button, input')];
  controls.forEach((el) => {
    el.disabled = true;
  });

  try {
    await fn();
  } catch (err) {
    statusMsg.textContent = err.message;
  } finally {
    busy = false;
    controls.forEach((el) => {
      el.disabled = false;
    });
  }
}

function renderTask(task) {
  const li = document.createElement('li');
  li.className = 'task-item';

  const form = document.createElement('form');
  form.className = 'task-form';

  const titleEl = document.createElement('input');
  titleEl.type = 'text';
  titleEl.value = task.title;
  titleEl.required = true;
  titleEl.maxLength = 200;
  titleEl.setAttribute('aria-label', 'Название задачи');

  const doneLabel = document.createElement('label');
  doneLabel.className = 'task-done-label';
  const doneEl = document.createElement('input');
  doneEl.type = 'checkbox';
  doneEl.checked = task.done;
  doneLabel.append(doneEl, 'Выполнено');

  const taskPath = `tasks/${task.id}/`;

  doneEl.addEventListener('change', () => {
    withBusy(async () => {
      try {
        const updated = await apiFetch(taskPath, 'PATCH', { done: doneEl.checked });
        task.done = updated.done;
      } catch (err) {
        doneEl.checked = task.done;
        throw err;
      }
    });
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn-secondary';
  saveBtn.textContent = 'Сохранить';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(async () => {
      const updated = await apiFetch(taskPath, 'PATCH', { title: titleEl.value });
      titleEl.value = updated.title;
    });
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-danger';
  deleteBtn.textContent = 'Удалить';

  deleteBtn.addEventListener('click', () => {
    withBusy(async () => {
      await apiFetch(taskPath, 'DELETE');
      await loadTasks(currentRunId);
    });
  });

  form.append(titleEl, doneLabel, saveBtn, deleteBtn);
  li.append(form);
  return li;
}

async function loadTasks(runId = currentRunId) {
  const tasks = await apiFetch(`tasks/?runId=${encodeURIComponent(runId)}`);
  currentRunId = runId;
  listSummary.textContent = `Набор «${runId}» — задач: ${tasks.length}`;
  taskList.replaceChildren(...tasks.map(renderTask));
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  withBusy(async () => {
    bearerToken = tokenInput.value.trim();
    try {
      const author = await apiFetch('author/');
      await loadTasks('manual');
      runInput.value = 'manual';
      authorName.textContent = author.fullName;
      authorLogin.textContent = author.login;
      tokenInput.value = '';
      authSection.hidden = true;
      workspace.hidden = false;
    } catch (err) {
      bearerToken = '';
      throw err;
    }
  });
});

logoutBtn.addEventListener('click', () => {
  bearerToken = '';
  titleInput.value = '';
  statusMsg.textContent = '';
  taskList.replaceChildren();
  workspace.hidden = true;
  authSection.hidden = false;
  tokenInput.focus();
});

runForm.addEventListener('submit', (e) => {
  e.preventDefault();
  withBusy(() => loadTasks(runInput.value));
});

createForm.addEventListener('submit', (e) => {
  e.preventDefault();
  withBusy(async () => {
    await apiFetch('tasks/', 'POST', {
      title: titleInput.value,
      runId: currentRunId,
    });
    titleInput.value = '';
    await loadTasks(currentRunId);
  });
});
