import { MetaApiError } from "./meta-client";

/** 24 kHz, 16-bit, mono — the input format for Meta Muse Voice Transcribe. */
export const PCM_SAMPLE_RATE = 24_000;
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * 2; // 48,000 bytes/sec

const FRAME_BYTES = PCM_BYTES_PER_SECOND * 0.08; // 80 ms frames = 3,840 bytes
const FRAME_INTERVAL_MS = 40; // 2x real-time streaming
const TRAILING_SILENCE_FRAMES = 8;

export interface TranscriptionResult {
  text: string;
  audioMs: number;
  model: string;
}

export interface WebSocketLike {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
}

export interface TranscriptionOptions {
  apiKey: string | undefined;
  url?: string;
  model?: string;
  timeoutMs?: number;
  webSocketFactory?: (url: string) => WebSocketLike;
}

type ServerEvent =
  | { type?: undefined; sessionId: string }
  | { type: "speechComplete"; transcript: string; audioProcessedMs?: number }
  | { type: "error"; message?: string; errorType?: string }
  | { type: string; [key: string]: unknown };

/**
 * Meta's realtime ASR WebSocket client for muse-voice-transcribe-1.0:
 * JSON handshake with the access token, binary PCM frames, then {"type":"endStream"}.
 * Final text for spoken turns arrives in speechComplete events.
 */
export function createMetaTranscriptionClient(options: TranscriptionOptions) {
  const url = options.url ?? "wss://api.meta.ai/v1/asr/realtime";
  const model = options.model ?? "muse-voice-transcribe-1.0";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const wsFactory = options.webSocketFactory ?? ((u: string) => new WebSocket(u) as WebSocketLike);

  return {
    model,
    async transcribe(pcm: Uint8Array): Promise<TranscriptionResult> {
      if (!options.apiKey) {
        throw new MetaApiError(
          "no_key",
          "Voice input needs a Meta API key. Run “Bytewise: Set Meta API Key” to add one.",
        );
      }
      const apiKey = options.apiKey;
      const audioMs = Math.round((pcm.length / PCM_BYTES_PER_SECOND) * 1000);
      const deadlineMs = audioMs / 2 + timeoutMs;

      return new Promise<TranscriptionResult>((resolve, reject) => {
        const segments: string[] = [];
        let settled = false;
        let ws: WebSocketLike;
        try {
          ws = wsFactory(url);
          ws.binaryType = "arraybuffer";
        } catch (err) {
          reject(
            new MetaApiError(
              "network",
              `Could not connect to voice service: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
          return;
        }

        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            ws.close();
          } catch {
            // Already closed.
          }
          if (error) {
            reject(error);
          } else {
            resolve({
              text: segments.join(" ").replace(/\s+/g, " ").trim(),
              audioMs,
              model,
            });
          }
        };

        const timer = setTimeout(
          () =>
            finish(
              new MetaApiError(
                "timeout",
                `Meta voice service timed out after ${Math.round(deadlineMs / 1000)}s.`,
              ),
            ),
          deadlineMs,
        );

        const stream = async () => {
          for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
            if (settled) return;
            ws.send(pcm.subarray(i, Math.min(i + FRAME_BYTES, pcm.length)));
            await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
          }
          const silence = new Uint8Array(FRAME_BYTES);
          for (let i = 0; i < TRAILING_SILENCE_FRAMES; i++) {
            if (settled) return;
            ws.send(silence);
            await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
          }
          if (!settled) ws.send('{"type":"endStream"}');
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
            const isAuth = /auth|token|permission|credential/i.test(
              `${detail} ${String(message.errorType ?? "")}`,
            );
            finish(
              new MetaApiError(isAuth ? "auth" : "server", `Voice transcription error: ${detail}`),
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
          if (!settled) {
            finish(
              new MetaApiError("network", "WebSocket connection to Meta voice service failed."),
            );
          }
        };

        ws.onclose = (event) => {
          if (settled) return;
          if (!handshakeDone) {
            finish(
              new MetaApiError(
                "network",
                `Voice service connection closed before handshake (${event.code}).`,
              ),
            );
          } else {
            finish();
          }
        };
      });
    },
  };
}

export type MetaTranscriptionClient = ReturnType<typeof createMetaTranscriptionClient>;
