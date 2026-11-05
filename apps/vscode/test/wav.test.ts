import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resampleToPcm16, wavTo24kPcm16 } from "../src/audio/wav";
import { PCM_SAMPLE_RATE } from "../src/meta/meta-transcription";

describe("WAV and PCM conversion", () => {
  it("resamples 48 kHz mono samples to 24 kHz PCM16", () => {
    // 48000 samples = 1 second of audio at 48 kHz
    const samples = new Float32Array(48000);
    // 440 Hz sine wave
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    const pcm = resampleToPcm16(samples, 48000);
    // 24000 samples * 2 bytes = 48000 bytes
    expect(pcm.length).toBe(PCM_SAMPLE_RATE * 2);
  });

  it("parses real fixture bug-report.wav and resamples to 24 kHz PCM16", () => {
    const fixturePath = path.resolve(__dirname, "../../../e2e/fixtures/bug-report.wav");
    if (!fs.existsSync(fixturePath)) {
      console.warn("Skipping bug-report.wav test: fixture not found at", fixturePath);
      return;
    }
    const buf = fs.readFileSync(fixturePath);
    const pcm = wavTo24kPcm16(new Uint8Array(buf));

    // The fixture is ~4.78 seconds of 48 kHz mono audio
    // At 24 kHz, 4.78 seconds * 48000 bytes/sec ~ 229,500 bytes
    expect(pcm.length).toBeGreaterThan(200_000);
    expect(pcm.length).toBeLessThan(300_000);
    // Must be even number of bytes (16-bit samples)
    expect(pcm.length % 2).toBe(0);
  });

  it("handles non-WAV buffer as raw PCM fallback", () => {
    const raw = new Uint8Array([1, 2, 3, 4]);
    const out = wavTo24kPcm16(raw);
    expect(out).toBe(raw);
  });
});
