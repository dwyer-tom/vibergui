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

export function TitleBar({ folder, onPickFolder, onNewChat, indexing }) {
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
      {indexing && (
        <div style={styles.titleBarCenter}>
          <span style={{ fontSize: 11, color: '#8c8c84', fontWeight: 500 }}>
            Indexing{indexing.total > 0 ? `… ${indexing.done}/${indexing.total}` : '…'}
          </span>
        </div>
      )}
    </div>
  );
}
