import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from './hooks/useChat';
import { parseEditBlocks } from './lib/parseEditBlocks';
import { TitleBar } from './components/TitleBar';
import Sidebar from './components/Sidebar';
import ChatInput from './components/ChatInput';
import Message from './components/Message';
import DiffPanel from './components/DiffPanel';
import styles from './styles';

export default function App() {
  const [folder, setFolder] = useState(() => localStorage.getItem('codelocal-folder') || null);
  const [recentFolders, setRecentFolders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('codelocal-recent') || '[]'); } catch { return []; }
  });
  const [files, setFiles] = useState([]);
  const [model, setModel] = useState('');
  const [ollamaModels, setOllamaModels] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [planMode, setPlanMode] = useState(false);
  const [activeDiff, setActiveDiff] = useState(null);
  const [indexing, setIndexing] = useState(null); // null | { done, total }
  const { messages, streaming, send, stop, reset } = useChat();
  const [autoApply, setAutoApply] = useState(() => localStorage.getItem('codelocal-autoapply') === 'true');
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
    if (streaming || !autoApply || messages.length === 0) return;
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
          send(retryMsg, { model, activeFile: null, activeFileContent: null, intent: 'agent', think: true, hidden: true });
          return;
        }
        retryCountRef.current = 0; // reset on success
      }
    })();
  }, [streaming, messages, autoApply]);

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
    if (f) applyFolder(f);
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
    });
  };

  const handleDeclinePlan = () => {
    handleSend('I want to change the plan. Let me explain what I want differently.');
  };

  const handleNewChat = () => { reset(); setActiveFile(null); };

  return (
    <div style={styles.shell}>
      <TitleBar folder={folder} onPickFolder={pickFolder} onNewChat={handleNewChat} indexing={indexing} />
      <div style={styles.titleBarBorder} />
      <div style={styles.root}>
        <Sidebar
          onNewChat={handleNewChat}
          onPickFolder={pickFolder}
          messages={messages}
        />

        <div style={styles.main}>
          <div ref={messagesRef} style={styles.messages} onScroll={handleMessagesScroll}>
            {messages.length === 0 && (
              <div style={styles.empty}>
                <svg width="100%" viewBox="0 0 680 500" role="img" style={{ maxWidth: 340, marginBottom: 16, opacity: 0.7 }}>
                  <title>Cartoon dog sitting at a computer</title>
                  <style>{`.line{fill:none;stroke:#b8b4ac;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.body{fill:#ede9e2;stroke:#b8b4ac;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.ear{fill:#e0dcd4;stroke:#b8b4ac;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.screen{fill:#e8e5df;stroke:#b8b4ac;stroke-width:1.5}.desk{fill:#e8e4dc;stroke:#b8b4ac;stroke-width:1.5;stroke-linecap:round}.chair{fill:#dedad2;stroke:#b8b4ac;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}`}</style>
                  <rect x="220" y="80" width="240" height="160" rx="10" className="body"/><rect x="234" y="93" width="212" height="132" rx="5" className="screen"/>
                  <line x1="252" y1="114" x2="360" y2="114" className="line" strokeWidth="1" stroke="#c8c4bc"/><line x1="252" y1="128" x2="400" y2="128" className="line" strokeWidth="1" stroke="#c8c4bc"/><line x1="252" y1="142" x2="376" y2="142" className="line" strokeWidth="1" stroke="#c8c4bc"/><line x1="252" y1="156" x2="394" y2="156" className="line" strokeWidth="1" stroke="#c8c4bc"/><line x1="252" y1="170" x2="352" y2="170" className="line" strokeWidth="1" stroke="#c8c4bc"/><line x1="252" y1="184" x2="386" y2="184" className="line" strokeWidth="1" stroke="#c8c4bc"/>
                  <rect x="354" y="179" width="6" height="10" rx="1" fill="#b8b4ac" opacity="0.6"/><rect x="325" y="240" width="30" height="36" rx="2" className="body"/><rect x="298" y="272" width="84" height="10" rx="4" className="body"/>
                  <rect x="150" y="282" width="380" height="16" rx="4" className="desk"/><rect x="248" y="285" width="184" height="18" rx="4" className="body"/>
                  <line x1="260" y1="291" x2="420" y2="291" className="line" strokeWidth="0.8" stroke="#c8c4bc"/><line x1="260" y1="297" x2="420" y2="297" className="line" strokeWidth="0.8" stroke="#c8c4bc"/>
                  <rect x="178" y="298" width="12" height="110" rx="3" className="desk"/><rect x="490" y="298" width="12" height="110" rx="3" className="desk"/>
                  <rect x="296" y="318" width="88" height="10" rx="4" className="chair"/><rect x="300" y="326" width="8" height="60" rx="3" className="chair"/><rect x="372" y="326" width="8" height="60" rx="3" className="chair"/><rect x="276" y="384" width="128" height="18" rx="6" className="chair"/><rect x="332" y="400" width="16" height="30" rx="3" className="chair"/>
                  <line x1="340" y1="428" x2="290" y2="448" className="line" strokeWidth="2"/><line x1="340" y1="428" x2="390" y2="448" className="line" strokeWidth="2"/><line x1="340" y1="428" x2="340" y2="452" className="line" strokeWidth="2"/>
                  <circle cx="290" cy="450" r="5" className="chair"/><circle cx="390" cy="450" r="5" className="chair"/><circle cx="340" cy="454" r="5" className="chair"/>
                  <path d="M400 370 Q448 350 458 318 Q466 292 448 278 Q438 270 430 280 Q442 290 436 312 Q428 334 386 352" className="body" strokeWidth="2.2"/>
                  <ellipse cx="340" cy="375" rx="62" ry="30" className="body"/><ellipse cx="340" cy="338" rx="52" ry="36" className="body"/>
                  <path d="M294 345 Q268 350 256 336 Q250 328 256 322 Q264 318 268 328 Q276 338 298 336" className="body"/><ellipse cx="254" cy="322" rx="13" ry="9" className="body"/>
                  <line x1="248" y1="316" x2="244" y2="312" className="line" strokeWidth="1.2"/><line x1="254" y1="314" x2="252" y2="309" className="line" strokeWidth="1.2"/><line x1="260" y1="315" x2="260" y2="310" className="line" strokeWidth="1.2"/>
                  <path d="M386 345 Q412 350 424 336 Q430 328 424 322 Q416 318 412 328 Q404 338 382 336" className="body"/><ellipse cx="426" cy="322" rx="13" ry="9" className="body"/>
                  <line x1="420" y1="316" x2="416" y2="312" className="line" strokeWidth="1.2"/><line x1="426" y1="314" x2="426" y2="309" className="line" strokeWidth="1.2"/><line x1="432" y1="315" x2="436" y2="310" className="line" strokeWidth="1.2"/>
                  <path d="M316 304 Q340 296 364 304 L360 322 Q340 316 320 322 Z" className="body"/>
                  <ellipse cx="340" cy="282" rx="52" ry="48" className="body"/>
                  <path d="M292 268 Q268 256 260 276 Q252 298 258 318 Q264 334 278 330 Q290 326 294 308 Q298 290 296 272" className="ear"/><path d="M388 268 Q412 256 420 276 Q428 298 422 318 Q416 334 402 330 Q390 326 386 308 Q382 290 384 272" className="ear"/>
                  <path d="M322 238 Q330 228 340 234 Q350 228 358 238" className="line" strokeWidth="1.4"/>
                  <path d="M300 316 Q340 308 380 316" className="line" strokeWidth="3"/><circle cx="340" cy="320" r="5" className="body" strokeWidth="1.5"/>
                </svg>
                Open a folder and ask anything about your codebase.<br />
                Select a file only if you want to edit it.
              </div>
            )}
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
            indexing={indexing}
          />
        </div>
      </div>
      {activeDiff && <DiffPanel edit={activeDiff} onClose={() => setActiveDiff(null)} />}
    </div>
  );
}
