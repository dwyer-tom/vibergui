import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { marked } from 'marked';

// Configure marked
marked.setOptions({ breaks: true, gfm: true });

// Inject markdown styles once
const mdStyle = document.createElement('style');
mdStyle.textContent = `
  .md h1,.md h2,.md h3,.md h4 { font-weight:700; margin:12px 0 4px; color:#1a1a19; line-height:1.3 }
  .md h1 { font-size:17px } .md h2 { font-size:15px } .md h3 { font-size:14px }
  .md p { margin:0 0 8px } .md p:last-child { margin-bottom:0 }
  .md ul,.md ol { margin:4px 0 8px 18px; padding:0 } .md li { margin-bottom:2px }
  .md code { background:#f3f2ee; border:1px solid #e5e3dc; border-radius:3px; padding:1px 5px; font-family:var(--mono); font-size:12px }
  .md pre { background:#1a1a19; border-radius:6px; padding:12px 14px; overflow-x:auto; margin:8px 0 }
  .md pre code { background:none; border:none; padding:0; color:#f3f2ee; font-size:12px; line-height:1.6 }
  .md strong { font-weight:700 } .md em { font-style:italic; color:#5c5c54 }
  .md blockquote { border-left:3px solid #e5e3dc; margin:0; padding:0 12px; color:#5c5c54 }
  .md a { color:#d97706; text-decoration:none } .md hr { border:none; border-top:1px solid #e5e3dc; margin:12px 0 }
  .think-block { background:#f9f8f5; border:1px solid #e5e3dc; border-radius:6px; padding:8px 12px; margin-bottom:8px; font-size:11px; color:#8c8c84; font-style:italic; white-space:pre-wrap; word-break:break-word; max-height:200px; overflow-y:auto }
  .think-label { font-size:10px; font-weight:700; letter-spacing:1px; color:#a0a098; margin-bottom:4px }
`;
document.head.appendChild(mdStyle);

function sanitizeHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('script, iframe, object, embed, form').forEach((el) => el.remove());
  tmp.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) { el.removeAttribute(attr.name); continue; }
      if ((attr.name === 'href' || attr.name === 'src') && /^javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return tmp.innerHTML;
}

function MarkdownContent({ text }) {
  const html = sanitizeHtml(marked.parse(text || ''));
  return <div className="md" style={styles.markdownBody} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── streaming chat hook ────────────────────────────────────────────────────
function useChat() {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const streamBuf = useRef('');
  const thinkBuf = useRef('');
  // Ref mirrors messages so `send` can read history without being in its dep array.
  // This prevents `send` from being recreated on every streaming token.
  const historyRef = useRef([]);
  const setMsgs = useCallback((fn) => {
    setMessages((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      historyRef.current = next;
      return next;
    });
  }, []);

  const toolCallsRef = useRef([]);

  const send = useCallback(async (userText, { model, files, activeFile, activeFileContent, relatedFiles = [], contextFiles = [], intent = 'chat', think = false }) => {
    if (streaming) return;
    setStreaming(true);
    streamBuf.current = '';
    thinkBuf.current = '';
    toolCallsRef.current = [];

    const systemPrompts = {
      edit: [
        "You are a coding assistant with direct access to the user's codebase.",
        'Relevant files are provided in every message.',
        'You also have tools: use list_files to discover files, read_file to read any file, run_bash to run commands.',
        'If the file you need to edit is not in the context, call read_file first.',
        '',
        'RULES:',
        '1. ONLY use code you can see. Never invent file names or structure.',
        '2. Identify the ONE file to change and make the smallest possible edit.',
        '3. Output ONLY the edit block — no other text:',
        '',
        '<edit path="FULL_FILE_PATH">',
        '<<<<<<< SEARCH',
        'exact lines to find — copy verbatim including indentation',
        '=======',
        'replacement lines',
        '>>>>>>> REPLACE',
        '</edit>',
        '',
        '4. SEARCH must match the file exactly (character-for-character, including indentation).',
        '   Include 2-3 lines of context to uniquely identify the location.',
        '5. Multiple blocks allowed inside one <edit> for multiple changes in the same file.',
        '6. NEVER output raw git conflict markers or the entire file.',
      ].join('\n'),

      search: [
        "You are a code navigation assistant with direct access to the user's codebase.",
        'Relevant files are provided in every message.',
        'You also have tools: use list_files, read_file, or run_bash when you need more context.',
        '',
        'RULES:',
        '1. Answer with exact file path(s) and line numbers.',
        '2. Do NOT output edit blocks or suggest code changes.',
        '3. When a button or UI element is mentioned, trace the full call chain:',
        '   - Where the JSX element is defined (file + line)',
        '   - The event handler function it calls (file + line)',
        '   - Any IPC channel it invokes (window.api.X → invoke → ipcMain.handle)',
        '   - What the main process handler does',
        '4. Be concise but complete — file path, line number, one-sentence explanation per step.',
      ].join('\n'),

      chat: [
        "You are a coding assistant with direct access to the user's codebase.",
        'Relevant files are provided in every message.',
        'You also have tools: use list_files, read_file, or run_bash when you need more context.',
        '',
        'RULES:',
        '1. Only use code you can see. Never invent anything.',
        '2. Answer questions concisely. Do NOT output edit blocks.',
        '3. If a code change is implied, describe what to change in words.',
      ].join('\n'),
    };

    const systemPrompt = systemPrompts[intent] ?? systemPrompts.chat;

    let promptParts = [];

    // RAG-expanded full files (semantic search → file expansion → graph neighbours)
    if (contextFiles.length > 0) {
      const section = contextFiles
        .map((f) => `=== ${f.path} ===\n${f.content}`)
        .join('\n\n');
      promptParts.push(`Relevant files from the codebase:\n${section}`);
    }

    if (activeFile && activeFileContent) {
      // Import-graph neighbours of the active file (deduped against contextFiles)
      if (relatedFiles.length > 0) {
        const relSection = relatedFiles.map((f) => `=== ${f.path} ===\n${f.content}`).join('\n\n');
        promptParts.push(`Files related to ${activeFile.split(/[\\/]/).pop()} (imports/importedBy):\n${relSection}`);
      }
      // Send full content so model can copy exact SEARCH strings verbatim
      promptParts.push(`File to edit (${activeFile}):\n--- START ---\n${activeFileContent}\n--- END ---`);
    } else if (contextFiles.length === 0 && files.length > 0) {
      // No RAG index yet — fall back to sending loaded files directly
      const fileSection = files.map((f) => {
        const truncated = f.content.length >= 12000;
        return `=== ${f.path}${truncated ? ' (truncated)' : ''} ===\n${f.content}`;
      }).join('\n\n');
      promptParts.push(`Project source files:\n${fileSection}`);
    }

    promptParts.push(userText);

    const enrichedUserMsg = { role: 'user', content: promptParts.join('\n\n') };

    setMsgs((m) => [...m, { role: 'user', content: userText }, { role: 'assistant', content: '', thinking: '', tokens: 0 }]);

    window.api.offChatListeners();

    window.api.onChatToken((delta) => {
      if (delta.thinking) {
        thinkBuf.current += delta.thinking;
      } else {
        streamBuf.current += delta.text ?? '';
      }
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: streamBuf.current, thinking: thinkBuf.current, toolCalls: toolCallsRef.current };
        return copy;
      });
    });

    window.api.onChatTool((data) => {
      toolCallsRef.current = [...toolCallsRef.current, data];
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], toolCalls: toolCallsRef.current };
        return copy;
      });
    });

    window.api.onChatDone((stats) => {
      if (stats?.elapsedMs) {
        setMsgs((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], stats };
          return copy;
        });
      }
      setStreaming(false);
    });

    try {
      const historyMsgs = historyRef.current.map((m) => ({ role: m.role, content: m.content }));
      await window.api.chat({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...historyMsgs, enrichedUserMsg],
        think,
      });
    } catch (err) {
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: `Error: ${err.message}`, thinking: '' };
        return copy;
      });
      setStreaming(false);
    }
  }, [streaming, setMsgs]);

  const stop = useCallback(() => {
    window.api.offChatListeners();
    window.api.abortChat();
    setStreaming(false);
  }, []);

  return { messages, streaming, send, stop };
}

// ── spinner ────────────────────────────────────────────────────────────────
function Spinner() {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % frames.length), 100);
    return () => clearInterval(id);
  }, []);
  return <span style={styles.spinnerChar}>{frames[i]}</span>;
}

// ── file tree ─────────────────────────────────────────────────────────────
function buildFileTree(files, folder) {
  const root = {};
  for (const f of files) {
    const rel = f.path.replace(folder, '').replace(/^[\\/]/, '');
    const parts = rel.split(/[\\/]/);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = { __dir: true, __children: {} };
      node = node[parts[i]].__children;
    }
    node[parts[parts.length - 1]] = { __file: f };
  }
  return root;
}

function sortedEntries(obj) {
  return Object.entries(obj).sort(([aName, aNode], [bName, bNode]) => {
    const aDir = !!aNode.__dir, bDir = !!bNode.__dir;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return aName.localeCompare(bName);
  });
}

const FILE_ICON_COLORS = {
  js: '#cbcb41', mjs: '#cbcb41', cjs: '#cbcb41',
  jsx: '#61dafb', tsx: '#61dafb',
  ts: '#3178c6',
  css: '#7b5ea7', scss: '#c6538c', less: '#2a7dbc',
  json: '#cbcb41', jsonc: '#cbcb41',
  md: '#519aba', mdx: '#519aba',
  html: '#e44d26', htm: '#e44d26',
  py: '#3572a5', rb: '#cc342d', go: '#00acd7', rs: '#ce4a1a',
  svg: '#ff9900', png: '#a074c4', jpg: '#a074c4', gif: '#a074c4',
  sh: '#4eaa25', env: '#cbcb41',
};

function getFileIconColor(name) {
  if (name.startsWith('.git')) return '#f05033';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return FILE_ICON_COLORS[ext] || '#8a8a8a';
}

function VscFileIcon({ name }) {
  const c = getFileIconColor(name);
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 2h7l3 3v9H3V2z" fill={c} fillOpacity="0.18" stroke={c} strokeWidth="1.1"/>
      <path d="M10 2v3h3" fill="none" stroke={c} strokeWidth="1.1"/>
    </svg>
  );
}

function VscFolderIcon({ open }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 5.5h4.2l1.3 1.5H14L12.5 12h-11z" fill="#dcb67a"/>
      <path d="M1.5 5.5h4.2l1.3-1.5h3V5.5" fill="#c09a4e"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 5h4.2l1.3 1.5H14v6h-12.5z" fill="#dcb67a"/>
      <path d="M1.5 5h4.2l1.3-1.5h3V5" fill="#c09a4e"/>
    </svg>
  );
}

function VscChevron({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, transition: 'transform 0.12s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
      <path d="M5 6l3 3 3-3" stroke="#7a7a70" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function TreeNode({ name, node, depth, activeFile, onSelectFile }) {
  const [open, setOpen] = useState(true);
  const [hovered, setHovered] = useState(false);
  const indent = depth * 16;

  if (node.__file) {
    const isActive = activeFile === node.__file.path;
    return (
      <div
        style={{
          display: 'flex', alignItems: 'center', height: 22,
          paddingLeft: 8 + indent, paddingRight: 8, gap: 5,
          cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', overflow: 'hidden',
          background: isActive ? '#fde68a' : hovered ? '#e8e6df' : 'transparent',
          borderLeft: isActive ? '2px solid #d97706' : '2px solid transparent',
        }}
        title={node.__file.path}
        onClick={() => onSelectFile(node.__file.path)}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      >
        <VscFileIcon name={name} />
        <span style={{ fontSize: 13, color: isActive ? '#92400e' : '#1e1e1e', fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', height: 22,
          paddingLeft: 2 + indent, paddingRight: 8, gap: 3,
          cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
          background: hovered ? '#e8e6df' : 'transparent',
        }}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      >
        <VscChevron open={open} />
        <VscFolderIcon open={open} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e1e1e' }}>{name}</span>
      </div>
      {open && (
        <div style={{ borderLeft: '1px solid #e0ddd6', marginLeft: 10 + indent }}>
          {sortedEntries(node.__children).map(([n, child]) => (
            <TreeNode key={n} name={n} node={child} depth={depth + 1} activeFile={activeFile} onSelectFile={onSelectFile} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── folder dropdown ────────────────────────────────────────────────────────
function FolderDropdown({ onPickFolder, onSelectFolder, recentFolders }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button style={styles.folderBtn} onClick={() => setOpen((o) => !o)}>
        <FolderIcon /> Select folder
      </button>
      {open && (
        <div style={styles.folderMenu}>
          {recentFolders.length > 0 && (
            <>
              <div style={styles.folderMenuSection}>Recent</div>
              {recentFolders.map((p) => (
                <div
                  key={p} style={styles.folderMenuItem}
                  onClick={() => { onSelectFolder(p); setOpen(false); }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f5f4f0'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <FolderIcon style={{ color: '#8c8c84', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.folderMenuName}>{p.split(/[\\/]/).pop()}</div>
                    <div style={styles.folderMenuPath}>{p}</div>
                  </div>
                </div>
              ))}
              <div style={styles.folderMenuDivider} />
            </>
          )}
          <div
            style={{ ...styles.folderMenuItem, background: '#f5f4f0' }}
            onClick={() => { onPickFolder(); setOpen(false); }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#eeece6'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#f5f4f0'}
          >
            <FolderIcon style={{ color: '#3a3a33', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a19' }}>Choose a different folder</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FolderIcon({ style }) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={style}>
      <path d="M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H5.79289L7.14645 3.85355C7.24021 3.94732 7.36739 4 7.5 4H12.5C13.0523 4 13.5 4.44772 13.5 5V11.5C13.5 12.0523 13.0523 12.5 12.5 12.5H2.5C1.94772 12.5 1.5 12.0523 1.5 11.5V3.5Z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
    </svg>
  );
}

// ── sidebar ────────────────────────────────────────────────────────────────
function Sidebar({ folder, files, onPickFolder, onSelectFolder, recentFolders, width, activeFile, onSelectFile }) {
  const tree = folder && files.length ? buildFileTree(files, folder) : null;

  return (
    <div style={{ ...styles.sidebar, width }}>
      <FolderDropdown onPickFolder={onPickFolder} onSelectFolder={onSelectFolder} recentFolders={recentFolders} />

      {folder && (
        <>
          <div style={styles.folderPath} title={folder}>{folder.split(/[\\/]/).pop()}</div>
          {activeFile && (
            <div style={styles.activeFileLabel} title={activeFile}>✎ {activeFile.split(/[\\/]/).pop()}</div>
          )}
          {tree && (
            <div style={styles.fileList}>
              {sortedEntries(tree).map(([n, node]) => (
                <TreeNode key={n} name={n} node={node} depth={0} activeFile={activeFile} onSelectFile={onSelectFile} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── edit blocks ────────────────────────────────────────────────────────────
function stripEditMarkup(text) {
  // Remove complete edit blocks (already rendered as EditBlock components)
  let s = text.replace(/<edit\b[^>]*>[\s\S]*?<\/edit>/gi, '');
  // Remove incomplete edit block still streaming (opening tag may not have > yet)
  s = s.replace(/<edit\b[\s\S]*/i, '');
  return s.trim();
}

function parseEditBlocks(text) {
  const parts = [];
  const editRegex = /<edit[\s]+(?:path|file|filename)="([^"]+)"[^>]*>\s*(?:<content>)?\n?([\s\S]*?)\n?(?:<\/content>\s*)?<\/edit>/g;
  const hunkRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;
  let last = 0, match;
  while ((match = editRegex.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: 'text', content: text.slice(last, match.index) });
    const filePath = match[1];
    const body = match[2].trim();
    const hunks = [];
    let hunkMatch;
    hunkRegex.lastIndex = 0;
    while ((hunkMatch = hunkRegex.exec(body)) !== null) {
      hunks.push({ search: hunkMatch[1], replace: hunkMatch[2] });
    }
    if (hunks.length > 0) {
      parts.push({ type: 'edit', path: filePath, hunks, fullContent: null });
    } else {
      // Backwards compat: no markers → treat as full file write
      parts.push({ type: 'edit', path: filePath, hunks: [], fullContent: body });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', content: text.slice(last) });

  // When a model self-corrects it emits multiple edit blocks for the same file.
  // Keep only the last edit per path — it's always the intended one.
  const lastEditIdx = new Map();
  parts.forEach((p, i) => { if (p.type === 'edit') lastEditIdx.set(p.path, i); });
  return parts.filter((p, i) => {
    if (p.type === 'edit') return lastEditIdx.get(p.path) === i;
    // Drop text fragments that contain raw diff markers (malformed/incomplete edit blocks)
    if (/<<<<<<< SEARCH|>>>>>>> REPLACE/.test(p.content)) return false;
    return true;
  });
}

function EditBlock({ edit }) {
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const fileName = edit.path.split(/[\\/]/).pop();

  const handleApply = async () => {
    const res = edit.fullContent !== null
      ? await window.api.writeFile(edit.path, edit.fullContent)
      : await window.api.applyEdit(edit.path, edit.hunks);
    if (res.ok) setApplied(true); else setError(res.error);
  };

  return (
    <div style={styles.editBlock}>
      <div style={styles.editHeader}>
        <span style={{ ...styles.editPath, cursor: 'pointer' }} title={edit.path} onClick={() => setExpanded((e) => !e)}>
          ✎ {fileName} <span style={{ fontSize: 10, color: '#b45309' }}>{expanded ? '▴' : '▾'}</span>
        </span>
        {applied ? <span style={styles.editApplied}>✓ Applied</span>
          : error ? <span style={styles.editError} title={error}>✗ {error.length > 60 ? error.slice(0, 60) + '…' : error}</span>
          : <button style={styles.editApplyBtn} onClick={handleApply}>Apply</button>}
      </div>
      {expanded && (edit.fullContent !== null ? (
        <pre style={styles.editCode}>{edit.fullContent}</pre>
      ) : (
        <div>
          {edit.hunks.map((h, i) => (
            <div key={i} style={i > 0 ? { borderTop: '1px solid #e5e7eb' } : {}}>
              <pre style={{ ...styles.editCode, background: '#fff1f2', color: '#be123c', marginBottom: 0 }}>
                {h.search.split('\n').map((line, j) => <span key={j} style={{ display: 'block' }}>- {line}</span>)}
              </pre>
              <pre style={{ ...styles.editCode, background: '#f0fdf4', color: '#15803d', marginTop: 0 }}>
                {h.replace.split('\n').map((line, j) => <span key={j} style={{ display: 'block' }}>+ {line}</span>)}
              </pre>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function toolLabel(tc) {
  const arg = tc.args.path ?? tc.args.cmd ?? '';
  const short = arg.replace(/\\/g, '/').split('/').slice(-2).join('/');
  return tc.name === 'list_files' ? 'listing files'
    : tc.name === 'read_file' ? short || 'file'
    : tc.name === 'run_bash' ? (tc.args.cmd?.slice(0, 40) ?? 'command')
    : tc.name;
}

function ToolSection({ summary, children }) {
  const [exp, setExp] = useState(false);
  return (
    <div style={{ marginBottom: 2 }}>
      <div style={styles.toolSummaryRow} onClick={() => setExp((o) => !o)}>
        <span style={styles.toolSummaryLabel}>{summary}</span>
        <span style={styles.toolSummaryHint}>{exp ? 'collapse' : 'expand'}</span>
      </div>
      {exp && <div style={styles.toolSummaryTree}>{children}</div>}
    </div>
  );
}

// Shown both during thinking and on completed messages
function ToolCallBadges({ toolCalls }) {
  if (!toolCalls || toolCalls.length === 0) return null;

  const reads = toolCalls.filter((tc) => tc.name === 'read_file');
  const lists = toolCalls.filter((tc) => tc.name === 'list_files');
  const bashes = toolCalls.filter((tc) => tc.name === 'run_bash');

  return (
    <div style={styles.toolSummaryWrap}>
      {reads.length > 0 && (
        <ToolSection summary={`Reading ${reads.length} file${reads.length > 1 ? 's' : ''}…`}>
          {reads.map((tc, i) => (
            <div key={i} style={styles.toolSummaryFile}>
              <span style={styles.toolSummaryConnector}>{i === reads.length - 1 ? '└' : '├'}</span>
              <span>{(tc.args.path ?? '').replace(/\\/g, '/')}</span>
            </div>
          ))}
        </ToolSection>
      )}
      {lists.length > 0 && (
        <ToolSection summary="Listed project files…">
          <div style={styles.toolSummaryFile}>
            <span style={styles.toolSummaryConnector}>└</span>
            <span>all source files</span>
          </div>
        </ToolSection>
      )}
      {bashes.map((tc, i) => (
        <ToolSection key={i} summary={`Ran command…`}>
          <div style={styles.toolSummaryFile}>
            <span style={styles.toolSummaryConnector}>└</span>
            <span>{tc.args.cmd}</span>
          </div>
        </ToolSection>
      ))}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  if (large) {
    return (
      <button onClick={doCopy} style={styles.copyBtnLarge} title="Copy last response">
        {copied ? '✓ Copied' : '⎘ Copy'}
      </button>
    );
  }
  return (
    <button onClick={doCopy} style={styles.copyBtn} title="Copy to clipboard">
      {copied ? '✓' : '⎘'}
    </button>
  );
}

function TitleBar() {
  return (
    <div style={styles.titleBar}>
      <div style={styles.titleBarLeft}>
        <button style={styles.titleBarIconBtn} title="Menu">☰</button>
        <button style={styles.titleBarIconBtn} title="Toggle sidebar">⊡</button>
        <button style={styles.titleBarIconBtn} title="Back" disabled>‹</button>
        <button style={styles.titleBarIconBtn} title="Forward" disabled>›</button>
      </div>
    </div>
  );
}

const THINKING_PHRASES = ['Thinking…', 'Reasoning…', 'Pondering…', 'Considering…', 'Reflecting…', 'Mulling…'];
const WORKING_PHRASES = ['Working…', 'Applying…', 'Editing…', 'Patching…', 'Updating…', 'Coding…'];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function Message({ msg, isThinking, isStreaming, model }) {
  const isUser = msg.role === 'user';
  // Memoised: parseEditBlocks runs heavy regex — only recompute when content changes
  const parts = useMemo(
    () => (!isUser && msg.content ? parseEditBlocks(msg.content) : null),
    [isUser, msg.content],
  );
  const [showThink, setShowThink] = useState(false);
  const thinkingPhrase = useMemo(() => pick(THINKING_PHRASES), []);
  const workingPhrase = useMemo(() => pick(WORKING_PHRASES), []);
  const [elapsed, setElapsed] = useState(0);

  const hasCompleteEdit = parts && parts.some((p) => p.type === 'edit');
  const isWorking = isStreaming && !isThinking && msg.content && msg.content.includes('<edit') && !hasCompleteEdit;
  const isActive = isThinking || isWorking;

  useEffect(() => {
    if (!isActive) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  return (
    <div style={{ ...styles.message, ...(isUser ? styles.messageUser : styles.messageAssistant) }}>
      <span style={styles.messageRole}>{isUser ? 'you' : 'ai'}</span>
      {isThinking ? (
        <div style={styles.messageContent}>
          <div style={styles.thinkingRow}><Spinner /><span style={styles.thinkingModel}>{model}</span></div>
          {msg.toolCalls?.length > 0
            ? <ToolCallBadges toolCalls={msg.toolCalls} />
            : <em style={styles.thinkingText}>Thinking…</em>}
        </div>
      ) : parts && parts.some((p) => p.type === 'edit') ? (
        <div style={{ ...styles.messageContent, position: 'relative' }}>
          <CopyButton text={msg.content} />
          <ToolCallBadges toolCalls={msg.toolCalls} />
          {msg.thinking && (
            <div>
              <div className="think-label" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#a0a098', marginBottom: 4, cursor: 'pointer' }} onClick={() => setShowThink(s => !s)}>
                ◈ REASONING {showThink ? '▴' : '▾'}
              </div>
              {showThink && <div className="think-block">{msg.thinking}</div>}
            </div>
          )}
          {parts.map((p, i) =>
            p.type === 'edit' ? <EditBlock key={i} edit={p} /> : null
          )}
        </div>
      ) : (
        <>
          <div style={{ ...styles.messageContent, position: 'relative' }}>
            {isUser ? (
              <span style={styles.userText}>{msg.content}</span>
            ) : (
              <>
                <CopyButton text={msg.content} />
                <ToolCallBadges toolCalls={msg.toolCalls} />
                {msg.thinking && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#a0a098', marginBottom: 4, cursor: 'pointer' }} onClick={() => setShowThink(s => !s)}>
                      ◈ REASONING {showThink ? '▴' : '▾'}
                    </div>
                    {showThink && <div className="think-block">{msg.thinking}</div>}
                  </div>
                )}
                <MarkdownContent text={msg.content} />
              </>
            )}
          </div>
          {!isUser && msg.stats && (
            <div style={styles.msgStats}>
              ※ {Math.round(msg.stats.elapsedMs / 1000)}s
              {msg.stats.tokens > 0 && <> · ↓ {msg.stats.tokens} tokens</>}
              {msg.stats.thinkMs > 0 && <> · thought for {Math.round(msg.stats.thinkMs / 1000)}s</>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── edits dropup ────────────────────────────────────────────────────────────
function EditsDropup({ edits }) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState({});
  const [errors, setErrors] = useState({});
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleApply = async (edit, idx) => {
    const res = edit.fullContent !== null
      ? await window.api.writeFile(edit.path, edit.fullContent)
      : await window.api.applyEdit(edit.path, edit.hunks);
    if (res.ok) setApplied((prev) => ({ ...prev, [idx]: true }));
    else setErrors((prev) => ({ ...prev, [idx]: res.error }));
  };

  const handleApplyAll = async () => {
    for (let i = 0; i < edits.length; i++) {
      if (applied[i]) continue;
      await handleApply(edits[i], i);
    }
  };

  const pendingCount = edits.length - Object.keys(applied).length;

  return (
    <div style={styles.dropupWrap} ref={menuRef}>
      {open && (
        <div style={styles.dropupMenu}>
          <div style={styles.dropupHeader}>
            <span style={styles.dropupTitle}>Code Edits ({edits.length})</span>
            {pendingCount > 0 && <button style={styles.dropupApplyAll} onClick={handleApplyAll}>Apply All ({pendingCount})</button>}
          </div>
          <div style={styles.dropupList}>
            {edits.map((edit, i) => (
              <div key={i} style={styles.dropupItem}>
                <span style={styles.dropupFile} title={edit.path}>{edit.path.split(/[\\/]/).pop()}</span>
                {applied[i] ? <span style={styles.dropupApplied}>Applied</span>
                  : errors[i] ? <span style={styles.dropupError} title={errors[i]}>Failed</span>
                  : <button style={styles.dropupApplyBtn} onClick={() => handleApply(edit, i)}>Apply</button>}
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        style={{ ...styles.editsBtn, ...(edits.length > 0 ? styles.editsBtnActive : {}) }}
        onClick={() => setOpen((o) => !o)} disabled={edits.length === 0}
      >
        ✎ {edits.length}
      </button>
    </div>
  );
}

function ModelDropup({ model, ollamaModels, setModel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const displayName = model || 'No models';

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      {open && (
        <div style={styles.modelMenu}>
          <div style={styles.folderMenuSection}>Model</div>
          {ollamaModels.length === 0
            ? <div style={{ padding: '8px 14px', fontSize: 12, color: '#8c8c84' }}>No models — is Ollama running?</div>
            : ollamaModels.map((m) => (
              <div
                key={m}
                style={{ ...styles.folderMenuItem, background: m === model ? '#f5f4f0' : 'transparent', alignItems: 'center' }}
                onClick={() => { setModel(m); setOpen(false); }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f5f4f0'}
                onMouseLeave={(e) => e.currentTarget.style.background = m === model ? '#f5f4f0' : 'transparent'}
              >
                <span style={{ fontSize: 13, color: '#1a1a19', fontWeight: m === model ? 600 : 400 }}>{m}</span>
                {m === model && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8c8c84' }}>✓</span>}
              </div>
            ))
          }
        </div>
      )}
      <button style={styles.modelBtn} onClick={() => setOpen((o) => !o)}>
        {displayName} <span style={{ fontSize: 10, color: '#8c8c84' }}>▾</span>
      </button>
    </div>
  );
}

function ChatInput({ onSend, onStop, streaming, edits, model, ollamaModels, setModel, think, setThink, indexing, indexProgress, lastResponse }) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px';
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || streaming) return;
    onSend(t);
    setText('');
    if (ref.current) ref.current.style.height = 'auto';
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && streaming) { e.preventDefault(); onStop(); }
  };

  const canSend = text.trim().length > 0 && !streaming;

  return (
    <div style={styles.inputWrap}>
      {lastResponse && <CopyButton text={lastResponse} large />}
      <div style={{ ...styles.inputBox, ...(focused ? styles.inputBoxFocused : {}) }}>
        <textarea
          ref={ref} style={styles.textarea} placeholder="Ask anything about your code…"
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} rows={1}
        />
        <div style={styles.inputFooter}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              style={{ ...styles.paramBtn, ...(think ? styles.paramBtnOn : {}) }}
              onClick={() => setThink((t) => !t)}
              title="Enable extended reasoning"
            >◈ Think</button>
            <EditsDropup edits={edits} />
            {indexing && (
              <div style={styles.indexProgressWrap}>
                <span style={styles.indexProgressLabel}>
                  {indexProgress.total === 0 ? 'Loading…' : `${indexProgress.done}/${indexProgress.total}`}
                </span>
                <div style={styles.indexProgressTrack}>
                  <div style={{
                    ...styles.indexProgressFill,
                    width: indexProgress.total > 0
                      ? `${Math.round((indexProgress.done / indexProgress.total) * 100)}%`
                      : '0%',
                  }} />
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ModelDropup model={model} ollamaModels={ollamaModels} setModel={setModel} />
            {streaming && <button style={styles.stopBtn} onClick={onStop} title="Stop generating">■</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── resizable sidebar ──────────────────────────────────────────────────────
function useSidebarResize(initial = 220, min = 140, max = 480) {
  const [width, setWidth] = useState(initial);
  const dragging = useRef(false);
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (e) => { if (dragging.current) setWidth(Math.min(max, Math.max(min, e.clientX))); };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [min, max]);
  return { width, onMouseDown };
}

// ── call-chain extraction ──────────────────────────────────────────────────
/**
 * Pull potential call targets from chunk text:
 * - JSX event handler references: onClick={name}
 * - IPC channel names from .invoke('channel-name')
 */
function extractCallTargets(text) {
  const handlers = new Set();
  const ipcChannels = new Set();
  const handlerRe = /\bon\w+\s*=\s*\{(\w+)\}/g;
  let m;
  while ((m = handlerRe.exec(text)) !== null) handlers.add(m[1]);
  const invokeRe = /\.invoke\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = invokeRe.exec(text)) !== null) ipcChannels.add(m[1]);
  return { handlers: [...handlers], ipcChannels: [...ipcChannels] };
}

// ── intent classification ──────────────────────────────────────────────────
function classifyIntent(query) {
  const q = query.toLowerCase();
  if (/\b(where|find|locate|which file|what file|show me where|search for)\b/.test(q)) return 'search';
  if (/\b(change|update|fix|refactor|rename|add|remove|delete|edit|implement|rewrite|move)\b/.test(q)) return 'edit';
  return 'chat';
}

// ── import graph ───────────────────────────────────────────────────────────
function extractImportPaths(filePath, content) {
  const dir = filePath.replace(/[\\/][^\\/]+$/, '');
  const matches = content.match(/(?:import\s+.*?from\s+|require\s*\(\s*)['"](\..*?)['"]/g) || [];
  return matches.map((m) => {
    const rel = m.match(/['"](\..*?)['"]/)[1];
    // Resolve relative path segments
    const parts = (dir + '/' + rel).replace(/\\/g, '/').split('/');
    const resolved = [];
    for (const p of parts) {
      if (p === '..') resolved.pop();
      else if (p !== '.') resolved.push(p);
    }
    return resolved.join('/');
  });
}

function buildImportGraph(files) {
  const graph = {}; // filePath -> { imports: Set<path>, importedBy: Set<path> }
  for (const f of files) graph[f.path] = { imports: new Set(), importedBy: new Set() };

  for (const f of files) {
    const importedPaths = extractImportPaths(f.path, f.content);
    for (const imp of importedPaths) {
      const match = files.find((lf) => {
        const n = lf.path.replace(/\\/g, '/');
        const i = imp;
        return n === i || n === i + '.js' || n === i + '.jsx' ||
               n === i + '.ts' || n === i + '.tsx' ||
               n === i + '/index.js' || n === i + '/index.jsx' ||
               n === i + '/index.ts' || n === i + '/index.tsx';
      });
      if (match) {
        graph[f.path].imports.add(match.path);
        graph[match.path].importedBy.add(f.path);
      }
    }
  }
  return graph;
}

// ── main app ───────────────────────────────────────────────────────────────
const EMBED_MODEL = 'nomic-embed-text';

export default function App() {
  const [folder, setFolder] = useState(() => localStorage.getItem('codelocal-folder') || null);
  const [recentFolders, setRecentFolders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('codelocal-recent') || '[]'); } catch { return []; }
  });
  const [files, setFiles] = useState([]);
  const [model, setModel] = useState('');
  const [ollamaModels, setOllamaModels] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [indexStatus, setIndexStatus] = useState(null);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ done: 0, total: 0 });
  const [importGraph, setImportGraph] = useState({});  // renderer-computed fallback
  const [filesMeta, setFilesMeta] = useState({});      // index-computed (source of truth)
  const [think, setThink] = useState(false);
  const { messages, streaming, send, stop } = useChat();
  const bottomRef = useRef(null);
  const messagesRef = useRef(null);
  const userScrolled = useRef(false);
  const indexingRef = useRef(false);
  const { width: sidebarWidth, onMouseDown: startResize } = useSidebarResize();

  // Auto-scroll only when user hasn't manually scrolled up
  useEffect(() => {
    if (!userScrolled.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Reset scroll lock when streaming ends
  useEffect(() => {
    if (!streaming) userScrolled.current = false;
  }, [streaming]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    userScrolled.current = !atBottom;
  }, []);

  useEffect(() => {
    window.api.ollamaModels().then((models) => {
      const chatModels = models.filter((m) => !m.startsWith('nomic-embed-text'));
      setOllamaModels(chatModels);
      if (chatModels.length) setModel(chatModels[0]);
    });
  }, []);

  // Restore folder on startup / after HMR reloads
  useEffect(() => {
    if (!folder) return;
    loadFiles(folder);
    refreshIndexStatus(folder);
    startWatching(folder);
  }, []);

  const refreshIndexStatus = async (f) => {
    const target = f ?? folder;
    const status = await window.api.indexStatus(target);
    setIndexStatus(status);
    // Load structural metadata from the index (imports, importedBy, symbols)
    if (status?.indexed) {
      const meta = await window.api.getFileMeta(target);
      if (meta) setFilesMeta(meta);
    }
  };

  const loadFiles = async (targetFolder) => {
    const f = targetFolder ?? folder;
    if (!f) return;
    const paths = await window.api.listFiles(f);
    const TEXT_EXT = /\.(js|jsx|ts|tsx|py|rs|go|java|c|cpp|h|hpp|cs|rb|php|sh|md|txt|json|toml|yaml|yml|sql|html|css|scss)$/i;
    const EXCLUDE  = /package-lock\.json|yarn\.lock|pnpm-lock\.yaml/i;
    const filtered = paths.filter((p) => TEXT_EXT.test(p) && !EXCLUDE.test(p)).slice(0, 60);
    // Read all files in parallel instead of sequentially
    const loaded = (await Promise.all(
      filtered.map(async (p) => {
        const res = await window.api.readFile(p);
        return res.ok ? { path: p, content: res.content.slice(0, 12000) } : null;
      })
    )).filter(Boolean);
    setFiles(loaded);
    setImportGraph(buildImportGraph(loaded));
  };

  const handleIndex = async (targetFolder) => {
    const f = targetFolder ?? folder;
    if (!f || indexingRef.current) return;
    indexingRef.current = true;
    setIndexing(true);
    setIndexProgress({ done: 0, total: 0 });
    window.api.offIndexingListeners();
    window.api.onIndexingProgress(({ done, total }) => setIndexProgress({ done, total }));
    try {
      await window.api.indexFolder(f, EMBED_MODEL);
    } finally {
      window.api.offIndexingListeners();
      indexingRef.current = false;
      setIndexing(false);
    }
    await refreshIndexStatus(f);
  };

  const saveRecent = (f) => {
    const updated = [f, ...recentFolders.filter((r) => r !== f)].slice(0, 5);
    setRecentFolders(updated);
    localStorage.setItem('codelocal-recent', JSON.stringify(updated));
  };

  const applyFolder = async (f) => {
    localStorage.setItem('codelocal-folder', f);
    saveRecent(f);
    setFolder(f);
    setFiles([]);
    setIndexStatus(null);
    await loadFiles(f);
    handleIndex(f);
    startWatching(f);
  };

  const pickFolder = async () => {
    const f = await window.api.pickFolder();
    if (f) applyFolder(f);
  };

  const selectFolder = (f) => applyFolder(f);

  const startWatching = (f) => {
    window.api.offFolderChanged();
    window.api.watchFolder(f);
    window.api.onFolderChanged(() => { loadFiles(f); handleIndex(f); });
  };

  const handleSend = async (text) => {
    const activeFileContent = activeFile
      ? (await window.api.readFile(activeFile))?.content ?? null
      : null;

    // ── Import-graph neighbours of the active file ─────────────────────────
    // Prefer index-computed filesMeta (covers all 200 files, resolved paths)
    // Fall back to renderer-computed importGraph (covers loaded 60 files)
    const graph = Object.keys(filesMeta).length > 0 ? filesMeta : importGraph;
    const activeRelatedPaths = new Set();
    if (activeFile && graph[activeFile]) {
      const { imports, importedBy } = graph[activeFile];
      (imports || []).forEach((p) => activeRelatedPaths.add(p));
      (importedBy || []).forEach((p) => activeRelatedPaths.add(p));
    }

    // ── RAG: chunks → slice relevant code → pull graph neighbours ──────────
    let contextFiles = [];
    let ragResults = [];
    if (folder && indexStatus?.indexed) {
      const res = await window.api.searchIndex(folder, text, EMBED_MODEL, 15);
      if (res.ok && res.results.length > 0) {
        ragResults = res.results;

        // 1. Group chunks by file, pick top 3 files by best chunk score
        const chunksByFile = new Map();
        for (const chunk of res.results) {
          if (chunk.path === activeFile) continue;
          if (!chunksByFile.has(chunk.path)) chunksByFile.set(chunk.path, []);
          chunksByFile.get(chunk.path).push(chunk);
        }
        const topFilePaths = [...chunksByFile.entries()]
          .sort((a, b) => b[1][0].score - a[1][0].score)
          .slice(0, 3)
          .map(([p]) => p);

        // 2. For top files, send the full file content so the model can see all
        //    definitions (e.g. styles objects at the end of large single files).
        //    Cap at 60 000 chars (~15 000 tokens) per file to stay within context.
        const topFiles = (await Promise.all(
          topFilePaths.map(async (p) => {
            const res = await window.api.readFile(p);
            if (!res.ok) return null;
            return { path: p, content: res.content.slice(0, 60000) };
          })
        )).filter(Boolean);

        // 3. Pull graph neighbours of those top files
        const neighbourPaths = new Set();
        for (const f of topFiles) {
          const node = graph[f.path];
          if (node) {
            (node.imports || []).forEach((p) => neighbourPaths.add(p));
            (node.importedBy || []).forEach((p) => neighbourPaths.add(p));
          }
        }
        topFilePaths.forEach((p) => neighbourPaths.delete(p));
        if (activeFile) neighbourPaths.delete(activeFile);
        activeRelatedPaths.forEach((p) => neighbourPaths.delete(p));

        const neighbourFiles = (await Promise.all(
          [...neighbourPaths].slice(0, 3).map(async (p) => {
            const chunks = chunksByFile.get(p);
            if (chunks) {
              const sliced = await window.api.sliceFile(p, chunks);
              return sliced ? { path: p, content: sliced } : null;
            }
            const loaded = files.find((f) => f.path === p);
            return loaded ?? null;
          })
        )).filter(Boolean);

        contextFiles = [...topFiles, ...neighbourFiles];
      }
    }

    const intent = classifyIntent(text);

    // ── Call-chain tracing (search queries only) ───────────────────────────
    // Single batched IPC call instead of O(names × files) round trips.
    if (intent === 'search' && ragResults.length > 0) {
      const allChunkText = ragResults.map((r) => r.text).join('\n');
      const { handlers, ipcChannels } = extractCallTargets(allChunkText);
      const allIndexedFiles = Object.keys(filesMeta);
      const contextPathSet = new Set(contextFiles.map((f) => f.path));

      // Build query list: handlers narrow by filesMeta symbols; channels search all files
      const queries = [];
      for (const name of handlers) {
        const candidates = allIndexedFiles.filter((fp) =>
          !contextPathSet.has(fp) && (filesMeta[fp]?.symbols || []).includes(name)
        );
        for (const fp of candidates) queries.push({ filePath: fp, name });
      }
      for (const channel of ipcChannels) {
        for (const fp of allIndexedFiles) {
          if (!contextPathSet.has(fp)) queries.push({ filePath: fp, name: channel });
        }
      }

      if (queries.length > 0) {
        // One IPC call returns { [name]: { filePath, lineNum } }
        const found = await window.api.findSymbols(queries);
        // Slice and add each found definition (deduplicated)
        await Promise.all(Object.values(found).map(async ({ filePath, lineNum }) => {
          if (contextPathSet.has(filePath)) return;
          const sliced = await window.api.sliceFile(filePath, [{ startLine: lineNum, endLine: lineNum }]);
          if (sliced) { contextFiles.push({ path: filePath, content: sliced }); contextPathSet.add(filePath); }
        }));
      }
    }

    // ── Active file's own graph neighbours (deduped against contextFiles) ──
    const contextPaths = new Set(contextFiles.map((f) => f.path));
    const relatedFiles = files
      .filter((f) => activeRelatedPaths.has(f.path) && !contextPaths.has(f.path))
      .slice(0, 4);

    send(text, { model, files, activeFile, activeFileContent, relatedFiles, contextFiles, intent, think });
  };

  // Memoised: avoids running parseEditBlocks on every streaming token for the edits dropup
  const edits = useMemo(
    () => messages.flatMap((m) =>
      m.role === 'assistant' && m.content
        ? parseEditBlocks(m.content).filter((p) => p.type === 'edit')
        : []
    ),
    [messages],
  );

  return (
    <div style={styles.shell}>
      <TitleBar />
      <div style={styles.root}>
      <Sidebar
        folder={folder} files={files} onPickFolder={pickFolder} onSelectFolder={selectFolder} recentFolders={recentFolders}
        width={sidebarWidth} activeFile={activeFile} onSelectFile={setActiveFile}
      />
      <div style={styles.resizeHandle} onMouseDown={startResize} />

      <div style={styles.main}>
        <div ref={messagesRef} style={styles.messages} onScroll={handleMessagesScroll}>
          {messages.length === 0 && (
            <div style={styles.empty}>
              Open a folder and ask anything about your codebase.<br />
              Select a file only if you want to edit it.
            </div>
          )}
          {messages.map((m, i) => (
            <Message
              key={i} msg={m} model={model}
              isThinking={streaming && m.role === 'assistant' && m.content === '' && i === messages.length - 1}
              isStreaming={streaming && m.role === 'assistant' && i === messages.length - 1}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        <ChatInput
          onSend={handleSend} onStop={stop} streaming={streaming}
          edits={edits}
          model={model} ollamaModels={ollamaModels} setModel={setModel}
          think={think} setThink={setThink}
          indexing={indexing} indexProgress={indexProgress}
          lastResponse={[...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ?? null}
        />
      </div>
    </div>
    </div>
  );
}

// ── styles ─────────────────────────────────────────────────────────────────
const styles = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#f5f4f0', color: '#1a1a19' },
  root: { display: 'flex', flex: 1, overflow: 'hidden', background: '#f5f4f0', color: '#1a1a19' },
  // ── title bar ──────────────────────────────────────────────────────────────
  titleBar: { height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', background: '#f3f2ee', borderBottom: '1px solid #e5e3dc', WebkitAppRegion: 'drag', userSelect: 'none' },
  titleBarLeft: { display: 'flex', alignItems: 'center', gap: 2, paddingLeft: 12, WebkitAppRegion: 'no-drag' },
  titleBarCenter: { flex: 1, display: 'flex', justifyContent: 'center', WebkitAppRegion: 'no-drag' },
  titleBarIconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#8c8c84', fontSize: 16, width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitAppRegion: 'no-drag' },
  sidebar: { background: '#f3f2ee', display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0 12px 12px', overflow: 'hidden', flexShrink: 0 },
  resizeHandle: { width: 4, cursor: 'col-resize', background: 'transparent', borderRight: '1px solid #e5e3dc', flexShrink: 0 },
  folderPath: { fontSize: 12, color: '#8c8c84', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fileList: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', marginTop: 4 },
  btn: { border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 },
  folderBtn: { display: 'flex', alignItems: 'center', gap: 6, background: '#1a1a19', color: '#ffffff', border: '1px solid #1a1a19', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer', width: '100%' },
  folderMenu: { position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0, background: '#ffffff', border: '1px solid #e0deda', borderRadius: 12, boxShadow: '0 -4px 20px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 200, minWidth: 220 },
  folderMenuSection: { fontSize: 11, fontWeight: 600, color: '#8c8c84', padding: '10px 14px 4px', letterSpacing: 0.3, textTransform: 'uppercase' },
  folderMenuItem: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 14px', cursor: 'pointer', transition: 'background 0.1s' },
  folderMenuName: { fontSize: 13, fontWeight: 600, color: '#1a1a19', lineHeight: 1.3 },
  folderMenuPath: { fontSize: 11, color: '#8c8c84', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  folderMenuDivider: { height: 1, background: '#f0ede8', margin: '4px 0' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f5f4f0' },
  badge: { fontSize: 11, color: '#166534', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 12, padding: '2px 8px' },
  messages: { flex: 1, overflowY: 'auto', padding: '20px 24px 12px', display: 'flex', flexDirection: 'column', gap: 14, background: '#f5f4f0' },
  empty: { color: '#8c8c84', fontSize: 13, margin: 'auto', textAlign: 'center', lineHeight: 2 },
  message: { display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '90%' },
  messageUser: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  messageAssistant: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  messageRole: { fontSize: 10, color: '#8c8c84', letterSpacing: 1 },
  messageContent: { background: '#ffffff', border: '1px solid #e5e3dc', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6, fontSize: 13, color: '#1a1a19' },
  copyBtn: { position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#a0a098', fontSize: 13, padding: '2px 4px', borderRadius: 4, opacity: 0.6 },
  toolReading: { fontSize: 12, color: '#6b7280', fontStyle: 'italic', animation: 'fadeIn 0.3s ease' },
  toolDone: { fontSize: 11, color: '#9ca3af', fontFamily: 'var(--mono)' },
  toolSummaryWrap: { marginBottom: 10 },
  toolSummaryRow: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' },
  toolSummaryLabel: { fontSize: 12, color: '#6b7280', fontStyle: 'italic' },
  toolSummaryHint: { fontSize: 10, color: '#c0bdb8' },
  toolSummaryTree: { marginTop: 3, paddingLeft: 4 },
  toolSummaryFile: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280', fontFamily: 'var(--mono)', lineHeight: 1.8 },
  toolSummaryConnector: { color: '#c0bdb8', userSelect: 'none' },
  toolSummaryOther: { fontSize: 11, color: '#9ca3af', fontFamily: 'var(--mono)', marginTop: 2 },
  msgStats: { fontSize: 11, color: '#a0a098', marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' },
  userText: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--mono)' },
  markdownBody: { fontFamily: 'system-ui, sans-serif', fontSize: 13, lineHeight: 1.7, color: '#1a1a19', wordBreak: 'break-word' },
  spinnerChar: { fontSize: 18, color: '#d97706', fontStyle: 'normal' },
  thinkingInline: { display: 'flex', alignItems: 'center', gap: 8 },
  thinkingModel: { fontSize: 15, fontWeight: 600, color: '#3a3a33' },
  thinkingText: { fontSize: 15, color: '#5c5c54', fontStyle: 'italic' },
  thinkingMeta: { fontSize: 12, color: '#a0a098', fontStyle: 'normal' },
  inputWrap: { padding: '8px 16px 16px', background: '#f5f4f0', display: 'flex', flexDirection: 'column' },
  inputBox: { background: '#ffffff', border: 'none', borderRadius: 18, overflow: 'visible', boxShadow: 'none', transition: 'box-shadow 0.15s' },
  inputBoxFocused: { boxShadow: '0 0 0 1.5px #c4c2bb, 0 2px 10px rgba(0,0,0,0.09)' },
  textarea: { display: 'block', width: '100%', background: 'transparent', color: '#1a1a19', border: 'none', padding: '16px 16px 6px', fontSize: 15, fontFamily: 'system-ui, -apple-system, sans-serif', resize: 'none', outline: 'none', lineHeight: 1.6, minHeight: 52, maxHeight: 320, overflowY: 'auto' },
  inputFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px 10px 12px', borderTop: '1px solid #f0ede8' },
  modelSelect: { background: 'transparent', color: '#5c5c54', border: '1px solid #e0deda', borderRadius: 8, padding: '4px 8px', fontSize: 12, cursor: 'pointer', maxWidth: 160, outline: 'none' },
  modelBtn: { display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', color: '#3a3a33', border: '1px solid #e0deda', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' },
  modelMenu: { position: 'absolute', bottom: 'calc(100% + 6px)', right: 0, background: '#ffffff', border: '1px solid #e0deda', borderRadius: 12, boxShadow: '0 -4px 20px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 200, minWidth: 180 },
  sendBtn: { width: 30, height: 30, borderRadius: 9, border: 'none', background: '#e8e6e0', color: '#9c9a94', fontSize: 16, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s, color 0.15s', flexShrink: 0 },
  sendBtnActive: { background: '#1a1a19', color: '#ffffff', cursor: 'pointer' },
  stopBtn: { width: 30, height: 30, borderRadius: 9, border: 'none', background: '#1a1a19', color: '#ffffff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 },
  activeBadge: { fontSize: 11, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 12, padding: '2px 8px', fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  activeFileLabel: { fontSize: 11, color: '#d97706', fontWeight: 600, padding: '4px 6px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  editBlock: { margin: '8px 0', border: '1px solid #d97706', borderRadius: 8, overflow: 'hidden' },
  editHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#fef3c7', borderBottom: '1px solid #fde68a' },
  editPath: { fontSize: 12, fontWeight: 600, color: '#92400e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  editApplyBtn: { background: '#d97706', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  editApplied: { fontSize: 11, color: '#166534', fontWeight: 600 },
  editError: { fontSize: 11, color: '#dc2626', fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  editCode: { margin: 0, padding: '10px 12px', fontSize: 12, lineHeight: 1.5, background: '#ffffff', color: '#1a1a19', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 400, overflowY: 'auto' },
  dropupWrap: { position: 'relative' },
  dropupMenu: { position: 'absolute', bottom: '100%', right: 0, marginBottom: 8, width: 280, background: '#ffffff', border: '1px solid #e5e3dc', borderRadius: 10, boxShadow: '0 -4px 20px rgba(0,0,0,0.10)', overflow: 'hidden', zIndex: 100 },
  dropupHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #e5e3dc', background: '#f3f2ee' },
  dropupTitle: { fontSize: 12, fontWeight: 700, color: '#1a1a19' },
  dropupApplyAll: { background: '#d97706', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  dropupList: { maxHeight: 240, overflowY: 'auto', padding: '4px 0' },
  dropupItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', gap: 8 },
  dropupFile: { fontSize: 12, color: '#3a3a33', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  dropupApplyBtn: { background: '#1a1a19', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 },
  dropupApplied: { fontSize: 11, color: '#166534', fontWeight: 600, flexShrink: 0 },
  dropupError: { fontSize: 11, color: '#dc2626', fontWeight: 600, flexShrink: 0 },
  editsBtn: { width: 28, height: 28, borderRadius: 8, border: 'none', background: '#e5e3dc', color: '#8c8c84', fontSize: 12, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 },
  editsBtnActive: { background: '#fef3c7', color: '#d97706', border: '1px solid #fde68a', cursor: 'pointer' },
  indexProgressWrap: { display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' },
  indexProgressLabel: { fontSize: 10, color: '#5c5c54', fontWeight: 500, lineHeight: 1 },
  indexProgressTrack: { width: 72, height: 4, background: '#e5e3dc', borderRadius: 2, overflow: 'hidden' },
  indexProgressFill: { height: '100%', background: '#1a1a19', borderRadius: 2, transition: 'width 0.2s ease' },
  paramBtn: { fontSize: 11, padding: '7px 12px', borderRadius: 6, border: '1px solid #e5e3dc', background: '#ffffff', color: '#5c5c54', cursor: 'pointer', fontWeight: 500 },
  paramBtnOn: { background: '#1a1a19', color: '#ffffff', border: '1px solid #1a1a19' },
};
