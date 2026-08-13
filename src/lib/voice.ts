/** Small client-side live dictation adapter. It uses the platform's streaming
 * speech recognizer so words appear in the composer as they are spoken. No API
 * key is shipped to the browser; a server/Tauri Whisper adapter can replace
 * this seam later without changing either composer. */
export type LiveDictation = {
  stop: () => void;
};

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionCtor = new () => Recognition;

export function startLiveDictation(
  onText: (text: string) => void,
  onError: (message: string) => void,
  language = "en-US"
): LiveDictation | null {
  const ctor = (globalThis as any).SpeechRecognition as RecognitionCtor | undefined
    ?? (globalThis as any).webkitSpeechRecognition as RecognitionCtor | undefined;
  if (!ctor) {
    onError("Live dictation is not supported by this browser");
    return null;
  }

  const recognition = new ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = language;
  let committed = "";
  let stopped = false;

  recognition.onresult = (event: any) => {
    let interim = "";
    for (let i = event.resultIndex ?? 0; i < event.results.length; i += 1) {
      const part = event.results[i][0]?.transcript ?? "";
      if (event.results[i].isFinal) committed += `${part.trim()} `;
      else interim += part;
    }
    onText(`${committed}${interim}`.trimStart());
  };
  recognition.onerror = (event: any) => {
    if (event?.error !== "aborted") {
      // Permission failures are terminal. Do not restart Chromium's recognizer
      // after not-allowed/no-speech, or it will flood the UI with toasts.
      stopped = true;
      try { recognition.stop(); } catch { /* already stopped */ }
      onError(`Voice input: ${event?.error ?? "recognition failed"}`);
    }
  };
  recognition.onend = () => {
    // Some Chromium builds stop unexpectedly; keep dictation genuinely live
    // until the user clicks the mic again.
    if (!stopped) {
      try { recognition.start(); } catch { /* already restarting */ }
    }
  };
  try {
    recognition.start();
  } catch {
    onError("Could not start live dictation");
    return null;
  }
  return {
    stop: () => {
      stopped = true;
      recognition.stop();
    },
  };
}
