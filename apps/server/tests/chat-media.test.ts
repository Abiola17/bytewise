import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionDetailSchema } from "@bytewise/shared";
import {
  createMetaLiveTranscription,
  liveText,
  type LiveHandlers,
  type LiveSocket,
} from "../src/providers/meta/meta.live-transcription";
import type { TranscriptionProvider } from "../src/providers/meta/meta.transcription";
import type { ModelProvider, StructuredRequest } from "../src/providers/model-provider";
import { createTestApp } from "./helpers";

// A real 2×3 PNG.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000020000000308060000009d74665c0000001049444154789c63f8cfc0f01f0c18180000a4f00ffd8c9f6d0000000049454e44ae426082",
  "hex",
);

const needsInformation = JSON.stringify({
  kind: "needs_information",
  reply: "What do you see?",
  summary: "Need more detail.",
  likelyCause: null,
  confidence: null,
  uncertainty: null,
  suggestedFix: null,
  limitations: [],
  clarifyingQuestions: ["What do you see?"],
  evidenceIds: [],
});

describe("images attached to chat messages", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  afterEach(async () => ctx?.cleanup());

  const requests: StructuredRequest[] = [];
  const provider: ModelProvider = {
    name: "test",
    model: "test-model",
    async generateStructured(request) {
      requests.push(request);
      return { content: needsInformation, model: "test-model", usage: null };
    },
  };

  async function session() {
    ctx = await createTestApp({ modelProvider: provider });
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

  const post = (sessionId: string, payload: object) =>
    ctx.app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/messages`, payload });

  it("shows the image to the model with the request and stores it on the message", async () => {
    const sessionId = await session();
    const res = await post(sessionId, {
      content: "What is wrong on this page?",
      images: [{ fileName: "login.png", mimeType: "image/png", data: PNG.toString("base64") }],
    });
    expect(res.statusCode).toBe(200);

    const content = requests.at(-1)!.messages[1]!.content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
    expect(parts[0]!.text).toContain("ATTACHED IMAGES");
    expect(parts[1]!.image_url!.url).toBe(`data:image/png;base64,${PNG.toString("base64")}`);

    const detail = sessionDetailSchema.parse(res.json());
    const user = detail.messages.find((m) => m.role === "user")!;
    expect(user.images).toEqual([
      { id: expect.any(String), fileName: "login.png", mimeType: "image/png", width: 2, height: 3 },
    ]);

    const image = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/message-images/${user.images[0]!.id}/image`,
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["x-content-type-options"]).toBe("nosniff");
    expect(image.rawPayload.equals(PNG)).toBe(true);
  });

  it("accepts an image on its own and stores a default request", async () => {
    const sessionId = await session();
    const res = await post(sessionId, {
      content: "",
      images: [{ mimeType: "image/png", data: PNG.toString("base64") }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages[0].content).toBe("Please look at the attached image.");
  });

  it("checks the bytes, not the declared type, and stores nothing on failure", async () => {
    const sessionId = await session();
    const fake = Buffer.from("<svg onload=alert(1)>").toString("base64");
    const res = await post(sessionId, {
      content: "look",
      images: [{ mimeType: "image/png", data: fake }],
    });
    expect(res.statusCode).toBe(415);
    const detail = (
      await ctx.app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}` })
    ).json();
    expect(detail.messages).toEqual([]);
  });

  it("limits the number of images and requires text or an image", async () => {
    const sessionId = await session();
    const image = { mimeType: "image/png", data: PNG.toString("base64") };
    expect(
      (await post(sessionId, { content: "look", images: Array(5).fill(image) })).statusCode,
    ).toBe(400);
    expect((await post(sessionId, { content: "" })).statusCode).toBe(400);
  });
});

describe("live dictation socket", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  afterEach(async () => ctx?.cleanup());

  /** A fake live session that "recognizes" one word per audio chunk. */
  function fakeTranscription() {
    const audio: Buffer[] = [];
    let cancelled = false;
    const provider: TranscriptionProvider = {
      model: "test-voice",
      async transcribe() {
        throw new Error("not used");
      },
      live(handlers: LiveHandlers) {
        const words: string[] = [];
        return {
          push(chunk) {
            audio.push(chunk);
            words.push(`word${words.length + 1}`);
            handlers.onText(words.join(" "));
          },
          async finish() {
            return `${words.join(" ")}.`;
          },
          cancel() {
            cancelled = true;
          },
        };
      },
    };
    return { provider, audio, cancelled: () => cancelled };
  }

  async function open(origin: string) {
    const fake = fakeTranscription();
    ctx = await createTestApp({ transcriptionProvider: fake.provider });
    await ctx.app.ready();
    const ws = await ctx.app.injectWS("/api/v1/transcriptions/live", { headers: { origin } });
    const received: Array<{ type: string; text?: string; message?: string }> = [];
    const closed = new Promise<void>((r) => ws.on("close", () => r()));
    ws.on("message", (data: Buffer) => received.push(JSON.parse(data.toString())));
    return { ws, received, closed, fake };
  }

  it("streams text back as audio arrives, then a final transcript", async () => {
    const { ws, received, closed, fake } = await open("http://localhost:3000");
    ws.send(Buffer.alloc(4800));
    ws.send(Buffer.alloc(4800));
    ws.send('{"type":"stop"}');
    await closed;
    expect(received).toEqual([
      { type: "text", text: "word1" },
      { type: "text", text: "word1 word2" },
      { type: "final", text: "word1 word2." },
    ]);
    expect(fake.audio.map((a) => a.length)).toEqual([4800, 4800]);
  });

  it("refuses other origins", async () => {
    await expect(open("https://evil.example")).rejects.toThrow();
  });

  it("drops the session when the browser disconnects", async () => {
    const { ws, fake } = await open("http://localhost:3000");
    ws.send(Buffer.alloc(4800));
    ws.terminate();
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.cancelled()).toBe(true);
  });
});

describe("createMetaLiveTranscription", () => {
  class FakeSocket implements LiveSocket {
    binaryType = "";
    sent: Array<string | Buffer> = [];
    onopen: LiveSocket["onopen"] = null;
    onmessage: LiveSocket["onmessage"] = null;
    onerror: LiveSocket["onerror"] = null;
    onclose: LiveSocket["onclose"] = null;
    send(data: string | Buffer) {
      this.sent.push(data);
      if (data === '{"type":"endStream"}') setTimeout(() => this.onclose?.({ code: 1000 }), 0);
    }
    close() {}
    event(msg: object) {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
    get audio() {
      return this.sent.filter((d): d is Buffer => Buffer.isBuffer(d));
    }
  }

  function setup() {
    const socket = new FakeSocket();
    const texts: string[] = [];
    const live = createMetaLiveTranscription(
      { apiKey: "k", url: "wss://test", model: "m", socket: () => socket },
      { onText: (t) => texts.push(t) },
    );
    socket.onopen?.({});
    return { socket, texts, live };
  }

  it("queues audio until the handshake, then sends 80 ms frames", () => {
    const { socket, live } = setup();
    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({
      authorization: { accessToken: "k" },
      partialMode: "CUMULATIVE",
    });
    live.push(Buffer.alloc(3840 + 100));
    expect(socket.audio).toHaveLength(0);
    socket.event({ sessionId: "s" });
    expect(socket.audio.map((f) => f.length)).toEqual([3840]);
    live.push(Buffer.alloc(3840 - 100));
    expect(socket.audio.map((f) => f.length)).toEqual([3840, 3840]);
  });

  it("reports growing partial text and keeps finished turns", async () => {
    const { socket, texts, live } = setup();
    socket.event({ sessionId: "s" });
    socket.event({ type: "transcript", transcript: "Why does" });
    socket.event({ type: "speechComplete", transcript: "Why does login fail?" });
    socket.event({ type: "transcript", transcript: "Check" });
    expect(texts).toEqual(["Why does", "Why does login fail?", "Why does login fail? Check"]);
    const done = live.finish();
    socket.event({ type: "speechComplete", transcript: "Check session.js." });
    await expect(done).resolves.toBe("Why does login fail? Check session.js.");
    expect(socket.sent.at(-1)).toBe('{"type":"endStream"}');
  });

  it("fails with the service's error", async () => {
    const { socket, live } = setup();
    socket.event({ type: "error", message: "invalid access token" });
    await expect(live.finish()).rejects.toMatchObject({ code: "provider_auth_failed" });
  });

  it("joins text the way the box shows it", () => {
    expect(liveText(["a ", " b"], " c ")).toBe("a b c");
  });
});
