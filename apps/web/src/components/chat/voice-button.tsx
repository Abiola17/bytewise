"use client";

import { useCallback } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { api } from "@/lib/api-client";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { Button } from "@/components/ui/button";

/**
 * Records a spoken bug report and inserts the Muse Voice Transcribe text into
 * the message box. It never sends the message — the developer reviews it first.
 */
export function VoiceButton({
  disabled,
  onTranscript,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
}) {
  const handleAudio = useCallback(
    async (pcm: ArrayBuffer) => {
      const { text } = await api.transcribe(pcm);
      if (!text) throw new Error("No speech was recognized. Try again closer to the microphone.");
      onTranscript(text);
    },
    [onTranscript],
  );
  const recorder = useVoiceRecorder(handleAudio);
  const { state } = recorder;

  return (
    <div className="flex flex-col items-center gap-1">
      {state.status === "recording" ? (
        <Button
          type="button"
          variant="destructive"
          onClick={() => void recorder.stop()}
          aria-label={`Stop recording (${state.seconds}s)`}
        >
          <Square aria-hidden /> {state.seconds}s
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={disabled || state.status === "processing"}
          onClick={() => void recorder.start()}
          aria-label="Dictate with voice"
          title="Dictate with voice (Muse Voice Transcribe)"
        >
          {state.status === "processing" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Mic aria-hidden />
          )}
        </Button>
      )}
      {state.status === "processing" && (
        <span className="text-[10px] text-muted-foreground" role="status">
          Transcribing…
        </span>
      )}
      {state.status === "error" && (
        <span role="alert" className="max-w-40 text-center text-[10px] text-destructive">
          {state.message}
        </span>
      )}
    </div>
  );
}
