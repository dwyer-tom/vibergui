import React, { useState, useRef, useEffect } from 'react';
import styles from '../styles';

// Inject keyframe for indeterminate indexing pulse
if (typeof document !== 'undefined' && !document.getElementById('index-pulse-keyframe')) {
  const style = document.createElement('style');
  style.id = 'index-pulse-keyframe';
  style.textContent = `@keyframes indexPulse { 0%,100%{width:20%} 50%{width:60%} }`;
  document.head.appendChild(style);
}

// ── edits dropup ───────────────────────────────────────────────────────────
// function EditsDropup({ edits }) {
//   const [open, setOpen] = useState(false);
//   const [applied, setApplied] = useState({});
//   const [errors, setErrors] = useState({});
//   const menuRef = useRef(null);

//   useEffect(() => {
//     if (!open) return;
//     const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
//     document.addEventListener('mousedown', handler);
//     return () => document.removeEventListener('mousedown', handler);
//   }, [open]);

//   const handleApply = async (edit, idx) => {
//     const res = edit.fullContent !== null
//       ? await window.api.writeFile(edit.path, edit.fullContent)
//       : await window.api.applyEdit(edit.path, edit.hunks);
//     if (res.ok) setApplied((prev) => ({ ...prev, [idx]: true }));
//     else setErrors((prev) => ({ ...prev, [idx]: res.error }));
//   };

//   const handleApplyAll = async () => {
//     for (let i = 0; i < edits.length; i++) {
//       if (applied[i]) continue;
//       await handleApply(edits[i], i);
//     }
//   };

//   const pendingCount = edits.length - Object.keys(applied).length;

//   return (
//     <div style={styles.dropupWrap} ref={menuRef}>
//       {open && (
//         <div style={styles.dropupMenu}>
//           <div style={styles.dropupHeader}>
//             <span style={styles.dropupTitle}>Code Edits ({edits.length})</span>
//             {pendingCount > 0 && <button style={styles.dropupApplyAll} onClick={handleApplyAll}>Apply All ({pendingCount})</button>}
//           </div>
//           <div style={styles.dropupList}>
//             {edits.map((edit, i) => (
//               <div key={i} style={styles.dropupItem}>
//                 <span style={styles.dropupFile} title={edit.path}>{edit.path.split(/[\\/]/).pop()}</span>
//                 {applied[i] ? <span style={styles.dropupApplied}>Applied</span>
//           </div>
//         </div>
//       )}
//       <button
//         style={{ ...styles.editsBtn, ...(edits.length > 0 ? styles.editsBtnActive : {}) }}
//         onClick={() => setOpen((o) => !o)} disabled={edits.length === 0}
//       >
//         ✎ {edits.length}
//       </button>
//     </div>
//   );
// }

// ── icon-only toggle button ────────────────────────────────────────────────
function IconBtn({ active, onClick, title, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 28, height: 28,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: active ? '1px solid #1a1a19' : '1px solid #e0ddd6',
        borderRadius: 6,
        background: active ? '#1a1a19' : hov ? '#f0ede8' : '#ffffff',
        color: active ? '#ffffff' : '#5c5c54',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 0.1s, border-color 0.1s, color 0.1s',
      }}
    >
      {children}
    </button>
  );
}

// ── model dropup ───────────────────────────────────────────────────────────
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
                <span style={{ fontSize: 13, color: '#3a3a33', fontWeight: m === model ? 600 : 400 }}>{m}</span>
                {m === model && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8c8c84' }}>✓</span>}
              </div>
            ))
          }
        </div>
      )}
      <button style={styles.modelBtn} onClick={() => setOpen((o) => !o)}>
        <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
        <span style={{ fontSize: 10, color: '#8c8c84', flexShrink: 0 }}>▾</span>
      </button>
    </div>
  );
}

// ── folder row ─────────────────────────────────────────────────────────────
function FolderRow({ folder, recentFolders = [], onPickFolder, onSelectFolder, model, ollamaModels, setModel, planMode, setPlanMode, autoApply, setAutoApply, chatMode, webSearch, setWebSearch, indexing, onImageClick, streaming, onStop }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const folderName = folder ? folder.split(/[\\/]/).pop() : null;

  const progress = indexing && indexing.total > 0 ? Math.round((indexing.done / indexing.total) * 100) : null;

  return (
    <div style={{ position: 'relative', borderTop: '1px solid #ede9e2', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9f8f6', borderRadius: '0 0 16px 16px' }} ref={ref}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {chatMode !== 'chat' && (
          <button style={styles.folderRowBtn} onClick={() => setOpen((o) => !o)}>
            <FolderSvg />
            {folderName ?? 'Select folder'}
          </button>
        )}
        {indexing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div style={{ width: 80, height: 4, borderRadius: 2, background: '#e8e5df', overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ height: '100%', borderRadius: 2, background: '#7c6f5b', transition: 'width 0.3s ease', width: progress != null ? `${progress}%` : '30%', animation: progress == null ? 'indexPulse 1.5s ease-in-out infinite' : 'none' }} />
            </div>
            <span style={{ fontSize: 11, color: '#8c8c84', whiteSpace: 'nowrap', fontWeight: 500 }}>
              {progress != null ? `${indexing.done}/${indexing.total}` : 'Indexing…'}
            </span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {streaming && (
          <button onClick={onStop} title="Stop generating" style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: '#ffffff', color: '#3a3a33', border: '1px solid #e0ddd6',
            borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 500,
            cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="1" y="1" width="8" height="8" rx="1.5" fill="#3a3a33"/>
            </svg>
            Stop
          </button>
        )}
        {!streaming && chatMode === 'chat' && (
          <IconBtn active={webSearch} onClick={() => setWebSearch(w => !w)} title="Web search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </IconBtn>
        )}
        {!streaming && chatMode !== 'chat' && (
          <IconBtn active={planMode} onClick={() => setPlanMode(p => !p)} title="Plan mode — outlines changes before editing. Reply 'go' to execute.">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </IconBtn>
        )}
        {!streaming && chatMode !== 'chat' && (
          <IconBtn active={autoApply} onClick={() => setAutoApply(a => { const next = !a; localStorage.setItem('codelocal-autoapply', String(next)); return next; })} title="Auto-apply edits (Ctrl+Shift+A)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>
            </svg>
          </IconBtn>
        )}
{!streaming && <ModelDropup model={model} ollamaModels={ollamaModels} setModel={setModel} />}
      </div>
      {open && (
        <div style={styles.folderRowMenu}>
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
                  <FolderSvg style={{ color: '#8c8c84', flexShrink: 0 }} />
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
            <FolderSvg style={{ color: '#3a3a33', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: '#3a3a33' }}>Choose a different folder…</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FolderSvg({ style }) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={style}>
      <path d="M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H5.79289L7.14645 3.85355C7.24021 3.94732 7.36739 4 7.5 4H12.5C13.0523 4 13.5 4.44772 13.5 5V11.5C13.5 12.0523 13.0523 12.5 12.5 12.5H2.5C1.94772 12.5 1.5 12.0523 1.5 11.5V3.5Z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
    </svg>
  );
}

// ── chat input ─────────────────────────────────────────────────────────────
export default function ChatInput({ onSend, onStop, streaming, model, ollamaModels, setModel, folder, recentFolders, onPickFolder, onSelectFolder, planMode, setPlanMode, autoApply, setAutoApply, chatMode, webSearch, setWebSearch, indexing, prefillText }) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px';
  }, [text]);

  useEffect(() => {
    if (!prefillText) return;
    const clean = prefillText.replace(/\u200b/g, '');
    setText(clean);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(clean.length, clean.length);
    });
  }, [prefillText]);

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

  return (
    <div style={styles.inputWrap}>
      <div style={{ ...styles.inputBox, ...(focused ? styles.inputBoxFocused : {}) }}>
        <textarea
          ref={ref} style={styles.textarea} placeholder="Ask anything about your code…"
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} rows={1}
        />
        <FolderRow folder={folder} recentFolders={recentFolders} onPickFolder={onPickFolder} onSelectFolder={onSelectFolder} model={model} ollamaModels={ollamaModels} setModel={setModel} planMode={planMode} setPlanMode={setPlanMode} autoApply={autoApply} setAutoApply={setAutoApply} chatMode={chatMode} webSearch={webSearch} setWebSearch={setWebSearch} indexing={indexing} streaming={streaming} onStop={onStop} />
      </div>
    </div>
  );
}
