const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder:   ()              => ipcRenderer.invoke('pick-folder'),
  readFile:     (p)             => ipcRenderer.invoke('read-file', p),
  writeFile:    (p, c)          => ipcRenderer.invoke('write-file', p, c),
  applyEdit:    (p, hunks)      => ipcRenderer.invoke('apply-edit', p, hunks),
  sliceFile:    (p, chunks)     => ipcRenderer.invoke('slice-file', p, chunks),
  findSymbols:  (queries)       => ipcRenderer.invoke('find-symbols', queries),
  listFiles:    (p)             => ipcRenderer.invoke('list-files', p),
  runBash:      (cmd, cwd)      => ipcRenderer.invoke('run-bash', cmd, cwd),
  chat:         (opts)          => ipcRenderer.invoke('chat', opts),
  abortChat:    ()              => ipcRenderer.invoke('chat-abort'),
  ollamaModels: ()              => ipcRenderer.invoke('ollama-models'),

  // RAG indexing
  indexStatus:  (folder)                       => ipcRenderer.invoke('index-status', folder),
  getFileMeta:  (folder)                       => ipcRenderer.invoke('get-file-meta', folder),
  indexFolder:  (folder, model)                => ipcRenderer.invoke('index-folder', { folderPath: folder, model }),
  searchIndex:  (folder, query, model, topK)   => ipcRenderer.invoke('search-index', { folderPath: folder, query, model, topK }),
  watchFolder:  (folder)                       => ipcRenderer.invoke('watch-folder', folder),
  onFolderChanged: (cb) => ipcRenderer.on('folder-changed', () => cb()),
  offFolderChanged: () => ipcRenderer.removeAllListeners('folder-changed'),

  onChatToken: (cb) => {
    ipcRenderer.on('chat-token', (_e, delta) => cb(delta));
  },
  onChatDone: (cb) => {
    ipcRenderer.on('chat-done', (_e, msg) => cb(msg));
  },
  onChatTool: (cb) => {
    ipcRenderer.on('chat-tool', (_e, data) => cb(data));
  },
  offChatListeners: () => {
    ipcRenderer.removeAllListeners('chat-token');
    ipcRenderer.removeAllListeners('chat-done');
    ipcRenderer.removeAllListeners('chat-tool');
  },

  onIndexingProgress: (cb) => {
    ipcRenderer.on('indexing-progress', (_e, data) => cb(data));
  },
  offIndexingListeners: () => {
    ipcRenderer.removeAllListeners('indexing-progress');
  },
});
