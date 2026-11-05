import { AppError } from "../../errors/app-error";
import { providerErrors } from "../model-provider";
import {
  createMetaLiveTranscription,
  type LiveHandlers,
  type LiveTranscription,
} from "./meta.live-transcription";

/** 24 kHz, 16-bit, mono — the only input format Bytewise sends. */
export const PCM_SAMPLE_RATE = 24_000;
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * 2;

const FRAME_BYTES = PCM_BYTES_PER_SECOND * 0.08; // 80 ms frames
// Faster than real time saves waiting; 2x was verified to keep accuracy, 8x was not.
const FRAME_INTERVAL_MS = 40;
// Trailing silence lets the endpointer close the last turn.
const TRAILING_SILENCE_FRAMES = 8;

export interface TranscriptionResult {
  text: string;
  audioMs: number;
  model: string;
}

export interface TranscriptionProvider {
  readonly model: string;
  transcribe(pcm: Buffer): Promise<TranscriptionResult>;
  /** Streams audio as it is recorded and reports the text so far. */
  live(handlers: LiveHandlers): LiveTranscription;
}

const notConfigured = () =>
  new AppError(
    503,
    "provider_not_configured",
    "Voice input needs META_API_KEY in .env (Muse Voice Transcribe is a Meta model).",
  );

type ServerEvent =
  | { type?: undefined; sessionId: string }
  | { type: "speechComplete"; transcript: string; audioProcessedMs?: number }
  | { type: "error"; message?: string; errorType?: string }
  | { type: string; [key: string]: unknown };

/**
 * Meta's realtime ASR WebSocket (verified 2026-11-04): JSON handshake with the
 * access token, binary PCM frames, then `{"type":"endStream"}`. Final text for
 * each spoken turn arrives in `speechComplete` events.
 */
export function createMetaTranscriptionProvider(options: {
  apiKey: string | undefined;
  url?: string;
  model?: string;
  timeoutMs: number;
}): TranscriptionProvider {
  const url = options.url ?? "wss://api.meta.ai/v1/asr/realtime";
  const model = options.model ?? "muse-voice-transcribe-1.0";

  return {
    model,
    live(handlers) {
      if (!options.apiKey) throw notConfigured();
      return createMetaLiveTranscription({ apiKey: options.apiKey, url, model }, handlers);
    },
    transcribe(pcm) {
      if (!options.apiKey) return Promise.reject(notConfigured());
      const apiKey = options.apiKey;
      const audioMs = Math.round((pcm.length / PCM_BYTES_PER_SECOND) * 1000);
      // Sending takes ~half the audio length; allow that plus the configured budget.
      const deadlineMs = audioMs / 2 + options.timeoutMs;

      return new Promise<TranscriptionResult>((resolve, reject) => {
        const segments: string[] = [];
        let settled = false;
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";

        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            ws.close();
          } catch {
            // already closed
          }
          if (error) reject(error);
          else resolve({ text: segments.join(" ").replace(/\s+/g, " ").trim(), audioMs, model });
        };

        const timer = setTimeout(
          () => finish(providerErrors.timeout("Meta voice", deadlineMs)),
          deadlineMs,
        );

        const stream = async () => {
          for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
            if (settled || ws.readyState !== WebSocket.OPEN) return;
            ws.send(pcm.subarray(i, i + FRAME_BYTES));
            await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
          }
          const silence = Buffer.alloc(FRAME_BYTES);
          for (let i = 0; i < TRAILING_SILENCE_FRAMES; i++) {
            if (settled || ws.readyState !== WebSocket.OPEN) return;
            ws.send(silence);
            await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
          }
          if (!settled && ws.readyState === WebSocket.OPEN) ws.send('{"type":"endStream"}');
        };

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              authorization: { accessToken: apiKey },
              mode: "ENDPOINTING",
              audioEncoding: "PCM_24KHZ",
              model,
              partialMode: "CUMULATIVE",
            }),
          );
        };

        let handshakeDone = false;
        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          let message: ServerEvent;
          try {
            message = JSON.parse(event.data) as ServerEvent;
          } catch {
            return;
          }
          if (message.type === "error") {
            const detail = typeof message.message === "string" ? message.message : "unknown error";
            const auth = /auth|token|permission|credential/i.test(
              `${detail} ${String(message.errorType ?? "")}`,
            );
            finish(
              auth
                ? providerErrors.auth("Meta voice")
                : providerErrors.unavailable("Meta voice", detail),
            );
            return;
          }
          if (!handshakeDone && "sessionId" in message) {
            handshakeDone = true;
            void stream();
            return;
          }
          if (message.type === "speechComplete" && typeof message.transcript === "string") {
            segments.push(message.transcript);
          }
        };

        ws.onerror = () => {
          if (!settled)
            finish(providerErrors.unavailable("Meta voice", "WebSocket connection failed"));
        };

        ws.onclose = (event) => {
          if (settled) return;
          if (!handshakeDone) {
            finish(providerErrors.unavailable("Meta voice", `connection closed (${event.code})`));
          } else {
            finish();
          }
        };
      });
    },
  };
}
