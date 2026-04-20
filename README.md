# viber

> total vibe coded nonsense, works rlly well with gemma

A local AI coding assistant built on Electron + Ollama. Point it at a folder, pick a model, and chat with your codebase — reads files, writes edits, runs searches, all on your machine with no cloud.

![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react) ![Ollama](https://img.shields.io/badge/Ollama-local-black) ![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **Agentic code editing** — the model reads files, searches the codebase, and writes targeted line-range edits
- **Multi-model** — works with any Ollama model; tested on Gemma 4b/27b, Qwen2.5-Coder, Qwen3-Coder, Mistral
- **Plan mode** — outlines proposed changes before touching a single file; reply "go" to execute
- **Auto-apply** — optionally applies edits automatically with syntax validation and retry on failure
- **RAG search** — semantic codebase search via `nomic-embed-text` embeddings
- **Integrated terminal** — run shell commands without leaving the app
- **Chat history** — SQLite-backed sessions grouped by project
- **Git status** — branch, dirty indicator, ahead/behind in the title bar
- **Web search** — SearXNG-based search for docs and current info (chat mode)
- **Settings** — tune temperature, context length, top-p/k; custom Ollama URL

---

## Requirements

- [Node.js](https://nodejs.org) 18+
- [Ollama](https://ollama.com) running locally

---

## Getting Started

```bash
# Install dependencies
npm install

# Pull a model (recommended starting points)
ollama pull qwen2.5-coder:14b
ollama pull gemma3:4b

# Start in dev mode
npm start
```

### Usage

1. Click **Open folder** and select a code project
2. Pick a model from the dropdown
3. Ask anything — the model will explore your code and propose edits
4. Review edit blocks inline and click **Apply**, or enable **Auto-apply** for hands-free mode
5. Use **Plan mode** to get a full plan before any files are touched

---

## Building

```bash
npm run make
```

Output goes to `out/`. Produces installers for your current platform (Squirrel on Windows, zip on macOS/Linux).

---

## Architecture

```
src/
├── main.js              # Electron main process — IPC handlers, Ollama, tools, file I/O
├── preload.js           # contextBridge: exposes window.api.* to renderer
├── renderer.jsx         # React entry point
├── App.jsx              # Root component — layout, state, chat orchestration
├── chatStore.js         # SQLite: sessions, messages, projects
├── indexer.js           # RAG indexing, embedding, cosine scoring, re-ranking
├── hooks/
│   └── useChat.js       # Chat state, streaming, system prompts
├── lib/
│   └── parseEditBlocks.js
├── components/
│   ├── Message.jsx      # Renders assistant messages, edit blocks, thinking
│   ├── ChatInput.jsx    # Textarea + toolbar (model picker, plan/auto/web toggles)
│   ├── Terminal.jsx     # Embedded terminal panel
│   ├── Settings.jsx     # Model params + Ollama URL
│   ├── Library.jsx      # Chat history + project browser
│   ├── CommandPalette.jsx
│   ├── TitleBar.jsx     # Title bar with git badge + mode toggle
│   └── Sidebar.jsx      # Icon rail
└── styles.js            # All styles (no CSS files)
```

### Tool loop

The agent runs up to 12 iterations. Each iteration the model either calls a tool or produces a final answer. Tools available:

| Tool | Description |
|---|---|
| `list_files` | Walk the open folder |
| `read_file` | Read a file (line-numbered for accurate edits) |
| `grep` | Regex search across files |
| `search_code` | Semantic search via embeddings |
| `run_bash` | Run a shell command (PowerShell on Windows) |
| `web_search` | SearXNG web search |

### RAG indexing (`indexer.js`)

`search_code` is backed by a local embedding index built from the open folder.

**Indexing pipeline:**
1. Walk folder (up to 200 files, skipping `node_modules` / `dist` / etc.)
2. Chunk each file into 30-line windows with 5-line overlap
3. Embed each chunk via `ollama.embeddings({ model: 'nomic-embed-text' })`
4. Persist embeddings to `.codelocal-index.json` inside the folder
5. Extract structural metadata (imports, `importedBy`, symbols) into `.codelocal-meta.json`

**Search pipeline:**
1. Embed the query (cached per `model:query` key, up to 200 entries)
2. Cosine similarity against all stored chunk embeddings
3. Re-rank with symbol and path signals:
   ```
   final_score = cosine × 0.7 + symbol_match × 0.2 + path_match × 0.1
   ```
   - `symbol_match` — fraction of query tokens found in extracted symbols or chunk text
   - `path_match` — any query token appears in the file path
4. Return top-K chunks with merged ±40-line context windows

The index is loaded once into memory and cached; subsequent searches skip disk I/O entirely.

### Multi-model tool call support

Different models emit tool calls in different formats — all are handled:

| Model family | Format |
|---|---|
| Gemma | `<tool_call>{…}</tool_call>` |
| Qwen2.5-Coder | Raw JSON `{"name":"…","arguments":{}}` |
| Qwen3-Coder | `<function=name>{…}</function>` |
| Native (Ollama) | `msg.tool_calls` array |

---

## Configuration

Settings are persisted to `localStorage`:

| Key | Default | Description |
|---|---|---|
| `codelocal-model-opts` | `{temperature:1, num_ctx:32768, top_p:0.95, top_k:64}` | Model parameters |
| `codelocal-ollama-url` | `http://localhost:11434` | Ollama host |
| `codelocal-autoapply` | `false` | Auto-apply edits |
| `codelocal-mode` | `code` | Default mode (code / chat) |
| `codelocal-term-h` | `240` | Terminal panel height |

---

## License

MIT
