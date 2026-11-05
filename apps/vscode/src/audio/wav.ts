import { PCM_SAMPLE_RATE } from "../meta/meta-transcription";

export interface ParsedWav {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  samples: Float32Array; // Normalized -1.0 to 1.0 mono
}

/**
 * Resamples a mono Float32Array to 24 kHz and converts to 16-bit signed integer PCM.
 */
export function resampleToPcm16(samples: Float32Array, inputSampleRate: number): Uint8Array {
  if (inputSampleRate === PCM_SAMPLE_RATE) {
    const pcm = new Uint8Array(samples.length * 2);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]!));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return pcm;
  }

  const ratio = inputSampleRate / PCM_SAMPLE_RATE;
  const outLength = Math.floor(samples.length / ratio);
  const pcm = new Uint8Array(outLength * 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const base = Math.floor(pos);
    const next = Math.min(base + 1, samples.length - 1);
    const frac = pos - base;
    const sample = samples[base]! + (samples[next]! - samples[base]!) * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return pcm;
}

/**
 * Parses a RIFF WAV buffer into normalized mono samples and resamples to 24 kHz PCM16.
 */
export function wavTo24kPcm16(buffer: Uint8Array): Uint8Array {
  // Check if buffer is a WAV file
  if (buffer.length < 44) {
    return buffer;
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const riff = String.fromCharCode(...buffer.subarray(0, 4));
  const wave = String.fromCharCode(...buffer.subarray(8, 12));
  if (riff !== "RIFF" || wave !== "WAVE") {
    // If not a WAV header, check if it might already be raw 24kHz PCM16
    return buffer;
  }

  let offset = 12;
  let audioFormat = 1; // 1 = PCM, 3 = IEEE float
  let channels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = String.fromCharCode(...buffer.subarray(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "fmt ") {
      if (offset + 8 + 16 > buffer.length) {
        throw new Error("Malformed WAV fmt chunk.");
      }
      audioFormat = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = Math.min(chunkSize, buffer.length - dataOffset);
      break;
    }

    offset += 8 + chunkSize;
    // Word alignment in RIFF
    if (chunkSize % 2 !== 0) offset += 1;
  }

  if (dataOffset === 0 || dataSize === 0) {
    throw new Error("WAV file contains no data chunk.");
  }

  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(
      `Unsupported WAV audio format code: ${audioFormat}. Only PCM and IEEE Float are supported.`,
    );
  }

  // Convert raw data to normalized mono Float32Array
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / (bytesPerSample * channels));
  const monoSamples = new Float32Array(totalSamples);

  let byteIdx = dataOffset;
  for (let i = 0; i < totalSamples; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      let sampleVal = 0;
      if (bitsPerSample === 16) {
        sampleVal = view.getInt16(byteIdx, true) / 32768.0;
        byteIdx += 2;
      } else if (bitsPerSample === 32 && audioFormat === 3) {
        sampleVal = view.getFloat32(byteIdx, true);
        byteIdx += 4;
      } else if (bitsPerSample === 8) {
        sampleVal = (view.getUint8(byteIdx) - 128) / 128.0;
        byteIdx += 1;
      } else {
        throw new Error(`Unsupported bit depth: ${bitsPerSample}`);
      }
      sum += sampleVal;
    }
    monoSamples[i] = sum / channels;
  }

  return resampleToPcm16(monoSamples, sampleRate);
}
