const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

let db = null;

function init() {
  if (db) return db;
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'chats.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder TEXT,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      thinking TEXT,
      tool_calls TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      folder TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
  `);

  // Migration: add project_id column to sessions if missing
  const cols = db.prepare('PRAGMA table_info(sessions)').all();
  if (!cols.some((c) => c.name === 'project_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN project_id INTEGER');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, updated_at DESC)');

  return db;
}

function createSession({ folder, title, projectId }) {
  const d = init();
  const now = Date.now();
  const info = d.prepare(
    'INSERT INTO sessions (folder, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(folder || null, title || 'New chat', projectId || null, now, now);
  return info.lastInsertRowid;
}

function renameSession(id, title) {
  const d = init();
  d.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id);
}

function deleteSession(id) {
  const d = init();
  d.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
  d.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function moveSessionToProject(sessionId, projectId) {
  const d = init();
  d.prepare('UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?')
    .run(projectId || null, Date.now(), sessionId);
}

function listSessions({ folder, projectId, limit = 100 } = {}) {
  const d = init();
  // projectId semantics: undefined/null = no filter. 0 = unassigned.
  if (projectId === 0) {
    return d.prepare('SELECT * FROM sessions WHERE project_id IS NULL ORDER BY updated_at DESC LIMIT ?').all(limit);
  }
  if (projectId) {
    return d.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?').all(projectId, limit);
  }
  if (folder) {
    return d.prepare('SELECT * FROM sessions WHERE folder = ? ORDER BY updated_at DESC LIMIT ?').all(folder, limit);
  }
  return d.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit);
}

function loadSession(id) {
  const d = init();
  const session = d.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) return null;
  const rows = d.prepare(
    'SELECT role, content, thinking, tool_calls, created_at FROM messages WHERE session_id = ? ORDER BY id ASC'
  ).all(id);
  const messages = rows.map((r) => ({
    role: r.role,
    content: r.content,
    thinking: r.thinking || '',
    toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : [],
  }));
  return { session, messages };
}

function appendMessage(sessionId, { role, content, thinking, toolCalls }) {
  const d = init();
  const now = Date.now();
  d.prepare(
    'INSERT INTO messages (session_id, role, content, thinking, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    sessionId,
    role,
    content || '',
    thinking || null,
    toolCalls && toolCalls.length ? JSON.stringify(toolCalls) : null,
    now
  );
  d.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
}

function search(query, { folder, projectId, limit = 50 } = {}) {
  const d = init();
  const q = query.trim();
  if (!q) return [];
  const ftsQuery = q.split(/\s+/).map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
  const base = `SELECT m.session_id, m.role, s.title, s.folder, s.project_id, s.updated_at,
                       snippet(messages_fts, 0, '[', ']', '...', 12) AS snippet
                FROM messages_fts
                JOIN messages m ON m.id = messages_fts.rowid
                JOIN sessions s ON s.id = m.session_id
                WHERE messages_fts MATCH ?`;
  try {
    if (projectId === 0) {
      return d.prepare(`${base} AND s.project_id IS NULL ORDER BY bm25(messages_fts) LIMIT ?`).all(ftsQuery, limit);
    }
    if (projectId) {
      return d.prepare(`${base} AND s.project_id = ? ORDER BY bm25(messages_fts) LIMIT ?`).all(ftsQuery, projectId, limit);
    }
    if (folder) {
      return d.prepare(`${base} AND s.folder = ? ORDER BY bm25(messages_fts) LIMIT ?`).all(ftsQuery, folder, limit);
    }
    return d.prepare(`${base} ORDER BY bm25(messages_fts) LIMIT ?`).all(ftsQuery, limit);
  } catch {
    return [];
  }
}

// ── Projects ─────────────────────────────────────────────────────────────

function listProjects() {
  const d = init();
  const rows = d.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id) AS chat_count
    FROM projects p
    ORDER BY p.updated_at DESC
  `).all();
  return rows;
}

function createProject({ name, folder }) {
  const d = init();
  const now = Date.now();
  const info = d.prepare(
    'INSERT INTO projects (name, folder, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(name || 'New project', folder || null, now, now);
  return info.lastInsertRowid;
}

function renameProject(id, name) {
  const d = init();
  d.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id);
}

function setProjectFolder(id, folder) {
  const d = init();
  d.prepare('UPDATE projects SET folder = ?, updated_at = ? WHERE id = ?').run(folder || null, Date.now(), id);
}

function deleteProject(id) {
  const d = init();
  d.prepare('UPDATE sessions SET project_id = NULL WHERE project_id = ?').run(id);
  d.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

module.exports = {
  init,
  createSession,
  renameSession,
  deleteSession,
  moveSessionToProject,
  listSessions,
  loadSession,
  appendMessage,
  search,
  listProjects,
  createProject,
  renameProject,
  setProjectFolder,
  deleteProject,
};
