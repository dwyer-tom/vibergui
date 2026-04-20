import React, { useState, useRef, useEffect } from 'react';
import styles from '../styles';

export function Spinner() {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % frames.length), 100);
    return () => clearInterval(id);
  }, []);
  return <span style={styles.spinnerChar}>{frames[i]}</span>;
}

function MenuItem({ icon, label, onClick, danger, disabled }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', cursor: disabled ? 'default' : 'pointer',
        background: hovered && !disabled ? '#f5f4f0' : 'transparent',
        color: disabled ? '#c0beb8' : danger ? '#dc2626' : '#1a1a19',
        fontSize: 13, userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 15, width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      {label}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: '#f0ede8', margin: '4px 0' }} />;
}

function GitBadge({ info }) {
  if (!info) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11, color: '#6b6960',
      background: '#eceae3', border: '1px solid #dedad2',
      borderRadius: 6, padding: '3px 8px',
      WebkitAppRegion: 'no-drag',
      userSelect: 'none',
    }}>
      {/* branch icon */}
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.7 }}>
        <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M4 6c0-2 8-2 8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      </svg>
      <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {info.branch}
      </span>
      {/* dirty indicator */}
      {info.dirty && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d97706', flexShrink: 0 }} title="Uncommitted changes" />
      )}
      {/* ahead/behind */}
      {info.ahead > 0 && (
        <span style={{ fontSize: 10, color: '#8c8c84' }} title={`${info.ahead} commit${info.ahead !== 1 ? 's' : ''} ahead`}>
          ↑{info.ahead}
        </span>
      )}
      {info.behind > 0 && (
        <span style={{ fontSize: 10, color: '#8c8c84' }} title={`${info.behind} commit${info.behind !== 1 ? 's' : ''} behind`}>
          ↓{info.behind}
        </span>
      )}
    </div>
  );
}

export function TitleBar({ folder, onPickFolder, onNewChat, indexing, chatMode, setChatMode, gitInfo }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handle = (fn) => () => { setOpen(false); fn && fn(); };

  return (
    <div style={styles.titleBar}>
      <div style={{ ...styles.titleBarLeft, position: 'relative' }} ref={menuRef}>
        <button
          style={{ ...styles.titleBarIconBtn, color: open ? '#1a1a19' : '#3a3a33' }}
          title="Menu"
          onClick={() => setOpen((o) => !o)}
        >
          ☰
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            background: '#ffffff', border: '1px solid #e0deda',
            borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            overflow: 'hidden', zIndex: 300, minWidth: 200,
          }}>
            <MenuItem icon="✎" label="New chat" onClick={handle(onNewChat)} />
            <Divider />
            <MenuItem icon="📂" label="Open folder…" onClick={handle(onPickFolder)} />
            <Divider />
            <MenuItem icon="⚙️" label="Settings" disabled />
          </div>
        )}
      </div>
      <div style={styles.titleBarCenter}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          background: '#ebe8e1', border: '1px solid #e0deda',
          borderRadius: 8, padding: 2, WebkitAppRegion: 'no-drag',
        }}>
          {['code', 'chat'].map((m) => {
            const active = chatMode === m;
            return (
              <button
                key={m}
                onClick={() => setChatMode && setChatMode(m)}
                style={{
                  background: active ? '#ffffff' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: active ? '#1a1a19' : '#6b6960',
                  fontSize: 12, fontWeight: 500,
                  padding: '4px 14px', borderRadius: 6,
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  textTransform: 'capitalize',
                  WebkitAppRegion: 'no-drag',
                }}
              >
                {m}
              </button>
            );
          })}
        </div>
        {indexing && (
          <span style={{ fontSize: 11, color: '#8c8c84', fontWeight: 500, marginLeft: 12 }}>
            Indexing{indexing.total > 0 ? `… ${indexing.done}/${indexing.total}` : '…'}
          </span>
        )}
      </div>
      {/* Right: git badge */}
      <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, WebkitAppRegion: 'no-drag' }}>
        <GitBadge info={gitInfo} />
      </div>
    </div>
  );
}
