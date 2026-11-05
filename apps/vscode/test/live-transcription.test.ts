import { describe, expect, it } from "vitest";
import { createLiveTranscription, liveText } from "../src/meta/live-transcription";
import type { WebSocketLike } from "../src/meta/meta-transcription";

class FakeSocket implements WebSocketLike {
  binaryType = "";
  readyState = 1;
  sent: Array<string | ArrayBuffer | Uint8Array> = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data);
    if (data === '{"type":"endStream"}') setTimeout(() => this.onclose?.({ code: 1000 }), 0);
  }
  close() {}
  event(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  get audio() {
    return this.sent.filter((d): d is Uint8Array => d instanceof Uint8Array);
  }
}

const FRAME = 3840; // 80 ms of 24 kHz PCM16

function setup() {
  const socket = new FakeSocket();
  const texts: string[] = [];
  const live = createLiveTranscription({
    apiKey: "k",
    onText: (t) => texts.push(t),
    webSocketFactory: () => socket,
  });
  return { socket, texts, live };
}

describe("liveText", () => {
  it("joins finished turns and the turn in progress", () => {
    expect(liveText(["Fix the login", " bug. "], "It returns")).toBe(
      "Fix the login bug. It returns",
    );
    expect(liveText([], "")).toBe("");
  });
});

describe("createLiveTranscription", () => {
  it("handshakes, then streams audio in 80 ms frames, queuing what arrives earlier", () => {
    const { socket, live } = setup();
    socket.onopen?.({});
    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({
      authorization: { accessToken: "k" },
      partialMode: "CUMULATIVE",
      audioEncoding: "PCM_24KHZ",
    });

    live.push(new Uint8Array(FRAME + 100)); // before the session is ready
    expect(socket.audio).toHaveLength(0);

    socket.event({ sessionId: "s1" });
    expect(socket.audio.map((f) => f.length)).toEqual([FRAME]); // 100 bytes kept back

    live.push(new Uint8Array(FRAME - 100));
    expect(socket.audio.map((f) => f.length)).toEqual([FRAME, FRAME]);
  });

  it("reports partial text as it grows and keeps finished turns", async () => {
    const { socket, texts, live } = setup();
    socket.onopen?.({});
    socket.event({ sessionId: "s1" });

    socket.event({ type: "transcript", transcript: "Why does", final: false });
    socket.event({ type: "transcript", transcript: "Why does login fail", final: false });
    socket.event({ type: "speechComplete", transcript: "Why does login fail?" });
    socket.event({ type: "transcript", transcript: "Check session", final: false });

    expect(texts).toEqual([
      "Why does",
      "Why does login fail",
      "Why does login fail?",
      "Why does login fail? Check session",
    ]);

    const done = live.finish();
    socket.event({ type: "speechComplete", transcript: "Check session.js." });
    await expect(done).resolves.toBe("Why does login fail? Check session.js.");
    expect(socket.sent.at(-1)).toBe('{"type":"endStream"}');
  });

  it("rejects finish() with the service's error", async () => {
    const { socket, live } = setup();
    socket.onopen?.({});
    socket.event({ type: "error", message: "invalid access token" });
    await expect(live.finish()).rejects.toMatchObject({ kind: "auth" });
  });

  it("stops sending after cancel()", () => {
    const { socket, live } = setup();
    socket.onopen?.({});
    socket.event({ sessionId: "s1" });
    live.cancel();
    live.push(new Uint8Array(FRAME * 2));
    expect(socket.audio).toHaveLength(0);
  });
});
