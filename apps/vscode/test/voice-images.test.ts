import { describe, expect, it } from "vitest";
import { parseAvfoundationAudioDevices, pcmLevel, pickMicrophone } from "../src/audio/recorder";
import { sniffImageType, validateImages } from "../src/agent/images";
import { createChatSession, withoutImages } from "../src/chat-session";
import type { ChatMessage, MetaClient } from "../src/meta/meta-client";
import type { ChatEntry } from "../src/protocol";

// Real `ffmpeg -f avfoundation -list_devices true -i ""` output from a Mac.
const LIST = `[AVFoundation indev @ 0x7c] AVFoundation video devices:
[AVFoundation indev @ 0x7c] [0] FaceTime HD Camera
[AVFoundation indev @ 0x7c] AVFoundation audio devices:
[AVFoundation indev @ 0x7c] [0] Iriun Webcam Audio
[AVFoundation indev @ 0x7c] [1] MacBook Pro Microphone
[AVFoundation indev @ 0x7c] [2] Microsoft Teams Audio
[in#0 @ 0x7c] Error opening input: Input/output error`;

describe("microphone selection", () => {
  it("reads audio devices from ffmpeg's list", () => {
    expect(parseAvfoundationAudioDevices(LIST)).toEqual([
      "Iriun Webcam Audio",
      "MacBook Pro Microphone",
      "Microsoft Teams Audio",
    ]);
  });

  it("prefers the built-in microphone over virtual devices, unless one is configured", () => {
    const devices = parseAvfoundationAudioDevices(LIST);
    expect(pickMicrophone(devices)).toBe("MacBook Pro Microphone");
    expect(pickMicrophone(devices, "Iriun Webcam Audio")).toBe("Iriun Webcam Audio");
    expect(pickMicrophone(["Iriun Webcam Audio", "USB Audio"])).toBe("USB Audio");
    expect(pickMicrophone([])).toBeNull();
  });
});

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000020000000308060000009d74665c0000001049444154789c63f8cfc0f01f0c18180000a4f00ffd8c9f6d0000000049454e44ae426082",
  "hex",
);

describe("image attachments", () => {
  it("detects the real type from the bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });

  it("accepts real images and rejects disguised or oversized files", () => {
    expect(validateImages([{ name: "a.png", dataBase64: PNG.toString("base64") }])).toMatchObject({
      ok: true,
      images: [{ name: "a.png", mimeType: "image/png" }],
    });
    expect(
      validateImages([{ name: "x.png", dataBase64: Buffer.from("<html>").toString("base64") }]),
    ).toMatchObject({ ok: false });
    expect(
      validateImages([
        { name: "big.png", dataBase64: Buffer.alloc(4 * 1024 * 1024 + 1, 0x89).toString("base64") },
      ]),
    ).toMatchObject({ ok: false });
    expect(
      validateImages(
        Array.from({ length: 5 }, () => ({ name: "a.png", dataBase64: PNG.toString("base64") })),
      ),
    ).toMatchObject({ ok: false });
    expect(validateImages([{ name: "a.png", dataBase64: "not base64!" }])).toMatchObject({
      ok: false,
    });
  });

  it("sends images to the model with the text, and keeps only names when saving", async () => {
    const calls: ChatMessage[][] = [];
    const client = {
      model: "t",
      async chat(req: { messages: ChatMessage[] }) {
        calls.push(req.messages);
        return {
          content: "It shows a 500 error.",
          toolCalls: [],
          finishReason: "stop",
          model: "t",
        };
      },
    } as unknown as MetaClient;
    const session = createChatSession({
      client: () => client,
      workspace: () => null,
      editorContext: () => null,
      newId: () => Math.random().toString(),
    });
    const seen: ChatEntry[] = [];
    const image = {
      name: "error.png",
      mimeType: "image/png" as const,
      dataBase64: PNG.toString("base64"),
    };
    await session.send(
      "",
      (e) => seen.push(e),
      () => {},
      { images: [image] },
    );

    expect(seen[0]).toMatchObject({ role: "user", attachments: ["error.png"] });
    const sent = calls[0]!.at(-1)!.content;
    expect(Array.isArray(sent)).toBe(true);
    expect(sent).toEqual([
      { type: "text", text: "Please look at the attached image." },
      { type: "image_url", image_url: { url: `data:image/png;base64,${image.dataBase64}` } },
    ]);

    const saved = JSON.stringify(session.snapshot());
    expect(saved).not.toContain(image.dataBase64);
    expect(saved).toContain("an image was attached here");
  });

  it("marks spoken messages", async () => {
    const client = {
      model: "t",
      async chat() {
        return { content: "ok", toolCalls: [], finishReason: "stop", model: "t" };
      },
    } as unknown as MetaClient;
    const session = createChatSession({
      client: () => client,
      workspace: () => null,
      editorContext: () => null,
      newId: () => "id",
    });
    const seen: ChatEntry[] = [];
    await session.send(
      "fix the login bug",
      (e) => seen.push(e),
      () => {},
      { spoken: true },
    );
    expect(seen[0]).toMatchObject({ role: "user", text: "fix the login bug", spoken: true });
  });

  it("withoutImages leaves plain text messages alone", () => {
    expect(withoutImages({ role: "user", content: "hi" })).toEqual({ role: "user", content: "hi" });
  });
});

describe("pcmLevel", () => {
  const tone = (amplitude: number) => {
    const pcm = new Uint8Array(4800);
    const view = new DataView(pcm.buffer);
    for (let i = 0; i < 2400; i++)
      view.setInt16(i * 2, Math.round(amplitude * Math.sin(i / 5)), true);
    return pcm;
  };
  it("is 0 for silence, grows with loudness and stays within 0–1", () => {
    expect(pcmLevel(new Uint8Array(4800))).toBe(0);
    expect(pcmLevel(new Uint8Array(0))).toBe(0);
    const quiet = pcmLevel(tone(300));
    const speech = pcmLevel(tone(4000));
    expect(quiet).toBeGreaterThan(0);
    expect(speech).toBeGreaterThan(quiet);
    expect(pcmLevel(tone(32767))).toBeLessThanOrEqual(1);
  });
});
