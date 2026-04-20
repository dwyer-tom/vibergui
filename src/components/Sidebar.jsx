import React, { useState } from 'react';

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
      <circle cx="6" cy="10" r="0.9" fill="currentColor"/>
      <circle cx="9" cy="10" r="0.9" fill="currentColor"/>
      <circle cx="12" cy="10" r="0.9" fill="currentColor"/>
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

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <path d="M11.5 11.5L14.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/>
      <path d="M5.5 7l2.5 2-2.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 11h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

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
        color: '#3a3a33',
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

export default function Sidebar({ onNewChat, onPickFolder, onSetActiveProject, onOpenCommandPalette, onOpenLibrary, libraryOpen, terminalOpen, onToggleTerminal, settingsOpen, onOpenSettings }) {
  return (
    <div style={{ display: 'flex', flexShrink: 0, height: '100%' }}>
      <div style={{
        width: 48, display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '8px 0', gap: 2, background: '#f3f2ee',
        borderRight: '1px solid #e5e3dc', flexShrink: 0,
      }}>
        <NavBtn icon={<IconChat />} label="New chat" onClick={onNewChat} />
        <NavBtn icon={<IconFolder />} label="Library (projects & chats)" active={libraryOpen} onClick={onOpenLibrary} />
        <NavBtn icon={<IconSearch />} label="Quick search (Ctrl/Cmd+K)" onClick={onOpenCommandPalette} />
        <NavBtn icon={<IconTerminal />} label="Terminal" active={terminalOpen} onClick={onToggleTerminal} />

        <div style={{ flex: 1 }} />

        <NavBtn icon={<IconSettings />} label="Settings" active={settingsOpen} onClick={onOpenSettings} />
      </div>
    </div>
  );
}
