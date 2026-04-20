const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  osUser:       process.env.USERNAME || process.env.USER || 'user',
  pickFolder:   ()              => ipcRenderer.invoke('pick-folder'),
  readFile:     (p)             => ipcRenderer.invoke('read-file', p),
  writeFile:    (p, c)          => ipcRenderer.invoke('write-file', p, c),
  applyEdit:    (p, hunks)      => ipcRenderer.invoke('apply-edit', p, hunks),
  listFiles:    (p)             => ipcRenderer.invoke('list-files', p),
  indexFolder:  (folder, model) => ipcRenderer.invoke('index-folder', { folderPath: folder, model }),
  indexStatus:  (folder)        => ipcRenderer.invoke('index-status', folder),
  runBash:      (cmd, cwd)      => ipcRenderer.invoke('run-bash', cmd, cwd),
  gitInfo:      (folder)        => ipcRenderer.invoke('git-info', folder),
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

  history: {
    list:   (opts)             => ipcRenderer.invoke('history-list', opts),
    load:   (id)               => ipcRenderer.invoke('history-load', id),
    create: (opts)             => ipcRenderer.invoke('history-create', opts),
    rename: (id, title)        => ipcRenderer.invoke('history-rename', { id, title }),
    remove: (id)               => ipcRenderer.invoke('history-delete', id),
    move:   (sessionId, projectId) => ipcRenderer.invoke('history-move', { sessionId, projectId }),
    append: (sessionId, message) => ipcRenderer.invoke('history-append', { sessionId, message }),
    search: (query, opts)      => ipcRenderer.invoke('history-search', { query, ...(opts || {}) }),
  },

  projects: {
    list:      ()             => ipcRenderer.invoke('projects-list'),
    create:    (name, folder) => ipcRenderer.invoke('projects-create', { name, folder }),
    rename:    (id, name)     => ipcRenderer.invoke('projects-rename', { id, name }),
    setFolder: (id, folder)   => ipcRenderer.invoke('projects-set-folder', { id, folder }),
    remove:    (id)           => ipcRenderer.invoke('projects-delete', id),
  },
});
