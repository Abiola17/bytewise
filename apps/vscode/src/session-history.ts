import type { ChatSnapshot } from "./chat-session";
import type { ChatEntry } from "./protocol";

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  entryCount: number;
}

export interface StoredSession extends SessionSummary {
  snapshot: ChatSnapshot;
}

export const MAX_STORED_SESSIONS = 25;

/**
 * Derives a clean, concise title from the conversation's first user message.
 */
export function deriveSessionTitle(entries: ChatEntry[]): string {
  const firstUser = entries.find((e) => e.role === "user");
  if (!firstUser || !("text" in firstUser) || !firstUser.text.trim()) {
    return "New debugging session";
  }
  // Remove file mentions at the start or leading punctuation
  let text = firstUser.text
    .trim()
    .replace(/^(@[\w./-]+(?::\d+(?:-\d+)?)?\s*)+/, "")
    .trim();
  if (!text) text = firstUser.text.trim();
  const firstLine = text.split("\n")[0]!.trim();
  return firstLine.length > 50 ? `${firstLine.slice(0, 47)}…` : firstLine;
}

/**
 * Adds or updates a session in the list of stored sessions, keeping at most MAX_STORED_SESSIONS.
 */
export function upsertStoredSession(
  list: StoredSession[],
  session: StoredSession,
  maxSessions = MAX_STORED_SESSIONS,
): StoredSession[] {
  const filtered = list.filter((s) => s.id !== session.id);
  const updated = [session, ...filtered];
  return updated.slice(0, maxSessions);
}

/**
 * Formats a relative timestamp (e.g. "2m ago", "1h ago", "Yesterday").
 */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
