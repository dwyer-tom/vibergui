/**
 * indexer.js — RAG indexing for codelocal (runs in main process only)
 *
 * Uses Ollama's /api/embeddings endpoint for embeddings (no extra deps),
 * stores the index as a JSON file inside the folder, and does cosine
 * similarity search at query time.
 *
 * Also writes a companion .codelocal-meta.json with per-file structural
 * metadata (imports, importedBy, symbols) so the renderer can use it for
 * graph-aware retrieval without re-parsing source files.
 */

const fs   = require('node:fs');
const path = require('node:path');
const { Ollama } = require('ollama');

const INDEX_FILE   = '.codelocal-index.json';
const META_FILE    = '.codelocal-meta.json';

// ── in-memory index cache ─────────────────────────────────────────────────────
// Avoids re-parsing the multi-MB embeddings JSON on every search query.
let _indexCache = null; // { path: string, data: object }
const CHUNK_LINES  = 30;   // lines per chunk
const CHUNK_OVERLAP = 5;   // line overlap between chunks
const MAX_FILES    = 200;

const IGNORE   = new Set(['.git', 'node_modules', '.next', 'dist', 'build',
  '__pycache__', '.venv', 'venv', '.webpack', '.cache',
  '.parcel-cache', 'out', 'coverage']);

const TEXT_EXT = /\.(js|jsx|ts|tsx|py|rs|go|java|c|cpp|h|hpp|cs|rb|php|sh|md|txt|json|toml|yaml|yml|sql|html|css|scss)$/i;
const EXCLUDE  = /package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.js|\.min\.css/i;

// ── file walking ──────────────────────────────────────────────────────────────
function walkFolder(folderPath) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      if (e.name === INDEX_FILE || e.name === META_FILE) continue;
      if (EXCLUDE.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (TEXT_EXT.test(e.name)) results.push(full);
    }
  }
  walk(folderPath);
  return results.slice(0, MAX_FILES);
}

// ── chunking ──────────────────────────────────────────────────────────────────
function chunkFile(filePath, content) {
  const lines  = content.split('\n');
  const chunks = [];
  const step   = CHUNK_LINES - CHUNK_OVERLAP;

  for (let i = 0; i < lines.length; i += step) {
    const slice = lines.slice(i, i + CHUNK_LINES);
    chunks.push({
      path:      filePath,
      startLine: i + 1,
      endLine:   i + slice.length,
      text:      `// File: ${filePath} (lines ${i + 1}-${i + slice.length})\n${slice.join('\n')}`,
    });
    if (i + CHUNK_LINES >= lines.length) break;
  }

  if (chunks.length === 0 && content.trim()) {
    chunks.push({
      path:      filePath,
      startLine: 1,
      endLine:   lines.length,
      text:      `// File: ${filePath}\n${content}`,
    });
  }

  return chunks;
}

// ── structural metadata extraction ────────────────────────────────────────────

/** Extract named symbols: functions, classes, arrow-function consts, exports */
function extractSymbols(content) {
  const symbols = new Set();
  const patterns = [
    /\bfunction\s+(\w+)\s*\(/g,
    /\bclass\s+(\w+)[\s{(]/g,
    /\bconst\s+(\w+)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[\w]+\s*=>)/g,
    /\bexport\s+(?:default\s+)?(?:function|class)\s+(\w+)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      if (m[1] && m[1].length > 1) symbols.add(m[1]);
    }
  }
  return [...symbols];
}

/** Extract relative import/require paths resolved to absolute paths */
function extractFileImports(filePath, content) {
  const dir = path.dirname(filePath);
  const matches = content.match(/(?:import\s+.*?from\s+|require\s*\(\s*)['"](\..*?)['"]/g) || [];
  return matches.map((m) => {
    const rel = m.match(/['"](\..*?)['"]/)[1];
    return path.resolve(dir, rel);
  });
}

/** Try to resolve an import path to an actual indexed file (handles missing extensions) */
function resolveToIndexedFile(importedPath, fileSet) {
  if (fileSet.has(importedPath)) return importedPath;
  for (const ext of ['.js', '.jsx', '.ts', '.tsx']) {
    const withExt = importedPath + ext;
    if (fileSet.has(withExt)) return withExt;
    const withIndex = path.join(importedPath, 'index' + ext);
    if (fileSet.has(withIndex)) return withIndex;
  }
  return null;
}

/** Build per-file metadata: imports, importedBy, symbols */
function buildFileMeta(files, fileContents) {
  const fileSet = new Set(files);
  const meta = {};

  // First pass: imports + symbols
  for (const f of files) {
    const content = fileContents[f] || '';
    meta[f] = {
      imports:    extractFileImports(f, content).map((p) => resolveToIndexedFile(p, fileSet)).filter(Boolean),
      importedBy: [],
      symbols:    extractSymbols(content),
    };
  }

  // Second pass: populate importedBy
  for (const [filePath, m] of Object.entries(meta)) {
    for (const imp of m.imports) {
      if (meta[imp]) meta[imp].importedBy.push(filePath);
    }
  }

  return meta;
}

// ── code slicing ─────────────────────────────────────────────────────────────

/** Merge overlapping line ranges after adding ±padding lines to each */
function mergeRanges(ranges, padding) {
  if (ranges.length === 0) return [];
  const padded = ranges.map(([s, e]) => [Math.max(1, s - padding), e + padding]);
  padded.sort((a, b) => a[0] - b[0]);
  const merged = [[...padded[0]]];
  for (let i = 1; i < padded.length; i++) {
    const last = merged[merged.length - 1];
    if (padded[i][0] <= last[1] + 1) {
      last[1] = Math.max(last[1], padded[i][1]);
    } else {
      merged.push([...padded[i]]);
    }
  }
  return merged;
}

/**
 * Given a file path and an array of chunks (each with startLine/endLine),
 * return the relevant code slices with ±padding line context, merging
 * overlapping ranges so function boundaries aren't cut.
 */
function getRelevantCode(filePath, chunks, padding = 40) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return null; }
  const lines      = content.split('\n');
  const totalLines = lines.length;
  const ranges     = chunks.map((c) => [c.startLine, c.endLine]);
  const merged     = mergeRanges(ranges, padding);

  return merged.map(([start, end]) => {
    const s = Math.max(1, start);
    const e = Math.min(totalLines, end);
    return `// lines ${s}–${e}\n` + lines.slice(s - 1, e).join('\n');
  }).join('\n\n// ───\n\n');
}

// ── math ──────────────────────────────────────────────────────────────────────
function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── re-ranking ────────────────────────────────────────────────────────────────
/**
 * Re-rank results using symbol and path signals from the index metadata.
 * score = cosine * 0.7 + symbolMatch * 0.2 + pathMatch * 0.1
 */
function rerank(results, query, filesMeta = {}) {
  const tokens = query.toLowerCase().split(/[\s\W]+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return results;

  return results.map((r) => {
    const pathLower    = r.path.replace(/\\/g, '/').toLowerCase();
    const symbols      = (filesMeta[r.path]?.symbols || []).map((s) => s.toLowerCase());
    const chunkLower   = r.text.toLowerCase();

    // symbolMatch: token found in known extracted symbols OR raw chunk text
    const symbolMatch = tokens.filter((t) =>
      symbols.some((s) => s.includes(t)) || chunkLower.includes(t)
    ).length / tokens.length;

    // pathMatch: any token appears in the file path
    const pathMatch = tokens.some((t) => pathLower.includes(t)) ? 1 : 0;

    return { ...r, score: r.score * 0.7 + symbolMatch * 0.2 + pathMatch * 0.1 };
  });
}

// ── query embedding cache ─────────────────────────────────────────────────────
// Keyed by "model:query" so cache is invalidated if the model changes.
const queryCache = new Map();
const CACHE_MAX  = 200; // evict oldest entries beyond this limit

function cacheGet(model, query) {
  return queryCache.get(`${model}:${query}`);
}

function cacheSet(model, query, embedding) {
  if (queryCache.size >= CACHE_MAX) {
    // Evict the oldest entry
    queryCache.delete(queryCache.keys().next().value);
  }
  queryCache.set(`${model}:${query}`, embedding);
}

// ── public API ─────────────────────────────────────────────────────────────────

/**
 * Build (or rebuild) the index for folderPath.
 * Also writes a companion .codelocal-meta.json with structural metadata.
 * onProgress(done, total, currentFilePath) is called for each chunk embedded.
 * Returns { count, files } on success; throws on error.
 */
async function buildIndex(folderPath, model, onProgress) {
  const ollama = new Ollama();
  const files  = walkFolder(folderPath);

  // Read all files, build chunks and collect content for metadata extraction
  const allChunks    = [];
  const fileContents = {};

  for (const f of files) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      fileContents[f] = content;
      allChunks.push(...chunkFile(f, content));
    } catch { /* skip unreadable */ }
  }

  if (allChunks.length === 0) {
    throw new Error('No text files found in folder.');
  }

  // Build and persist structural metadata before embedding starts
  const filesMeta = buildFileMeta(Object.keys(fileContents), fileContents);
  const metaPath  = path.join(folderPath, META_FILE);
  fs.writeFileSync(metaPath, JSON.stringify(filesMeta));

  // Signal that we're starting (model may take time to load)
  onProgress?.(0, allChunks.length, null);

  const embeddings = [];
  for (let i = 0; i < allChunks.length; i++) {
    const res = await ollama.embeddings({ model, prompt: allChunks[i].text });
    onProgress?.(i + 1, allChunks.length, allChunks[i].path);
    if (!res.embedding || res.embedding.length === 0) {
      throw new Error(`Model "${model}" returned no embedding. Try a different model or pull nomic-embed-text.`);
    }
    embeddings.push(res.embedding);
  }

  const index = {
    version:    2,
    model,
    built:      Date.now(),
    folderPath,
    chunks:     allChunks,
    embeddings,
  };

  const indexPath = path.join(folderPath, INDEX_FILE);
  fs.writeFileSync(indexPath, JSON.stringify(index));
  _indexCache = { path: indexPath, data: index }; // warm the cache immediately

  return { count: allChunks.length, files: files.length };
}

/**
 * Search the persisted index with a query string.
 * Returns { ok, results, filesMeta } or { ok: false, error }.
 * filesMeta is the structural metadata for the matched files only.
 */
async function searchIndex(folderPath, query, model, topK = 5, log) {
  const _log = log || (() => {});
  const t0 = Date.now();
  const indexPath = path.join(folderPath, INDEX_FILE);
  if (!fs.existsSync(indexPath)) {
    _log('[search] no index file found');
    return { ok: false, error: 'No index found. Click "Index folder" first.' };
  }

  let index;
  try {
    const cached = _indexCache?.path === indexPath;
    if (cached) {
      index = _indexCache.data;
    } else {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      _indexCache = { path: indexPath, data: index };
    }
    _log(`[search] index loaded (${cached ? 'cache' : 'disk'}): ${index.chunks.length} chunks, ${new Set(index.chunks.map(c => c.path)).size} files`);
  } catch {
    return { ok: false, error: 'Index file is corrupt. Re-index the folder.' };
  }

  // Load structural metadata if available (written alongside the index)
  let filesMeta = {};
  const metaPath = path.join(folderPath, META_FILE);
  try {
    if (fs.existsSync(metaPath)) filesMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch { /* non-fatal */ }

  let queryEmbedding = cacheGet(model, query);
  const embedCached = !!queryEmbedding;
  if (!queryEmbedding) {
    try {
      const ollama = new Ollama();
      const eStart = Date.now();
      const res    = await ollama.embeddings({ model, prompt: query });
      queryEmbedding = res.embedding;
      cacheSet(model, query, queryEmbedding);
      _log(`[search] query embedded in ${Date.now() - eStart}ms (dim=${queryEmbedding.length})`);
    } catch (err) {
      return { ok: false, error: `Embedding query failed: ${err.message}` };
    }
  } else {
    _log(`[search] query embedding cache hit`);
  }

  const scored = index.chunks.map((chunk, i) => ({
    path:      chunk.path,
    startLine: chunk.startLine,
    endLine:   chunk.endLine,
    text:      chunk.text,
    score:     cosineSim(queryEmbedding, index.embeddings[i]),
  }));

  const reranked = rerank(scored, query, filesMeta);
  reranked.sort((a, b) => b.score - a.score);
  const results = reranked.slice(0, topK);

  // Log all scored results (top 15 for visibility)
  const top15 = reranked.slice(0, 15);
  for (const r of top15) {
    const rel = path.relative(folderPath, r.path);
    const marker = results.includes(r) ? '★' : ' ';
    _log(`[search] ${marker} ${r.score.toFixed(4)} ${rel}:${r.startLine}-${r.endLine}`);
  }
  _log(`[search] done in ${Date.now() - t0}ms — returned top ${results.length}/${reranked.length} chunks`);

  // Return metadata only for matched files (keeps IPC payload small)
  const matchedMeta = {};
  for (const r of results) {
    if (filesMeta[r.path]) matchedMeta[r.path] = filesMeta[r.path];
  }

  return { ok: true, results, filesMeta: matchedMeta };
}

/**
 * Load the full structural metadata (all files) from the companion meta file.
 * Fast — no embeddings involved.
 */
function getFileMeta(folderPath) {
  const metaPath = path.join(folderPath, META_FILE);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Return metadata about the stored index without loading embeddings.
 */
function getIndexStatus(folderPath) {
  const indexPath = path.join(folderPath, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return { indexed: false };
  try {
    const raw = fs.readFileSync(indexPath, 'utf8');
    const { version, model, built, chunks } = JSON.parse(raw);
    return { indexed: true, version, model, built, chunkCount: chunks.length };
  } catch {
    return { indexed: false };
  }
}

// ── symbol finder ─────────────────────────────────────────────────────────────
/**
 * Find the first line number (1-indexed) where `name` is defined in filePath.
 * Matches: functions, classes, const/let/var assignments, export declarations,
 * and ipcMain.handle registrations (for IPC channel tracing).
 * Returns null if not found.
 */
function findSymbol(filePath, name) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return null; }
  const lines = content.split('\n');
  const esc = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  const patterns = [
    new RegExp(`\\bfunction\\s+${esc}\\s*\\(`),
    new RegExp(`\\bclass\\s+${esc}[\\s{(]`),
    new RegExp(`\\b(?:const|let|var)\\s+${esc}\\s*=`),
    new RegExp(`\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function|class)\\s+${esc}`),
    new RegExp(`ipcMain\\.handle\\s*\\(\\s*['"]${esc}['"]`),
  ];
  for (let i = 0; i < lines.length; i++) {
    for (const re of patterns) {
      if (re.test(lines[i])) return i + 1;
    }
  }
  return null;
}

module.exports = { buildIndex, searchIndex, getIndexStatus, getFileMeta, getRelevantCode, findSymbol };
