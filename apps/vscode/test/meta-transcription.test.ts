import { describe, expect, it } from "vitest";
import { createMetaTranscriptionClient, type WebSocketLike } from "../src/meta/meta-transcription";

class MockWebSocket implements WebSocketLike {
  binaryType = "arraybuffer";
  readyState = 1; // OPEN
  sent: Array<string | ArrayBuffer | Uint8Array> = [];
  closedWith: number | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;

  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data);
  }

  close(code = 1000) {
    this.closedWith = code;
  }
}

describe("createMetaTranscriptionClient", () => {
  it("throws no_key if apiKey is missing", async () => {
    const client = createMetaTranscriptionClient({ apiKey: undefined });
    await expect(client.transcribe(new Uint8Array(48000))).rejects.toMatchObject({
      kind: "no_key",
    });
  });

  it("completes full handshake, streams frames, and extracts transcript", async () => {
    let mockWs!: MockWebSocket;
    const client = createMetaTranscriptionClient({
      apiKey: "test-key-123",
      timeoutMs: 5000,
      webSocketFactory: () => {
        mockWs = new MockWebSocket();
        setTimeout(() => {
          mockWs.onopen?.({});
          setTimeout(() => {
            mockWs.onmessage?.({ data: JSON.stringify({ sessionId: "sess-abc" }) });
          }, 10);
        }, 10);
        return mockWs;
      },
    });

    // 1 second of audio: 48,000 bytes
    const pcm = new Uint8Array(48_000);
    const promise = client.transcribe(pcm);

    // After frames are sent, simulate speechComplete and close
    await new Promise((r) => setTimeout(r, 80));
    mockWs.onmessage?.({
      data: JSON.stringify({
        type: "speechComplete",
        transcript: "The login endpoint returns 500.",
      }),
    });
    mockWs.onclose?.({ code: 1000 });

    const result = await promise;
    expect(result.text).toBe("The login endpoint returns 500.");
    expect(result.audioMs).toBe(1000);
    expect(result.model).toBe("muse-voice-transcribe-1.0");

    // Verify first sent frame was JSON handshake
    expect(typeof mockWs.sent[0]).toBe("string");
    const handshake = JSON.parse(mockWs.sent[0] as string);
    expect(handshake).toMatchObject({
      authorization: { accessToken: "test-key-123" },
      model: "muse-voice-transcribe-1.0",
      audioEncoding: "PCM_24KHZ",
    });
  });

  it("handles auth error from server", async () => {
    let mockWs!: MockWebSocket;
    const client = createMetaTranscriptionClient({
      apiKey: "invalid-key",
      webSocketFactory: () => {
        mockWs = new MockWebSocket();
        setTimeout(() => {
          mockWs.onopen?.({});
          setTimeout(() => {
            mockWs.onmessage?.({
              data: JSON.stringify({ type: "error", message: "Invalid credentials / auth token" }),
            });
          }, 10);
        }, 10);
        return mockWs;
      },
    });

    await expect(client.transcribe(new Uint8Array(4800))).rejects.toMatchObject({
      kind: "auth",
    });
  });

  it("handles network close before handshake", async () => {
    let mockWs!: MockWebSocket;
    const client = createMetaTranscriptionClient({
      apiKey: "valid-key",
      webSocketFactory: () => {
        mockWs = new MockWebSocket();
        setTimeout(() => {
          mockWs.onopen?.({});
          setTimeout(() => {
            mockWs.onclose?.({ code: 1006 });
          }, 10);
        }, 10);
        return mockWs;
      },
    });

    await expect(client.transcribe(new Uint8Array(4800))).rejects.toMatchObject({
      kind: "network",
    });
  });
});
