import { useCallback, useRef, useState } from 'react';

const SYSTEM_PROMPTS = {
  agent: `You are a coding assistant on a Windows codebase. You MUST complete the user's task — do not stop early, do not ask what to do, do not say "I'm ready". Always respond in English.

YOUR JOB: Use tools to explore the code, then produce edit blocks that solve the user's request. Every response must either call a tool OR output the final answer with edit blocks. Never respond with just a description of what you found.

WORKFLOW:
1. list_files to see project structure.
2. grep (exact text) or search_code (concepts) to find relevant code.
3. read_file on files you need to change.
4. Output edit blocks with your changes. Done.

EDIT BLOCK FORMAT (use after reading files):
<edit path="FULL_FILE_PATH" startLine="START" endLine="END">
replacement lines
</edit>
startLine/endLine are the line numbers from read_file output to replace (inclusive). Multiple blocks OK. To INSERT new lines, set startLine one past the line you want to insert after and endLine to the line before startLine (e.g. startLine="10" endLine="9").

RULES:
- Read every file before referencing or editing it.
- Only use code patterns you saw in the files — never guess or fabricate.
- One tool call per response. Never repeat the same tool call.
- run_bash: PowerShell only, for builds/tests only.
- No clarifying questions. Be concise. Cite file:line.`,

  agent_edit: `You are a coding assistant on a Windows codebase. You MUST implement the plan NOW. Always respond in English.

YOUR JOB: Execute the plan. Read the files you need to edit, then produce edit blocks. No exploration, no questions, no restating the plan.

WORKFLOW:
1. read_file on the FIRST file you need to edit (you already know which files from the plan).
2. Output edit blocks for that file immediately.
3. If more files need editing, read_file + edit blocks for each one.
4. Done.

CRITICAL:
- Do NOT call list_files or pwd — you already explored during planning.
- Do NOT restate or summarize the plan — just implement it.
- Do NOT ask questions — just execute.
- Every response MUST contain either a read_file tool call OR edit blocks. Nothing else.

EDIT BLOCK FORMAT:
<edit path="FULL_FILE_PATH" startLine="START" endLine="END">
replacement lines
</edit>
startLine/endLine are the line numbers from read_file output to replace (inclusive). Multiple blocks OK. To INSERT new lines, set startLine one past the line you want to insert after and endLine to the line before startLine (e.g. startLine="10" endLine="9"). To create a new file, use startLine="1" endLine="0" with the full file content.

RULES:
- Read every file before editing it. Line numbers come from read_file, never from memory.
- Only use code patterns you saw in the files.
- One tool call per response. Never repeat the same tool call.
- run_bash: PowerShell only, for builds/tests only.`,

  plan: `You are a coding assistant in PLAN MODE on a Windows codebase. Always respond in English.

YOUR JOB: Explore the code with tools, then help the user plan their change.

WORKFLOW:
1. list_files to see project structure.
2. grep (exact text) or search_code (concepts) to find relevant code.
3. read_file on files that need changing.
4. STOP AND ASK QUESTIONS FIRST if the request is ambiguous or has multiple valid approaches. Ask specific questions based on what you found in the code. Example: "Should the Images button toggle a mode like Plan does, or trigger a one-time action like opening a file picker?" Do NOT ask generic questions like "what would you like me to do?" Do NOT produce a plan yet — wait for the user's answers.
5. After the user answers, THEN output your plan.

IMPORTANT: Do NOT produce a plan and questions in the same response. If you have questions, ask them FIRST without a plan. Only produce the plan after all questions are answered.

RULES:
- For EXISTING files: only name files you confirmed exist via list_files, and only describe code you read via read_file — never guess.
- For NEW files: you may propose creating new files. Clearly mark them as "(new file)" in your plan.
- One tool call per response. Never repeat the same tool call.
- run_bash: PowerShell only, for builds/tests only.

PLAN FORMAT (only after questions are resolved):
1. Files that need to change (full paths). Mark new files with "(new file)".
2. What to change in each file (specific, based on what you read). For new files, describe what they should contain.
3. Risks or dependencies
End with exactly: "Ready. Reply 'go' to implement."`,
};

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const streamBuf = useRef('');
  const thinkBuf = useRef('');
  const toolCallsRef = useRef([]);
  const historyRef = useRef([]);
  const setMsgs = useCallback((fn) => {
    setMessages((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      historyRef.current = next;
      return next;
    });
  }, []);

  const send = useCallback(async (userText, { model, activeFile, activeFileContent, intent = 'agent', think = false, planMode = false, hidden = false }) => {
    if (streaming) return;
    setStreaming(true);
    streamBuf.current = '';
    thinkBuf.current = '';
    toolCallsRef.current = [];

    const systemPrompt = planMode
      ? SYSTEM_PROMPTS.plan
      : intent === 'go' ? SYSTEM_PROMPTS.agent_edit
      : SYSTEM_PROMPTS.agent;

    // Only inject active file if explicitly selected — Gemma finds everything else via tools
    const parts = [];
    if (activeFile && activeFileContent) {
      parts.push(`Active file (${activeFile}):\n--- START ---\n${activeFileContent}\n--- END ---`);
    }
    parts.push(userText);

    const enrichedUserMsg = { role: 'user', content: parts.join('\n\n') };

    setMsgs((m) => [
      ...m,
      ...(hidden ? [] : [{ role: 'user', content: userText }]),
      { role: 'assistant', content: '', thinking: '', tokens: 0, toolCalls: [] },
    ]);

    window.api.offChatListeners();
    window.api.offDebugLog();
    setDebugLogs([]);

    window.api.onDebugLog((d) => {
      setDebugLogs((prev) => [...prev.slice(-100), d.line]);
    });

    window.api.onToolCall((d) => {
      toolCallsRef.current = [...toolCallsRef.current, { name: d.name, args: d.args, result: null, summary: null }];
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], toolCalls: [...toolCallsRef.current] };
        return copy;
      });
    });

    window.api.onToolResult((d) => {
      toolCallsRef.current = toolCallsRef.current.map((tc) =>
        tc.name === d.name && tc.result === null ? { ...tc, summary: d.summary, result: d.full } : tc
      );
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], toolCalls: [...toolCallsRef.current] };
        return copy;
      });
    });

    window.api.onChatToken((delta) => {
      if (delta.thinking) {
        thinkBuf.current += delta.thinking;
      } else {
        streamBuf.current += delta.text ?? '';
      }
      setMsgs((m) => {
        const copy = [...m];
        const prev = copy[copy.length - 1];
        copy[copy.length - 1] = { role: 'assistant', content: streamBuf.current, thinking: thinkBuf.current, tokens: (prev.tokens || 0) + 1, toolCalls: toolCallsRef.current };
        return copy;
      });
    });

    window.api.onChatDone(() => setStreaming(false));

    try {
      const MAX_HISTORY_TURNS = 10;
      // Build history with tool call summaries so model remembers what it explored
      const allHistory = historyRef.current.map((m) => {
        if (m.role === 'assistant' && m.toolCalls?.length > 0) {
          const toolSummary = m.toolCalls
            .filter(tc => tc.summary)
            .map(tc => `[tool: ${tc.name}(${Object.values(tc.args || {}).join(', ')}) → ${tc.summary}]`)
            .join('\n');
          const content = [toolSummary, m.content].filter(Boolean).join('\n\n');
          return { role: m.role, content };
        }
        return { role: m.role, content: m.content };
      });
      let historyMsgs = allHistory.length > MAX_HISTORY_TURNS * 2
        ? allHistory.slice(-MAX_HISTORY_TURNS * 2)
        : allHistory;

      // On "go": condense history to just the plan + user context so the model focuses on execution
      if (intent === 'go') {
        // Find the plan message and gather the conversation around it
        let planIdx = -1;
        for (let i = allHistory.length - 1; i >= 0; i--) {
          const c = allHistory[i].content || '';
          if (allHistory[i].role === 'assistant' && /ready\.?\s*reply\s*['"]?go['"]?\s*to\s*implement/i.test(c)) {
            planIdx = i;
            break;
          }
        }
        if (planIdx >= 0) {
          // Include the original user request + the plan (skip intermediate Q&A)
          const condensed = [];
          // Find the first user message (the original task)
          for (let i = 0; i < planIdx; i++) {
            if (allHistory[i].role === 'user') { condensed.push(allHistory[i]); break; }
          }
          // Include user answers between plan questions and the plan itself
          for (let i = planIdx - 1; i >= 0; i--) {
            if (allHistory[i].role === 'user' && i > 0) {
              condensed.push(allHistory[i]);
              break;
            }
          }
          // The plan itself
          const planText = allHistory[planIdx].content;
          condensed.push({ role: 'assistant', content: planText });
          historyMsgs = condensed;
        } else {
          historyMsgs = [];
        }
      }

      await window.api.chat({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...historyMsgs, enrichedUserMsg],
        think,
        agentMode: true,
      });
    } catch (err) {
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: `Error: ${err.message}`, thinking: '', toolCalls: toolCallsRef.current };
        return copy;
      });
      setStreaming(false);
    }
  }, [streaming, setMsgs]);

  const stop = useCallback(() => {
    window.api.offChatListeners();
    window.api.abortChat();
    setMsgs((m) => {
      const last = m[m.length - 1];
      if (last?.role === 'assistant' && !last.content) {
        const copy = [...m];
        copy[copy.length - 1] = { ...last, content: 'Process stopped by user.', stopped: true };
        return copy;
      }
      return m;
    });
    setStreaming(false);
  }, [setMsgs]);

  const reset = useCallback(() => {
    setMsgs([]);
    streamBuf.current = '';
    thinkBuf.current = '';
    toolCallsRef.current = [];
  }, [setMsgs]);

  return { messages, streaming, debugLogs, send, stop, reset };
}
