/**
 * test-indexer.js — standalone test for the RAG indexer
 *
 * Run with:  node test-indexer.js [model]
 *
 * It indexes this project's own src/ folder, then runs a few searches
 * and prints results. Requires Ollama to be running locally.
 *
 * If no model is given, defaults to the first one listed by Ollama.
 */

const path = require('path');
const { Ollama } = require('ollama');
const { buildIndex, searchIndex, getIndexStatus } = require('./src/indexer');

const FOLDER = path.join(__dirname, 'src');

async function pickModel(requested) {
  if (requested) return requested;
  const ollama = new Ollama();
  const { models } = await ollama.list();
  if (!models.length) throw new Error('No Ollama models found — is Ollama running?');
  return models[0].name;
}

function hr(label) {
  console.log('\n' + '─'.repeat(60));
  if (label) console.log(' ' + label);
  console.log('─'.repeat(60));
}

async function run() {
  const model = await pickModel(process.argv[2]);
  console.log(`\nModel: ${model}`);
  console.log(`Folder: ${FOLDER}\n`);

  // ── 1. Check status before indexing ────────────────────────────────────────
  hr('1. Status before indexing');
  const before = getIndexStatus(FOLDER);
  console.log(JSON.stringify(before, null, 2));

  // ── 2. Build index ──────────────────────────────────────────────────────────
  hr('2. Building index…');
  let lastFile = '';
  const result = await buildIndex(FOLDER, model, (done, total, file) => {
    if (file !== lastFile) {
      process.stdout.write(`  [${done + 1}/${total}] ${path.basename(file)}\n`);
      lastFile = file;
    }
  });
  console.log(`\nDone: ${result.count} chunks across ${result.files} files.`);

  // ── 3. Check status after indexing ─────────────────────────────────────────
  hr('3. Status after indexing');
  const after = getIndexStatus(FOLDER);
  console.log(JSON.stringify(after, null, 2));

  // ── 4. Run searches ─────────────────────────────────────────────────────────
  const queries = [
    'streaming tokens from Ollama chat',
    'cosine similarity embedding',
    'parse edit blocks from AI response',
  ];

  for (const q of queries) {
    hr(`Search: "${q}"`);
    const res = await searchIndex(FOLDER, q, model, 3);
    if (!res.ok) {
      console.log('ERROR:', res.error);
      continue;
    }
    for (const r of res.results) {
      console.log(`  score=${r.score.toFixed(4)}  ${path.basename(r.path)}:${r.startLine}-${r.endLine}`);
    }
  }

  console.log('\nAll tests passed.\n');
}

run().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
