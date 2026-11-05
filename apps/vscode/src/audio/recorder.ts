import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Microphone recording from the extension host. VS Code webviews have no
 * microphone access, so the panel asks the extension to record with ffmpeg,
 * which captures 24 kHz mono 16-bit PCM — the format Muse Voice Transcribe takes.
 */

export const RECORDING_LIMITS = { maxSeconds: 120 };

const COMMON_FFMPEG_PATHS = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
];

/** VS Code started from the Dock often lacks Homebrew in PATH, so check the usual places too. */
export function findFfmpeg(configured?: string): string | null {
  const candidates = [
    configured?.trim(),
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .map((d) => d && path.join(d, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")),
    ...COMMON_FFMPEG_PATHS,
  ].filter((c): c is string => Boolean(c));
  return (
    candidates.find((c) => {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? null
  );
}

/** Audio input names from `ffmpeg -f avfoundation -list_devices true` (macOS). */
export function parseAvfoundationAudioDevices(stderr: string): string[] {
  const lines = stderr.split("\n");
  const start = lines.findIndex((l) => /AVFoundation audio devices/i.test(l));
  if (start === -1) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /\]\s*\[(\d+)\]\s*(.+?)\s*$/.exec(line);
    if (!m) break;
    names.push(m[2]!);
  }
  return names;
}

/** Prefers a built-in microphone over virtual devices (webcam apps, meeting software). */
export function pickMicrophone(devices: string[], preferred?: string): string | null {
  if (preferred && devices.includes(preferred)) return preferred;
  return (
    devices.find((d) => /built-?in|macbook.*microphone/i.test(d)) ??
    devices.find(
      (d) => /microphone|mic\b/i.test(d) && !/teams|zoom|virtual|iriun|blackhole/i.test(d),
    ) ??
    devices.find((d) => !/teams|zoom|virtual|iriun|blackhole/i.test(d)) ??
    devices[0] ??
    null
  );
}

function listMacMicrophones(ffmpeg: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      ffmpeg,
      ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
      { timeout: 10_000 },
      (_err, _out, stderr) => resolve(parseAvfoundationAudioDevices(String(stderr))),
    );
  });
}

/** ffmpeg input arguments for the platform's microphone. */
export async function inputArgs(ffmpeg: string, preferred?: string): Promise<string[]> {
  if (process.platform === "darwin") {
    const mic = pickMicrophone(await listMacMicrophones(ffmpeg), preferred);
    if (!mic) throw new Error("No microphone was found.");
    return ["-f", "avfoundation", "-i", `:${mic}`];
  }
  if (process.platform === "linux") return ["-f", "pulse", "-i", preferred || "default"];
  if (process.platform === "win32") {
    if (!preferred) {
      throw new Error(
        'Set "bytewise.microphone" to your microphone name (see: ffmpeg -list_devices true -f dshow -i dummy).',
      );
    }
    return ["-f", "dshow", "-i", `audio=${preferred}`];
  }
  throw new Error(`Recording is not supported on ${process.platform}.`);
}

/** Loudness of PCM16 mono audio on a 0–1 scale (RMS, scaled so speech fills it). */
export function pcmLevel(pcm: Uint8Array): number {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, samples * 2);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const v = view.getInt16(i * 2, true) / 32768;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(Math.sqrt(sum / samples) * 6));
}

export interface Recording {
  /** Stops and returns the captured PCM. */
  stop(): Promise<Uint8Array>;
  /** Stops and discards the audio. */
  cancel(): void;
}

/** Starts recording; resolves once ffmpeg is running. */
export async function startRecording(options: {
  ffmpeg: string;
  microphone?: string;
  maxSeconds?: number;
  onLimit?: () => void;
  /** Receives PCM as it is captured, for live transcription. */
  onData?: (chunk: Uint8Array) => void;
}): Promise<Recording> {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    ...(await inputArgs(options.ffmpeg, options.microphone)),
    "-t",
    String(options.maxSeconds ?? RECORDING_LIMITS.maxSeconds),
    "-ac",
    "1",
    "-ar",
    "24000",
    "-f",
    "s16le",
    "pipe:1",
  ];
  const child: ChildProcess = spawn(options.ffmpeg, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const chunks: Buffer[] = [];
  let stderr = "";
  let stopping = false;
  child.stdout!.on("data", (c: Buffer) => {
    chunks.push(c);
    options.onData?.(new Uint8Array(c.buffer, c.byteOffset, c.length));
  });
  child.stderr!.on("data", (c: Buffer) => (stderr += c.toString()));

  const exited = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(-1));
  });
  // The time limit ends the process on its own.
  void exited.then(() => {
    if (!stopping) options.onLimit?.();
  });

  // Fail fast if ffmpeg could not open the microphone (e.g. permission denied).
  const early = await Promise.race([
    exited.then((code) => ({ code })),
    new Promise<null>((r) => setTimeout(() => r(null), 400)),
  ]);
  if (early && chunks.length === 0) {
    throw new Error(
      /permission|not authorized|denied/i.test(stderr)
        ? "Microphone access was denied. Allow VS Code in System Settings → Privacy & Security → Microphone."
        : `Could not start recording${stderr ? `: ${stderr.trim().split("\n").pop()}` : "."}`,
    );
  }

  return {
    async stop() {
      stopping = true;
      // "q" asks ffmpeg to finish cleanly; kill if it does not.
      child.stdin?.write("q");
      child.stdin?.end();
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      await exited;
      clearTimeout(timer);
      const pcm = Buffer.concat(chunks);
      return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length - (pcm.length % 2));
    },
    cancel() {
      stopping = true;
      child.kill("SIGKILL");
    },
  };
}
