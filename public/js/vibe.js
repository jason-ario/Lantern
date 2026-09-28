// The AI tools a game can say it was "built with", shared by the server
// (validation) and the store UI (chips, filters). Plain data, no DOM, so Node
// can import it too. Colors are only for the little dot on each chip.
export const TOOLS = [
  { id: 'claude-code', name: 'Claude Code', color: '#ff8a5c' },
  { id: 'claude', name: 'Claude', color: '#e0906d' },
  { id: 'cursor', name: 'Cursor', color: '#b7c2ff' },
  { id: 'chatgpt', name: 'ChatGPT', color: '#3ecf9e' },
  { id: 'codex', name: 'Codex', color: '#7ce0c3' },
  { id: 'copilot', name: 'GitHub Copilot', color: '#b48cff' },
  { id: 'gemini', name: 'Gemini', color: '#5b9bff' },
  { id: 'windsurf', name: 'Windsurf', color: '#2de2ff' },
  { id: 'bolt', name: 'Bolt', color: '#ffd23f' },
  { id: 'lovable', name: 'Lovable', color: '#ff5fa2' },
  { id: 'replit', name: 'Replit', color: '#ff8f3d' },
  { id: 'v0', name: 'v0', color: '#e8e8f0' },
  { id: 'other', name: 'Something else', color: '#9b7bff' },
];
export const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

export const MAX_TOOLS = 5;
export const MAX_PROMPT = 400;

// Normalises creator input into { builtWith, vibe } or throws a message string.
export function cleanVibe(builtWith, vibe) {
  const ids = [...new Set((Array.isArray(builtWith) ? builtWith : []).map((x) => String(x)))].filter((id) => TOOL_BY_ID.has(id)).slice(0, MAX_TOOLS);
  const prompt = String(vibe?.prompt ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, MAX_PROMPT);
  const rawHours = vibe?.hours;
  let hours = null;
  if (rawHours !== undefined && rawHours !== null && rawHours !== '') {
    hours = Number(rawHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 5000) throw new Error('Build time must be between 0.1 and 5000 hours');
    hours = Math.round(hours * 10) / 10;
  }
  return { builtWith: ids, vibe: prompt || hours ? { prompt: prompt || null, hours } : null };
}

// "45 min", "6 hrs", "3 days" (8-hour days feel right for build diaries)
export function buildTime(hours) {
  if (!hours) return null;
  if (hours < 1) return `${Math.max(5, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours % 1 ? hours.toFixed(1) : hours} hr${hours === 1 ? '' : 's'}`;
  return `${Math.round(hours / 8)} days`;
}
