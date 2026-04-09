const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { exec } = require('node:child_process');
const { Ollama } = require('ollama');
const { buildIndex, searchIndex, getIndexStatus, getFileMeta, getRelevantCode, findSymbol } = require('./indexer');

if (require('electron-squirrel-startup')) app.quit();

// ── Path safety ────────────────────────────────────────────────────────────
let currentFolder = null;

function isWithinFolder(filePath) {
  if (!currentFolder) return false;
  const resolved = path.resolve(filePath);
  const base = path.resolve(currentFolder);
  return resolved === base || resolved.startsWith(base + path.sep);
}

// ── Folder watcher ─────────────────────────────────────────────────────────
let folderWatcher = null;
let watchDebounce  = null;

ipcMain.handle('watch-folder', (event, folderPath) => {
  currentFolder = folderPath;
  if (folderWatcher) { folderWatcher.close(); folderWatcher = null; }
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    folderWatcher = fs.watch(folderPath, { recursive: true }, (_type, filename) => {
      if (!filename) return;
      if (/node_modules|\.webpack|\.codelocal-index/.test(filename)) return;
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        win.webContents.send('folder-changed');
      }, 1500);
    });
  } catch { /* fs.watch not available on this platform */ }
});

// ── IPC: open folder picker ────────────────────────────────────────────────
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

// ── IPC: read a file ───────────────────────────────────────────────────────
ipcMain.handle('read-file', async (_e, filePath) => {
  try {
    return { ok: true, content: fs.readFileSync(filePath, 'utf8') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: write a file ──────────────────────────────────────────────────────
ipcMain.handle('write-file', async (_e, filePath, content) => {
  if (!isWithinFolder(filePath)) return { ok: false, error: 'Path is outside the open folder.' };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: list files in a folder recursively (respects .gitignore patterns) ─
ipcMain.handle('list-files', async (_e, folderPath) => {
  const IGNORE = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv', '.webpack', '.cache', '.parcel-cache', 'out', 'coverage']);
  const IGNORE_FILES = new Set(['.codelocal-index.json', '.codelocal-meta.json']);
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (IGNORE.has(e.name) || IGNORE_FILES.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else results.push(full);
    }
  }
  walk(folderPath);
  return results;
});

// ── IPC: apply search/replace hunks to a file ─────────────────────────────
ipcMain.handle('apply-edit', async (_e, filePath, hunks) => {
  if (!isWithinFolder(filePath)) return { ok: false, error: 'Path is outside the open folder.' };
  try {
    if (!hunks || hunks.length === 0) return { ok: false, error: 'No hunks provided' };

    let content = null;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { /* new file */ }

    // Normalise line endings for matching (Windows CRLF safety)
    const crlf = content?.includes('\r\n') ?? false;
    let result = (content ?? '').replace(/\r\n/g, '\n');

    for (const { search, replace } of hunks) {
      const normSearch  = search.replace(/\r\n/g, '\n');
      const normReplace = replace.replace(/\r\n/g, '\n');
      if (normSearch === '') { result = normReplace; continue; }
      const idx = result.indexOf(normSearch);
      if (idx === -1) return { ok: false, error: `SEARCH text not found in ${path.basename(filePath)}` };
      result = result.slice(0, idx) + normReplace + result.slice(idx + normSearch.length);
    }

    if (crlf) result = result.replace(/\n/g, '\r\n');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, result, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: run a bash command ────────────────────────────────────────────────
ipcMain.handle('run-bash', async (_e, cmd, cwd) => {
  if (!cwd || !isWithinFolder(cwd)) return { ok: false, stdout: '', stderr: 'cwd is outside the open folder.', code: 1 };
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 30000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout, stderr, code: err?.code ?? 0 });
    });
  });
});

// ── IPC: chat with model (Ollama only) ────────────────────────────────────
// Streams tokens back via webContents.send('chat-token', token)
let activeOllama = null;

// ── Agentic tool definitions (Ollama native tools API) ─────────────────────
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List all source files in the project.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full contents of a file by its relative path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file, e.g. src/main.js' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_bash',
      description: 'Run a shell command in the project root and return stdout+stderr.',
      parameters: {
        type: 'object',
        properties: {
          cmd: { type: 'string', description: 'The shell command to execute.' },
        },
        required: ['cmd'],
      },
    },
  },
];

async function executeTool(name, args, folder) {
  if (name === 'list_files') {
    const IGNORE = new Set(['.git', 'node_modules', '.next', 'dist', 'build',
      '__pycache__', '.venv', 'venv', '.webpack', '.cache', '.parcel-cache',
      'out', 'coverage', '.codelocal-index.json', '.codelocal-meta.json']);
    const results = [];
    function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (IGNORE.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else results.push(path.relative(folder, full).replace(/\\/g, '/'));
      }
    }
    walk(folder);
    return results.join('\n');
  }
  if (name === 'read_file') {
    if (!args.path) return 'Error: path argument required';
    const filePath = path.isAbsolute(args.path) ? args.path : path.join(folder, args.path);
    try { return fs.readFileSync(filePath, 'utf8').slice(0, 20000); }
    catch (e) { return `Error: ${e.message}`; }
  }
  if (name === 'run_bash') {
    if (!args.cmd) return 'Error: cmd argument required';
    return new Promise((resolve) => {
      exec(args.cmd, { cwd: folder, timeout: 15000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
        resolve(((stdout || '') + (stderr || '')).trim() || (err?.message ?? 'no output'));
      });
    });
  }
  return `Unknown tool: ${name}`;
}

ipcMain.handle('chat-abort', () => {
  if (activeOllama) { activeOllama.abort(); activeOllama = null; }
});

ipcMain.handle('chat', async (event, { model, messages, think }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  activeOllama = new Ollama();
  const MAX_ROUNDS = 6;
  let currentMessages = messages;
  const startTime = Date.now();
  let totalTokens = 0;
  let thinkMs = 0;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let fullText = '';
      let fullThinking = '';
      let toolCalls = [];

      const res = await activeOllama.chat({
        model: model ?? 'llama3',
        messages: currentMessages,
        tools: AGENT_TOOLS,
        stream: true,
        think: think ?? false,
        options: { num_ctx: 32768 },
      });

      for await (const part of res) {
        fullText += part.message.content ?? '';
        fullThinking += part.message.thinking ?? '';
        if (part.message.tool_calls?.length) {
          toolCalls = part.message.tool_calls;
        }
        if (part.done) {
          totalTokens += part.eval_count ?? 0;
          thinkMs += part.thinking_duration ? Math.round(part.thinking_duration / 1e6) : 0;
        }
      }

      if (toolCalls.length === 0 || round === MAX_ROUNDS - 1) {
        // No tool calls (or hit limit) — send buffered response and stop
        win.webContents.send('chat-token', { text: fullText, thinking: fullThinking });
        break;
      }

      // Emit any prose the model wrote before the tool calls
      if (fullText.trim()) {
        win.webContents.send('chat-token', { text: fullText + '\n', thinking: fullThinking });
      }

      // Execute each tool call; notify renderer so it can show badges
      const toolResultMessages = [];
      for (const tc of toolCalls) {
        const name = tc.function.name;
        const args = tc.function.arguments ?? {};
        win.webContents.send('chat-tool', { name, args });
        const result = await executeTool(name, args, currentFolder);
        toolResultMessages.push({ role: 'tool', content: result });
      }

      // Append assistant turn + tool results for next model round
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: fullText, tool_calls: toolCalls },
        ...toolResultMessages,
      ];
    }
  } catch (err) {
    if (err?.name !== 'AbortError') throw err;
  } finally {
    activeOllama = null;
    win.webContents.send('chat-done', {
      elapsedMs: Date.now() - startTime,
      tokens: totalTokens,
      thinkMs,
    });
  }
});

// ── IPC: batch symbol/IPC-channel search across multiple files ────────────
// queries: [{ filePath, name }] — returns { [name]: { filePath, lineNum } }
// Doing the loop in the main process avoids O(N) IPC round-trips.
ipcMain.handle('find-symbols', async (_e, queries) => {
  const results = {};
  for (const { filePath, name } of queries) {
    if (results[name]) continue; // already found
    const lineNum = findSymbol(filePath, name);
    if (lineNum) results[name] = { filePath, lineNum };
  }
  return results;
});

// ── IPC: get index status ─────────────────────────────────────────────────
ipcMain.handle('index-status', async (_e, folderPath) => {
  return getIndexStatus(folderPath);
});

// ── IPC: get structural file metadata (imports, importedBy, symbols) ──────
ipcMain.handle('get-file-meta', async (_e, folderPath) => {
  return getFileMeta(folderPath);
});

// ── IPC: get relevant code slices for a file given matched chunks ──────────
ipcMain.handle('slice-file', async (_e, filePath, chunks) => {
  return getRelevantCode(filePath, chunks);
});

// ── IPC: build index for folder ───────────────────────────────────────────
// Streams progress via webContents.send('indexing-progress', { done, total, file })
ipcMain.handle('index-folder', async (event, { folderPath, model }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    const result = await buildIndex(folderPath, model, (done, total, file) => {
      win.webContents.send('indexing-progress', { done, total, file });
    });
    win.webContents.send('indexing-progress', { done: result.count, total: result.count, file: null });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: search index ─────────────────────────────────────────────────────
ipcMain.handle('search-index', async (_e, { folderPath, query, model, topK }) => {
  return searchIndex(folderPath, query, model, topK ?? 5);
});

// ── IPC: list available Ollama models ─────────────────────────────────────
ipcMain.handle('ollama-models', async () => {
  try {
    const ollama = new Ollama();
    const { models } = await ollama.list();
    return models.map((m) => m.name);
  } catch {
    return [];
  }
});

// ── Window ─────────────────────────────────────────────────────────────────
const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    backgroundColor: '#f3f2ee',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f3f2ee',
      symbolColor: '#1a1a19',
      height: 40,
    },
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  if (process.env.NODE_ENV === 'development') win.webContents.openDevTools();
};

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
