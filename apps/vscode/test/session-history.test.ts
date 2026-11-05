import { describe, expect, it } from "vitest";
import {
  deriveSessionTitle,
  formatRelativeTime,
  upsertStoredSession,
  type StoredSession,
} from "../src/session-history";
import type { ChatEntry } from "../src/protocol";

describe("session history utilities", () => {
  it("derives a title from the first user entry", () => {
    const entries: ChatEntry[] = [
      { id: "1", role: "user", text: "@src/login.js:10-20 Why does login return 500?" },
      { id: "2", role: "assistant", text: "Checking the file..." },
    ];
    expect(deriveSessionTitle(entries)).toBe("Why does login return 500?");
  });

  it("truncates long user prompts to ~50 characters", () => {
    const entries: ChatEntry[] = [
      {
        id: "1",
        role: "user",
        text: "This is a very long question that goes on and on and contains a lot of details about the code",
      },
    ];
    const title = deriveSessionTitle(entries);
    expect(title.length).toBeLessThanOrEqual(50);
    expect(title.endsWith("…")).toBe(true);
  });

  it("upserts and caps stored sessions", () => {
    let list: StoredSession[] = [];
    const makeSession = (id: string, title: string): StoredSession => ({
      id,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      entryCount: 2,
      snapshot: { version: 1, history: [], entries: [] },
    });

    for (let i = 0; i < 30; i++) {
      list = upsertStoredSession(list, makeSession(`s${i}`, `Session ${i}`), 25);
    }
    expect(list).toHaveLength(25);
    expect(list[0]!.id).toBe("s29");

    // Updating existing session moves it to front
    list = upsertStoredSession(list, makeSession("s20", "Updated Session 20"), 25);
    expect(list[0]!.id).toBe("s20");
    expect(list[0]!.title).toBe("Updated Session 20");
    expect(list).toHaveLength(25);
  });

  it("formats relative timestamps", () => {
    const now = 1000000;
    expect(formatRelativeTime(now - 30 * 1000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60 * 1000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 2 * 3600 * 1000, now)).toBe("2h ago");
    expect(formatRelativeTime(now - 24 * 3600 * 1000, now)).toBe("yesterday");
    expect(formatRelativeTime(now - 3 * 24 * 3600 * 1000, now)).toBe("3d ago");
  });
});
