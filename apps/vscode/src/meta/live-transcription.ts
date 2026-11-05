import { MetaApiError } from "./meta-client";
import type { WebSocketLike } from "./meta-transcription";

/**
 * Live dictation with Meta's realtime ASR (muse-voice-transcribe-1.0), verified
 * 2026-11-04: JSON handshake with the access token, binary PCM16 24 kHz mono
 * frames, then {"type":"endStream"}. While speaking, "transcript" events carry
 * the current turn's text so far (CUMULATIVE mode); "speechComplete" closes a turn.
 */

const FRAME_BYTES = 24_000 * 2 * 0.08; // 80 ms of audio
const TRAILING_SILENCE_FRAMES = 8; // lets the endpointer close the last turn
const FINISH_TIMEOUT_MS = 10_000;

export interface LiveTranscription {
  /** Audio as it is recorded (PCM16 24 kHz mono). */
  push(chunk: Uint8Array): void;
  /** Ends the stream and resolves with the full transcript. */
  finish(): Promise<string>;
  /** Drops everything without waiting for the service. */
  cancel(): void;
}

/** Joins finished turns and the turn in progress into what the box should show. */
export function liveText(finals: string[], current: string): string {
  return [...finals, current]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}

export function createLiveTranscription(options: {
  apiKey: string;
  /** Called with the full text so far every time it changes. */
  onText: (text: string) => void;
  onError?: (error: MetaApiError) => void;
  url?: string;
  model?: string;
  webSocketFactory?: (url: string) => WebSocketLike;
}): LiveTranscription {
  const url = options.url ?? "wss://api.meta.ai/v1/asr/realtime";
  const model = options.model ?? "muse-voice-transcribe-1.0";
  const ws = (
    options.webSocketFactory ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike)
  )(url);
  ws.binaryType = "arraybuffer";

  const finals: string[] = [];
  let current = "";
  let ready = false;
  let closed = false;
  let failure: MetaApiError | null = null;
  let pending = new Uint8Array(0);
  const queued: Uint8Array[] = [];
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((r) => (resolveClosed = r));

  const emit = () => options.onText(liveText(finals, current));
  const fail = (error: MetaApiError) => {
    if (failure || closed) return;
    failure = error;
    options.onError?.(error);
    try {
      ws.close();
    } catch {
      // already closed
    }
  };

  /** Sends whole 80 ms frames; keeps the remainder for the next chunk. */
  const sendFrames = (chunk: Uint8Array, flush = false) => {
    const data = new Uint8Array(pending.length + chunk.length);
    data.set(pending);
    data.set(chunk, pending.length);
    let offset = 0;
    for (; offset + FRAME_BYTES <= data.length; offset += FRAME_BYTES) {
      ws.send(data.subarray(offset, offset + FRAME_BYTES));
    }
    pending = data.slice(offset);
    if (flush && pending.length) {
      ws.send(pending);
      pending = new Uint8Array(0);
    }
  };

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        authorization: { accessToken: options.apiKey },
        mode: "ENDPOINTING",
        audioEncoding: "PCM_24KHZ",
        model,
        partialMode: "CUMULATIVE",
      }),
    );
  };

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let msg: {
      type?: string;
      sessionId?: string;
      transcript?: unknown;
      message?: unknown;
      errorType?: unknown;
    };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "error") {
      const detail = typeof msg.message === "string" ? msg.message : "unknown error";
      const auth = /auth|token|permission|credential/i.test(
        `${detail} ${String(msg.errorType ?? "")}`,
      );
      fail(new MetaApiError(auth ? "auth" : "server", `Voice transcription error: ${detail}`));
      return;
    }
    if (!ready && typeof msg.sessionId === "string") {
      ready = true;
      for (const chunk of queued.splice(0)) sendFrames(chunk);
      return;
    }
    if (msg.type === "transcript" && typeof msg.transcript === "string" && msg.transcript) {
      current = msg.transcript;
      emit();
    } else if (msg.type === "speechComplete" && typeof msg.transcript === "string") {
      if (msg.transcript.trim()) finals.push(msg.transcript);
      current = "";
      emit();
    }
  };

  ws.onerror = () => fail(new MetaApiError("network", "Could not reach Meta's voice service."));
  ws.onclose = (event) => {
    closed = true;
    if (!ready && !failure && event.code !== 1000) {
      failure = new MetaApiError(
        "network",
        `Meta's voice service closed the connection (${event.code}).`,
      );
      options.onError?.(failure);
    }
    resolveClosed();
  };

  return {
    push(chunk) {
      if (closed || failure) return;
      if (ready) sendFrames(chunk);
      else queued.push(chunk);
    },

    async finish() {
      if (!closed && !failure) {
        // Wait briefly for the handshake if the recording was very short.
        for (let i = 0; i < 50 && !ready && !closed && !failure; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (ready && !closed) {
          sendFrames(new Uint8Array(0), true);
          for (let i = 0; i < TRAILING_SILENCE_FRAMES; i++) ws.send(new Uint8Array(FRAME_BYTES));
          ws.send('{"type":"endStream"}');
          await Promise.race([closedPromise, new Promise((r) => setTimeout(r, FINISH_TIMEOUT_MS))]);
        }
      }
      if (failure) throw failure;
      // A turn still in progress when the service closed is kept as said.
      return liveText(finals, current);
    },

    cancel() {
      closed = true;
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
}
