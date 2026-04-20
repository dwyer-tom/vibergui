import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from './hooks/useChat';
import { parseEditBlocks } from './lib/parseEditBlocks';
import { TitleBar } from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Terminal from './components/Terminal';
import Settings, { loadModelOpts, loadOllamaUrl } from './components/Settings';
import ChatInput from './components/ChatInput';
import Message from './components/Message';
import DiffPanel from './components/DiffPanel';
import CommandPalette from './components/CommandPalette';
import Library from './components/Library';
import styles from './styles';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const getPrompt = () => {
  const h = new Date().getHours();
  if (h >= 22 || h < 5) return pick(['burning the midnight oil?', 'still up?', 'late night session?']);
  if (h < 12)           return pick(['what are we shipping today?', 'morning grind?', 'coffee and code?']);
  if (h < 18)           return pick(['what are we building?', 'deep in it?', 'making progress?']);
  return pick(['still hacking?', 'evening session?', 'one more feature?']);
};

const LANDING_CHIPS = [
  { label: 'Explain this folder', prefill: 'Give me a tour of this codebase.' },
  { label: 'Find bugs',           prefill: 'Scan for likely bugs or smells.' },
  { label: 'Write tests',         prefill: 'Write tests for the most important untested code.' },
  { label: 'Refactor',            prefill: 'Suggest refactors that would most improve readability.' },
];

export default function App() {
  const [folder, setFolder] = useState(() => localStorage.getItem('codelocal-folder') || null);
  const [activeProjectId, setActiveProjectIdState] = useState(() => {
    const raw = localStorage.getItem('codelocal-active-project');
    if (!raw || raw === 'null') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  });
  const [projects, setProjects] = useState([]);
  const [recentFolders, setRecentFolders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('codelocal-recent') || '[]'); } catch { return []; }
  });
  const [files, setFiles] = useState([]);
  const [model, setModel] = useState('');
  const [ollamaModels, setOllamaModels] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [planMode, setPlanMode] = useState(false);
  const [chatMode, setChatModeState] = useState(() => localStorage.getItem('codelocal-mode') || 'code');
  const setChatMode = useCallback((m) => {
    setChatModeState(m);
    localStorage.setItem('codelocal-mode', m);
    setLibraryOpen(false);
  }, []);
  const [activeDiff, setActiveDiff] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteSessions, setPaletteSessions] = useState([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [indexing, setIndexing] = useState(null); // null | { done, total }
  const [prefill, setPrefill] = useState('');
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gitInfo, setGitInfo] = useState(null);
  const { messages, streaming, send, stop, reset, sessionId, loadSession } = useChat();
  const [autoApply, setAutoApply] = useState(() => localStorage.getItem('codelocal-autoapply') === 'true');
  const [webSearch, setWebSearchState] = useState(() => localStorage.getItem('codelocal-websearch') === 'true');
  const setWebSearch = useCallback((v) => {
    setWebSearchState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      localStorage.setItem('codelocal-websearch', String(next));
      return next;
    });
  }, []);
  const bottomRef = useRef(null);
  const messagesRef = useRef(null);
  const userScrolled = useRef(false);
  const appliedMsgsRef = useRef(new Set()); // track which messages we already auto-applied
  const retryCountRef = useRef(0); // track consecutive auto-apply failures

  useEffect(() => {
    if (!userScrolled.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (!streaming) userScrolled.current = false;
  }, [streaming]);

  // Ctrl/Cmd+K opens command palette
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Load sessions for command palette when it opens
  useEffect(() => {
    if (!paletteOpen) return;
    (async () => {
      const res = await window.api.history.list({});
      if (res?.ok) setPaletteSessions(res.sessions);
    })();
  }, [paletteOpen, sessionId]);

  // Ctrl+Shift+A toggles auto-apply
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        setAutoApply((prev) => {
          const next = !prev;
          localStorage.setItem('codelocal-autoapply', String(next));
          return next;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Auto-apply edits when streaming finishes
  useEffect(() => {
    if (streaming || !autoApply || messages.length === 0 || chatMode === 'chat') return;
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant' || !last.content) return;
    // Use message index as identity to avoid re-applying
    const msgId = messages.length - 1;
    if (appliedMsgsRef.current.has(msgId)) return;

    const parts = parseEditBlocks(last.content);
    const allEdits = parts.filter((p) => p.type === 'edit');
    if (allEdits.length === 0) return;
    // Deduplicate edits targeting the same file+lines
    const seen = new Set();
    const edits = allEdits.filter(e => {
      const key = `${e.path}:${e.startLine}-${e.endLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    appliedMsgsRef.current.add(msgId);

    (async () => {
      for (const edit of edits) {
        let res;
        if (edit.startLine != null && edit.endLine != null) {
          res = await window.api.applyEdit(edit.path, { startLine: edit.startLine, endLine: edit.endLine, replacement: edit.fullContent });
        } else if (edit.fullContent !== null && edit.hunks.length === 0) {
          res = await window.api.writeFile(edit.path, edit.fullContent);
        } else {
          res = await window.api.applyEdit(edit.path, edit.hunks);
        }
        if (!res.ok) {
          retryCountRef.current += 1;
          if (retryCountRef.current >= 2) {
            retryCountRef.current = 0;
            // Stop retrying — let the user handle it
            return;
          }
          const lineInfo = edit.startLine != null ? ` (lines ${edit.startLine}-${edit.endLine})` : '';
          const retryMsg = `Auto-apply failed for ${edit.path}${lineInfo}: ${res.error}\n\nPlease use read_file to check the current file content, then fix the edit with correct line numbers.`;
          send(retryMsg, { model, activeFile: null, activeFileContent: null, intent: 'agent', think: true, hidden: true, folder, projectId: activeProjectId });
          return;
        }
        retryCountRef.current = 0; // reset on success
      }
    })();
  }, [streaming, messages, autoApply, chatMode]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    userScrolled.current = !atBottom;
  }, []);

  useEffect(() => {
    window.api.ollamaModels().then((models) => {
      setOllamaModels(models);
      if (models.length) setModel(models[0]);
    });
  }, []);

  const refreshProjects = useCallback(async () => {
    const res = await window.api.projects.list();
    if (res?.ok) setProjects(res.projects);
  }, []);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  const setActiveProjectId = useCallback((id) => {
    setActiveProjectIdState(id);
    localStorage.setItem('codelocal-active-project', id == null ? 'null' : String(id));
    // Bind project folder into workspace folder if project has one
    if (id != null) {
      const p = projects.find((x) => x.id === id);
      if (p?.folder && p.folder !== folder) {
        applyFolder(p.folder);
      }
    }
  }, [projects, folder]);

  // Git info — fetch on folder change, poll every 5s
  useEffect(() => {
    if (!folder) { setGitInfo(null); return; }
    const refresh = () => window.api.gitInfo(folder).then(info => setGitInfo(info?.ok ? info : null));
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [folder]);

  // Restore folder on startup — load file list for sidebar only
  useEffect(() => {
    if (!folder) return;
    loadFiles(folder);
    startWatching(folder);
    triggerIndexing(folder);
  }, []);

  const loadFiles = async (targetFolder) => {
    const f = targetFolder ?? folder;
    if (!f) return;
    const paths = await window.api.listFiles(f);
    const TEXT_EXT = /\.(js|jsx|ts|tsx|py|rs|go|java|c|cpp|h|hpp|cs|rb|php|sh|md|txt|json|toml|yaml|yml|sql|html|css|scss)$/i;
    const EXCLUDE = /package-lock\.json|yarn\.lock|pnpm-lock\.yaml/i;
    const filtered = paths.filter((p) => TEXT_EXT.test(p) && !EXCLUDE.test(p)).slice(0, 200);
    // Only store paths — content is read by Gemma via tools at query time
    setFiles(filtered.map((path) => ({ path })));
  };

  const saveRecent = (f) => {
    const updated = [f, ...recentFolders.filter((r) => r !== f)].slice(0, 5);
    setRecentFolders(updated);
    localStorage.setItem('codelocal-recent', JSON.stringify(updated));
  };

  const triggerIndexing = async (f) => {
    try {
      const status = await window.api.indexStatus(f);
      if (status.indexed && (Date.now() - status.built) < 3600000) return;
      setIndexing({ done: 0, total: 0 });
      window.api.offIndexingListeners();
      window.api.onIndexingProgress(({ done, total, file }) => {
        if (file === null) setIndexing(null);
        else setIndexing({ done, total });
      });
      await window.api.indexFolder(f, 'nomic-embed-text');
    } catch {
      setIndexing(null);
    }
  };

  const applyFolder = async (f) => {
    localStorage.setItem('codelocal-folder', f);
    saveRecent(f);
    setFolder(f);
    setFiles([]);
    await loadFiles(f);
    startWatching(f);
    triggerIndexing(f); // fire-and-forget, non-blocking
  };

  const pickFolder = async () => {
    const f = await window.api.pickFolder();
    if (!f) return;
    applyFolder(f);
    if (activeProjectId != null) {
      await window.api.projects.setFolder(activeProjectId, f);
      refreshProjects();
    }
  };

  const startWatching = (f) => {
    window.api.offFolderChanged();
    window.api.watchFolder(f);
    window.api.onFolderChanged(() => loadFiles(f));
  };

  const handleSend = async (text) => {
    const activeFileContent = activeFile
      ? (await window.api.readFile(activeFile))?.content ?? null
      : null;

    // "go" dismisses plan mode and switches to agent_edit prompt
    const isGo = text.trim().toLowerCase() === 'go';
    if (isGo) setPlanMode(false);

    send(text, {
      model,
      activeFile,
      activeFileContent,
      intent: isGo ? 'go' : 'agent',
      think: true,
      planMode: isGo ? false : planMode,
      chatMode,
      webSearch,
      folder,
      projectId: activeProjectId,
      modelOptions: loadModelOpts(),
      ollamaUrl: loadOllamaUrl(),
    });
  };

  const handleRetryEdit = (edit, error) => {
    const lineInfo = edit.startLine != null ? ` (lines ${edit.startLine}-${edit.endLine})` : '';
    handleSend(`The edit to ${edit.path}${lineInfo} failed with: ${error}\n\nPlease read the file again and fix the edit.`);
  };

  const handleAcceptPlan = async () => {
    setPlanMode(false);
    const activeFileContent = activeFile
      ? (await window.api.readFile(activeFile))?.content ?? null
      : null;
    send('Implement the plan now.', {
      model,
      activeFile,
      activeFileContent,
      intent: 'go',
      think: true,
      planMode: false,
      folder,
      projectId: activeProjectId,
      modelOptions: loadModelOpts(),
      ollamaUrl: loadOllamaUrl(),
    });
  };

  const handleDeclinePlan = () => {
    handleSend('I want to change the plan. Let me explain what I want differently.');
  };

  const handleNewChat = () => { reset(); setActiveFile(null); };

  return (
    <div style={styles.shell}>
      <TitleBar folder={folder} onPickFolder={pickFolder} onNewChat={handleNewChat} indexing={indexing} chatMode={chatMode} setChatMode={setChatMode} gitInfo={gitInfo} />
      <div style={styles.titleBarBorder} />
      <div style={styles.root}>
        <Sidebar
          onNewChat={handleNewChat}
          onPickFolder={pickFolder}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          onOpenLibrary={() => setLibraryOpen(true)}
          libraryOpen={libraryOpen}
          terminalOpen={terminalOpen}
          onToggleTerminal={() => setTerminalOpen(o => !o)}
          settingsOpen={settingsOpen}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div style={styles.main}>
          {settingsOpen ? (
            <Settings onClose={() => setSettingsOpen(false)} />
          ) : libraryOpen ? (
            <Library
              onLoadSession={loadSession}
              onNewChat={handleNewChat}
              onClose={() => setLibraryOpen(false)}
              currentSessionId={sessionId}
              activeProjectId={activeProjectId}
              onSetActiveProject={setActiveProjectId}
              projects={projects}
              onProjectsChanged={refreshProjects}
              onOpenCommandPalette={() => setPaletteOpen(true)}
              folderName={folder ? folder.split(/[\\/]/).pop() : null}
            />
          ) : messages.length === 0 ? (
            <div style={styles.landing}>
              <div style={styles.landingHeader}>
                <div style={styles.landingKicker}>
                  ~ codelocal // {folder ? folder.split(/[\\/]/).pop() : 'no folder'}
                </div>
                <div style={styles.landingGreeting}>
                  <span style={styles.landingCaret}>›</span>
                  hey {window.api.osUser}, {getPrompt()}
                </div>
              </div>
              <div style={styles.landingInputWrap}>
                <ChatInput
                  onSend={handleSend} onStop={stop} streaming={streaming}
                  model={model} ollamaModels={ollamaModels} setModel={setModel}
                  folder={folder} recentFolders={recentFolders} onPickFolder={pickFolder} onSelectFolder={applyFolder}
                  planMode={planMode} setPlanMode={setPlanMode}
                  autoApply={autoApply} setAutoApply={setAutoApply}
                  chatMode={chatMode} webSearch={webSearch} setWebSearch={setWebSearch}
                  indexing={indexing}
                  prefillText={prefill}
                />
              </div>
              <div style={styles.landingChips}>
                {chatMode !== 'chat' && LANDING_CHIPS.map((c) => (
                  <button
                    key={c.label}
                    style={{ ...styles.landingChip, ...(folder ? null : styles.landingChipDisabled) }}
                    disabled={!folder}
                    onClick={() => setPrefill(c.prefill + '\u200b'.repeat(((prefill.match(/\u200b/g) || []).length) + 1))}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div ref={messagesRef} style={styles.messages} onScroll={handleMessagesScroll}>
                {messages.map((m, i) => (
                  <Message
                    key={i} msg={m}
                    isThinking={streaming && m.role === 'assistant' && m.content === '' && i === messages.length - 1}
                    isStreaming={streaming && m.role === 'assistant' && i === messages.length - 1}
                    showCopy={!streaming || i < messages.length - 1}
                    onAcceptPlan={!streaming ? handleAcceptPlan : undefined}
                    onDeclinePlan={!streaming ? handleDeclinePlan : undefined}
                  />
                ))}
                <div ref={bottomRef} />
              </div>

              <ChatInput
                onSend={handleSend} onStop={stop} streaming={streaming}
                model={model} ollamaModels={ollamaModels} setModel={setModel}
                folder={folder} recentFolders={recentFolders} onPickFolder={pickFolder} onSelectFolder={applyFolder}
                planMode={planMode} setPlanMode={setPlanMode}
                autoApply={autoApply} setAutoApply={setAutoApply}
                chatMode={chatMode} webSearch={webSearch} setWebSearch={setWebSearch}
                indexing={indexing}
              />
            </>
          )}
          {terminalOpen && (
            <Terminal folder={folder} onClose={() => setTerminalOpen(false)} />
          )}
        </div>
      </div>
      {activeDiff && <DiffPanel edit={activeDiff} onClose={() => setActiveDiff(null)} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sessions={paletteSessions}
        projects={projects}
        currentSessionId={sessionId}
        activeProjectId={activeProjectId}
        onLoadSession={loadSession}
        onNewChat={handleNewChat}
        onSetActiveProject={setActiveProjectId}
      />
    </div>
  );
}
