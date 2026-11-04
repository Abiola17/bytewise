import type { Region } from "@bytewise/shared";
import { AppError } from "../../errors/app-error";
import { providerErrors } from "../model-provider";

export interface SegmentationResult {
  regions: Region[];
  model: string;
}

export interface SegmentationProvider {
  readonly model: string;
  segment(image: Buffer, mimeType: string, phrase: string): Promise<SegmentationResult>;
}

/** `<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|>` — one per detected object (masks are ignored). */
const BOX_TOKEN = /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g;

export function parseSamBoxes(outputText: string): Region[] {
  return [...outputText.matchAll(BOX_TOKEN)].map((m) => ({
    x1: Number(m[1]),
    y1: Number(m[2]),
    x2: Number(m[3]),
    y2: Number(m[4]),
  }));
}

/**
 * SAM 3.1 via the Meta Model API Responses endpoint (verified 2026-11-04):
 * a noun phrase plus an image data URL; boxes come back as special tokens.
 * An empty output means nothing matched.
 */
export function createMetaSegmentationProvider(options: {
  apiKey: string | undefined;
  baseUrl: string;
  timeoutMs: number;
  model?: string;
  fetchImpl?: typeof fetch;
}): SegmentationProvider {
  const model = options.model ?? "sam-3.1";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    model,
    async segment(image, mimeType, phrase) {
      if (!options.apiKey) {
        throw new AppError(
          503,
          "provider_not_configured",
          "Screenshot analysis needs META_API_KEY in .env (SAM 3.1 is a Meta model).",
        );
      }
      let res: Response;
      try {
        res = await fetchImpl(`${options.baseUrl}/responses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            input: [
              {
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text: phrase },
                  {
                    type: "input_image",
                    image_url: `data:${mimeType};base64,${image.toString("base64")}`,
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw providerErrors.timeout("Meta SAM", options.timeoutMs);
        }
        throw providerErrors.unavailable("Meta SAM", "network error");
      }
      if (res.status === 401 || res.status === 403) throw providerErrors.auth("Meta SAM");
      if (res.status === 429) throw providerErrors.rateLimited("Meta SAM");
      if (!res.ok) throw providerErrors.unavailable("Meta SAM", `HTTP ${res.status}`);

      const body = (await res.json().catch(() => null)) as {
        output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      } | null;
      if (!body || !Array.isArray(body.output)) {
        throw providerErrors.invalidResponse("unexpected segmentation response format");
      }
      const text = body.output
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === "output_text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("");
      return { regions: parseSamBoxes(text), model };
    },
  };
}
