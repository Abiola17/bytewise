import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { screenshotSchema, sessionDetailSchema } from "@bytewise/shared";
import { readImageInfo } from "../src/filesystem/image-info";
import { parseSamBoxes, type SegmentationProvider } from "../src/providers/meta/meta.segmentation";
import type { TranscriptionProvider } from "../src/providers/meta/meta.transcription";
import type { ModelProvider, StructuredRequest } from "../src/providers/model-provider";
import { createTestApp } from "./helpers";

// A real 2×3 PNG (IHDR width=2, height=3).
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000020000000308060000009d74665c0000001049444154789c63f8cfc0f01f0c18180000a4f00ffd8c9f6d0000000049454e44ae426082",
  "hex",
);

describe("readImageInfo", () => {
  it("reads PNG dimensions from the bytes", () => {
    expect(readImageInfo(PNG)).toEqual({ mimeType: "image/png", width: 2, height: 3 });
  });

  it("reads JPEG dimensions from the SOF marker", () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40,
      0x00, 0x80, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(readImageInfo(jpeg)).toEqual({ mimeType: "image/jpeg", width: 128, height: 64 });
  });

  it("rejects non-images", () => {
    expect(readImageInfo(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(readImageInfo(Buffer.alloc(0))).toBeNull();
  });
});

describe("parseSamBoxes", () => {
  it("extracts boxes and ignores mask payloads", () => {
    const text =
      "<0f>0<|box;x1=40;y1=194;x2=123;y2=224;w=640;h=400|><|mask;x=0;y=0;data=31,84,~!!!'H|>" +
      "<|box;x1=1;y1=2;x2=3;y2=4;w=640;h=400|>";
    expect(parseSamBoxes(text)).toEqual([
      { x1: 40, y1: 194, x2: 123, y2: 224 },
      { x1: 1, y1: 2, x2: 3, y2: 4 },
    ]);
    expect(parseSamBoxes("")).toEqual([]);
  });
});

describe("media API", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  afterEach(async () => {
    await ctx?.cleanup();
  });

  const transcribed: Buffer[] = [];
  const transcription: TranscriptionProvider = {
    model: "test-voice",
    async transcribe(pcm) {
      transcribed.push(pcm);
      return { text: "the login endpoint returns 500", audioMs: 1000, model: "test-voice" };
    },
  };
  const segmentation: SegmentationProvider = {
    model: "test-sam",
    async segment(_image, _mime, phrase) {
      return {
        model: "test-sam",
        regions: phrase === "nothing" ? [] : [{ x1: 0, y1: 1, x2: 2, y2: 3 }],
      };
    },
  };

  async function session(modelProvider?: ModelProvider) {
    ctx = await createTestApp({
      transcriptionProvider: transcription,
      segmentationProvider: segmentation,
      ...(modelProvider ? { modelProvider } : {}),
    });
    fs.mkdirSync(path.join(ctx.projectsDir, "app"));
    fs.writeFileSync(path.join(ctx.projectsDir, "app", "index.js"), "console.log(1);\n");
    const project = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/v1/projects",
        payload: { directory: "app" },
      })
    ).json();
    return (
      await ctx.app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/sessions`,
        payload: {},
      })
    ).json().id as string;
  }

  const transcribe = (body: Buffer) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/v1/transcriptions",
      headers: { "content-type": "application/octet-stream" },
      payload: body,
    });

  it("transcribes uploaded PCM audio without storing it", async () => {
    await session();
    const res = await transcribe(Buffer.alloc(48_000)); // 1 s of 24 kHz PCM16
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      text: "the login endpoint returns 500",
      audioMs: 1000,
      model: "test-voice",
    });
    expect(transcribed.at(-1)!.length).toBe(48_000);
  });

  it.each([
    [Buffer.alloc(100), 400, /too short/],
    [Buffer.alloc(48_001), 400, /16-bit/],
    [Buffer.alloc(61 * 48_000), 400, /60 seconds/],
  ])("rejects invalid audio (%#)", async (body, status, message) => {
    await session();
    const res = await transcribe(body);
    expect(res.statusCode).toBe(status);
    expect(res.json().error.message).toMatch(message);
  });

  const upload = (sessionId: string, payload: object) =>
    ctx.app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/screenshots`, payload });

  it("stores a screenshot, its regions and an evidence item", async () => {
    const sessionId = await session();
    const res = await upload(sessionId, {
      phrase: "button",
      mimeType: "image/png",
      data: PNG.toString("base64"),
      fileName: "login<script>.png",
    });
    expect(res.statusCode).toBe(201);
    const shot = screenshotSchema.parse(res.json());
    expect(shot).toMatchObject({
      width: 2,
      height: 3,
      regions: [{ x1: 0, y1: 1, x2: 2, y2: 3 }],
      model: "test-sam",
      fileName: "login_script_.png",
    });

    const detail = sessionDetailSchema.parse(
      (await ctx.app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}` })).json(),
    );
    expect(detail.screenshots.map((s) => s.id)).toEqual([shot.id]);
    const ev = detail.evidence.find((e) => e.sourceType === "screenshot_regions")!;
    expect(ev.excerpt).toMatch(/SAM 3\.1 found 1 region\(s\) matching "button"/);

    const image = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/screenshots/${shot.id}/image`,
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["x-content-type-options"]).toBe("nosniff");
    expect(image.rawPayload.equals(PNG)).toBe(true);
  });

  it("rejects files that are not the image type they claim to be", async () => {
    const sessionId = await session();
    const notImage = await upload(sessionId, {
      phrase: "button",
      mimeType: "image/png",
      data: Buffer.from("<html>").toString("base64"),
    });
    expect(notImage.statusCode).toBe(415);
    const mismatch = await upload(sessionId, {
      phrase: "button",
      mimeType: "image/jpeg",
      data: PNG.toString("base64"),
    });
    expect(mismatch.statusCode).toBe(400);
  });

  it("includes screenshot regions as evidence in the next diagnosis", async () => {
    const requests: StructuredRequest[] = [];
    const provider: ModelProvider = {
      name: "test",
      model: "test-model",
      async generateStructured(request) {
        requests.push(request);
        return {
          model: "test-model",
          usage: null,
          content: JSON.stringify({
            kind: "needs_information",
            reply: "ok",
            summary: "ok",
            likelyCause: null,
            confidence: null,
            uncertainty: null,
            suggestedFix: null,
            evidenceIds: [],
            limitations: [],
            clarifyingQuestions: [],
          }),
        };
      },
    };
    const sessionId = await session(provider);
    await upload(sessionId, {
      phrase: "nothing",
      mimeType: "image/png",
      data: PNG.toString("base64"),
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/messages`,
      payload: { content: "The page shows an error" },
    });
    const prompt = requests[0]!.messages[1]!.content;
    expect(prompt).toMatch(/type="screenshot_regions"/);
    expect(prompt).toMatch(/found 0 region\(s\) matching "nothing"/);
  });

  it("returns 404 for unknown screenshots", async () => {
    await session();
    expect(
      (await ctx.app.inject({ method: "GET", url: "/api/v1/screenshots/nope/image" })).statusCode,
    ).toBe(404);
  });
});
