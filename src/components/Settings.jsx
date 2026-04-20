import React, { useState, useCallback, useEffect } from 'react';

// ── defaults & persistence ─────────────────────────────────────────────────
export const MODEL_DEFAULTS = {
  temperature: 1.0,
  num_ctx:     32768,
  top_p:       0.95,
  top_k:       64,
};

export function loadModelOpts() {
  try {
    const s = localStorage.getItem('codelocal-model-opts');
    if (s) return { ...MODEL_DEFAULTS, ...JSON.parse(s) };
  } catch {}
  return { ...MODEL_DEFAULTS };
}

function saveModelOpts(opts) {
  localStorage.setItem('codelocal-model-opts', JSON.stringify(opts));
}

export function loadOllamaUrl() {
  return localStorage.getItem('codelocal-ollama-url') || 'http://localhost:11434';
}

// ── sub-components ─────────────────────────────────────────────────────────
function SectionHeader({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
      textTransform: 'uppercase', color: '#8c8c84',
      marginBottom: 2, paddingBottom: 8,
      borderBottom: '1px solid #e5e3dc',
    }}>
      {children}
    </div>
  );
}

function SettingRow({ label, hint, right }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 0', borderBottom: '1px solid #f0ede8' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#3a3a33', marginBottom: 3 }}>{label}</div>
          {hint && <div style={{ fontSize: 11, color: '#8c8c84', lineHeight: 1.5 }}>{hint}</div>}
        </div>
        <div style={{ flexShrink: 0 }}>{right}</div>
      </div>
    </div>
  );
}

function SliderRow({ label, hint, value, min, max, step, onChange, displayFn }) {
  const display = displayFn ? displayFn(value) : String(value);
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 0', borderBottom: '1px solid #f0ede8' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#3a3a33' }}>{label}</div>
          {hint && <div style={{ fontSize: 11, color: '#8c8c84', marginTop: 2, lineHeight: 1.5 }}>{hint}</div>}
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13, fontWeight: 600, color: '#3a3a33',
          background: '#f3f2ee', border: '1px solid #e5e3dc',
          borderRadius: 6, padding: '3px 10px', minWidth: 52, textAlign: 'center',
        }}>
          {display}
        </div>
      </div>
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        {/* Track fill */}
        <div style={{
          position: 'absolute', left: 0, height: 3, borderRadius: 999,
          background: '#e5e3dc', width: '100%',
        }} />
        <div style={{
          position: 'absolute', left: 0, height: 3, borderRadius: 999,
          background: '#d97706', width: `${pct}%`,
          transition: 'width 0.05s',
        }} />
        <input
          type="range"
          min={min} max={max} step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            position: 'absolute', width: '100%', opacity: 0,
            cursor: 'pointer', height: 20, margin: 0,
          }}
        />
        {/* Thumb */}
        <div style={{
          position: 'absolute',
          left: `calc(${pct}% - 8px)`,
          width: 16, height: 16, borderRadius: '50%',
          background: '#ffffff',
          border: '2px solid #d97706',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          pointerEvents: 'none',
          transition: 'left 0.05s',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#a0a098', fontFamily: "'JetBrains Mono', monospace" }}>
        <span>{displayFn ? displayFn(min) : min}</span>
        <span>{displayFn ? displayFn(max) : max}</span>
      </div>
    </div>
  );
}

function NavItem({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left',
        background: active ? '#e8e6df' : 'transparent',
        border: 'none', borderRadius: 6,
        padding: '7px 10px', cursor: 'pointer',
        fontSize: 13, fontWeight: active ? 500 : 400,
        color: active ? '#3a3a33' : '#6b6960',
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#eeece6'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

// ── main component ─────────────────────────────────────────────────────────
const SECTIONS = ['Model', 'Connection'];

export default function Settings({ onClose }) {
  const [section, setSection] = useState('Model');
  const [opts, setOpts] = useState(loadModelOpts);
  const [ollamaUrl, setOllamaUrl] = useState(loadOllamaUrl);
  const [urlSaved, setUrlSaved] = useState(false);

  const setOpt = useCallback((key, value) => {
    setOpts(prev => {
      const next = { ...prev, [key]: value };
      saveModelOpts(next);
      return next;
    });
  }, []);

  const resetDefaults = () => {
    setOpts({ ...MODEL_DEFAULTS });
    saveModelOpts({ ...MODEL_DEFAULTS });
  };

  const saveUrl = () => {
    localStorage.setItem('codelocal-ollama-url', ollamaUrl.trim() || 'http://localhost:11434');
    setUrlSaved(true);
    setTimeout(() => setUrlSaved(false), 1800);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f5f4f0' }}>
      {/* Header */}
      <div style={{
        height: 44, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        borderBottom: '1px solid #e5e3dc',
        background: '#f3f2ee',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#3a3a33', letterSpacing: 0.1 }}>Settings</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8c8c84', fontSize: 16, lineHeight: 1, padding: '4px 6px', borderRadius: 4 }}
          onMouseEnter={e => e.currentTarget.style.color = '#3a3a33'}
          onMouseLeave={e => e.currentTarget.style.color = '#8c8c84'}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left nav */}
        <div style={{
          width: 160, flexShrink: 0,
          borderRight: '1px solid #e5e3dc',
          background: '#f3f2ee',
          padding: '12px 8px',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {SECTIONS.map(s => (
            <NavItem key={s} label={s} active={section === s} onClick={() => setSection(s)} />
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          {section === 'Model' && (
            <div style={{ maxWidth: 560 }}>
              <SectionHeader>Model Parameters</SectionHeader>
              <div style={{ marginTop: 4 }}>
                <SliderRow
                  label="Temperature"
                  hint="Controls randomness. Lower = more focused, higher = more creative."
                  value={opts.temperature}
                  min={0} max={2} step={0.05}
                  onChange={v => setOpt('temperature', v)}
                />
                <SliderRow
                  label="Context window"
                  hint="Max tokens the model sees. Higher uses more RAM but handles larger files."
                  value={opts.num_ctx}
                  min={2048} max={131072} step={1024}
                  onChange={v => setOpt('num_ctx', v)}
                  displayFn={v => `${Math.round(v / 1024)}k`}
                />
                <SliderRow
                  label="Top P"
                  hint="Nucleus sampling. Restricts token pool to top P probability mass."
                  value={opts.top_p}
                  min={0} max={1} step={0.01}
                  onChange={v => setOpt('top_p', v)}
                />
                <SliderRow
                  label="Top K"
                  hint="Limits tokens considered at each step. 0 = disabled."
                  value={opts.top_k}
                  min={0} max={100} step={1}
                  onChange={v => setOpt('top_k', v)}
                />
              </div>
              <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={resetDefaults}
                  style={{
                    background: '#f3f2ee', border: '1px solid #e0ddd6', borderRadius: 6,
                    padding: '7px 14px', fontSize: 12, fontWeight: 500, color: '#5c5c54',
                    cursor: 'pointer', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#e8e6df'}
                  onMouseLeave={e => e.currentTarget.style.background = '#f3f2ee'}
                >
                  Reset to defaults
                </button>
                <span style={{ fontSize: 11, color: '#a0a098' }}>
                  Changes apply to the next message sent.
                </span>
              </div>
            </div>
          )}

          {section === 'Connection' && (
            <div style={{ maxWidth: 560 }}>
              <SectionHeader>Ollama Connection</SectionHeader>
              <div style={{ marginTop: 4 }}>
                <SettingRow
                  label="Ollama host"
                  hint="URL of your Ollama server. Change this if you're running Ollama on a different port or remote host."
                  right={null}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <input
                    value={ollamaUrl}
                    onChange={e => setOllamaUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveUrl()}
                    spellCheck={false}
                    style={{
                      flex: 1,
                      background: '#ffffff', border: '1px solid #e5e3dc',
                      borderRadius: 8, padding: '8px 12px',
                      fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                      color: '#3a3a33', outline: 'none',
                    }}
                    onFocus={e => e.target.style.borderColor = '#d5d2ca'}
                    onBlur={e => e.target.style.borderColor = '#e5e3dc'}
                  />
                  <button
                    onClick={saveUrl}
                    style={{
                      background: urlSaved ? '#f0fdf4' : '#1a1a19',
                      border: `1px solid ${urlSaved ? '#bbf7d0' : '#1a1a19'}`,
                      color: urlSaved ? '#166534' : '#ffffff',
                      borderRadius: 8, padding: '8px 16px',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      transition: 'all 0.15s', whiteSpace: 'nowrap',
                    }}
                  >
                    {urlSaved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
                <div style={{ marginTop: 20, padding: '12px 14px', background: '#f3f2ee', border: '1px solid #e5e3dc', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b6960', marginBottom: 4 }}>Default</div>
                  <code style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#3a3a33' }}>http://localhost:11434</code>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
