import { useEffect, useRef, useState } from "react";

type VoiceStatus = "idle" | "listening" | "transcribing" | "error";

export function VoiceSearch({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, []);

  const stopAll = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  };

  const transcribeWithGroq = async (blob: Blob): Promise<string | null> => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-transcribe`;
    const form = new FormData();
    const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("ogg") ? "ogg" : "m4a";
    form.append("file", blob, `audio.${ext}`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: form,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Transcription failed (${res.status})`);
    }
    const j = (await res.json()) as { text?: string; error?: string };
    if (j.error) throw new Error(j.error);
    return (j.text ?? "").trim() || null;
  };

  const startGroqRecording = async () => {
    setError(null);
    setStatus("listening");
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size === 0) {
          setStatus("idle");
          setError("No audio captured — try again.");
          return;
        }
        setStatus("transcribing");
        try {
          const text = await transcribeWithGroq(blob);
          if (text) {
            onTranscript(text);
            setStatus("idle");
          } else {
            setStatus("idle");
            setError("No speech detected — try speaking more clearly.");
          }
        } catch (e: any) {
          setStatus("idle");
          setError(e?.message || "Voice transcription failed — using browser fallback.");
          startNativeFallback();
        }
      };
      mr.start();
    } catch (e: any) {
      setStatus("error");
      if (e?.name === "NotAllowedError") {
        setError("Microphone permission denied. Allow mic access to use voice search.");
      } else {
        setError("Could not access microphone. Trying browser speech recognition…");
        startNativeFallback();
      }
    }
  };

  const startNativeFallback = () => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setStatus("error");
      setError(
        "Voice search needs microphone access. Browser speech recognition works best in Chrome.",
      );
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    recognitionRef.current = rec;
    setStatus("listening");
    rec.onresult = (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript ?? "";
      if (text) onTranscript(text);
      setStatus("idle");
    };
    rec.onerror = (e: any) => {
      setStatus("error");
      if (e?.error === "not-allowed") {
        setError("Microphone permission denied.");
      } else {
        setError("Browser speech recognition failed. Works best in Chrome.");
      }
    };
    rec.onend = () => setStatus("idle");
    try {
      rec.start();
    } catch {
      setStatus("error");
      setError("Could not start speech recognition.");
    }
  };

  const toggle = () => {
    if (status === "listening" || status === "transcribing") {
      stopAll();
      setStatus("idle");
      return;
    }
    if (navigator.mediaDevices && typeof MediaRecorder !== "undefined") {
      startGroqRecording();
    } else {
      startNativeFallback();
    }
  };

  const label =
    status === "listening"
      ? "Listening…"
      : status === "transcribing"
        ? "Transcribing…"
        : status === "error"
          ? "Voice"
          : "Voice";

  return (
    <div style={{ position: "relative" }}>
      <button
        className="am-btn am-btn-icon"
        onClick={toggle}
        title="Voice search (Groq Whisper, Chrome fallback)"
        aria-label="Voice search"
        style={
          status === "listening" || status === "transcribing"
            ? { background: "var(--am-accent)", color: "#fff", borderColor: "transparent" }
            : undefined
        }
        type="button"
      >
        {status === "transcribing" ? (
          <span className="am-spinner" />
        ) : status === "listening" ? (
          "⏹"
        ) : (
          "🎙"
        )}
      </button>
      {status === "listening" && (
        <div
          style={{
            position: "absolute",
            top: 46,
            right: 0,
            fontSize: 11,
            color: "var(--am-muted)",
            whiteSpace: "nowrap",
          }}
        >
          {label} — tap to stop
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            top: 46,
            right: 0,
            fontSize: 11,
            color: "#ff8a95",
            maxWidth: 260,
            whiteSpace: "normal",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
