"use client";

import { useRef, useState } from "react";
import { AlertCircle, ImagePlus, Loader2, ScanSearch } from "lucide-react";
import { MAX_SCREENSHOT_BYTES, SCREENSHOT_MIME_TYPES, type Screenshot } from "@bytewise/shared";
import { api, screenshotImageUrl } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// SAM matches concrete nouns; abstract phrases like "warning" find nothing.
const PHRASE_SUGGESTIONS = ["button", "text box", "image", "icon", "table"];

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

/** The screenshot with SAM's regions drawn over it, scaled with the image. */
function AnnotatedScreenshot({ shot }: { shot: Screenshot }) {
  return (
    <figure className="space-y-2 rounded-md border p-2">
      <div className="relative">
        {/* A plain <img>: the image is served by the API at runtime, not a static asset. */}
        <img
          src={screenshotImageUrl(shot.id)}
          alt={`Screenshot${shot.fileName ? ` ${shot.fileName}` : ""} with ${shot.regions.length} highlighted region(s) matching "${shot.phrase}"`}
          className="block h-auto w-full rounded"
        />
        {shot.regions.map((r, i) => (
          <div
            key={i}
            aria-hidden
            className="absolute rounded-sm border-2 border-primary bg-primary/15"
            style={{
              left: `${(r.x1 / shot.width) * 100}%`,
              top: `${(r.y1 / shot.height) * 100}%`,
              width: `${((r.x2 - r.x1) / shot.width) * 100}%`,
              height: `${((r.y2 - r.y1) / shot.height) * 100}%`,
            }}
          >
            <span className="absolute -top-4 left-0 rounded bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
              {i + 1}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{shot.model}</Badge>
        {shot.regions.length === 0
          ? `No regions matched "${shot.phrase}". Try a more concrete noun.`
          : `${shot.regions.length} region(s) matching "${shot.phrase}"`}
      </figcaption>
    </figure>
  );
}

export function ScreenshotPanel({
  sessionId,
  screenshots,
  onUploaded,
}: {
  sessionId: string;
  screenshots: Screenshot[];
  onUploaded: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phrase, setPhrase] = useState("text box");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setError(null);
    if (!(SCREENSHOT_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setError("Screenshots are limited to 4 MB.");
      return;
    }
    setBusy(true);
    try {
      await api.uploadScreenshot(sessionId, {
        phrase,
        mimeType: file.type as (typeof SCREENSHOT_MIME_TYPES)[number],
        data: await readAsBase64(file),
        fileName: file.name,
      });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Screenshots" className="space-y-3">
      <form onSubmit={submit} className="space-y-2 rounded-md border border-dashed p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <ImagePlus className="size-4" aria-hidden /> Add a screenshot of the bug
        </p>
        <input
          ref={fileRef}
          type="file"
          accept={SCREENSHOT_MIME_TYPES.join(",")}
          aria-label="Screenshot file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs file:mr-3 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1 file:text-xs"
        />
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Highlight objects named (a concrete noun)</span>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            list="screenshot-phrases"
            maxLength={80}
            className="w-full rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <datalist id="screenshot-phrases">
            {PHRASE_SUGGESTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <Button size="sm" type="submit" disabled={!file || phrase.trim().length < 2 || busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ScanSearch aria-hidden />}
          Find regions with SAM 3.1
        </Button>
        {error && (
          <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          The regions are added to this session&apos;s evidence for the next diagnosis.
        </p>
      </form>
      {[...screenshots].reverse().map((shot) => (
        <AnnotatedScreenshot key={shot.id} shot={shot} />
      ))}
    </section>
  );
}
