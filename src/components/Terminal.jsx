import React, { useState, useEffect, useRef, useCallback } from 'react';

const MIN_H = 120, MAX_H = 600, DEFAULT_H = 240;

// Terminals are always dark — that's the convention even in light-mode IDEs.
// We do dial the darkness based on OS theme to avoid total jarring contrast.
const LIGHT = {
  bg:         '#23241f',   // slightly warmer than pure black
  border:     '#3a3a36',
  headerBg:   '#1d1e1a',
  headerText: '#6b6960',
  btnFg:      '#5c5c54',
  btnHovFg:   '#c8c5bc',
  btnHovBg:   '#2e2e2b',
  stdout:     '#c8c5bc',
  stderr:     '#f87171',
  info:       '#4a4a46',
  cmdText:    '#e8e6df',
  running:    '#4a4a46',
  prompt:     '#d97706',
  caret:      '#d97706',
  selection:  'rgba(217,119,6,0.2)',
};

const DARK = {
  bg:         '#1a1a19',
  border:     '#3a3a36',
  headerBg:   '#161615',
  headerText: '#5c5c54',
  btnFg:      '#4a4a46',
  btnHovFg:   '#c8c5bc',
  btnHovBg:   '#2a2a27',
  stdout:     '#c8c5bc',
  stderr:     '#f87171',
  info:       '#4a4a46',
  cmdText:    '#e8e6df',
  running:    '#4a4a46',
  prompt:     '#d97706',
  caret:      '#d97706',
  selection:  'rgba(217,119,6,0.2)',
};

function useColorScheme() {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return dark;
}

export default function Terminal({ folder, onClose }) {
  const t = useColorScheme() ? DARK : LIGHT;
  const [lines, setLines] = useState([{ type: 'info', text: 'ready' }]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [height, setHeight] = useState(() => {
    const s = localStorage.getItem('codelocal-term-h');
    return s ? Number(s) : DEFAULT_H;
  });

  const outputRef  = useRef(null);
  const inputRef   = useRef(null);
  const dragging   = useRef(false);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [lines, running]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const addLines = (newLines) => setLines(prev => [...prev, ...newLines]);

  const run = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || running) return;
    if (!folder) { addLines([{ type: 'stderr', text: 'No folder open.' }]); return; }

    setHistory(h => [cmd, ...h.filter(x => x !== cmd)].slice(0, 200));
    setHistIdx(-1);
    addLines([{ type: 'input', text: cmd }]);
    setInput('');
    setRunning(true);

    const res = await window.api.runBash(cmd, folder);
    setRunning(false);

    const out = [];
    if (res.stdout?.trim()) res.stdout.trimEnd().split('\n').forEach(l => out.push({ type: 'stdout', text: l }));
    if (res.stderr?.trim()) res.stderr.trimEnd().split('\n').forEach(l => out.push({ type: 'stderr', text: l }));
    if (out.length === 0 && !res.ok) out.push({ type: 'stderr', text: `exited with code ${res.code}` });
    if (out.length > 0) addLines(out);
  }, [input, running, folder]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); run();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHistIdx(i => {
        const next = Math.min(i + 1, history.length - 1);
        if (history[next] !== undefined) setInput(history[next]);
        return next;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHistIdx(i => {
        const next = Math.max(i - 1, -1);
        setInput(next === -1 ? '' : (history[next] ?? ''));
        return next;
      });
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault(); setLines([]);
    }
  };

  const onDragStart = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    dragStartY.current = e.clientY;
    dragStartH.current = height;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [height]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const delta = dragStartY.current - e.clientY;
      setHeight(Math.min(MAX_H, Math.max(MIN_H, dragStartH.current + delta)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setHeight(h => { localStorage.setItem('codelocal-term-h', String(h)); return h; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const folderName = folder ? folder.split(/[\\/]/).pop() : '~';

  return (
    <div style={{
      height, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: t.bg,
      borderTop: `1px solid ${t.border}`,
    }}>
      {/* Resize handle */}
      <div
        onMouseDown={onDragStart}
        style={{ height: 3, flexShrink: 0, cursor: 'row-resize', transition: 'background 0.12s' }}
        onMouseEnter={e  => e.currentTarget.style.background = 'rgba(217,119,6,0.4)'}
        onMouseLeave={e  => { if (!dragging.current) e.currentTarget.style.background = 'transparent'; }}
      />

      {/* Header */}
      <div style={{
        height: 32, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 4px 0 12px',
        background: t.headerBg,
        borderBottom: `1px solid ${t.border}`,
      }}>
        {/* Left: shell label + folder */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(217,119,6,0.12)',
            border: '1px solid rgba(217,119,6,0.2)',
            borderRadius: 4, padding: '2px 7px',
            flexShrink: 0,
          }}>
            <span style={{ color: '#d97706', fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, letterSpacing: 0.3, userSelect: 'none' }}>
              bash
            </span>
          </div>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, fontWeight: 400,
            color: t.headerText,
            userSelect: 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {folderName}
          </span>
        </div>
        {/* Right: actions */}
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {/* Clear */}
          <TinyBtn t={t} onClick={() => setLines([])} title="Clear (Ctrl+L)">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M2 12h8M2 8h10M2 4h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M13 10l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </TinyBtn>
          {/* Close — chevron down */}
          <TinyBtn t={t} onClick={onClose} title="Hide terminal">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M3 5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </TinyBtn>
        </div>
      </div>

      {/* Output — click anywhere to focus input */}
      <div
        ref={outputRef}
        onClick={() => inputRef.current?.focus()}
        style={{
          flex: 1, overflowY: 'auto',
          padding: '10px 16px 0',
          cursor: 'text',
          background: t.bg,
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12, lineHeight: 1.8,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {line.type === 'input' && (
              <span>
                <span style={{ color: t.prompt, opacity: 0.5, marginRight: 6 }}>›</span>
                <span style={{ color: t.cmdText }}>{line.text}</span>
              </span>
            )}
            {line.type === 'stdout' && <span style={{ color: t.stdout }}>{line.text || '\u00a0'}</span>}
            {line.type === 'stderr' && <span style={{ color: t.stderr }}>{line.text}</span>}
            {line.type === 'info'   && <span style={{ color: t.info }}>{line.text}</span>}
          </div>
        ))}
        {running && (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.8, color: t.running }}>
            <Spinner />
          </div>
        )}
        {/* Spacer so last line isn't flush against input */}
        <div style={{ height: 8 }} />
      </div>

      {/* Input row — inline on the terminal bg, no box */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 16px 10px',
          background: t.bg,
          borderTop: `1px solid rgba(255,255,255,0.04)`,
        }}
        onClick={() => inputRef.current?.focus()}
      >
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, color: t.prompt,
          flexShrink: 0, userSelect: 'none', lineHeight: 1,
        }}>
          ›
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); setHistIdx(-1); }}
          onKeyDown={handleKeyDown}
          disabled={running}
          spellCheck={false} autoComplete="off" autoCorrect="off"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: t.cmdText,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12, lineHeight: 1,
            caretColor: t.caret,
          }}
        />
      </div>
    </div>
  );
}

function TinyBtn({ t, onClick, title, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 26, height: 26,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hov ? t.btnHovBg : 'transparent',
        border: 'none', cursor: 'pointer',
        color: hov ? t.btnHovFg : t.btnFg,
        borderRadius: 4,
        transition: 'background 0.1s, color 0.1s',
      }}
    >
      {children}
    </button>
  );
}

function Spinner() {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI(n => (n + 1) % frames.length), 100);
    return () => clearInterval(id);
  }, []);
  return <span style={{ color: '#d97706', opacity: 0.7 }}>{frames[i]}</span>;
}
