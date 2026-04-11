export function stripEditMarkup(text) {
  // Remove complete edit blocks (already rendered as EditBlock components)
  let s = text.replace(/<edit\b[^>]*>[\s\S]*?<\/edit>/gi, '');
  // Remove incomplete edit block still streaming (opening tag may not have > yet)
  s = s.replace(/<edit\b[\s\S]*/i, '');
  return s.trim();
}

export function parseEditBlocks(text) {
  const parts = [];
  const editRegex = /<edit[\s]+(?:path|file|filename)="([^"]+)"(?:\s+startLine="(\d+)")?(?:\s+endLine="(\d+)")?[^>]*>\s*(?:<content>)?\n?([\s\S]*?)\n?(?:<\/content>\s*)?<\/edit>/g;
  const hunkRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;
  let last = 0, match;
  while ((match = editRegex.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: 'text', content: text.slice(last, match.index) });
    const filePath = match[1];
    const startLine = match[2] ? parseInt(match[2], 10) : null;
    const endLine = match[3] ? parseInt(match[3], 10) : null;
    const body = match[4].trim();

    // Line-number-based edit (new format)
    if (startLine !== null && endLine !== null) {
      parts.push({ type: 'edit', path: filePath, startLine, endLine, fullContent: body, hunks: [] });
    } else {
      // Legacy: SEARCH/REPLACE hunks
      const hunks = [];
      let hunkMatch;
      hunkRegex.lastIndex = 0;
      while ((hunkMatch = hunkRegex.exec(body)) !== null) {
        hunks.push({ search: hunkMatch[1], replace: hunkMatch[2] });
      }
      if (hunks.length > 0) {
        parts.push({ type: 'edit', path: filePath, hunks, fullContent: null });
      } else {
        // No markers → treat as full file write
        parts.push({ type: 'edit', path: filePath, hunks: [], fullContent: body });
      }
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', content: text.slice(last) });

  // When a model self-corrects it emits multiple edit blocks for the same file.
  // Keep only the last edit per path — it's always the intended one.
  const lastEditIdx = new Map();
  parts.forEach((p, i) => { if (p.type === 'edit') lastEditIdx.set(p.path, i); });
  return parts.filter((p, i) => {
    if (p.type === 'edit') return lastEditIdx.get(p.path) === i;
    // Drop text fragments that contain raw diff markers (malformed/incomplete edit blocks)
    if (/<<<<<<< SEARCH|>>>>>>> REPLACE/.test(p.content)) return false;
    return true;
  });
}
