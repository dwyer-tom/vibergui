import React, { useState, useEffect, useCallback, useRef } from 'react';

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatHistory({ folder, currentSessionId, onLoad, onNewChat, activeProjectId, onSetActiveProject, projects = [], onProjectsChanged }) {
  const [sessions, setSessions] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  // scope: 'project' (active project) | 'all'
  const [scope, setScope] = useState('project');
  const [renamingId, setRenamingId] = useState(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [moveMenuId, setMoveMenuId] = useState(null);

  const effectiveProjectId = scope === 'all' ? undefined : (activeProjectId ?? 0);

  const refresh = useCallback(async () => {
    setLoading(true);
    const opts = scope === 'all' ? {} : { projectId: effectiveProjectId };
    const res = await window.api.history.list(opts);
    setSessions(res?.ok ? res.sessions : []);
    setLoading(false);
  }, [scope, effectiveProjectId]);

  useEffect(() => { refresh(); }, [refresh, currentSessionId]);

  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const opts = scope === 'all' ? {} : { projectId: effectiveProjectId };
      const res = await window.api.history.search(query, opts);
      if (!cancelled) setResults(res?.ok ? res.results : []);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, scope, effectiveProjectId]);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this chat?')) return;
    await window.api.history.remove(id);
    if (id === currentSessionId) onNewChat?.();
    refresh();
  };

  const startRename = (e, id) => {
    e.stopPropagation();
    setRenamingId(id);
  };

  const submitRename = async (id, title, currentTitle) => {
    setRenamingId(null);
    const next = (title || '').trim();
    if (!next || next === currentTitle) return;
    await window.api.history.rename(id, next);
    refresh();
  };

  const handleMove = async (sessionId, projectId) => {
    setMoveMenuId(null);
    await window.api.history.move(sessionId, projectId);
    onProjectsChanged?.();
    refresh();
  };

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeLabel = activeProject ? activeProject.name : 'No project';

  const listItems = results
    ? results.map((r) => ({
        id: r.session_id,
        title: r.title,
        folder: r.folder,
        project_id: r.project_id,
        updated_at: r.updated_at,
        snippet: r.snippet,
      }))
    : sessions;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Project switcher */}
      <div style={{ padding: '10px 10px 4px', position: 'relative' }}>
        <button
          onClick={() => setSwitcherOpen((o) => !o)}
          style={{
            width: '100%', background: '#ebe8e1', border: '1px solid #e5e3dc',
            borderRadius: 6, padding: '6px 8px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 12, fontWeight: 600, color: '#1a1a19',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {scope === 'all' ? 'All chats' : activeLabel}
          </span>
          <span style={{ fontSize: 9, color: '#8c8c84' }}>▼</span>
        </button>
        {switcherOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 10, right: 10,
            background: '#ffffff', border: '1px solid #d8d5cc',
            borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            zIndex: 20, marginTop: 2, maxHeight: 260, overflowY: 'auto',
          }}>
            <SwitcherItem label="All chats" active={scope === 'all'} onClick={() => { setScope('all'); setSwitcherOpen(false); }} />
            <SwitcherItem label="No project" active={scope === 'project' && activeProjectId == null} onClick={() => { setScope('project'); onSetActiveProject(null); setSwitcherOpen(false); }} />
            {projects.map((p) => (
              <SwitcherItem
                key={p.id}
                label={p.name}
                active={scope === 'project' && activeProjectId === p.id}
                count={p.chat_count}
                onClick={() => { setScope('project'); onSetActiveProject(p.id); setSwitcherOpen(false); }}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '4px 10px 6px', fontSize: 11, fontWeight: 700, color: '#8c8c84', letterSpacing: 0.4, textTransform: 'uppercase', userSelect: 'none' }}>
        Chats
      </div>

      <div style={{ padding: '0 10px 8px' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search messages…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#ffffff', border: '1px solid #e5e3dc',
            borderRadius: 6, padding: '6px 8px',
            fontSize: 12, color: '#1a1a19', outline: 'none',
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
        {loading && <div style={{ padding: 12, fontSize: 11, color: '#8c8c84' }}>Loading…</div>}
        {!loading && listItems.length === 0 && (
          <div style={{ padding: 12, fontSize: 11, color: '#8c8c84', textAlign: 'center' }}>
            {query ? 'No matches' : 'No chats yet'}
          </div>
        )}
        {listItems.map((s) => {
          const active = s.id === currentSessionId;
          return (
            <SessionRow
              key={`${s.id}-${s.snippet || ''}`}
              s={s}
              active={active}
              renaming={renamingId === s.id}
              moveOpen={moveMenuId === s.id}
              projects={projects}
              onClick={() => onLoad(s.id)}
              onDelete={(e) => handleDelete(e, s.id)}
              onRename={(e) => startRename(e, s.id)}
              onRenameSubmit={(title) => submitRename(s.id, title, s.title)}
              onRenameCancel={() => setRenamingId(null)}
              onOpenMove={(e) => { e.stopPropagation(); setMoveMenuId((cur) => cur === s.id ? null : s.id); }}
              onMove={(projectId) => handleMove(s.id, projectId)}
              onCloseMove={() => setMoveMenuId(null)}
            />
          );
        })}
      </div>
    </div>
  );
}

function SwitcherItem({ label, active, count, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '6px 10px', fontSize: 12, cursor: 'pointer',
        background: active ? '#e8e6df' : hovered ? '#f5f3ef' : 'transparent',
        color: '#1a1a19', fontWeight: active ? 600 : 500,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {count != null && <span style={{ fontSize: 10, color: '#8c8c84' }}>{count}</span>}
    </div>
  );
}

function SessionRow({ s, active, renaming, moveOpen, projects, onClick, onDelete, onRename, onRenameSubmit, onRenameCancel, onOpenMove, onMove, onCloseMove }) {
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState(s.title || '');
  const moveRef = useRef(null);
  useEffect(() => { if (renaming) setDraft(s.title || ''); }, [renaming, s.title]);

  useEffect(() => {
    if (!moveOpen) return;
    const handler = (e) => {
      if (moveRef.current && !moveRef.current.contains(e.target)) onCloseMove();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moveOpen, onCloseMove]);

  return (
    <div
      onClick={renaming ? (e) => e.stopPropagation() : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        background: active ? '#e8e6df' : hovered ? '#ffffff' : 'transparent',
        border: '1px solid',
        borderColor: active ? '#d8d5cc' : hovered ? '#e5e3dc' : 'transparent',
        borderRadius: 8, padding: '8px 10px', marginBottom: 4,
        cursor: renaming ? 'default' : 'pointer', transition: 'background 0.12s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onRenameSubmit(draft); }
              if (e.key === 'Escape') { e.preventDefault(); onRenameCancel(); }
            }}
            onBlur={() => onRenameSubmit(draft)}
            style={{
              flex: 1, fontSize: 12, fontWeight: 600, color: '#1a1a19',
              background: '#ffffff', border: '1px solid #d8d5cc', borderRadius: 4,
              padding: '2px 4px', outline: 'none', minWidth: 0,
            }}
          />
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a19', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={s.title}>
            {s.title || 'Untitled'}
          </span>
        )}
        <span style={{ fontSize: 10, color: '#8c8c84', flexShrink: 0 }}>{formatTime(s.updated_at)}</span>
      </div>
      {s.snippet && (
        <div style={{ fontSize: 11, color: '#6b6960', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          dangerouslySetInnerHTML={{ __html: escapeAndHighlight(s.snippet) }}
        />
      )}
      {hovered && !renaming && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button onClick={onRename} style={rowBtn}>Rename</button>
          <button onClick={onOpenMove} style={rowBtn}>Move</button>
          <button onClick={onDelete} style={{ ...rowBtn, color: '#dc2626' }}>Delete</button>
        </div>
      )}
      {moveOpen && (
        <div
          ref={moveRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', left: 10, right: 10,
            background: '#ffffff', border: '1px solid #d8d5cc',
            borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            zIndex: 15, marginTop: 2, maxHeight: 200, overflowY: 'auto',
          }}
        >
          <SwitcherItem label="No project" active={s.project_id == null} onClick={() => onMove(null)} />
          {projects.map((p) => (
            <SwitcherItem
              key={p.id}
              label={p.name}
              active={s.project_id === p.id}
              onClick={() => onMove(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const rowBtn = {
  background: 'transparent', border: '1px solid #e5e3dc',
  borderRadius: 4, padding: '2px 6px', fontSize: 10,
  cursor: 'pointer', color: '#6b6960',
};

function escapeAndHighlight(snippet) {
  const escaped = snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\[/g, '<mark style="background:#fef3c7;color:#1a1a19;padding:0 1px;border-radius:2px;">')
    .replace(/\]/g, '</mark>');
}
