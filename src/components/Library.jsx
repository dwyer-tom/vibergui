import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// ── time bucketing (ChatGPT-style) ────────────────────────────────────────
const TIME_BUCKETS = [
  { key: 'today',     label: 'Today',            maxDays: 1 },
  { key: 'yesterday', label: 'Yesterday',        maxDays: 2 },
  { key: 'week',      label: 'Previous 7 days',  maxDays: 7 },
  { key: 'month',     label: 'Previous 30 days', maxDays: 30 },
  { key: 'older',     label: 'Older',            maxDays: Infinity },
];

function bucketSessions(sessions) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets = TIME_BUCKETS.map((b) => ({ ...b, items: [] }));
  for (const s of sessions) {
    const d = new Date(s.updated_at);
    const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = (startOfToday - startOfThat) / 86400000;
    for (const b of buckets) {
      if (diffDays < b.maxDays) { b.items.push(s); break; }
    }
  }
  return buckets.filter((b) => b.items.length);
}

function formatRelative(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffMin = (now - d) / 60000;
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`;
  const diffHr = diffMin / 60;
  if (diffHr < 24 && d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diffDays = diffHr / 24;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function projectColor(id) {
  const palette = ['#3b82f6', '#8b5cf6', '#10b981', '#d97706', '#ef4444', '#ec4899', '#14b8a6', '#6366f1'];
  if (id == null) return '#a9a69e';
  return palette[id % palette.length];
}

// ── dropdown menu ─────────────────────────────────────────────────────────
function DropMenu({ children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', top: '100%', right: 8, marginTop: 6,
        background: '#ffffff', border: '1px solid #e0ddd6',
        borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.14)',
        zIndex: 30, minWidth: 180, padding: 5,
      }}
    >
      {children}
    </div>
  );
}

function MenuItem({ label, onClick, danger, disabled }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '8px 12px', fontSize: 12.5, cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#c0bdb5' : danger ? '#dc2626' : '#1a1a19',
        background: hover && !disabled ? '#f5f3ef' : 'transparent',
        borderRadius: 6, userSelect: 'none',
      }}
    >
      {label}
    </div>
  );
}

const MenuSep = () => <div style={{ height: 1, background: '#f0ede8', margin: '4px 2px' }} />;
const MenuLabel = ({ label }) => (
  <div style={{ padding: '6px 12px 3px', fontSize: 9, color: '#a9a69e', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
    {label}
  </div>
);

// ── icons ─────────────────────────────────────────────────────────────────
const IconDots = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="3.5" cy="8" r="1.4" fill="#6b6960" />
    <circle cx="8"   cy="8" r="1.4" fill="#6b6960" />
    <circle cx="12.5" cy="8" r="1.4" fill="#6b6960" />
  </svg>
);
const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="7" cy="7" r="4.5" stroke="#8c8c84" strokeWidth="1.5" fill="none" />
    <path d="M10.4 10.4L13.5 13.5" stroke="#8c8c84" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const IconClose = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

// ── project chip ─────────────────────────────────────────────────────────
function ProjectChip({
  id, name, count, active, renaming,
  onClick, onRenameStart, onRenameSubmit, onRenameCancel,
  onSetFolder, onDelete, menuOpen, onToggleMenu, onCloseMenu,
}) {
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState(name || '');
  useEffect(() => { if (renaming) setDraft(name || ''); }, [renaming, name]);
  const color = projectColor(id);
  const isSpecial = id === '__all__' || id === null;

  return (
    <div
      onClick={renaming ? (e) => e.stopPropagation() : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '8px 14px',
        background: active ? '#ffffff' : hovered ? '#ffffff' : '#f9f8f4',
        border: '1px solid',
        borderColor: active ? '#1a1a19' : '#e0ddd6',
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        color: '#3a3a33',
        cursor: renaming ? 'default' : 'pointer',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : '0 1px 2px rgba(0,0,0,0.03)',
        transition: 'all 0.12s',
        whiteSpace: 'nowrap',
      }}
    >
      {id === '__all__' ? (
        <span style={{ width: 9, height: 9, borderRadius: 2, background: '#1a1a19', flexShrink: 0 }} />
      ) : (
        <span style={{
          width: 9, height: 9, borderRadius: '50%',
          background: id == null ? 'transparent' : color,
          border: id == null ? '1.5px solid #a9a69e' : 'none',
          flexShrink: 0,
        }} />
      )}

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
            fontSize: 12.5, fontWeight: 600, color: '#1a1a19',
            background: 'transparent', border: 'none', outline: 'none',
            minWidth: 80, maxWidth: 200,
          }}
        />
      ) : (
        <span>{name}</span>
      )}
      {count != null && (
        <span style={{ fontSize: 10.5, color: '#a9a69e', fontWeight: 500 }}>{count}</span>
      )}

      {!isSpecial && !renaming && (hovered || menuOpen) && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 0, marginLeft: 2, display: 'flex', alignItems: 'center',
          }}
          title="More"
        ><IconDots /></button>
      )}

      {menuOpen && (
        <DropMenu onClose={onCloseMenu}>
          <MenuItem label="Rename" onClick={() => { onCloseMenu(); onRenameStart(); }} />
          <MenuItem label="Set folder…" onClick={() => { onCloseMenu(); onSetFolder(); }} />
          <MenuSep />
          <MenuItem label="Delete project" danger onClick={onDelete} />
        </DropMenu>
      )}
    </div>
  );
}

// ── chat card ─────────────────────────────────────────────────────────────
function ChatCard({
  session, active, projectColor: accent, projectName,
  renaming, onRenameStart, onRenameSubmit, onRenameCancel,
  menuOpen, onOpenMenu, onCloseMenu,
  projects, onLoad, onMove, onDelete,
}) {
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState(session.title || '');
  useEffect(() => { if (renaming) setDraft(session.title || ''); }, [renaming, session.title]);

  return (
    <div
      onClick={renaming ? (e) => e.stopPropagation() : () => onLoad(session.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 18px',
        background: '#ffffff',
        border: '1px solid',
        borderColor: active ? '#d8d5cc' : hovered ? '#e0ddd6' : '#ece9e2',
        borderRadius: 12,
        cursor: renaming ? 'default' : 'pointer',
        transition: 'all 0.12s',
        boxShadow: hovered ? '0 4px 14px rgba(0,0,0,0.05)' : '0 1px 2px rgba(0,0,0,0.03)',
        marginBottom: 8,
      }}
    >
      {accent && (
        <span style={{
          width: 4, alignSelf: 'stretch', borderRadius: 3,
          background: accent, flexShrink: 0, marginLeft: -4,
        }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
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
              width: '100%',
              fontSize: 14, fontWeight: 600, color: '#1a1a19',
              background: 'transparent', border: '1px solid #d8d5cc',
              borderRadius: 4, padding: '2px 6px', outline: 'none',
            }}
          />
        ) : (
          <div style={{
            fontSize: 14, fontWeight: 500, color: '#1a1a19',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            letterSpacing: -0.1,
          }} title={session.title}>
            {session.title || 'Untitled'}
          </div>
        )}
        <div style={{
          marginTop: 4, display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 11, color: '#8c8c84',
        }}>
          {projectName && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent || '#a9a69e' }} />
              {projectName}
            </span>
          )}
          <span>{formatRelative(session.updated_at)}</span>
          {session.snippet && (
            <span
              style={{
                flex: 1, minWidth: 0, color: '#6b6960', fontStyle: 'italic',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
              dangerouslySetInnerHTML={{ __html: escapeAndHighlight(session.snippet) }}
            />
          )}
        </div>
      </div>

      {!renaming && (hovered || menuOpen) && (
        <button
          onClick={(e) => { e.stopPropagation(); onOpenMenu(); }}
          style={{
            background: '#f9f8f4', border: '1px solid #e5e3dc', cursor: 'pointer',
            width: 28, height: 28, borderRadius: 7, display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
          title="More"
        ><IconDots /></button>
      )}

      {menuOpen && (
        <DropMenu onClose={onCloseMenu}>
          <MenuItem label="Rename" onClick={() => { onCloseMenu(); onRenameStart(); }} />
          <MenuSep />
          <MenuLabel label="Move to" />
          <MenuItem label="No project" onClick={() => onMove(null)} disabled={session.project_id == null} />
          {projects.map((p) => (
            <MenuItem
              key={p.id}
              label={p.name}
              onClick={() => onMove(p.id)}
              disabled={session.project_id === p.id}
            />
          ))}
          <MenuSep />
          <MenuItem label="Delete chat" danger onClick={onDelete} />
        </DropMenu>
      )}
    </div>
  );
}

function escapeAndHighlight(snippet) {
  const escaped = (snippet || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\[/g, '<mark style="background:#fef3c7;color:#1a1a19;padding:0 2px;border-radius:2px;">')
    .replace(/\]/g, '</mark>');
}

// ── main ──────────────────────────────────────────────────────────────────
export default function Library({
  onLoadSession, onNewChat, onClose,
  currentSessionId,
  activeProjectId, onSetActiveProject,
  projects, onProjectsChanged,
  onOpenCommandPalette,
  folderName,
}) {
  const [allSessions, setAllSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [scope, setScope] = useState(() => localStorage.getItem('codelocal-library-scope') || 'all');
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [menuKey, setMenuKey] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => { localStorage.setItem('codelocal-library-scope', scope); }, [scope]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await window.api.history.list({});
    setAllSessions(res?.ok ? res.sessions : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [refresh]);

  // Search (FTS over messages)
  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await window.api.history.search(query, {});
      if (!cancelled) setResults(res?.ok ? res.results : []);
    }, 160);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  // Esc closes when search is empty
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape' && !query) onClose?.();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [query, onClose]);

  const projectCounts = useMemo(() => {
    const map = new Map();
    let unassigned = 0;
    for (const s of allSessions) {
      if (s.project_id == null) unassigned++;
      else map.set(s.project_id, (map.get(s.project_id) || 0) + 1);
    }
    return { map, unassigned };
  }, [allSessions]);

  const visibleSessions = useMemo(() => {
    const src = results
      ? results.map((r) => ({
          id: r.session_id, title: r.title, project_id: r.project_id,
          updated_at: r.updated_at, snippet: r.snippet,
        }))
      : allSessions;
    if (query.trim() || scope === 'all') return src;
    return src.filter((s) => (s.project_id ?? null) === (activeProjectId ?? null));
  }, [results, allSessions, scope, query, activeProjectId]);

  const buckets = useMemo(() => bucketSessions(visibleSessions), [visibleSessions]);

  // Handlers
  const handleSelectAll = () => setScope('all');
  const handleSelectProject = (id) => {
    setScope('filter');
    onSetActiveProject(id);
  };
  const submitCreateProject = async () => {
    const name = newProjName.trim();
    setCreatingProject(false);
    setNewProjName('');
    if (!name) return;
    await window.api.projects.create(name, null);
    onProjectsChanged?.();
  };
  const handleDeleteChat = async (id) => {
    setMenuKey(null);
    if (!confirm('Delete this chat?')) return;
    await window.api.history.remove(id);
    if (id === currentSessionId) onNewChat?.();
    refresh();
  };
  const handleDeleteProject = async (id) => {
    setMenuKey(null);
    if (!confirm('Delete project? Chats inside become unassigned.')) return;
    await window.api.projects.remove(id);
    if (id === activeProjectId) onSetActiveProject(null);
    onProjectsChanged?.();
    refresh();
  };
  const handleRenameChat = async (id, title, current) => {
    setRenamingChatId(null);
    const next = (title || '').trim();
    if (!next || next === current) return;
    await window.api.history.rename(id, next);
    refresh();
  };
  const handleRenameProject = async (id, name, current) => {
    setRenamingProjectId(null);
    const next = (name || '').trim();
    if (!next || next === current) return;
    await window.api.projects.rename(id, next);
    onProjectsChanged?.();
  };
  const handleMoveChat = async (sessionId, projectId) => {
    setMenuKey(null);
    await window.api.history.move(sessionId, projectId);
    onProjectsChanged?.();
    refresh();
  };
  const handleSetProjectFolder = async (id) => {
    const f = await window.api.pickFolder();
    if (!f) return;
    await window.api.projects.setFolder(id, f);
    onProjectsChanged?.();
  };
  const handleNewChatClick = () => {
    onNewChat?.();
    onClose?.();
  };
  const handleLoadChat = (id) => {
    onLoadSession(id);
    onClose?.();
  };

  const showingAll = scope === 'all' || !!query.trim();
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const headerLabel = query.trim()
    ? `Results for "${query.trim()}"`
    : showingAll
      ? 'All chats'
      : activeProjectId != null
        ? activeProject?.name || 'Project'
        : 'No project';

  return (
    <div style={{
      flex: 1, overflowY: 'auto', overflowX: 'hidden',
      backgroundImage: 'radial-gradient(#e5e3dc 1px, transparent 1px)',
      backgroundSize: '18px 18px',
      position: 'relative',
    }}>
      {/* Close button */}
      <button
        onClick={onClose}
        title="Close (Esc)"
        style={{
          position: 'absolute', top: 18, right: 22, zIndex: 5,
          width: 32, height: 32, borderRadius: 10,
          background: '#ffffff', border: '1px solid #e0ddd6',
          cursor: 'pointer', color: '#6b6960',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <IconClose />
      </button>

      <div style={{
        maxWidth: 780, margin: '0 auto',
        padding: '64px 40px 80px',
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>

        {/* Hero */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <div style={{
            fontSize: 11, color: '#8c8c84', fontFamily: 'var(--mono)',
            letterSpacing: 1.2, textTransform: 'uppercase',
          }}>
            ~ codelocal // library{folderName ? ` // ${folderName}` : ''}
          </div>
          <div style={{
            fontSize: 32, fontWeight: 500, color: '#3a3a33',
            display: 'flex', alignItems: 'center', gap: 12, letterSpacing: -0.5,
          }}>
            <span style={{ color: '#d97706', fontSize: 34, fontWeight: 600, lineHeight: 1 }}>›</span>
            your chats
          </div>
        </div>

        {/* Search card — matches landing input style */}
        <div style={{
          background: '#ffffff', borderRadius: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '18px 20px',
          transition: 'box-shadow 0.15s',
        }}>
          <IconSearch />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your chats and messages…"
            style={{
              flex: 1, background: 'transparent', border: 'none',
              fontSize: 15, color: '#1a1a19', outline: 'none',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#8c8c84', padding: 4, borderRadius: 6,
                display: 'flex', alignItems: 'center',
              }}
              title="Clear"
            ><IconClose /></button>
          )}
          <button
            onClick={() => onOpenCommandPalette?.()}
            title="Quick jump (Ctrl/Cmd+K)"
            style={{
              background: '#f3f2ee', border: '1px solid #e5e3dc',
              borderRadius: 6, padding: '4px 8px', fontSize: 10,
              color: '#6b6960', cursor: 'pointer',
              fontFamily: 'ui-monospace, monospace', fontWeight: 600,
            }}
          >⌘K</button>
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleNewChatClick}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#1a1a19', color: '#ffffff',
              border: 'none', borderRadius: 999,
              padding: '9px 18px', fontSize: 13, fontWeight: 500,
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            <IconPlus />
            <span>New chat</span>
          </button>
          <button
            onClick={() => setCreatingProject(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#ffffff', color: '#3a3a33',
              border: '1px solid #e0ddd6', borderRadius: 999,
              padding: '9px 18px', fontSize: 13, fontWeight: 500,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            }}
          >
            <IconPlus />
            <span>New project</span>
          </button>
        </div>

        {/* Projects pill row */}
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#8c8c84',
            letterSpacing: 0.6, textTransform: 'uppercase',
            marginBottom: 10, fontFamily: 'var(--mono)',
          }}>
            Projects
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <ProjectChip
              id="__all__"
              name="All chats"
              count={allSessions.length}
              active={showingAll}
              onClick={handleSelectAll}
            />
            <ProjectChip
              id={null}
              name="No project"
              count={projectCounts.unassigned}
              active={!showingAll && activeProjectId == null}
              onClick={() => handleSelectProject(null)}
            />
            {projects.map((p) => (
              <ProjectChip
                key={p.id}
                id={p.id}
                name={p.name}
                count={projectCounts.map.get(p.id) || 0}
                active={!showingAll && p.id === activeProjectId}
                renaming={renamingProjectId === p.id}
                menuOpen={menuKey === `project-${p.id}`}
                onClick={() => handleSelectProject(p.id)}
                onToggleMenu={() => setMenuKey((k) => k === `project-${p.id}` ? null : `project-${p.id}`)}
                onCloseMenu={() => setMenuKey(null)}
                onRenameStart={() => setRenamingProjectId(p.id)}
                onRenameSubmit={(n) => handleRenameProject(p.id, n, p.name)}
                onRenameCancel={() => setRenamingProjectId(null)}
                onSetFolder={() => handleSetProjectFolder(p.id)}
                onDelete={() => handleDeleteProject(p.id)}
              />
            ))}
          </div>

          {creatingProject && (
            <div style={{ marginTop: 10 }}>
              <input
                autoFocus
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitCreateProject(); }
                  if (e.key === 'Escape') { e.preventDefault(); setCreatingProject(false); setNewProjName(''); }
                }}
                onBlur={submitCreateProject}
                placeholder="Project name…"
                style={{
                  background: '#ffffff', border: '1px solid #d8d5cc',
                  borderRadius: 999, padding: '8px 16px',
                  fontSize: 13, color: '#1a1a19', outline: 'none',
                  minWidth: 220,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
              />
            </div>
          )}
        </div>

        {/* Chats section */}
        <div style={{ marginTop: 6 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#8c8c84',
              letterSpacing: 0.6, textTransform: 'uppercase',
              fontFamily: 'var(--mono)',
            }}>
              {headerLabel}
            </div>
            <div style={{ fontSize: 11, color: '#a9a69e' }}>
              {visibleSessions.length} {visibleSessions.length === 1 ? 'chat' : 'chats'}
            </div>
          </div>

          {loading && allSessions.length === 0 && (
            <div style={{ padding: '40px 0', fontSize: 13, color: '#a9a69e', textAlign: 'center' }}>
              Loading…
            </div>
          )}

          {!loading && visibleSessions.length === 0 && (
            <div style={{
              padding: '48px 20px', fontSize: 13, color: '#a9a69e', textAlign: 'center',
              background: '#ffffff', border: '1px dashed #e0ddd6', borderRadius: 12,
            }}>
              {query.trim() ? `No chats match "${query.trim()}"` : 'No chats here yet — start one above'}
            </div>
          )}

          {buckets.map((b) => (
            <div key={b.key} style={{ marginBottom: 18 }}>
              <div style={{
                padding: '0 4px 8px',
                fontSize: 10, fontWeight: 700, color: '#a9a69e',
                letterSpacing: 0.5, textTransform: 'uppercase',
              }}>
                {b.label}
              </div>
              {b.items.map((s) => {
                const proj = s.project_id != null ? projects.find((p) => p.id === s.project_id) : null;
                return (
                  <ChatCard
                    key={`${s.id}-${s.snippet || ''}`}
                    session={s}
                    active={s.id === currentSessionId}
                    projectColor={s.project_id != null ? projectColor(s.project_id) : null}
                    projectName={showingAll && proj ? proj.name : null}
                    renaming={renamingChatId === s.id}
                    menuOpen={menuKey === `chat-${s.id}`}
                    projects={projects}
                    onLoad={handleLoadChat}
                    onOpenMenu={() => setMenuKey(`chat-${s.id}`)}
                    onCloseMenu={() => setMenuKey(null)}
                    onRenameStart={() => setRenamingChatId(s.id)}
                    onRenameSubmit={(t) => handleRenameChat(s.id, t, s.title)}
                    onRenameCancel={() => setRenamingChatId(null)}
                    onMove={(pid) => handleMoveChat(s.id, pid)}
                    onDelete={() => handleDeleteChat(s.id)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
