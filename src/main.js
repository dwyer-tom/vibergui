const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { exec } = require('node:child_process');
const { Ollama } = require('ollama');
const { buildIndex, searchIndex, getIndexStatus } = require('./indexer');

if (require('electron-squirrel-startup')) app.quit();

// ── Syntax validation ────────────────────────────────────────────────────
// Parse JS/JSX/TS/TSX files after edits to catch broken syntax before persisting.
const JS_SYNTAX_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const CSS_SYNTAX_EXTS = new Set(['.css', '.scss']);

function cssBasicCheck(code) {
  // Lightweight brace-balance check for CSS
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') depth--;
    if (depth < 0) return `Syntax error: unexpected '}' at position ${i}`;
  }
  if (depth !== 0) return `Syntax error: ${depth > 0 ? 'unclosed' : 'extra'} brace (${Math.abs(depth)} unmatched)`;
  return null;
}

function syntaxCheck(filePath, code) {
  const ext = path.extname(filePath).toLowerCase();
  if (CSS_SYNTAX_EXTS.has(ext)) return cssBasicCheck(code);
  if (ext === '.json') {
    try { JSON.parse(code); return null; }
    catch (err) { return `JSON syntax error: ${err.message}`; }
  }
  if (!JS_SYNTAX_EXTS.has(ext)) return null; // skip unknown file types
  try {
    const babel = require('@babel/core');
    const presets = [require.resolve('@babel/preset-react')];
    if ((ext === '.tsx' || ext === '.ts')) {
      try { presets.push(require.resolve('@babel/preset-typescript')); } catch { return null; } // skip if preset not installed
    }
    babel.parseSync(code, { filename: filePath, presets, sourceType: 'unambiguous' });
    return null; // no error
  } catch (err) {
    const loc = err.loc ? ` (line ${err.loc.line}, col ${err.loc.column})` : '';
    return `Syntax error${loc}: ${err.message.split('\n')[0]}`;
  }
}

// ── Debug broadcast ───────────────────────────────────────────────────────
// Sends debug lines to all renderer windows + console
function debugLog(...args) {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  try { console.log(...args); } catch { /* EPIPE */ }
  for (const win of BrowserWindow.getAllWindows()) {
    try { if (!win.isDestroyed()) win.webContents.send('debug-log', { ts: Date.now(), line }); }
    catch { /* window gone */ }
  }
}

// ── Path safety ────────────────────────────────────────────────────────────
let currentFolder = null;

function resolveInFolder(filePath) {
  // Resolve relative paths against the open folder, not the Electron process CWD
  if (currentFolder && !path.isAbsolute(filePath)) {
    return path.resolve(currentFolder, filePath);
  }
  return path.resolve(filePath);
}

function isWithinFolder(filePath) {
  if (!currentFolder) return false;
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : resolveInFolder(filePath);
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
      if (/node_modules|\.webpack|\.codelocal-/.test(filename)) return;
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
  filePath = resolveInFolder(filePath);
  try {
    return { ok: true, content: fs.readFileSync(filePath, 'utf8') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: write a file ──────────────────────────────────────────────────────
ipcMain.handle('write-file', async (_e, filePath, content) => {
  filePath = resolveInFolder(filePath);
  if (!isWithinFolder(filePath)) return { ok: false, error: 'Path is outside the open folder.' };
  try {
    const syntaxErr = syntaxCheck(filePath, content);
    if (syntaxErr) return { ok: false, error: syntaxErr };
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

// ── Fuzzy line-level replace (fallback when exact indexOf fails) ───────────
function fuzzyReplace(fileContent, searchText, replaceText) {
  const fileLines = fileContent.split('\n');
  const searchLines = searchText.split('\n').map(l => l.trim());
  const n = searchLines.length;
  for (let i = 0; i <= fileLines.length - n; i++) {
    const win = fileLines.slice(i, i + n).map(l => l.trim());
    if (win.every((l, j) => l === searchLines[j])) {
      return [...fileLines.slice(0, i), ...replaceText.split('\n'), ...fileLines.slice(i + n)].join('\n');
    }
  }
  return null;
}

// ── IPC: apply edit to a file (line-range or legacy search/replace) ────────
ipcMain.handle('apply-edit', async (_e, filePath, hunksOrLineEdit) => {
  filePath = resolveInFolder(filePath);
  if (!isWithinFolder(filePath)) return { ok: false, error: 'Path is outside the open folder.' };
  try {
    let content = null;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { /* new file */ }
    const backup = content; // snapshot for rollback

    // Normalise line endings for matching (Windows CRLF safety)
    const crlf = content?.includes('\r\n') ?? false;
    let result = (content ?? '').replace(/\r\n/g, '\n');

    // Line-range edit: { startLine, endLine, replacement }
    if (hunksOrLineEdit && typeof hunksOrLineEdit.startLine === 'number') {
      const { startLine, endLine, replacement } = hunksOrLineEdit;
      const lines = result.split('\n');
      const s = startLine - 1; // 0-indexed
      const e = endLine;       // endLine is inclusive, so slice up to endLine
      debugLog(`[apply-edit] ${path.basename(filePath)}: lines ${startLine}-${endLine} of ${lines.length} total`);
      if (s < 0 || s > lines.length) return { ok: false, error: `startLine ${startLine} out of range (file has ${lines.length} lines). Use read_file to get current line numbers.` };
      const newLines = replacement.split('\n');
      lines.splice(s, Math.max(0, e - s), ...newLines);
      result = lines.join('\n');
    } else {
      // Legacy search/replace hunks
      const hunks = hunksOrLineEdit;
      if (!hunks || hunks.length === 0) return { ok: false, error: 'No hunks provided' };

      for (const { search, replace } of hunks) {
        const normSearch  = search.replace(/\r\n/g, '\n');
        const normReplace = replace.replace(/\r\n/g, '\n');
        if (normSearch === '') { result = normReplace; continue; }
        const idx = result.indexOf(normSearch);
        if (idx === -1) {
          const fuzzy = fuzzyReplace(result, normSearch, normReplace);
          if (fuzzy !== null) { result = fuzzy; continue; }
          return { ok: false, error: `SEARCH text not found in ${path.basename(filePath)}` };
        }
        result = result.slice(0, idx) + normReplace + result.slice(idx + normSearch.length);
      }
    }

    // Syntax-check before writing — reject if broken (file is never written)
    const syntaxErr = syntaxCheck(filePath, result);
    if (syntaxErr) {
      debugLog(`[apply-edit] REJECTED — syntax error in ${path.basename(filePath)}: ${syntaxErr}`);
      return { ok: false, error: `Edit would break syntax: ${syntaxErr}. File was NOT modified.` };
    }

    if (crlf) result = result.replace(/\n/g, '\r\n');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, result, 'utf8');
    debugLog(`[apply-edit] OK — ${path.basename(filePath)} written`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: run a bash command ────────────────────────────────────────────────
ipcMain.handle('run-bash', async (_e, cmd, cwd) => {
  if (!cwd || !isWithinFolder(cwd)) return { ok: false, stdout: '', stderr: 'cwd is outside the open folder.', code: 1 };
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const shellFlag = process.platform === 'win32' ? '-Command' : '-c';
  return new Promise((resolve) => {
    exec(`${shell} ${shellFlag} "${cmd.replace(/"/g, '\\"')}"`, { cwd, timeout: 30000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout, stderr, code: err?.code ?? 0 });
    });
  });
});

// ── IPC: build RAG index for folder ───────────────────────────────────────
ipcMain.handle('index-folder', async (event, { folderPath, model }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  debugLog(`[index] building index for ${folderPath} with ${model}`);
  const t0 = Date.now();
  try {
    const result = await buildIndex(folderPath, model, (done, total, file) => {
      win.webContents.send('indexing-progress', { done, total, file });
      if (done % 20 === 0 || done === total) debugLog(`[index] ${done}/${total} chunks embedded`);
    });
    win.webContents.send('indexing-progress', { done: result.count, total: result.count, file: null });
    debugLog(`[index] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.count} chunks, ${result.files} files`);
    return { ok: true, ...result };
  } catch (err) {
    debugLog(`[index] FAILED: ${err.message}`);
    return { ok: false, error: err.message };
  }
});

// ── IPC: search RAG index ─────────────────────────────────────────────────
ipcMain.handle('search-index', async (_e, { folderPath, query, model, topK }) => {
  return searchIndex(folderPath, query, model, topK ?? 5);
});

// ── IPC: get index status ─────────────────────────────────────────────────
ipcMain.handle('index-status', async (_e, folderPath) => {
  return getIndexStatus(folderPath);
});

// ── Tool definitions ───────────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full contents of a file from the codebase.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative path to the file.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List all files in the open folder or a subdirectory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory to list. Defaults to the root of the open folder.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search for a regex pattern across files in the codebase. Returns matching lines with file paths and line numbers. Use when you know exact text, function name, or identifier. Prefer this over search_code for specific strings.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for.' },
          path: { type: 'string', description: 'Directory or file to search in. Defaults to the root of the open folder.' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_bash',
      description: 'Run a shell command in the root of the open folder. Use for running tests, builds, or inspecting output.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Semantic search across the codebase using embeddings. Use ONLY when you do not know file names or locations. Returns JSON grouped by file. Do NOT use for exact strings — use grep instead.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language description of what to find.' },
          top_k: { type: 'number', description: 'Number of results (default 5, max 10).' },
        },
        required: ['query'],
      },
    },
  },
];

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv', '.webpack', '.cache', '.parcel-cache', 'out', 'coverage']);
const IGNORE_GREP_FILES = new Set(['.codelocal-index.json', '.codelocal-meta.json']);
function grepDir(dir, regex, results, cap) {
  if (results.length >= cap) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (results.length >= cap) return;
    if (IGNORE_DIRS.has(e.name) || IGNORE_GREP_FILES.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { grepDir(full, regex, results, cap); continue; }
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && results.length < cap; i++) {
      if (regex.test(lines[i])) results.push(`${full}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

async function executeTool(name, args) {
  if (name === 'read_file') {
    const filePath = resolveInFolder(args.path);
    if (!isWithinFolder(filePath)) return { ok: false, result: 'Error: path is outside the open folder.' };
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      debugLog(`[read_file] ${path.relative(currentFolder || '', filePath)} — ${lines.length} lines, ${content.length} chars`);
      // Number every line so the model can reference line ranges in edits
      const numbered = lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
      return { ok: true, result: numbered, summary: `${lines.length} lines read` };
    } catch (err) {
      return { ok: false, result: `Error: ${err.message}` };
    }
  }

  if (name === 'list_files') {
    const base = args.path ? resolveInFolder(args.path) : currentFolder;
    if (!base || !isWithinFolder(base)) return { ok: false, result: 'Error: path is outside the open folder.' };
    const results = [];
    function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (IGNORE_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full); else results.push(full);
      }
    }
    walk(base);
    debugLog(`[list_files] ${path.relative(currentFolder || '', base)} — ${results.length} files`);
    const result = results.join('\n');
    return { ok: true, result, summary: `${results.length} files listed` };
  }

  if (name === 'grep') {
    if (!currentFolder) return { ok: false, result: 'Error: no folder is open.' };
    let regex;
    try { regex = new RegExp(args.pattern, 'i'); } catch { return { ok: false, result: `Error: invalid regex "${args.pattern}"` }; }
    const searchRoot = args.path ? resolveInFolder(args.path) : currentFolder;
    if (!isWithinFolder(searchRoot)) return { ok: false, result: 'Error: path is outside the open folder.' };
    const matches = [];
    grepDir(searchRoot, regex, matches, 25);
    debugLog(`[grep] /${args.pattern}/ — ${matches.length} matches`);
    const result = matches.length ? matches.join('\n') : 'No matches found.';
    return { ok: true, result, summary: matches.length ? `${matches.length} match${matches.length > 1 ? 'es' : ''}` : 'no matches' };
  }

  if (name === 'run_bash') {
    if (!currentFolder) return { ok: false, result: 'Error: no folder is open.' };
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellFlag = process.platform === 'win32' ? '-Command' : '-c';
    return new Promise((resolve) => {
      exec(`${shell} ${shellFlag} "${args.command.replace(/"/g, '\\"')}"`, { cwd: currentFolder, timeout: 30000, maxBuffer: 1024 * 256 }, (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
        const truncated = output.length > 4000 ? output.slice(0, 4000) + '\n…(truncated)' : output;
        resolve({ ok: !err || !!stdout, result: truncated, summary: err ? `exit ${err.code ?? 1}` : 'done' });
      });
    });
  }

  if (name === 'search_code') {
    if (!currentFolder) return { ok: false, result: 'Error: no folder is open.' };
    const topK = Math.min(args.top_k ?? 5, 10);
    debugLog(`[search_code] query="${args.query}" topK=${topK}`);
    const res = await searchIndex(currentFolder, args.query, 'nomic-embed-text', topK, debugLog);
    if (!res.ok) return { ok: false, result: `Error: ${res.error} Use grep as a fallback.` };
    if (res.results.length === 0) return { ok: true, result: 'No relevant results found.', summary: 'no matches' };

    // Group by file, best score per file
    const byFile = new Map();
    for (const r of res.results) {
      const rel = path.relative(currentFolder, r.path);
      if (!byFile.has(rel)) byFile.set(rel, { file: rel, score: r.score, matches: [] });
      const entry = byFile.get(rel);
      entry.score = Math.max(entry.score, r.score);
      entry.matches.push({ start: r.startLine, end: r.endLine, snippet: r.text });
    }

    // Structured truncation: top 3 files, 2 matches each, 30-line snippets
    const files = [...byFile.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(f => ({
        ...f, score: +f.score.toFixed(3),
        matches: f.matches.slice(0, 2).map(m => {
          const lines = m.snippet.split('\n');
          return { ...m, snippet: lines.length > 30 ? lines.slice(0, 30).join('\n') + '\n...' : m.snippet };
        }),
      }));

    const output = {
      files,
      hint: 'Read the top file with read_file for full context before making changes.',
    };
    return { ok: true, result: JSON.stringify(output, null, 2), summary: `${files.length} file${files.length > 1 ? 's' : ''}` };
  }

  return { ok: false, result: `Unknown tool: ${name}` };
}

// ── Gemma 4 helpers ────────────────────────────────────────────────────────

// Gemma 4 outputs thinking as: <|channel>thought\n[reasoning]\n<channel|>[answer]
function parseGemmaThinking(content) {
  const m = content.match(/<\|channel>thought\n([\s\S]*?)<channel\|>([\s\S]*)/);
  if (!m) return null;
  return { thinking: m[1].trim(), content: m[2].trim() };
}

// Gemma 4 streaming tool call formats seen in content:
//   Format A (Ollama template): <tool_call>\n{"name":"...","arguments":{...}}\n</tool_call>
//   Format B (raw tokens):      <|tool_response>://name{key:<|"|>value<|"|>}<|tool_response>
function parseGemmaToolCalls(content) {
  const toolCalls = [];

  // Format A — standard JSON block (most common in streaming)
  const blockRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m;
  while ((m = blockRe.exec(content)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      const name = obj.name ?? obj.function_name ?? obj.tool;
      const args = obj.arguments ?? obj.parameters ?? obj.args ?? {};
      if (name) toolCalls.push({ function: { name, arguments: args } });
    } catch (e) {
      console.log('tool_call JSON parse failed:', m[1].slice(0, 200), e.message);
    }
  }
  if (toolCalls.length) return toolCalls;

  // Format B — raw <|tool_response>://name{...} tokens
  const rawRe = /<\|tool_response>:\/\/(\w+)\{([^}]*)\}/g;
  while ((m = rawRe.exec(content)) !== null) {
    const name = m[1];
    const jsonStr = '{' + m[2].replace(/<\|"\|>/g, '"').replace(/(\w+):/g, '"$1":') + '}';
    let args = {};
    try { args = JSON.parse(jsonStr); } catch {}
    toolCalls.push({ function: { name, arguments: args } });
  }
  return toolCalls.length ? toolCalls : null;
}

// Strip all Gemma special tokens and tool call blocks from content.
function stripGemmaToolMarkup(content) {
  return content
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')            // <tool_call> blocks
    .replace(/<\|tool_response>[\s\S]*?<\|tool_response>/g, '')  // paired raw blocks
    .replace(/<\|[^>]*\|?>/g, '')                                 // <|token|> and <|token>
    .replace(/<[^>]*\|>/g, '')                                    // <token|>
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Enable thinking by injecting <|think|> at start of system prompt
function applyThink(messages) {
  return messages.map((m) =>
    m.role === 'system' ? { ...m, content: `<|think|>\n${m.content}` } : m
  );
}

const MODEL_OPTIONS = { num_ctx: 32768, temperature: 1.0, top_p: 0.95, top_k: 64 };

// ── IPC: chat ─────────────────────────────────────────────────────────────
let activeOllama = null;

ipcMain.handle('chat-abort', () => {
  if (activeOllama) { activeOllama.abort(); activeOllama = null; }
});

ipcMain.handle('chat', async (event, { model, messages, think, agentMode }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  activeOllama = new Ollama();
  const tools = agentMode ? TOOLS : undefined;
  const [sysMsg, ...historyMsgs] = messages;
  let currentMessages = [...messages];
  const MAX_ITER = 12;
  const MAX_TOOL_ROUNDS = 8;
  let reachedLimit = false;
  const retrievedFiles = new Set(); // Track files the model has actually seen via tools

  // Pre-populate from history tool summaries (e.g. "[tool: read_file(src/foo.js) → 1234 chars read]")
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.content) continue;
    const toolRefs = m.content.matchAll(/\[tool: (?:read_file|grep|list_files|search_code)\(([^)]+)\)[^\]]*\]/g);
    for (const match of toolRefs) {
      const arg = match[1].trim();
      retrievedFiles.add(arg);
      if (currentFolder) {
        retrievedFiles.add(path.relative(currentFolder, path.resolve(arg)));
        retrievedFiles.add(path.resolve(arg));
      }
    }
  }
  if (retrievedFiles.size > 0) debugLog(`[ctx] pre-populated ${retrievedFiles.size} retrieved files from history`);

  const safeSend = (channel, data) => {
    try { if (!win.isDestroyed()) win.webContents.send(channel, data); }
    catch { /* window gone mid-chat */ }
  };
  const safeLog = debugLog; // use module-level broadcaster

  safeLog(`[chat] model=${model} think=${think} agent=${agentMode} msgs=${currentMessages.length}`);

  try {
    for (let iter = 0; iter < MAX_ITER; iter++) {
      if (!activeOllama) break;
      // Trim context: keep system + first user message (the task) + last N messages
      const MAX_TAIL = 12;
      if (currentMessages.length > MAX_TAIL + 2) {
        const sysMsg0 = currentMessages[0];
        // Preserve first user message so the model never loses the original task
        const firstUser = currentMessages.find((m, i) => i > 0 && m.role === 'user');
        const tail = currentMessages.slice(1).slice(-MAX_TAIL);
        // Only prepend firstUser if it's not already in the tail
        const hasFirst = firstUser && tail.includes(firstUser);
        currentMessages = hasFirst
          ? [sysMsg0, ...tail]
          : [sysMsg0, ...(firstUser ? [firstUser] : []), ...tail];
        safeLog(`[ctx] trimmed to ${currentMessages.length} messages (kept first user msg)`);
      }
      const ctxChars = currentMessages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
      const msgRoles = currentMessages.map(m => m.role[0]).join('');
      safeLog(`[iter ${iter}] sending ${currentMessages.length} msgs [${msgRoles}] (${(ctxChars / 1000).toFixed(1)}k chars) to ${model}`);
      const iterStart = Date.now();

      let accThinking = '';
      let accContent = '';
      let toolCalls = null;

      // Gemma produces empty content when stream=true + tools are defined.
      // Use stream=false for agent iterations; stream=true only when no tools.
      const useStream = !tools;

      if (useStream) {
        const stream = await activeOllama.chat({
          model,
          messages: think ? applyThink(currentMessages) : currentMessages,
          stream: true,
          options: MODEL_OPTIONS,
        });
        for await (const chunk of stream) {
          if (!activeOllama) break;
          const msg = chunk.message ?? {};
          if (msg.thinking) {
            accThinking += msg.thinking;
            safeSend('chat-token', { text: '', thinking: msg.thinking });
          }
          if (msg.content) accContent += msg.content;
        }
        safeLog(`[iter ${iter}] stream done in ${Date.now() - iterStart}ms thinking=${accThinking.length} content=${accContent.length}`);
      } else {
        const resp = await activeOllama.chat({
          model,
          messages: think ? applyThink(currentMessages) : currentMessages,
          stream: false,
          tools,
          options: MODEL_OPTIONS,
        });
        safeLog(`[iter ${iter}] non-stream done in ${Date.now() - iterStart}ms`);
        const msg = resp.message ?? {};
        accThinking = msg.thinking ?? '';
        accContent = msg.content ?? '';
        if (msg.tool_calls?.length) {
          toolCalls = msg.tool_calls;
          safeLog(`[iter ${iter}] tool_calls: ${toolCalls.map(tc => `${tc.function.name}(${JSON.stringify(tc.function.arguments)})`).join(', ')}`);
        }
        safeLog(`[iter ${iter}] thinking=${accThinking.length} content=${accContent.length}${accContent.length > 0 && accContent.length < 200 ? ' → ' + JSON.stringify(accContent) : ''}`);

        // Send thinking to UI
        if (accThinking) safeSend('chat-token', { text: '', thinking: accThinking });
      }

      // Thinking channel fallback (Gemma sometimes embeds thinking in content)
      if (!accThinking) {
        const gp = parseGemmaThinking(accContent);
        if (gp) {
          safeSend('chat-token', { text: '', thinking: gp.thinking });
          accThinking = gp.thinking; accContent = gp.content;
        }
      }

      // Parse tool calls from content if not natively provided
      if (!toolCalls?.length && (accContent.includes('<tool_call>') || accContent.includes('<|tool_response>'))) {
        const parsed = parseGemmaToolCalls(accContent);
        if (parsed) {
          toolCalls = parsed;
          safeLog(`[iter ${iter}] parsed tool calls:`, toolCalls.map(tc => tc.function.name));
          accContent = stripGemmaToolMarkup(accContent);
        } else {
          safeLog(`[iter ${iter}] unparseable tool tokens. raw:`, JSON.stringify(accContent.slice(0, 300)));
          accContent = stripGemmaToolMarkup(accContent);
        }
      }

      if (!toolCalls?.length) {
        // Final answer — stream content to UI in chunks for smooth rendering
        accContent = stripGemmaToolMarkup(accContent);

        // Guard: reject if model references files it hasn't retrieved via tools
        // Skip in plan mode (proposes new files) and execution mode (reads files itself during execution)
        const isPlanMode = sysMsg?.content?.includes('PLAN MODE');
        const isExecMode = sysMsg?.content?.includes('implement the plan NOW');
        const fileRefs = [...accContent.matchAll(/\b([\w./-]+\.(?:js|jsx|ts|tsx|py|java|go|rs|css|html|json|md|yml|yaml))\b/g)]
          .map(m => m[1]);
        const unverified = fileRefs.filter(f => !retrievedFiles.has(f) && f.includes('/'));
        if (!isPlanMode && !isExecMode && unverified.length > 0 && iter < MAX_ITER - 1) {
          safeLog(`[guard] rejected — unretrieved files: ${unverified.join(', ')}`);
          currentMessages.push(
            { role: 'assistant', content: accContent },
            { role: 'user', content: `Error: You referenced files you have not retrieved: ${unverified.join(', ')}. Use read_file, search_code, or grep first. Try again.` }
          );
          continue;
        }

        // Guard: reject if model produced prose but no edit blocks (hallucination/passive response)
        // Only trigger if files were read (model had enough context to act) and it's not the last iteration
        const hasEdits = accContent.includes('<edit') || accContent.includes('<<<<<<');
        const filesRead = retrievedFiles.size > 0;
        const looksPassive = /\b(ready to assist|let me know|how can I help|I'm ready|I understand the task|what would you like|provide your instructions|don't have a specific request|please provide|what do you want me to)\b/i.test(accContent);
        if (filesRead && !hasEdits && looksPassive && iter < MAX_ITER - 1) {
          safeLog(`[guard] passive response detected — re-prompting to produce edit blocks`);
          currentMessages.push(
            { role: 'assistant', content: accContent },
            { role: 'user', content: 'You described the task but did not complete it. Produce the edit blocks now. Output ONLY edit blocks, no prose.' }
          );
          continue;
        }

        safeLog(`[iter ${iter}] final answer length=${accContent.length}`);
        const CHUNK = 8;
        for (let i = 0; i < accContent.length; i += CHUNK)
          safeSend('chat-token', { text: accContent.slice(i, i + CHUNK), thinking: '' });
        break;
      }

      if (iter === MAX_ITER - 1) { reachedLimit = true; break; }

      for (const tc of toolCalls) {
        const { name: toolName, arguments: args } = tc.function;
        safeLog(`[tool] ${toolName}`, args);
        safeSend('chat-tool-call', { name: toolName, args });
        const { result, summary, ok } = await executeTool(toolName, args);
        safeLog(`[tool] ${toolName} -> ${summary ?? (ok ? 'ok' : 'error')}`);
        safeSend('chat-tool-result', { name: toolName, summary: summary ?? (ok ? 'done' : 'error'), full: result });

        // Track which files the model has actually retrieved
        if (toolName === 'read_file' && ok && args.path) {
          retrievedFiles.add(args.path);
          if (currentFolder) retrievedFiles.add(path.relative(currentFolder, resolveInFolder(args.path)));
        } else if (toolName === 'search_code' && ok) {
          try { const parsed = JSON.parse(result); (parsed.files || []).forEach(f => retrievedFiles.add(f.file)); } catch {}
        } else if (toolName === 'grep' && ok) {
          for (const line of result.split('\n')) { const fp = line.split(':')[0]; if (fp) retrievedFiles.add(currentFolder ? path.relative(currentFolder, fp) : fp); }
        } else if (toolName === 'list_files' && ok) {
          for (const fp of result.split('\n')) { if (fp.trim()) retrievedFiles.add(currentFolder ? path.relative(currentFolder, fp.trim()) : fp.trim()); }
        }
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: accContent || '', tool_calls: toolCalls },
          { role: 'tool', name: toolName, content: result },
        ];
        // Cap context: keep system + base history + last MAX_TOOL_ROUNDS*2 tool messages
        const baseLen = historyMsgs.length + 1;
        const toolMsgs = currentMessages.slice(baseLen);
        if (toolMsgs.length > MAX_TOOL_ROUNDS * 2) {
          currentMessages = [sysMsg, ...historyMsgs, ...toolMsgs.slice(-MAX_TOOL_ROUNDS * 2)];
          safeLog(`[ctx] trimmed to ${currentMessages.length} messages`);
        }
      }
    }

    if (reachedLimit) {
      const msg = 'Agent reached the maximum number of steps. Try rephrasing or being more specific.';
      for (let i = 0; i < msg.length; i += 4) safeSend('chat-token', { text: msg.slice(i, i + 4), thinking: '' });
    }
  } catch (err) {
    if (err?.name !== 'AbortError') {
      safeLog('[chat error]', err);
      safeSend('chat-token', { text: `\n\nError: ${err.message}`, thinking: '' });
    }
  } finally {
    activeOllama = null;
    safeSend('chat-done', {});
    safeLog('[chat done]');
  }
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
      spellcheck: true,
    },
  });
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        items.push({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion),
        });
      }
      if (items.length) items.push({ type: 'separator' });
      items.push({
        label: 'Add to dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }
    items.push(
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
    );
    Menu.buildFromTemplate(items).popup({ window: win });
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
