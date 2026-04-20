import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// ── time bucketing (ChatGPT-style) ────────────────────────────────────────
const TIME_BUCKETS = [
  { key: 'today',     label: 'Today',            maxDays: 1 },
  { key: 'yesterday', label: 'Yesterday',        maxDays: 2 },
  { key: 'week',      label: 'Previous 7 Days',  maxDays: 7 },
  { key: 'month',     label: 'Previous 30 Days', maxDays: 30 },
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

// ── dropdown menu ─────────────────────────────────────────────────────────
function DropMenu({ children, onClose, align = 'right' }) {
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
      data-menu-root
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', top: '100%',
        [align]: 4, marginTop: 4,
        background: '#ffffff', border: '1px solid #e0ddd6',
        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        zIndex: 30, minWidth: 170, padding: 4,
      }}
    >
      {children}
    </div>
  );
}

function MenuItem({ label, onClick, danger, disabled, sub }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '7px 10px', fontSize: 12, cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#c0bdb5' : danger ? '#dc2626' : '#1a1a19',
        background: hover && !disabled ? '#f5f3ef' : 'transparent',
        borderRadius: 6, userSelect: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {sub && <span style={{ fontSize: 10, color: '#a9a69e' }}>{sub}</span>}
    </div>
  );
}

const MenuSep = () => <div style={{ height: 1, background: '#f0ede8', margin: '4px 2px' }} />;
const MenuLabel = ({ label }) => (
  <div style={{ padding: '6px 10px 3px', fontSize: 9, color: '#a9a69e', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
    {label}
  </div>
);

// ── icons ─────────────────────────────────────────────────────────────────
const IconDots = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <circle cx="3.5" cy="8" r="1.3" fill="#6b6960" />
    <circle cx="8"   cy="8" r="1.3" fill="#6b6960" />
    <circle cx="12.5" cy="8" r="1.3" fill="#6b6960" />
  </svg>
);
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M8 3v10M3 8h10" stroke="#3a3a33" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const IconSearch = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <circle cx="7" cy="7" r="4.2" stroke="#8c8c84" strokeWidth="1.4" fill="none" />
    <path d="M10.2 10.2L13 13" stroke="#8c8c84" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const IconFolder = ({ color }) => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <path d="M1.5 4.5C1.5 3.95 1.95 3.5 2.5 3.5h3.25l1.1 1.1c.09.09.22.15.35.15H13.5c.55 0 1 .45 1 1V12c0 .55-.45 1-1 1h-11c-.55 0-1-.45-1-1V4.5z" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.3" />
  </svg>
);

// ── tiny color hash for project accent ───────────────────────────────────
function projectColor(id) {
  const palette = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1'];
  if (id == null) return '#a9a69e';
  return palette[id % palette.length];
}

// ── project pill (filter row) ─────────────────────────────────────────────
function ProjectPill({
  id, name, chatCount, active, renaming,
  onClick, onRenameStart, onRenameSubmit, onRenameCancel,
  onSetFolder, onDelete,
  menuOpen, onToggleMenu, onCloseMenu,
}) {
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState(name || '');
  useEffect(() => { if (renaming) setDraft(name || ''); }, [renaming, name]);
  const color = projectColor(id);

  return (
    <div
      onClick={renaming ? (e) => e.stopPropagation() : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px',
        background: active ? '#e8e6df' : hovered ? '#ece9e2' : 'transparent',
        borderRadius: 6,
        cursor: renaming ? 'default' : 'pointer',
        transition: 'background 0.1s',
        marginBottom: 1,
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: color, flexShrink: 0,
        boxShadow: active ? `0 0 0 2px ${color}22` : 'none',
      }} />
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
            flex: 1, fontSize: 12.5, fontWeight: 500, color: '#1a1a19',
            background: '#ffffff', border: '1px solid #d8d5cc', borderRadius: 4,
            padding: '1px 5px', outline: 'none', minWidth: 0,
          }}
        />
      ) : (
        <span style={{
          flex: 1, fontSize: 12.5, color: '#1a1a19',
          fontWeight: active ? 600 : 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </span>
      )}
      {!renaming && (
        <>
          {hovered || menuOpen ? (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center',
                flexShrink: 0,
              }}
              title="More"
            ><IconDots /></button>
          ) : chatCount != null ? (
            <span style={{ fontSize: 10.5, color: '#a9a69e', flexShrink: 0 }}>{chatCount}</span>
          ) : null}
        </>
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

// ── chat row ──────────────────────────────────────────────────────────────
function ChatRow({
  session, active, projectColor: accent,
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
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px',
        background: active ? '#e8e6df' : hovered ? '#ece9e2' : 'transparent',
        borderRadius: 6,
        cursor: renaming ? 'default' : 'pointer',
        transition: 'background 0.1s',
        marginBottom: 1,
      }}
    >
      {accent && (
        <span style={{
          width: 3, alignSelf: 'stretch',
          background: accent, borderRadius: 2, flexShrink: 0,
          marginLeft: -4,
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
            flex: 1, fontSize: 13, fontWeight: 500, color: '#1a1a19',
            background: '#ffffff', border: '1px solid #d8d5cc', borderRadius: 4,
            padding: '1px 5px', outline: 'none', minWidth: 0,
          }}
        />
      ) : (
        <span
          style={{
            flex: 1, fontSize: 13, color: '#1a1a19',
            fontWeight: active ? 600 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={session.title}
        >
          {session.title || 'Untitled'}
        </span>
      )}

      {!renaming && (hovered || menuOpen) && (
        <button
          onClick={(e) => { e.stopPropagation(); onOpenMenu(); }}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center',
            flexShrink: 0,
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

// ── section header ────────────────────────────────────────────────────────
function Section({ label, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 12px 6px',
      fontSize: 10, fontWeight: 700, color: '#8c8c84',
      letterSpacing: 0.6, textTransform: 'uppercase', userSelect: 'none',
    }}>
      <span>{label}</span>
      {action}
    </div>
  );
}

const iconBtn = {
  background: 'transparent', border: 'none', borderRadius: 4,
  width: 20, height: 20, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0,
};

// ── main ──────────────────────────────────────────────────────────────────
export default function Workspace({
  currentSessionId, onLoad, onNewChat,
  activeProjectId, onSetActiveProject,
  projects, onProjectsChanged,
  onOpenCommandPalette,
}) {
  const [allSessions, setAllSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  // scope: 'all' (every chat) | 'filter' (respect activeProjectId)
  const [scope, setScope] = useState(() => localStorage.getItem('codelocal-ws-scope') || 'filter');
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [menuKey, setMenuKey] = useState(null);

  useEffect(() => {
    localStorage.setItem('codelocal-ws-scope', scope);
  }, [scope]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await window.api.history.list({});
    setAllSessions(res?.ok ? res.sessions : []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh, currentSessionId]);

  // Search
  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await window.api.history.search(query, {});
      if (!cancelled) setResults(res?.ok ? res.results : []);
    }, 160);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  // Project chat counts (local, always based on full sessions)
  const projectCounts = useMemo(() => {
    const map = new Map();
    let unassigned = 0;
    for (const s of allSessions) {
      if (s.project_id == null) unassigned++;
      else map.set(s.project_id, (map.get(s.project_id) || 0) + 1);
    }
    return { map, unassigned };
  }, [allSessions]);

  // Sessions to show, after filter/search
  const visibleSessions = useMemo(() => {
    const src = results
      ? results.map((r) => ({
          id: r.session_id, title: r.title, project_id: r.project_id,
          updated_at: r.updated_at, snippet: r.snippet,
        }))
      : allSessions;
    if (scope === 'all' || query.trim()) return src;
    // filter by active project (null = "no project")
    return src.filter((s) => (s.project_id ?? null) === (activeProjectId ?? null));
  }, [results, allSessions, scope, query, activeProjectId]);

  const buckets = useMemo(() => bucketSessions(visibleSessions), [visibleSessions]);

  const submitCreateProject = async () => {
    const name = newProjName.trim();
    setCreatingProject(false);
    setNewProjName('');
    if (!name) return;
    await window.api.projects.create(name, null);
    onProjectsChanged?.();
  };

  const handleSelectProject = (id) => {
    setScope('filter');
    onSetActiveProject(id);
  };

  const handleShowAll = () => {
    setScope('all');
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

  const showingAll = scope === 'all' || !!query.trim();
  const activeProject = projects.find((p) => p.id === activeProjectId);

  // header label for the chat list
  const chatHeaderLabel = query.trim()
    ? 'Search results'
    : scope === 'all'
      ? 'All chats'
      : activeProjectId != null
        ? (activeProject?.name || 'Project')
        : 'No project';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── new chat ─── */}
      <div style={{ padding: '12px 10px 6px' }}>
        <button
          onClick={onNewChat}
          style={{
            width: '100%',
            background: '#ffffff',
            color: '#1a1a19',
            border: '1px solid #e0ddd6',
            borderRadius: 10, padding: '9px 12px',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#f9f8f4'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; }}
        >
          <IconPlus />
          <span>New chat</span>
        </button>
      </div>

      {/* ── search ─── */}
      <div style={{ padding: '4px 10px 6px' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 9, top: 8, pointerEvents: 'none' }}><IconSearch /></span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            placeholder="Search chats"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#ebe8e1', border: '1px solid transparent',
              borderRadius: 8, padding: '7px 40px 7px 28px',
              fontSize: 12.5, color: '#1a1a19', outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.borderColor = '#d8d5cc'; }}
            onBlur={(e) => { e.currentTarget.style.background = '#ebe8e1'; e.currentTarget.style.borderColor = 'transparent'; }}
          />
          <button
            onClick={() => onOpenCommandPalette?.()}
            title="Command palette (Ctrl/Cmd+K)"
            style={{
              position: 'absolute', right: 5, top: 5, height: 22,
              background: '#ffffff', border: '1px solid #e0ddd6', borderRadius: 5,
              padding: '0 6px', fontSize: 10, color: '#6b6960', cursor: 'pointer',
              fontFamily: 'ui-monospace, monospace', fontWeight: 600,
            }}
          >⌘K</button>
        </div>
      </div>

      {/* ── scroll region ─── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 10px' }}>

        {/* Projects section */}
        <Section
          label="Projects"
          action={
            <button
              onClick={() => setCreatingProject(true)}
              title="New project"
              style={iconBtn}
            ><IconPlus /></button>
          }
        />

        {/* "All chats" pseudo-item */}
        <div style={{ padding: '0 6px' }}>
          <div
            onClick={handleShowAll}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px',
              background: showingAll ? '#e8e6df' : 'transparent',
              borderRadius: 6, cursor: 'pointer',
              fontSize: 12.5, color: '#1a1a19',
              fontWeight: showingAll ? 600 : 500,
              transition: 'background 0.1s',
              marginBottom: 1,
            }}
            onMouseEnter={(e) => { if (!showingAll) e.currentTarget.style.background = '#ece9e2'; }}
            onMouseLeave={(e) => { if (!showingAll) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'transparent', border: '1.5px solid #a9a69e', flexShrink: 0,
            }} />
            <span style={{ flex: 1 }}>All chats</span>
            <span style={{ fontSize: 10.5, color: '#a9a69e', flexShrink: 0 }}>{allSessions.length}</span>
          </div>

          {/* "No project" pseudo-project */}
          <ProjectPill
            id={null}
            name="No project"
            chatCount={projectCounts.unassigned}
            active={!showingAll && activeProjectId == null}
            onClick={() => handleSelectProject(null)}
            menuOpen={false}
            onToggleMenu={() => {}}
            onCloseMenu={() => {}}
          />

          {creatingProject && (
            <div style={{ padding: '2px 0 4px' }}>
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
                  width: '100%', boxSizing: 'border-box',
                  background: '#ffffff', border: '1px solid #d8d5cc',
                  borderRadius: 6, padding: '6px 10px',
                  fontSize: 12.5, color: '#1a1a19', outline: 'none',
                }}
              />
            </div>
          )}

          {projects.map((p) => (
            <ProjectPill
              key={p.id}
              id={p.id}
              name={p.name}
              chatCount={projectCounts.map.get(p.id) || 0}
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

          {projects.length === 0 && !creatingProject && (
            <div style={{ padding: '8px 8px', fontSize: 11, color: '#a9a69e', fontStyle: 'italic' }}>
              No projects yet
            </div>
          )}
        </div>

        {/* Chats section */}
        <Section label={chatHeaderLabel} />

        <div style={{ padding: '0 6px' }}>
          {loading && allSessions.length === 0 && (
            <div style={{ padding: '12px 8px', fontSize: 11, color: '#a9a69e' }}>Loading…</div>
          )}

          {!loading && visibleSessions.length === 0 && (
            <div style={{ padding: '16px 8px', fontSize: 11.5, color: '#a9a69e', textAlign: 'center' }}>
              {query.trim() ? 'No matches' : 'No chats yet'}
            </div>
          )}

          {buckets.map((b) => (
            <div key={b.key} style={{ marginBottom: 6 }}>
              <div style={{
                padding: '8px 8px 4px',
                fontSize: 10, fontWeight: 700, color: '#a9a69e',
                letterSpacing: 0.5, textTransform: 'uppercase', userSelect: 'none',
              }}>
                {b.label}
              </div>
              {b.items.map((s) => (
                <ChatRow
                  key={`${s.id}-${s.snippet || ''}`}
                  session={s}
                  active={s.id === currentSessionId}
                  projectColor={
                    showingAll && s.project_id != null ? projectColor(s.project_id) : null
                  }
                  renaming={renamingChatId === s.id}
                  menuOpen={menuKey === `chat-${s.id}`}
                  projects={projects}
                  onLoad={onLoad}
                  onOpenMenu={() => setMenuKey(`chat-${s.id}`)}
                  onCloseMenu={() => setMenuKey(null)}
                  onRenameStart={() => setRenamingChatId(s.id)}
                  onRenameSubmit={(t) => handleRenameChat(s.id, t, s.title)}
                  onRenameCancel={() => setRenamingChatId(null)}
                  onMove={(pid) => handleMoveChat(s.id, pid)}
                  onDelete={() => handleDeleteChat(s.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
