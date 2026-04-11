import React, { useState, useEffect, useMemo } from 'react';

const CONTEXT = 3;

function findHunkLine(fileLines, searchText) {
  const searchLines = searchText.split('\n').map(l => l.trim());
  const n = searchLines.length;
  for (let i = 0; i <= fileLines.length - n; i++) {
    if (fileLines.slice(i, i + n).map(l => l.trim()).every((l, j) => l === searchLines[j])) return i;
  }
  return null;
}

function buildHunkRows(fileLines, hunk) {
  const searchLines = hunk.search.split('\n');
  const replaceLines = hunk.replace.split('\n');
  const startIdx = fileLines ? findHunkLine(fileLines, hunk.search) : null;
  const rows = [];

  if (startIdx === null) {
    // Fallback — no file context, just show the hunk
    searchLines.forEach(t => rows.push({ lineNum: null, type: 'del', text: t }));
    replaceLines.forEach(t => rows.push({ lineNum: null, type: 'add', text: t }));
    return rows;
  }

  const ctxStart = Math.max(0, startIdx - CONTEXT);
  const afterEnd  = Math.min(fileLines.length - 1, startIdx + searchLines.length - 1 + CONTEXT);

  for (let i = ctxStart; i < startIdx; i++)
    rows.push({ lineNum: i + 1, type: 'context', text: fileLines[i] });

  searchLines.forEach((t, j) =>
    rows.push({ lineNum: startIdx + j + 1, type: 'del', text: t }));

  replaceLines.forEach(t =>
    rows.push({ lineNum: null, type: 'add', text: t }));

  for (let i = startIdx + searchLines.length; i <= afterEnd; i++)
    rows.push({ lineNum: i + 1, type: 'context', text: fileLines[i] });

  return rows;
}

const ROW_BG    = { context: 'transparent', del: '#fff0f0', add: '#edfaed' };
const ROW_COLOR = { context: '#1a1a19',     del: '#1a1a19', add: '#1a1a19' };
const IND_COLOR = { context: 'transparent', del: '#cc2222', add: '#1a7a1a' };
const INDS      = { context: ' ',           del: '−',       add: '+' };

export default function DiffPanel({ edit, onClose }) {
  const [fileLines, setFileLines] = useState(undefined); // undefined = loading
  const fileName = edit.path.split(/[\\/]/).pop();

  useEffect(() => {
    setFileLines(undefined);
    window.api.readFile(edit.path)
      .then(res => setFileLines(res.ok ? res.content.split('\n') : null))
      .catch(() => setFileLines(null));
  }, [edit.path]);

  const sections = useMemo(() => {
    if (fileLines === undefined) return null; // still loading
    if (edit.fullContent !== null) {
      return [edit.fullContent.split('\n').map((text, i) => ({ lineNum: i + 1, type: 'add', text }))];
    }
    return edit.hunks.map(hunk => buildHunkRows(fileLines, hunk));
  }, [edit, fileLines]);

  return (
    <div style={{
      width: 480, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: '#f5f4f0', borderRight: '1px solid #e5e3dc', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid #e5e3dc',
        background: '#f3f2ee', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 11, color: '#8c8c84', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>
            Changes
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#3a3a33', fontFamily: 'var(--mono)' }} title={edit.path}>
            {fileName}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8c8c84', fontSize: 18, lineHeight: 1, padding: '4px 6px', borderRadius: 6 }}
          title="Close"
        >×</button>
      </div>

      {/* Diff content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '12px 0' }}>
        {sections === null ? (
          <div style={{ padding: '16px 20px', color: '#8c8c84', fontSize: 12 }}>Loading…</div>
        ) : sections.map((rows, si) => (
          <div key={si} style={{
            margin: '0 12px 12px',
            border: '1px solid #e5e3dc',
            borderRadius: 8,
            overflow: 'hidden',
            background: '#ffffff',
          }}>
            {/* Hunk header */}
            <div style={{
              padding: '6px 12px', background: '#f3f2ee',
              borderBottom: '1px solid #e5e3dc',
              fontSize: 11, color: '#8c8c84', fontFamily: 'var(--mono)',
            }}>
              @@ hunk {si + 1} of {sections.length}
            </div>
            {/* Lines */}
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6 }}>
              {rows.map((row, ri) => (
                <div key={ri} style={{ display: 'flex', background: ROW_BG[row.type] }}>
                  {/* Line number */}
                  <span style={{
                    minWidth: 40, textAlign: 'right', padding: '0 8px',
                    color: '#b0aea8', userSelect: 'none', flexShrink: 0,
                    borderRight: '1px solid #e5e3dc',
                    background: row.type === 'del' ? '#ffe0e0' : row.type === 'add' ? '#d8f5db' : '#f3f2ee',
                  }}>
                    {row.lineNum ?? ''}
                  </span>
                  {/* +/- indicator */}
                  <span style={{
                    width: 20, textAlign: 'center', flexShrink: 0,
                    color: IND_COLOR[row.type], fontWeight: 700, userSelect: 'none',
                    background: ROW_BG[row.type],
                  }}>
                    {INDS[row.type]}
                  </span>
                  {/* Code */}
                  <span style={{
                    flex: 1, padding: '0 10px 0 2px',
                    whiteSpace: 'pre', color: ROW_COLOR[row.type],
                    background: ROW_BG[row.type],
                  }}>
                    {row.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
