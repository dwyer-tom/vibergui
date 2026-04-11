import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { parseEditBlocks } from '../lib/parseEditBlocks';

// ── icons ──────────────────────────────────────────────────────────────────
function IconChat() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3 4a1.5 1.5 0 011.5-1.5h9A1.5 1.5 0 0115 4v7a1.5 1.5 0 01-1.5 1.5H7L4 15v-2.5H4.5A1.5 1.5 0 013 11V4z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6.5 6.5h5M6.5 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M2.5 5C2.5 4.17 3.17 3.5 4 3.5h3.29l1.35 1.35c.1.1.22.15.36.15H14c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H4c-.83 0-1.5-.67-1.5-1.5V5z" stroke="currentColor" strokeWidth="1.4" fill="none"/>
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="7" cy="5" r="1.5" fill="currentColor"/>
      <circle cx="11" cy="9" r="1.5" fill="currentColor"/>
      <circle cx="7" cy="13" r="1.5" fill="currentColor"/>
    </svg>
  );
}

// ── nav button ─────────────────────────────────────────────────────────────
function NavBtn({ icon, label, active, onClick, disabled }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 36, height: 36, borderRadius: 8, border: 'none',
        background: active ? '#e8e6df' : hovered ? '#eeece6' : 'transparent',
        color: active ? '#3a3a33' : '#3a3a33',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, transition: 'background 0.12s, color 0.12s',
        opacity: disabled ? 0.3 : 1,
      }}
    >
      {icon}
    </button>
  );
}

// ── file icon ─────────────────────────────────────────────────────────────
const FILE_ICON_COLORS = {
  js: '#cbcb41', mjs: '#cbcb41', cjs: '#cbcb41',
  jsx: '#61dafb', tsx: '#61dafb',
  ts: '#3178c6',
  css: '#7b5ea7', scss: '#c6538c',
  json: '#cbcb41',
  md: '#519aba',
  html: '#e44d26',
  py: '#3572a5', rb: '#cc342d', go: '#00acd7', rs: '#ce4a1a',
  sh: '#4eaa25',
};

function getFileIconColor(name) {
  if (name.startsWith('.git')) return '#f05033';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return FILE_ICON_COLORS[ext] || '#8a8a8a';
}

function VscFileIcon({ name }) {
  const c = getFileIconColor(name);
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 2h7l3 3v9H3V2z" fill={c} fillOpacity="0.18" stroke={c} strokeWidth="1.1"/>
      <path d="M10 2v3h3" fill="none" stroke={c} strokeWidth="1.1"/>
    </svg>
  );
}

// ── edit card ─────────────────────────────────────────────────────────────
function EditCard({ edit }) {
  const [hovered, setHovered] = useState(false);
  const fileName = edit.path.split(/[\\/]/).pop();
  const lineInfo = edit.startLine != null ? `L${edit.startLine}-${edit.endLine}` : null;
  const isHunkEdit = edit.hunks?.length > 0;
  const lineCount = isHunkEdit
    ? edit.hunks.reduce((n, h) => n + h.replace.split('\n').length, 0)
    : (edit.fullContent || '').split('\n').length;

  return (
    <div
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? '#ffffff' : '#fafaf8',
        border: '1px solid #e5e3dc',
        borderRadius: 8,
        padding: '8px 10px',
        marginBottom: 4,
        transition: 'background 0.12s, box-shadow 0.12s',
        boxShadow: hovered ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <VscFileIcon name={fileName} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#3a3a33', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={edit.path}>
          {fileName}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#8c8c84' }}>
        {lineInfo && <span>{lineInfo} · </span>}
        <span>{lineCount} line{lineCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

// ── sidebar ────────────────────────────────────────────────────────────────
function IconPanel() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <line x1="7" y1="3" x2="7" y2="15" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  );
}

export default function Sidebar({ onNewChat, onPickFolder, messages }) {
  const MIN_W = 120, MAX_W = 480, DEFAULT_W = 220, SNAP_THRESHOLD = 60;
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem('codelocal-sidebar-w');
    return saved ? Number(saved) : DEFAULT_W;
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const dragging = useRef(false);
  const railRef = useRef(null);

  // Collect all edits from assistant messages
  const allEdits = useMemo(() => {
    if (!messages) return [];
    const edits = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant' || !m.content) continue;
      const parts = parseEditBlocks(m.content);
      for (const p of parts) {
        if (p.type === 'edit') edits.push(p);
      }
    }
    return edits;
  }, [messages]);

  const onDragStart = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current || !railRef.current) return;
      const railRight = railRef.current.getBoundingClientRect().right;
      const newW = e.clientX - railRight;
      if (newW < SNAP_THRESHOLD) {
        setPanelOpen(false);
      } else {
        setPanelOpen(true);
        setPanelWidth(Math.min(MAX_W, Math.max(MIN_W, newW)));
      }
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // persist
      setPanelWidth(w => { localStorage.setItem('codelocal-sidebar-w', String(w)); return w; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpen(o => !o);
  }, []);

  return (
    <div style={{ display: 'flex', flexShrink: 0, height: '100%', position: 'relative' }}>
      {/* Icon rail */}
      <div ref={railRef} style={{
        width: 48, display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '8px 0', gap: 2, background: '#f3f2ee',
        borderRight: '1px solid #e5e3dc', flexShrink: 0,
      }}>
        <NavBtn icon={<IconChat />} label="New chat" onClick={onNewChat} />
        <NavBtn icon={<IconFolder />} label="Open folder" onClick={onPickFolder} />
        <NavBtn icon={<IconPanel />} label="Toggle sidebar" active={panelOpen} onClick={togglePanel} />

        {/* Spacer pushes settings to bottom */}
        <div style={{ flex: 1 }} />

        <NavBtn icon={<IconSettings />} label="Settings (coming soon)" />
      </div>

      {/* Edits panel — collapsible + resizable */}
      {panelOpen && <div style={{
        width: panelWidth, height: '100%', display: 'flex', flexDirection: 'column',
        background: '#f3f2ee',
        overflow: 'hidden', flexShrink: 0, position: 'relative',
      }}>
        {allEdits.length > 0 ? (
          <>
            <div style={{ padding: '10px 10px 6px', fontSize: 11, fontWeight: 700, color: '#8c8c84', letterSpacing: 0.4, textTransform: 'uppercase', userSelect: 'none' }}>
              Edits ({allEdits.length})
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
              {allEdits.map((edit, i) => (
                <EditCard key={i} edit={edit} />
              ))}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'hidden' }}>
            <svg viewBox="0 0 680 520" role="img" style={{ opacity: 0.6, width: 160, height: 122, flexShrink: 0 }}>
              <title>Cartoon dog standing next to a sign</title>
              <style>{`.line{fill:none;stroke:#b8b4ac;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.body{fill:#ede9e2;stroke:#b8b4ac;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.ear{fill:#e0dcd4;stroke:#b8b4ac;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.sign{fill:#f5f3ef;stroke:#b8b4ac;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.sign-text{font-family:Georgia,serif;fill:#8c8880}`}</style>
              <rect x="282" y="290" width="8" height="172" rx="3" className="body"/>
              <rect x="188" y="190" width="158" height="104" rx="6" className="sign"/>
              <line x1="200" y1="208" x2="334" y2="208" className="line" strokeWidth="0.6" stroke="#d0ccc4"/><line x1="200" y1="224" x2="334" y2="224" className="line" strokeWidth="0.6" stroke="#d0ccc4"/><line x1="200" y1="240" x2="334" y2="240" className="line" strokeWidth="0.6" stroke="#d0ccc4"/><line x1="200" y1="256" x2="334" y2="256" className="line" strokeWidth="0.6" stroke="#d0ccc4"/><line x1="200" y1="272" x2="334" y2="272" className="line" strokeWidth="0.6" stroke="#d0ccc4"/>
              <circle cx="200" cy="200" r="3.5" fill="#c8c4bc"/><circle cx="334" cy="200" r="3.5" fill="#c8c4bc"/><circle cx="200" cy="286" r="3.5" fill="#c8c4bc"/><circle cx="334" cy="286" r="3.5" fill="#c8c4bc"/>
              <text x="267" y="234" textAnchor="middle" className="sign-text" fontSize="13" fontStyle="italic">edits will</text>
              <text x="267" y="254" textAnchor="middle" className="sign-text" fontSize="13" fontStyle="italic">appear here</text>
              <ellipse cx="436" cy="340" rx="58" ry="50" className="body"/>
              <path d="M490 320 Q524 300 528 276 Q532 256 518 250 Q508 246 504 258 Q514 264 510 282 Q504 302 472 318" className="body" strokeWidth="2.4"/>
              <path d="M382 318 Q350 310 308 300" className="body" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round"/><path d="M382 318 Q350 310 308 300" fill="none" stroke="#b8b4ac" strokeWidth="1.8" strokeLinecap="round"/>
              <ellipse cx="300" cy="297" rx="12" ry="8" className="body"/><line x1="292" y1="291" x2="288" y2="285" className="line" strokeWidth="1.2"/><line x1="299" y1="289" x2="297" y2="283" className="line" strokeWidth="1.2"/><line x1="306" y1="290" x2="306" y2="284" className="line" strokeWidth="1.2"/>
              <path d="M488 326 Q500 354 502 388" className="body" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round"/><path d="M488 326 Q500 354 502 388" fill="none" stroke="#b8b4ac" strokeWidth="1.8" strokeLinecap="round"/>
              <ellipse cx="503" cy="394" rx="12" ry="8" className="body"/><line x1="495" y1="388" x2="491" y2="382" className="line" strokeWidth="1.2"/><line x1="502" y1="386" x2="500" y2="380" className="line" strokeWidth="1.2"/><line x1="509" y1="387" x2="511" y2="381" className="line" strokeWidth="1.2"/>
              <path d="M404 384 Q398 416 396 458" className="body" strokeWidth="22" strokeLinecap="round"/><path d="M404 384 Q398 416 396 458" fill="none" stroke="#b8b4ac" strokeWidth="1.8" strokeLinecap="round"/><ellipse cx="396" cy="460" rx="18" ry="8" className="body"/>
              <path d="M468 384 Q474 416 476 458" className="body" strokeWidth="22" strokeLinecap="round"/><path d="M468 384 Q474 416 476 458" fill="none" stroke="#b8b4ac" strokeWidth="1.8" strokeLinecap="round"/><ellipse cx="476" cy="460" rx="18" ry="8" className="body"/>
              <ellipse cx="436" cy="252" rx="50" ry="46" className="body"/>
              <path d="M390 238 Q366 226 360 246 Q354 268 360 286 Q366 300 380 296 Q392 290 390 272 Q388 252 390 240" className="ear"/><path d="M482 238 Q506 226 512 246 Q518 268 512 286 Q506 300 492 296 Q480 290 482 272 Q484 252 482 240" className="ear"/>
              <ellipse cx="436" cy="268" rx="20" ry="15" className="body"/><ellipse cx="436" cy="261" rx="7" ry="5.5" fill="#c8c4bc"/><path d="M427 272 Q436 280 445 272" className="line" strokeWidth="1.4"/>
              <ellipse cx="421" cy="244" rx="7" ry="7" className="body"/><ellipse cx="451" cy="244" rx="7" ry="7" className="body"/><ellipse cx="422" cy="245" rx="3.5" ry="3.5" fill="#b8b4ac"/><ellipse cx="452" cy="245" rx="3.5" ry="3.5" fill="#b8b4ac"/><circle cx="424" cy="243" r="1.2" fill="#f0ede8"/><circle cx="454" cy="243" r="1.2" fill="#f0ede8"/>
              <path d="M413 234 Q421 228 429 232" className="line" strokeWidth="1.4"/><path d="M443 232 Q451 228 459 234" className="line" strokeWidth="1.4"/>
              <path d="M426 210 Q436 200 446 210" className="line" strokeWidth="1.4"/>
              <path d="M400 292 Q436 284 472 292" className="line" strokeWidth="3"/><circle cx="436" cy="296" r="5" className="body" strokeWidth="1.5"/>
              <line x1="100" y1="468" x2="600" y2="468" className="line" strokeWidth="1" stroke="#d0ccc4"/>
            </svg>
          </div>
        )}

        {/* Drag handle on right edge */}
        <div
          onMouseDown={onDragStart}
          style={{
            position: 'absolute', top: 0, right: -2, width: 5, height: '100%',
            cursor: 'col-resize', zIndex: 10,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.08)'}
          onMouseLeave={(e) => { if (!dragging.current) e.currentTarget.style.background = 'transparent'; }}
        />
      </div>}

      {/* Thin border between sidebar and main content */}
      <div style={{ width: 1, background: '#e5e3dc', flexShrink: 0 }} />
    </div>
  );
}
