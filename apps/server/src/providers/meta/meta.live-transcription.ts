import type { AppError } from "../../errors/app-error";
import { providerErrors } from "../model-provider";

/**
 * Live dictation with Meta's realtime ASR, same protocol as the batch client.
 * While the developer speaks, "transcript" events carry the current turn's text
 * so far (CUMULATIVE mode); "speechComplete" closes a turn.
 */

// 80 ms of 24 kHz PCM16 (not imported from meta.transcription, which imports this file).
const FRAME_BYTES = 24_000 * 2 * 0.08;
const TRAILING_SILENCE_FRAMES = 8; // lets the endpointer close the last turn
const HANDSHAKE_WAIT_MS = 5000;
const FINISH_TIMEOUT_MS = 10_000;

export interface LiveTranscription {
  /** Audio as it is recorded (PCM16 24 kHz mono). */
  push(chunk: Buffer): void;
  /** Ends the stream and resolves with the full transcript. */
  finish(): Promise<string>;
  /** Drops everything without waiting for the service. */
  cancel(): void;
}

export interface LiveHandlers {
  /** Called with the full text so far every time it changes. */
  onText: (text: string) => void;
  onError?: (error: AppError) => void;
}

/** Minimal WebSocket surface, so tests can substitute a fake. */
export interface LiveSocket {
  binaryType: string;
  send(data: string | Buffer): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
}

/** Joins finished turns and the turn in progress into what the box should show. */
export function liveText(finals: string[], current: string): string {
  return [...finals, current]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}

export function createMetaLiveTranscription(
  options: { apiKey: string; url: string; model: string; socket?: (url: string) => LiveSocket },
  handlers: LiveHandlers,
): LiveTranscription {
  const ws = (options.socket ?? ((u) => new WebSocket(u) as unknown as LiveSocket))(options.url);
  ws.binaryType = "arraybuffer";

  const finals: string[] = [];
  let current = "";
  let ready = false;
  let closed = false;
  let failure: AppError | null = null;
  let pending: Buffer = Buffer.alloc(0);
  const queued: Buffer[] = [];
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((r) => (resolveClosed = r));

  const emit = () => handlers.onText(liveText(finals, current));
  const fail = (error: AppError) => {
    if (failure || closed) return;
    failure = error;
    handlers.onError?.(error);
    try {
      ws.close();
    } catch {
      // already closed
    }
  };

  /** Sends whole 80 ms frames; keeps the remainder for the next chunk. */
  const sendFrames = (chunk: Buffer, flush = false) => {
    const data = Buffer.concat([pending, chunk]);
    let offset = 0;
    for (; offset + FRAME_BYTES <= data.length; offset += FRAME_BYTES) {
      ws.send(data.subarray(offset, offset + FRAME_BYTES));
    }
    pending = data.subarray(offset);
    if (flush && pending.length) {
      ws.send(pending);
      pending = Buffer.alloc(0);
    }
  };

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        authorization: { accessToken: options.apiKey },
        mode: "ENDPOINTING",
        audioEncoding: "PCM_24KHZ",
        model: options.model,
        partialMode: "CUMULATIVE",
      }),
    );
  };

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let msg: {
      type?: string;
      sessionId?: unknown;
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
      fail(
        auth ? providerErrors.auth("Meta voice") : providerErrors.unavailable("Meta voice", detail),
      );
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

  ws.onerror = () => fail(providerErrors.unavailable("Meta voice", "WebSocket connection failed"));
  ws.onclose = (event) => {
    if (!ready && !failure && !closed && event.code !== 1000) {
      failure = providerErrors.unavailable("Meta voice", `connection closed (${event.code})`);
      handlers.onError?.(failure);
    }
    closed = true;
    resolveClosed();
  };

  return {
    push(chunk) {
      if (closed || failure) return;
      if (ready) sendFrames(chunk);
      else queued.push(chunk);
    },

    async finish() {
      if (!closed && !failure && !ready) {
        // A very short recording can end before the handshake completes.
        const deadline = Date.now() + HANDSHAKE_WAIT_MS;
        while (!ready && !closed && !failure && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      if (ready && !closed && !failure) {
        sendFrames(Buffer.alloc(0), true);
        const silence = Buffer.alloc(FRAME_BYTES);
        for (let i = 0; i < TRAILING_SILENCE_FRAMES; i++) ws.send(silence);
        ws.send('{"type":"endStream"}');
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          closedPromise,
          new Promise((r) => (timer = setTimeout(r, FINISH_TIMEOUT_MS))),
        ]);
        clearTimeout(timer);
        if (!closed) {
          closed = true;
          ws.close();
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
