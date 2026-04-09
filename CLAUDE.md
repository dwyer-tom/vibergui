# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

**codelocal** is an Electron desktop app that acts as a local AI coding assistant. It lets the user point at a folder of code, select a file, and chat with a locally-running Ollama model (e.g. Gemma 4b) to read and edit that code. The AI responds with `<edit path="...">full file content</edit>` blocks which the user can apply directly to disk.

## Commands

```bash
npm start        # Run in dev mode (hot-reload via Webpack, DevTools auto-open)
npm run make     # Package the app into a distributable
```

No test runner or linter is configured.

## Architecture

The app is Electron with a React renderer. All source is in `src/`.

### Process boundary

- **`src/main.js`** — Electron main process. Handles all Node/filesystem/Ollama work via `ipcMain.handle`. IPC channels: `pick-folder`, `read-file`, `write-file`, `list-files`, `run-bash`, `chat`, `ollama-models`. The `chat` channel streams tokens back to the renderer via `webContents.send('chat-token')` / `chat-done`.
- **`src/preload.js`** — Bridges main↔renderer via `contextBridge`, exposing `window.api.*` methods. This is the only way the renderer talks to Node.
- **`src/renderer.jsx`** — Entry point that mounts React into `index.html`.
- **`src/App.jsx`** — The entire React UI. Single file, ~720 lines.

### App.jsx internals

| Piece | Purpose |
|---|---|
| `useChat()` hook | Manages message history, streams tokens from Ollama, builds the prompt sent to the model |
| `Sidebar` + `TreeNode` | File browser; clicking a file sets it as the "active file" |
| `parseEditBlocks()` | Parses `<edit path="...">...</edit>` out of AI responses |
| `EditBlock` / `EditsDropup` | UI to preview and apply parsed edits to disk via `window.api.writeFile` |
| `styles` object | All styles inline at the bottom of the file — no CSS files |

### How the AI prompt is built (inside `useChat.send`)

1. The active file's full content is read fresh from disk in `handleSend` and passed in.
2. A system prompt instructs the model to respond with only `<edit>` blocks when making changes.
3. The active file content + paths of other loaded files + user message are joined into the user turn.
4. Full conversation history is included on every request.

### File loading

`loadFiles()` walks the selected folder (skipping `node_modules`, `.git`, `.webpack`, etc.), filters to known text extensions, loads up to 50 files, and caps each at **4000 chars**. The active file is re-read fresh (no cap) at send time.

### IPC for Ollama streaming

Main process uses `ollama.chat({ stream: true })` and forwards each chunk via `webContents.send('chat-token', { text })`. The renderer listens with `window.api.onChatToken` and appends to the last assistant message in state. Listeners are cleared with `window.api.offChatListeners()` before each new request to prevent duplicates.
