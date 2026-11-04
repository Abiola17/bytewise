"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_TRANSCRIPTION_SECONDS, TRANSCRIPTION_SAMPLE_RATE } from "@bytewise/shared";

export type RecorderState =
  | { status: "idle" }
  | { status: "recording"; seconds: number }
  | { status: "processing" }
  | { status: "error"; message: string };

// Copies microphone samples to the main thread. Loaded from a Blob URL so no
// separate static file is needed.
const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

/** Linear resampling to the transcription rate, then float → 16-bit little-endian PCM. */
function toPcm16(chunks: Float32Array[], inputRate: number): ArrayBuffer {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.length;
  }
  const ratio = inputRate / TRANSCRIPTION_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const view = new DataView(new ArrayBuffer(outLength * 2));
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const base = Math.floor(pos);
    const next = Math.min(base + 1, input.length - 1);
    const sample = input[base]! + (input[next]! - input[base]!) * (pos - base);
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return view.buffer;
}

/**
 * Records the microphone and hands PCM16 24 kHz mono audio to `onAudio` when
 * stopped. Stops automatically at the server's length limit.
 */
export function useVoiceRecorder(onAudio: (pcm: ArrayBuffer) => Promise<void>) {
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  const resources = useRef<{
    stream: MediaStream;
    context: AudioContext;
    node: AudioWorkletNode;
    chunks: Float32Array[];
    timer: ReturnType<typeof setInterval>;
    workletUrl: string;
  } | null>(null);

  const release = useCallback(() => {
    const r = resources.current;
    if (!r) return null;
    resources.current = null;
    clearInterval(r.timer);
    r.node.disconnect();
    r.stream.getTracks().forEach((t) => t.stop());
    void r.context.close();
    URL.revokeObjectURL(r.workletUrl);
    return r;
  }, []);

  const stop = useCallback(async () => {
    const r = release();
    if (!r) return;
    setState({ status: "processing" });
    try {
      await onAudio(toPcm16(r.chunks, r.context.sampleRate));
      setState({ status: "idle" });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Transcription failed.",
      });
    }
  }, [onAudio, release]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ status: "error", message: "This browser cannot record audio here." });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setState({ status: "error", message: "Microphone access was denied." });
      return;
    }
    const context = new AudioContext();
    const workletUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
    );
    await context.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(context, "pcm-capture");
    const chunks: Float32Array[] = [];
    node.port.onmessage = (e: MessageEvent<Float32Array>) => chunks.push(e.data);
    context.createMediaStreamSource(stream).connect(node);

    const started = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      if (seconds >= MAX_TRANSCRIPTION_SECONDS) void stop();
      else setState({ status: "recording", seconds });
    }, 250);
    resources.current = { stream, context, node, chunks, timer, workletUrl };
    setState({ status: "recording", seconds: 0 });
  }, [stop]);

  // Never leave the microphone on after unmounting.
  useEffect(() => () => void release(), [release]);

  return { state, start, stop, reset: () => setState({ status: "idle" }) };
}
