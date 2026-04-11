const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder:   ()              => ipcRenderer.invoke('pick-folder'),
  readFile:     (p)             => ipcRenderer.invoke('read-file', p),
  writeFile:    (p, c)          => ipcRenderer.invoke('write-file', p, c),
  applyEdit:    (p, hunks)      => ipcRenderer.invoke('apply-edit', p, hunks),
  listFiles:    (p)             => ipcRenderer.invoke('list-files', p),
  indexFolder:  (folder, model) => ipcRenderer.invoke('index-folder', { folderPath: folder, model }),
  indexStatus:  (folder)        => ipcRenderer.invoke('index-status', folder),
  runBash:      (cmd, cwd)      => ipcRenderer.invoke('run-bash', cmd, cwd),
  chat:         (opts)          => ipcRenderer.invoke('chat', opts),
  abortChat:    ()              => ipcRenderer.invoke('chat-abort'),
  ollamaModels: ()              => ipcRenderer.invoke('ollama-models'),

  watchFolder:  (folder)                       => ipcRenderer.invoke('watch-folder', folder),
  onFolderChanged: (cb) => ipcRenderer.on('folder-changed', () => cb()),
  offFolderChanged: () => ipcRenderer.removeAllListeners('folder-changed'),

  onChatToken: (cb) => {
    ipcRenderer.on('chat-token', (_e, delta) => cb(delta));
  },
  onChatDone: (cb) => {
    ipcRenderer.on('chat-done', (_e, msg) => cb(msg));
  },
  offChatListeners: () => {
    ipcRenderer.removeAllListeners('chat-token');
    ipcRenderer.removeAllListeners('chat-done');
    ipcRenderer.removeAllListeners('chat-tool-call');
    ipcRenderer.removeAllListeners('chat-tool-result');
  },
  onToolCall:   (cb) => ipcRenderer.on('chat-tool-call',   (_e, d) => cb(d)),
  onToolResult: (cb) => ipcRenderer.on('chat-tool-result', (_e, d) => cb(d)),

  onIndexingProgress: (cb) => ipcRenderer.on('indexing-progress', (_e, d) => cb(d)),
  offIndexingListeners: () => ipcRenderer.removeAllListeners('indexing-progress'),

  onDebugLog: (cb) => ipcRenderer.on('debug-log', (_e, d) => cb(d)),
  offDebugLog: () => ipcRenderer.removeAllListeners('debug-log'),
});
