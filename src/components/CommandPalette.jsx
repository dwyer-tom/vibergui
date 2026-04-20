import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// Simple fuzzy scorer: returns null if miss, number score if hit (lower = better).
function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = (text || '').toLowerCase();
  if (!t) return null;
  if (t.includes(q)) return t.indexOf(q); // strong boost: substring match
  let qi = 0, score = 0, lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += ti - lastIdx;
      lastIdx = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  return 1000 + score;
}

export default function CommandPalette({
  open, onClose,
  sessions, projects,
  currentSessionId, activeProjectId,
  onLoadSession, onNewChat, onSetActiveProject,
}) {
  const [query, setQuery] = useState('');
  const [ftsResults, setFtsResults] = useState([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setFtsResults([]);
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // FTS search for message contents
  useEffect(() => {
    if (!open || !query.trim()) { setFtsResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await window.api.history.search(query, {});
      if (!cancelled) setFtsResults(res?.ok ? res.results : []);
    }, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);

  // Build a flat list of commands + items
  const items = useMemo(() => {
    const out = [];

    // Static commands
    const cmds = [
      { kind: 'cmd', id: 'new-chat', label: 'New chat', hint: 'Start a fresh conversation', action: () => onNewChat() },
    ];
    for (const c of cmds) {
      const score = fuzzyScore(query, c.label);
      if (score != null) out.push({ ...c, score: score - 200 }); // prioritize commands
    }

    // Projects (switch to)
    for (const p of projects) {
      const score = fuzzyScore(query, `switch ${p.name}`);
      const nameScore = fuzzyScore(query, p.name);
      const best = [score, nameScore].filter((x) => x != null).sort((a, b) => a - b)[0];
      if (best != null) {
        out.push({
          kind: 'project', id: `p${p.id}`,
          label: p.name,
          hint: `Switch to project${p.id === activeProjectId ? ' · active' : ''}`,
          action: () => onSetActiveProject(p.id),
          score: best,
        });
      }
    }

    // Chats by title (from all sessions)
    const seen = new Set();
    for (const s of sessions) {
      const score = fuzzyScore(query, s.title || 'Untitled');
      if (score != null) {
        seen.add(s.id);
        const proj = s.project_id != null ? projects.find((p) => p.id === s.project_id) : null;
        out.push({
          kind: 'chat', id: `c${s.id}`,
          label: s.title || 'Untitled',
          hint: proj ? `Chat · ${proj.name}` : 'Chat · No project',
          action: () => onLoadSession(s.id),
          score: score + 10,
        });
      }
    }

    // Message content hits from FTS (skip ones already shown by title)
    for (const r of ftsResults) {
      if (seen.has(r.session_id)) continue;
      seen.add(r.session_id);
      const proj = r.project_id != null ? projects.find((p) => p.id === r.project_id) : null;
      out.push({
        kind: 'chat', id: `c${r.session_id}`,
        label: r.title || 'Untitled',
        hint: stripMarks(r.snippet) || (proj ? `Chat · ${proj.name}` : 'Chat'),
        snippetHtml: r.snippet ? escapeAndHighlight(r.snippet) : null,
        action: () => onLoadSession(r.session_id),
        score: 40,
      });
    }

    out.sort((a, b) => a.score - b.score);
    return out.slice(0, 30);
  }, [query, sessions, projects, ftsResults, activeProjectId, onNewChat, onLoadSession, onSetActiveProject]);

  const runItem = useCallback((it) => {
    if (!it) return;
    it.action();
    onClose();
  }, [onClose]);

  // Keyboard
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); return; }
      if (e.key === 'Enter')     { e.preventDefault(); runItem(items[sel]); return; }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, items, sel, runItem, onClose]);

  // Keep selection in view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${sel}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  // Reset selection when list changes
  useEffect(() => { setSel(0); }, [query, ftsResults.length]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(26,26,25,0.28)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)',
          background: '#ffffff',
          border: '1px solid #d8d5cc',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(0,0,0,0.24)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0ede8', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, color: '#8c8c84' }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats, projects, commands…"
            style={{
              flex: 1, background: 'transparent', border: 'none',
              fontSize: 15, color: '#1a1a19', outline: 'none',
            }}
          />
          <span style={{ fontSize: 10, color: '#a9a69e', fontFamily: 'ui-monospace, monospace' }}>esc</span>
        </div>

        <div ref={listRef} style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto', padding: 6 }}>
          {items.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#a9a69e' }}>
              {query ? 'No matches' : 'Type to search your chats and projects'}
            </div>
          )}
          {items.map((it, i) => {
            const active = i === sel;
            return (
              <div
                key={`${it.kind}-${it.id}`}
                data-idx={i}
                onMouseEnter={() => setSel(i)}
                onClick={() => runItem(it)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  background: active ? '#f1efe9' : 'transparent',
                  borderRadius: 8, cursor: 'pointer',
                }}
              >
                <KindBadge kind={it.kind} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a19', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.label}
                  </div>
                  {it.snippetHtml ? (
                    <div
                      style={{ fontSize: 11, color: '#8c8c84', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}
                      dangerouslySetInnerHTML={{ __html: it.snippetHtml }}
                    />
                  ) : it.hint ? (
                    <div style={{ fontSize: 11, color: '#a9a69e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                      {it.hint}
                    </div>
                  ) : null}
                </div>
                {active && (
                  <span style={{ fontSize: 10, color: '#a9a69e', fontFamily: 'ui-monospace, monospace' }}>↵</span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{
          padding: '8px 14px', borderTop: '1px solid #f0ede8',
          display: 'flex', alignItems: 'center', gap: 14,
          fontSize: 10, color: '#a9a69e',
        }}>
          <Hint keys="↑↓" label="navigate" />
          <Hint keys="↵" label="open" />
          <Hint keys="esc" label="close" />
        </div>
      </div>
    </div>
  );
}

function KindBadge({ kind }) {
  const map = {
    chat:    { label: 'chat',    color: '#3178c6', bg: '#e8f0fb' },
    project: { label: 'project', color: '#166534', bg: '#dcfce7' },
    cmd:     { label: 'cmd',     color: '#6b21a8', bg: '#f3e8ff' },
  };
  const m = map[kind] || map.chat;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color: m.color, background: m.bg,
      textTransform: 'uppercase', letterSpacing: 0.4,
      padding: '2px 6px', borderRadius: 4, flexShrink: 0,
      minWidth: 42, textAlign: 'center',
    }}>{m.label}</span>
  );
}

function Hint({ keys, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <kbd style={{
        fontFamily: 'ui-monospace, monospace',
        fontSize: 9, color: '#6b6960',
        background: '#f3f2ee', border: '1px solid #e5e3dc',
        borderRadius: 3, padding: '1px 4px',
      }}>{keys}</kbd>
      <span>{label}</span>
    </span>
  );
}

function stripMarks(s) {
  return (s || '').replace(/\[/g, '').replace(/\]/g, '');
}

function escapeAndHighlight(snippet) {
  const escaped = snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\[/g, '<mark style="background:#fef3c7;color:#1a1a19;padding:0 1px;border-radius:2px;">')
    .replace(/\]/g, '</mark>');
}
