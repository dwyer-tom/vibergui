# Contributing to viber

Thanks for your interest! viber is a vibe-coded Electron app — contributions of any size are welcome.

## Setup

```bash
git clone https://github.com/dwyer-tom/vibergui.git
cd vibergui
npm install
ollama pull qwen2.5-coder:14b   # or any model you prefer
npm start
```

That's it. Hot-reload is enabled — changes to `src/` reflect immediately without restarting.

## Project structure

```
src/
├── main.js          # Electron main process — all Node/file/Ollama work happens here
├── preload.js       # Exposes window.api.* to the renderer via contextBridge
├── App.jsx          # Root React component
├── hooks/useChat.js # Chat state + system prompts
├── indexer.js       # RAG indexing + semantic search
├── chatStore.js     # SQLite-backed chat history
└── components/      # UI components
```

The renderer can only talk to Node via `window.api.*` (defined in `preload.js`). Any new Node/filesystem functionality needs a new `ipcMain.handle` in `main.js` and a matching entry in `preload.js`.

## How to contribute

1. **Pick an issue** — look for [`good first issue`](https://github.com/dwyer-tom/vibergui/issues?q=is%3Aopen+label%3A%22good+first+issue%22) to start
2. **Fork + branch** — `git checkout -b your-feature`
3. **Make your change** — keep PRs focused on one thing
4. **Test it** — run `npm start` and verify it works end-to-end with a real Ollama model
5. **Open a PR** — describe what you changed and why

## Guidelines

- **No linter/tests** are configured yet — just make sure it runs
- Keep inline styles consistent with `src/styles.js` (no CSS files)
- New IPC channels go in `main.js` + `preload.js` — keep the renderer sandboxed
- If adding a new dependency, prefer pure-JS packages (native modules cause packaging headaches)
- Small focused PRs are easier to review than large ones

## Ideas for contributions

See the [open issues](https://github.com/dwyer-tom/vibergui/issues) — some good starting points:

- New model support / tool call format parsers
- UI improvements
- macOS / Linux packaging
- Bug fixes

## Questions?

Open an issue or start a discussion — happy to help you get oriented.
