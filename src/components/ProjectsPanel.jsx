import React, { useState, useEffect, useCallback } from 'react';

export default function ProjectsPanel({
  activeProjectId,
  onSetActiveProject,
  onPickFolder,
  onAfterActivate,
}) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await window.api.projects.list();
    setProjects(res?.ok ? res.projects : []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) { setCreating(false); setNewName(''); return; }
    await window.api.projects.create(name, null);
    setCreating(false);
    setNewName('');
    refresh();
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete project? Chats inside will become unassigned.')) return;
    await window.api.projects.remove(id);
    if (id === activeProjectId) onSetActiveProject(null);
    refresh();
  };

  const submitRename = async (id, name, currentName) => {
    setRenamingId(null);
    const next = (name || '').trim();
    if (!next || next === currentName) return;
    await window.api.projects.rename(id, next);
    refresh();
  };

  const handleSetFolder = async (e, id) => {
    e.stopPropagation();
    const f = await window.api.pickFolder();
    if (!f) return;
    await window.api.projects.setFolder(id, f);
    refresh();
  };

  const handleActivate = (id) => {
    onSetActiveProject(id);
    onAfterActivate?.();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '10px 10px 6px', fontSize: 11, fontWeight: 700, color: '#8c8c84', letterSpacing: 0.4, textTransform: 'uppercase', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Projects</span>
        <button
          onClick={() => setCreating(true)}
          style={{
            background: 'transparent', border: '1px solid #e5e3dc',
            borderRadius: 4, padding: '2px 8px', fontSize: 10,
            cursor: 'pointer', color: '#6b6960', fontWeight: 600,
          }}
        >
          + New
        </button>
      </div>

      {creating && (
        <div style={{ padding: '0 10px 8px' }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitCreate(); }
              if (e.key === 'Escape') { e.preventDefault(); setCreating(false); setNewName(''); }
            }}
            onBlur={submitCreate}
            placeholder="Project name…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#ffffff', border: '1px solid #d8d5cc',
              borderRadius: 6, padding: '6px 8px',
              fontSize: 12, color: '#1a1a19', outline: 'none',
            }}
          />
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
        {loading && <div style={{ padding: 12, fontSize: 11, color: '#8c8c84' }}>Loading…</div>}

        {/* No project pseudo-row */}
        <ProjectRow
          p={{ id: null, name: 'No project', folder: null, chat_count: null }}
          active={activeProjectId == null}
          onClick={() => handleActivate(null)}
        />

        {!loading && projects.length === 0 && !creating && (
          <div style={{ padding: 12, fontSize: 11, color: '#8c8c84', textAlign: 'center' }}>
            No projects yet
          </div>
        )}

        {projects.map((p) => (
          <ProjectRow
            key={p.id}
            p={p}
            active={p.id === activeProjectId}
            renaming={renamingId === p.id}
            onClick={() => handleActivate(p.id)}
            onRename={(e) => { e.stopPropagation(); setRenamingId(p.id); }}
            onRenameSubmit={(name) => submitRename(p.id, name, p.name)}
            onRenameCancel={() => setRenamingId(null)}
            onDelete={(e) => handleDelete(e, p.id)}
            onSetFolder={(e) => handleSetFolder(e, p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectRow({ p, active, renaming, onClick, onRename, onRenameSubmit, onRenameCancel, onDelete, onSetFolder }) {
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState(p.name || '');
  useEffect(() => { if (renaming) setDraft(p.name || ''); }, [renaming, p.name]);

  const folderName = p.folder ? p.folder.split(/[\\/]/).pop() : null;

  return (
    <div
      onClick={renaming ? (e) => e.stopPropagation() : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
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
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a19', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={p.name}>
            {p.name}
          </span>
        )}
        {p.chat_count != null && (
          <span style={{ fontSize: 10, color: '#8c8c84', flexShrink: 0 }}>{p.chat_count}</span>
        )}
      </div>
      {folderName && (
        <div style={{ fontSize: 11, color: '#6b6960', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.folder}>
          📁 {folderName}
        </div>
      )}
      {hovered && p.id != null && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button onClick={onRename} style={rowBtn}>Rename</button>
          <button onClick={onSetFolder} style={rowBtn}>Set folder</button>
          <button onClick={onDelete} style={{ ...rowBtn, color: '#dc2626' }}>Delete</button>
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
