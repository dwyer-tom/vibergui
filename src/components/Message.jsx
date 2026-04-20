import React, { useState, useMemo, useEffect, useRef } from 'react';
import { parseEditBlocks, stripEditMarkup } from '../lib/parseEditBlocks';
import { MarkdownContent } from '../lib/markdown';
import { Spinner } from './TitleBar';
import styles from '../styles';

const THINKING_PHRASES = ['Thinking…', 'Reasoning…', 'Pondering…', 'Considering…', 'Reflecting…', 'Mulling…'];
const WORKING_PHRASES = ['Working…', 'Applying…', 'Editing…', 'Patching…', 'Updating…', 'Coding…'];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── word diff helper ──────────────────────────────────────────────────────
function wordDiff(oldLine, newLine) {
  // Find common prefix/suffix and highlight the changed middle
  let start = 0;
  while (start < oldLine.length && start < newLine.length && oldLine[start] === newLine[start]) start++;
  let endOld = oldLine.length, endNew = newLine.length;
  while (endOld > start && endNew > start && oldLine[endOld - 1] === newLine[endNew - 1]) { endOld--; endNew--; }
  return { start, endOld, endNew };
}

function HighlightedLine({ text, start, end, bg }) {
  if (start === undefined || start === end) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <span style={{ background: bg, borderRadius: 2 }}>{text.slice(start, end)}</span>
      {text.slice(end)}
    </>
  );
}

// ── thinking block ────────────────────────────────────────────────────────
function ThinkingBlock({ text, live }) {
  const ref = useRef(null);
  useEffect(() => {
    if (live && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [text, live]);
  return (
    <div ref={ref} style={{
      marginTop: 6, maxHeight: 150, overflowY: 'auto',
      borderLeft: '2px solid #c8c4bc',
      background: '#fafaf8', borderRadius: '0 4px 4px 0',
      paddingLeft: 12, paddingTop: 6, paddingBottom: 6,
      fontSize: 12, color: '#8c8c84', lineHeight: 1.55,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      {text}
    </div>
  );
}

// ── edit block ─────────────────────────────────────────────────────────────
export function EditBlock({ edit }) {
  const [fileLines, setFileLines] = useState(null);
  const fileName = edit.path.split(/[\\/]/).pop();

  // Load file for context lines
  useEffect(() => {
    window.api.readFile(edit.path)
      .then(res => { if (res.ok) setFileLines(res.content.split('\n')); })
      .catch(() => {});
  }, [edit.path]);

  // Build diff rows with context
  const rows = useMemo(() => {
    const CONTEXT = 3;
    const result = [];

    if (edit.startLine != null && edit.endLine != null && fileLines) {
      const s = edit.startLine - 1;
      const e = edit.endLine;
      const replaceLines = (edit.fullContent || '').split('\n');
      const removedLines = fileLines.slice(s, e);

      // Context before
      for (let i = Math.max(0, s - CONTEXT); i < s; i++)
        result.push({ num: i + 1, type: 'ctx', text: fileLines[i] });
      // Removed
      removedLines.forEach((t, j) => result.push({ num: s + j + 1, type: 'del', text: t }));
      // Added
      replaceLines.forEach((t, j) => result.push({ num: s + j + 1, type: 'add', text: t }));
      // Context after
      for (let i = e; i < Math.min(fileLines.length, e + CONTEXT); i++)
        result.push({ num: i + 1, type: 'ctx', text: fileLines[i] });
    } else if (edit.hunks?.length > 0) {
      for (const h of edit.hunks) {
        const searchLines = h.search.split('\n');
        const replaceLines = h.replace.split('\n');
        searchLines.forEach(t => result.push({ num: null, type: 'del', text: t }));
        replaceLines.forEach(t => result.push({ num: null, type: 'add', text: t }));
      }
    } else if (edit.fullContent != null) {
      edit.fullContent.split('\n').forEach((t, i) => result.push({ num: i + 1, type: 'add', text: t }));
    }
    return result;
  }, [edit, fileLines]);

  const addedCount = rows.filter(r => r.type === 'add').length;
  const removedCount = rows.filter(r => r.type === 'del').length;

  // Pair up adjacent del/add lines for word-level highlighting
  const wordDiffs = useMemo(() => {
    const map = {};
    let i = 0;
    while (i < rows.length) {
      if (rows[i].type === 'del') {
        const delStart = i;
        while (i < rows.length && rows[i].type === 'del') i++;
        const addStart = i;
        while (i < rows.length && rows[i].type === 'add') i++;
        const delCount = addStart - delStart;
        const addCount = i - addStart;
        const pairs = Math.min(delCount, addCount);
        for (let p = 0; p < pairs; p++) {
          const wd = wordDiff(rows[delStart + p].text, rows[addStart + p].text);
          map[delStart + p] = { start: wd.start, end: wd.endOld };
          map[addStart + p] = { start: wd.start, end: wd.endNew };
        }
      } else { i++; }
    }
    return map;
  }, [rows]);

  const BG = { ctx: 'transparent', del: 'rgba(255,220,220,0.5)', add: 'rgba(220,255,220,0.5)' };
  const HIGHLIGHT_BG = { del: 'rgba(255,150,150,0.4)', add: 'rgba(130,220,130,0.4)' };

  return (
    <div style={{ margin: '8px 0', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', fontSize: 12, lineHeight: 1.65 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f3f2ee', border: '1px solid #e5e3dc', borderRadius: 6, padding: '3px 9px' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <path d="M3 2h7l3 3v9H3V2z" fill="#d97706" fillOpacity="0.15" stroke="#d97706" strokeWidth="1.2"/>
            <path d="M10 2v3h3" fill="none" stroke="#d97706" strokeWidth="1.2"/>
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#3a3a33' }}>{fileName}</span>
        </div>
        <span style={{ fontSize: 11, color: '#8c8c84' }}>
          <span style={{ color: '#2d8a2d', fontWeight: 500 }}>+{addedCount}</span>
          <span style={{ margin: '0 3px' }}>/</span>
          <span style={{ color: '#b03030', fontWeight: 500 }}>−{removedCount}</span>
        </span>
      </div>

      {/* Diff lines */}
      <div style={{ overflowX: 'auto' }}>
          {rows.map((row, i) => {
            const wd = wordDiffs[i];
            return (
              <div key={i} style={{ display: 'flex', background: BG[row.type], minHeight: 20 }}>
                <span style={{
                  minWidth: 36, textAlign: 'right', paddingRight: 6,
                  color: row.type === 'ctx' ? '#b0aea8' : row.type === 'del' ? '#cc4444' : '#2d8a2d',
                  userSelect: 'none', flexShrink: 0,
                }}>
                  {row.num ?? ''}
                </span>
                <span style={{
                  width: 14, textAlign: 'center', flexShrink: 0, userSelect: 'none',
                  color: row.type === 'del' ? '#cc4444' : row.type === 'add' ? '#2d8a2d' : 'transparent',
                  fontWeight: 600,
                }}>
                  {row.type === 'del' ? '-' : row.type === 'add' ? '+' : ' '}
                </span>
                <span style={{ flex: 1, whiteSpace: 'pre', paddingRight: 8, color: '#3a3a33' }}>
                  {wd ? (
                    <HighlightedLine text={row.text} start={wd.start} end={wd.end} bg={HIGHLIGHT_BG[row.type]} />
                  ) : row.text}
                </span>
              </div>
            );
          })}
        </div>
    </div>
  );
}

// ── tool calls section ─────────────────────────────────────────────────────
const TOOL_VERBS_ACTIVE = { read_file: 'Reading', list_files: 'Listing', grep: 'Searching', search_code: 'Searching', run_bash: 'Running' };
const TOOL_VERBS_DONE = { read_file: 'Read', list_files: 'Listed', grep: 'Searched', search_code: 'Searched', run_bash: 'Ran' };

function ToolCallsSection({ toolCalls }) {
  const [open, setOpen] = useState(false);

  // Group by tool name
  const groups = useMemo(() => {
    const map = {};
    for (const tc of toolCalls) {
      if (!map[tc.name]) map[tc.name] = [];
      map[tc.name].push(tc);
    }
    return Object.entries(map);
  }, [toolCalls]);

  return (
    <div style={{ marginBottom: 6, fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', fontSize: 12, lineHeight: 1.6 }}>
      {groups.map(([name, calls]) => {
        const running = calls.some(tc => tc.result === null);
        const verb = running ? (TOOL_VERBS_ACTIVE[name] || name) : (TOOL_VERBS_DONE[name] || name);
        const noun = name === 'read_file' ? 'file' : name === 'list_files' ? 'folder' : name === 'grep' || name === 'search_code' ? 'pattern' : 'command';
        const label = `${verb} ${calls.length} ${noun}${calls.length !== 1 ? 's' : ''}`;

        return (
          <div key={name}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#8c8c84', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setOpen(o => !o)}
            >
              <span>{label}{running ? '…' : ''}</span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? '▴' : '▾'}</span>
            </div>
            {open && calls.map((tc, i) => {
              const file = tc.args?.path || tc.args?.query || tc.args?.command || '';
              const short = file.split(/[\\/]/).pop() || file;
              return (
                <div key={i} style={{ color: '#8c8c84', paddingLeft: 10, fontSize: 11 }}>
                  └ <span style={{ color: '#6b6960' }}>{short}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── copy button ────────────────────────────────────────────────────────────
export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const doCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={doCopy}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Copy to clipboard"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: hovered ? '#eceae4' : '#f3f2ee',
        border: '1px solid #e0ddd6', borderRadius: 6,
        padding: '4px 10px', fontSize: 12, color: '#5c5c54',
        cursor: 'pointer', fontWeight: 500, transition: 'background 0.12s',
        marginTop: 6,
      }}
    >
      {copied ? (
        <><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="#2d6a2d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> Copied</>
      ) : (
        <><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M11 5V4a1 1 0 00-1-1H4a1 1 0 00-1 1v8a1 1 0 001 1h1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> Copy</>
      )}
    </button>
  );
}

// ── message ────────────────────────────────────────────────────────────────
export default function Message({ msg, isThinking, isStreaming, showCopy, onAcceptPlan, onDeclinePlan }) {
  const isUser = msg.role === 'user';
  // Memoised: parseEditBlocks runs heavy regex — only recompute when content changes
  const parts = useMemo(
    () => (!isUser && msg.content ? parseEditBlocks(msg.content) : null),
    [isUser, msg.content],
  );
  const [showThink, setShowThink] = useState(false);
  const [planActioned, setPlanActioned] = useState(false);
  const thinkingPhrase = useMemo(() => pick(THINKING_PHRASES), []);
  const workingPhrase = useMemo(() => pick(WORKING_PHRASES), []);
  const [elapsed, setElapsed] = useState(0);

  const hasCompleteEdit = parts && parts.some((p) => p.type === 'edit');
  const isWorking = isStreaming && !isThinking && msg.content && msg.content.includes('<edit') && !hasCompleteEdit;
  const isActive = isThinking || isWorking;
  const isPlan = !isUser && !isStreaming && msg.content && /ready\.?\s*reply\s*['"]?go['"]?\s*to\s*implement/i.test(msg.content);

  useEffect(() => {
    if (!isActive) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  return (
    <div style={{ ...styles.message, ...(isUser ? styles.messageUser : styles.messageAssistant) }}>
      {isActive ? (
        <>
          {msg.toolCalls?.length > 0 && <ToolCallsSection toolCalls={msg.toolCalls} />}
          <div style={styles.thinkingInline}>
            <Spinner />
            <em style={styles.thinkingText}>{isThinking ? thinkingPhrase : workingPhrase}</em>
            <span style={styles.thinkingMeta}>{elapsed}s</span>
            {msg.tokens > 0 && <span style={styles.thinkingMeta}>{msg.tokens} tok</span>}
          </div>
          {msg.thinking && <ThinkingBlock text={msg.thinking} live />}
        </>
      ) : parts && parts.some((p) => p.type === 'edit') ? (
        <div>
          {msg.toolCalls?.length > 0 && <ToolCallsSection toolCalls={msg.toolCalls} />}
          {parts.map((p, i) =>
            p.type === 'edit' ? <EditBlock key={i} edit={p} /> : null
          )}
          {showCopy && <CopyButton text={msg.content} />}
        </div>
      ) : (
        <div>
          {!isUser && msg.toolCalls?.length > 0 && <ToolCallsSection toolCalls={msg.toolCalls} />}
          <div style={isUser ? styles.messageContentUser : { ...styles.messageContent, ...(msg.stopped ? { color: '#a0a098', fontStyle: 'italic', border: '1px solid #e5e3dc', background: '#fafaf8' } : {}) }}>
            {isUser ? (
              <span style={{ ...styles.userText, color: '#e8e6df' }}>{msg.content}</span>
            ) : (
              <>
                <MarkdownContent text={stripEditMarkup(msg.content)} />
              </>
            )}
          </div>
          {isPlan && !planActioned && onAcceptPlan && onDeclinePlan && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => { setPlanActioned(true); onDeclinePlan(); }} style={{
                background: '#f3f2ee', border: '1px solid #e0ddd6', borderRadius: 6,
                padding: '6px 16px', fontSize: 12, color: '#5c5c54', cursor: 'pointer',
                fontWeight: 500, transition: 'background 0.12s',
              }}>Decline</button>
              <button onClick={() => { setPlanActioned(true); onAcceptPlan(); }} style={{
                background: '#1a1a19', border: '1px solid #1a1a19', borderRadius: 6,
                padding: '6px 16px', fontSize: 12, color: '#fff', cursor: 'pointer',
                fontWeight: 600, transition: 'background 0.12s',
              }}>Accept Plan</button>
            </div>
          )}
          {showCopy && !isUser && !msg.stopped && <CopyButton text={msg.content} />}
        </div>
      )}
    </div>
  );
}
