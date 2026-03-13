import { ttsSpeak } from "./tauri";
import { useVoiceStore } from "../store/voiceStore";

// ── IPA → ARPAbet phoneme mapping ─────────────────────────────────────────────
// Used to parse the IPA string returned by Kokoro's G2P (via misaki/espeak-ng).
// Entries are tried longest-first so multi-char IPA symbols win over sub-sequences.

const IPA_ARPABET: [string, string][] = [
  // Diphthongs / affricates / ligatures (must come before single chars)
  ["eɪ","EY"],["aɪ","AY"],["ɔɪ","OY"],["aʊ","AW"],["oʊ","OW"],
  ["tʃ","CH"],["dʒ","JH"],["ʧ","CH"],["ʤ","JH"],
  // Long vowels
  ["iː","IY"],["uː","UW"],["ɑː","AA"],["ɔː","AO"],["ɜː","ER"],["ɝː","ER"],
  // Short vowels
  ["æ","AE"],["ɑ","AA"],["ʌ","AH"],["ə","AH"],["ɐ","AH"],
  ["ɛ","EH"],["ɪ","IH"],["ɔ","AO"],["ʊ","UH"],["ɜ","ER"],["ɝ","ER"],
  // High vowels (after longer sequences so iː/uː are matched first)
  ["i","IY"],["u","UW"],["e","EH"],["o","OW"],
  // Consonants
  ["p","P"],["b","B"],["t","T"],["d","D"],["k","K"],["g","G"],
  ["f","F"],["v","V"],["θ","TH"],["ð","DH"],
  ["s","S"],["z","Z"],["ʃ","SH"],["ʒ","ZH"],
  ["m","M"],["n","N"],["ŋ","NG"],
  ["l","L"],["ɹ","R"],["r","R"],["j","Y"],["w","W"],["h","HH"],
];

/**
 * Parse an IPA string (from misaki or espeak-ng) into an ARPAbet phoneme list.
 * Stress marks (ˈˌ) and syllable dots are stripped; spaces become SIL pauses.
 */
function parseIpaPhonemes(ipa: string): string[] {
  const result: string[] = [];
  const words = ipa
    .replace(/[ˈˌ.]/g, "")   // strip stress marks + syllable boundaries
    .split(/[\s\n]+/)
    .filter(Boolean);

  for (const word of words) {
    let i = 0;
    while (i < word.length) {
      let matched = false;
      for (const [seq, arpa] of IPA_ARPABET) {
        if (word.startsWith(seq, i)) {
          result.push(arpa);
          i += seq.length;
          matched = true;
          break;
        }
      }
      if (!matched) i++; // skip unknown IPA char
    }
    result.push("SIL");
  }
  // Remove trailing SIL
  while (result.length > 0 && result[result.length - 1] === "SIL") result.pop();
  return result;
}

// ── Text → ARPAbet fallback (used when backend G2P is unavailable) ─────────────
// Context-sensitive rules handle the most common English irregularities.

const VOWEL_MAP: Record<string, string> = {
  a: "AA", e: "EH", i: "IH", o: "OW", u: "UW",
};
const CONSONANT_MAP: Record<string, string> = {
  b: "B",  c: "K",  d: "D",  f: "F",  g: "G",
  h: "HH", j: "JH", k: "K",  l: "L",  m: "M",
  n: "N",  p: "P",  q: "K",  r: "R",  s: "S",
  t: "T",  v: "V",  w: "W",  x: "K",  y: "Y",  z: "Z",
};

function textToPhonemeSequence(text: string): string[] {
  const result: string[] = [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    let i = 0;
    while (i < word.length) {
      const ch = word[i];
      const next = i + 1 < word.length ? word[i + 1] : "";

      // Silent terminal 'e' in words longer than 2 chars
      if (ch === "e" && i === word.length - 1 && word.length > 2) {
        i++; continue;
      }

      // Silent / altered consonant pairs (before general digraph loop)
      if (ch === "k" && next === "n") { result.push("N");  i += 2; continue; } // knife
      if (ch === "w" && next === "r") { result.push("R");  i += 2; continue; } // write
      if (ch === "g" && next === "h") {
        // gh silent before t or at word end (light, night); else F (enough)
        const after = i + 2 < word.length ? word[i + 2] : "";
        if (!after || after === "t") { i += 2; continue; }
        result.push("F"); i += 2; continue;
      }

      // Common digraphs
      if (next) {
        const dg = ch + next;
        if (dg === "oo") { result.push("UW");  i += 2; continue; }
        if (dg === "ee") { result.push("IY");  i += 2; continue; }
        if (dg === "ea") { result.push("IY");  i += 2; continue; }
        if (dg === "ai") { result.push("EY");  i += 2; continue; }
        if (dg === "ay") { result.push("EY");  i += 2; continue; }
        if (dg === "ou") { result.push("AW");  i += 2; continue; }
        if (dg === "ow") { result.push("AW");  i += 2; continue; }
        if (dg === "oi") { result.push("OY");  i += 2; continue; }
        if (dg === "oy") { result.push("OY");  i += 2; continue; }
        if (dg === "th") { result.push("TH");  i += 2; continue; }
        if (dg === "sh") { result.push("SH");  i += 2; continue; }
        if (dg === "ch") { result.push("CH");  i += 2; continue; }
        if (dg === "zh") { result.push("ZH");  i += 2; continue; }
        if (dg === "ph") { result.push("F");   i += 2; continue; }
        if (dg === "wh") { result.push("W");   i += 2; continue; }
        if (dg === "ng") { result.push("NG");  i += 2; continue; }
        if (dg === "ck") { result.push("K");   i += 2; continue; }
        if (dg === "qu") { result.push("K"); result.push("W"); i += 2; continue; }
      }

      // Context-sensitive: c/g before front vowels
      if (ch === "c" && "eiy".includes(next)) { result.push("S");  i++; continue; }
      if (ch === "g" && "ei".includes(next))  { result.push("JH"); i++; continue; }

      // Doubled consonants — skip one (tt→T, ll→L, etc.)
      if (ch === next && "bcdfgjklmnprstvz".includes(ch)) { i++; continue; }

      const ph = VOWEL_MAP[ch] ?? CONSONANT_MAP[ch];
      if (ph) result.push(ph);
      i++;
    }
    result.push("SIL");
  }
  return result;
}

// ── Phoneme duration weights ───────────────────────────────────────────────────

// Relative duration weights per phoneme type for proportional timing
function phonemeWeight(ph: string): number {
  const VOWELS = new Set(["AA","AE","AH","AO","AW","AY","EH","ER","EY","IH","IY","OW","OY","UH","UW"]);
  const VOICED = new Set(["B","D","DH","G","JH","L","M","N","NG","R","V","W","Y","Z","ZH"]);
  if (VOWELS.has(ph)) return 1.5;
  if (VOICED.has(ph)) return 0.8;
  if (ph === "SIL" || ph === "SP") return 0.35;
  return 0.6; // unvoiced consonants
}

/**
 * Schedule ARPAbet phoneme viseme changes over `durationMs` milliseconds.
 *
 * @param text        Plain text being spoken (used when ipaPhonemes unavailable).
 * @param durationMs  Actual audio duration from Web Audio decode.
 * @param ipaPhonemes IPA string from Kokoro G2P; when present, replaces JS fallback.
 * @returns Cancel function that clears all timers and resets activeViseme.
 */
function schedulePhonemes(text: string, durationMs: number, ipaPhonemes?: string): () => void {
  // Prefer backend G2P phonemes (correct) over JS spelling-based fallback.
  const phonemes = ipaPhonemes ? parseIpaPhonemes(ipaPhonemes) : textToPhonemeSequence(text);
  if (!phonemes.length) return () => {};

  // Read phoneme lead from voiceStore (default 50ms).
  // Mouth movements physically anticipate audio by ~50ms due to motor planning.
  const leadMs = Math.max(0, useVoiceStore.getState().phonemeLead ?? 50);

  const weights = phonemes.map(phonemeWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  // 0.78× compresses the viseme timeline so mouth finishes slightly before
  // tail silence, avoiding a "frozen" expression at sentence end.
  const visemeTimelineMs = Math.max(140, durationMs * 0.78);
  const msPerWeight = visemeTimelineMs / totalWeight;

  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  let elapsedMs = 0;

  for (let i = 0; i < phonemes.length; i++) {
    const ph = phonemes[i];
    const fireAt = elapsedMs;
    elapsedMs += weights[i] * msPerWeight;

    const t = setTimeout(() => {
      if (cancelled) return;
      // SIL/SP → null so renderer enters release mode (mouth closes via lerp)
      useVoiceStore.getState().setActiveViseme(ph === "SIL" || ph === "SP" ? null : ph);
    }, Math.max(0, fireAt - leadMs));
    timers.push(t);
  }

  // Clear viseme slightly after audio ends
  const endTimer = setTimeout(() => {
    if (cancelled) return;
    useVoiceStore.getState().setActiveViseme(null);
  }, durationMs + 120);
  timers.push(endTimer);

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
    useVoiceStore.getState().setActiveViseme(null);
  };
}

let activeTtsPlaybacks = 0;

function beginTtsPlayback(): void {
  activeTtsPlaybacks += 1;
  useVoiceStore.getState().setIsSpeaking(true);
}

function endTtsPlayback(): void {
  activeTtsPlaybacks = Math.max(0, activeTtsPlaybacks - 1);
  if (activeTtsPlaybacks === 0) {
    const vs = useVoiceStore.getState();
    vs.setIsSpeaking(false);
    vs.setTtsAmplitude(0);
    vs.setActiveViseme(null);
  }
}

function estimateSpeechDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const ms = words * 185;
  return Math.max(500, Math.min(16_000, ms));
}

function startSyntheticLipSync(text: string, ipaPhonemes?: string): () => void {
  const durationMs = estimateSpeechDurationMs(text);
  const cancelPhonemes = schedulePhonemes(text, durationMs, ipaPhonemes);
  let cancelled = false;
  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  let phase = 0;

  const tick = () => {
    if (cancelled) return;
    phase += 0.56;
    const wobble =
      0.095 +
      Math.sin(phase) * 0.055 +
      Math.sin(phase * 2.2) * 0.018 +
      (Math.random() - 0.5) * 0.028;
    // Keep synthetic lipsync updates at ~15 Hz to reduce high-frequency
    // voice-store writes without visibly affecting mouth motion.
    useVoiceStore.getState().setTtsAmplitude(Math.max(0.03, Math.min(0.24, wobble)));
    tickTimer = setTimeout(tick, 67);
  };
  tickTimer = setTimeout(tick, 67);

  return () => {
    cancelled = true;
    if (tickTimer !== null) clearTimeout(tickTimer);
    cancelPhonemes();
    useVoiceStore.getState().setTtsAmplitude(0);
    useVoiceStore.getState().setActiveViseme(null);
  };
}

function isMetadataOrCodeLikeLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;

  // Markdown table rows/separators.
  if (/^\|.*\|$/.test(t) || /^:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+$/.test(t)) return true;

  // Common metadata keys found in assistant/event payloads.
  if (/^(id|role|created_at|updated_at|conversation_id|message_id|tool|status|metadata|timestamp)\s*:/i.test(t)) {
    return true;
  }

  // Typical code-like lines that should never be spoken verbatim.
  if (/^(import|export|const|let|var|function|class|interface|type|return|if|else|for|while|switch|case|def|fn)\b/.test(t)) {
    return true;
  }

  // Heuristic for JSON/object-like lines and shell prompts.
  if (/^[{\[("'].*[:=].*[}\])"']?$/.test(t) || /^[>$]\s+\S+/.test(t)) return true;

  return false;
}

function dropMetadataAndCodeLikeLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isMetadataOrCodeLikeLine(line))
    .join("\n");
}

function stripEmoji(text: string): string {
  return text
    // Most emoji glyphs and pictographs.
    .replace(/\p{Extended_Pictographic}/gu, "")
    // Regional indicator symbols used for flags.
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    // Zero-width joiner + variation selectors used in emoji sequences.
    .replace(/[\u200D\uFE0E\uFE0F]/g, "")
    // Keycap combining mark.
    .replace(/\u20E3/g, "");
}

// Strip markdown/tool tags/metadata to produce clean spoken text in voice mode.
export function stripForTts(text: string): string {
  const stripped = text
    // YAML frontmatter-like metadata blocks.
    .replace(/^\s*---\s*\n[\s\S]*?\n---\s*/g, "")
    // Tool call tags and payloads.
    .replace(/<write_to_file>[\s\S]*?<\/write_to_file>/g, "")
    .replace(/<read_file>[\s\S]*?<\/read_file>/g, "")
    .replace(/<file_contents[\s\S]*?<\/file_contents>/g, "")
    .replace(/<create_task>[\s\S]*?<\/create_task>/g, "")
    .replace(/<update_task>[\s\S]*?<\/update_task>/g, "")
    .replace(/<create_note>[\s\S]*?<\/create_note>/g, "")
    .replace(/<update_note>[\s\S]*?<\/update_note>/g, "")
    .replace(/<browser_fetch>[\s\S]*?<\/browser_fetch>/g, "")
    .replace(/<coder_run>[\s\S]*?<\/coder_run>/g, "")
    // Generic XML/HTML tags (self-closing or paired).
    .replace(/<([a-z_][\w:-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?[a-z_][\w:-]*\b[^>]*\/?>/gi, "")
    // Remove fenced code blocks entirely (do not speak placeholders).
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    // Streaming chunks can split markdown markers (e.g. "**Hello" / "world**").
    // Remove leftover emphasis/control punctuation so TTS doesn't read them aloud.
    .replace(/[*`]/g, "")
    .replace(/(^|[\s([{])_+|_+([\s)\]}.!,?:;]|$)/g, "$1$2")
    .replace(/~~/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\^?\d+\]/g, "")
    .replace(/【[^】]+】/g, "")
    .replace(/^\s*[-*+]\s/gm, "")
    // Drop lines that still look like code/metadata.
    .trim();

  return stripEmoji(dropMetadataAndCodeLikeLines(stripped))
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Play raw audio bytes (MP3/WAV/OGG) via Web Audio API.
// Registers a stop function in voiceStore for barge-in interruption.
async function setAudioSinkToSystemDefault(audio: HTMLAudioElement): Promise<void> {
  const withSink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (!withSink.setSinkId) return;
  try {
    await withSink.setSinkId("default");
  } catch (e) {
    console.debug("[voice] setSinkId('default') failed:", e);
  }
}

/**
 * Play audio bytes using the Web Audio API.
 *
 * Advantages over HTMLAudioElement:
 *  - Real-time amplitude analysis via AnalyserNode → drives avatar jaw sync
 *  - Precise duration from decoded buffer → enables phoneme scheduling
 *  - No MIME-type sniffing issues
 *
 * Falls back to HTMLAudioElement if decoding fails.
 */
async function playBytesWithHtmlAudio(
  bytes: number[],
  /** Plain text that is being spoken (used for phoneme scheduling). */
  text: string | null | undefined,
  /** IPA phoneme string from Kokoro's G2P; when present, replaces JS fallback. */
  ipaPhonemes: string | null | undefined,
  onStop?: (stop: () => void) => void,
): Promise<void> {
  beginTtsPlayback();
  // ── Web Audio path (preferred) ───────────────────────────────────────────
  const arrayBuffer = new Uint8Array(bytes).buffer.slice(0) as ArrayBuffer;
  let audioCtx: AudioContext | null = null;
  try {
    audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const durationMs = audioBuffer.duration * 1000;

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    const pcmData = new Float32Array(analyser.fftSize);
    let animId: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    // Poll amplitude at ~15 fps (67ms) instead of 60 fps.  The avatar lerps
    // between samples so visual smoothness is preserved while Zustand update
    // frequency drops by 4×, eliminating continuous React re-renders.
    const pollAmplitude = () => {
      if (finished) return;
      analyser.getFloatTimeDomainData(pcmData);
      let rms = 0;
      for (const v of pcmData) rms += v * v;
      rms = Math.sqrt(rms / pcmData.length);
      // Scale so typical speech peaks around 0.7-1.0
      useVoiceStore.getState().setTtsAmplitude(Math.min(1, rms * 10));
      animId = setTimeout(pollAmplitude, 67);
    };

    // Schedule phoneme viseme changes if text is available
    let cancelPhonemes = () => {};
    if (text) {
      cancelPhonemes = schedulePhonemes(text, durationMs, ipaPhonemes ?? undefined);
    }

    return new Promise<void>((resolve) => {
      const cleanup = () => {
        if (finished) return;
        finished = true;
        if (animId !== null) { clearTimeout(animId); animId = null; }
        cancelPhonemes();
        useVoiceStore.getState().setTtsAmplitude(0);
        void audioCtx!.close().catch(() => {});
        endTtsPlayback();
        resolve();
      };

      const stop = () => {
        try { source.stop(); } catch { /* already stopped */ }
        cleanup();
      };

      onStop?.(stop);
      source.onended = cleanup;
      source.start();
      animId = setTimeout(pollAmplitude, 67);
    });
  } catch (err) {
    // Decoding or AudioContext error — close context and fall through to HTMLAudio
    console.debug("[voice] Web Audio path failed, falling back to HTML Audio:", err);
    if (audioCtx) {
      useVoiceStore.getState().setTtsAmplitude(0);
      void audioCtx.close().catch(() => {});
    }
  }

  // ── HTMLAudioElement fallback (no amplitude analysis) ────────────────────
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = "auto";
  await setAudioSinkToSystemDefault(audio);

  return new Promise((resolve) => {
    let finished = false;
    const stopSynthetic = text ? startSyntheticLipSync(text, ipaPhonemes ?? undefined) : () => {};
    const cleanup = () => {
      if (finished) return;
      finished = true;
      stopSynthetic();
      URL.revokeObjectURL(url);
      endTtsPlayback();
      resolve();
    };
    const stop = () => {
      try { audio.pause(); audio.currentTime = 0; } catch { /* ignore */ }
      cleanup();
    };
    onStop?.(stop);
    audio.onended = cleanup;
    audio.onerror = cleanup;
    void audio.play().catch((err) => {
      console.debug("[voice] html audio play failed:", err);
      cleanup();
    });
  });
}

export async function playAudioBytes(bytes: number[], text?: string, ipaPhonemes?: string): Promise<void> {
  return playBytesWithHtmlAudio(bytes, text ?? null, ipaPhonemes ?? null, (stop) => {
    // Expose stop handle for barge-in
    useVoiceStore.getState().setStopCurrentAudio(() => { stop(); });
  }).finally(() => {
    useVoiceStore.getState().setStopCurrentAudio(null);
    useVoiceStore.getState().setTtsAmplitude(0);
    useVoiceStore.getState().setActiveViseme(null);
  });
}

// Browser speech synthesis fallback
function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      resolve();
      return;
    }
    beginTtsPlayback();
    const stopSynthetic = startSyntheticLipSync(text);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stopSynthetic();
      endTtsPlayback();
      resolve();
    };
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);

    useVoiceStore.getState().setStopCurrentAudio(() => {
      window.speechSynthesis.cancel();
      finish();
    });

    utterance.onend = () => {
      useVoiceStore.getState().setStopCurrentAudio(null);
      finish();
    };
    utterance.onerror = () => {
      useVoiceStore.getState().setStopCurrentAudio(null);
      finish();
    };
    window.speechSynthesis.speak(utterance);
  });
}

// Speak text: try backend TTS endpoint, fall back to browser speech synthesis
export async function speakText(text: string): Promise<void> {
  const clean = stripForTts(text);
  if (!clean) return;

  try {
    const result = await ttsSpeak(clean);
    if (result.audioBytes.length > 0) {
      await playAudioBytes(result.audioBytes, clean, result.phonemes ?? undefined);
      return;
    }
  } catch {
    // Backend TTS unavailable — fall through to browser
  }

  await browserSpeak(clean);
}

interface StreamingSpeechSession {
  pushDelta: (delta: string) => void;
  finalize: () => Promise<void>;
  stop: () => void;
}

const MIN_SEGMENT_WORDS = 3;
const MIN_SEGMENT_CHARS = 18;
const FIRST_SEGMENT_TIMEOUT_MS = 380;
const NEXT_SEGMENT_TIMEOUT_MS = 650;
function splitReadySegments(buffer: string): { segments: string[]; rest: string } {
  const segments: string[] = [];
  let start = 0;
  let currentLen = 0;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    const next = i + 1 < buffer.length ? buffer[i + 1] : "";
    currentLen += 1;

    const sentenceBoundary =
      (ch === "." || ch === "!" || ch === "?") && (next === "" || /\s/.test(next));
    const paragraphBoundary =
      ch === "\n" && (next === "\n" || next === "" || (i > 0 && buffer[i - 1] === "\n"));
    const clauseBoundary =
      (ch === ":" || ch === ";" || ch === ",") &&
      currentLen >= 72 &&
      (next === "" || /\s/.test(next));
    const longChunkBoundary = currentLen >= 140 && /\s/.test(ch);

    if (sentenceBoundary || paragraphBoundary || clauseBoundary || longChunkBoundary) {
      const segment = buffer.slice(start, i + 1).trim();
      if (segment) segments.push(segment);
      start = i + 1;
      currentLen = 0;
    }
  }

  return { segments, rest: buffer.slice(start) };
}

function shouldSpeakSegment(clean: string, firstSegment: boolean, timeoutFlush: boolean): boolean {
  const words = clean.split(/\s+/).filter(Boolean);
  if (firstSegment && timeoutFlush) {
    return words.length >= 1 && clean.length >= 6;
  }
  if (timeoutFlush) {
    return words.length >= 2 || clean.length >= 12;
  }
  if (firstSegment) {
    return words.length >= 2 || clean.length >= 10;
  }
  if (words.length >= MIN_SEGMENT_WORDS) return true;
  return clean.length >= MIN_SEGMENT_CHARS;
}

class AudioQueuePlayer {
  private stopped = false;
  private currentStop: (() => void) | null = null;

  async playBytes(bytes: number[], text?: string, ipaPhonemes?: string): Promise<void> {
    if (this.stopped) return;
    await playBytesWithHtmlAudio(bytes, text ?? null, ipaPhonemes ?? null, (stop) => {
      this.currentStop = stop;
    });
    this.currentStop = null;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.currentStop?.();
    this.currentStop = null;
    useVoiceStore.getState().setTtsAmplitude(0);
    useVoiceStore.getState().setActiveViseme(null);
  }
}

function browserSpeakWithStop(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      resolve();
      return;
    }
    beginTtsPlayback();
    const stopSynthetic = startSyntheticLipSync(text);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stopSynthetic();
      endTtsPlayback();
      resolve();
    };
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => finish();
    utterance.onerror = () => finish();
    window.speechSynthesis.speak(utterance);
  });
}

// Streaming TTS session that starts speaking while text is still being generated.
export function createStreamingSpeechSession(): StreamingSpeechSession {
  let pendingRaw = "";
  const queue: string[] = [];
  const player = new AudioQueuePlayer();
  let processing = false;
  let finalized = false;
  let stopped = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let emittedAnySegment = false;
  let wakeResolver: (() => void) | null = null;
  let doneResolver: (() => void) | null = null;
  const donePromise = new Promise<void>((resolve) => {
    doneResolver = resolve;
  });

  const wake = () => {
    wakeResolver?.();
    wakeResolver = null;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    finalized = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    queue.length = 0;
    pendingRaw = "";
    player.stop(); // also clears ttsAmplitude + activeViseme
    window.speechSynthesis?.cancel();
    wake();
    doneResolver?.();
    useVoiceStore.getState().setStopCurrentAudio(null);
  };

  useVoiceStore.getState().setStopCurrentAudio(stop);

  const enqueueFromBuffer = (forceFlush: boolean, timeoutFlush: boolean) => {
    const { segments, rest } = splitReadySegments(pendingRaw);
    pendingRaw = rest;
    for (const raw of segments) {
      const clean = stripForTts(raw);
      if (clean && shouldSpeakSegment(clean, !emittedAnySegment, timeoutFlush)) {
        queue.push(clean);
        emittedAnySegment = true;
      }
    }

    if (forceFlush) {
      const cleanTail = stripForTts(pendingRaw);
      pendingRaw = "";
      if (cleanTail) {
        queue.push(cleanTail);
        emittedAnySegment = true;
      }
      return;
    }

    if (timeoutFlush && pendingRaw.trim()) {
      const cleanTail = stripForTts(pendingRaw);
      if (cleanTail && shouldSpeakSegment(cleanTail, !emittedAnySegment, true)) {
        pendingRaw = "";
        queue.push(cleanTail);
        emittedAnySegment = true;
      }
    }
  };

  const armFlushTimer = () => {
    if (flushTimer) clearTimeout(flushTimer);
    const wait = emittedAnySegment ? NEXT_SEGMENT_TIMEOUT_MS : FIRST_SEGMENT_TIMEOUT_MS;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (stopped || finalized) return;
      enqueueFromBuffer(false, true);
      wake();
      void process();
    }, wait);
  };

  const process = async () => {
    if (processing) return;
    processing = true;

    try {
      while (!stopped) {
        if (queue.length === 0) {
          if (finalized) break;
          await new Promise<void>((resolve) => {
            wakeResolver = resolve;
          });
          continue;
        }

        const segment = queue.shift();
        if (!segment) continue;
        if (stopped) break;

        try {
          const result = await ttsSpeak(segment);
          if (stopped) break;
          if (result.audioBytes.length > 0) {
            await player.playBytes(result.audioBytes, segment, result.phonemes ?? undefined);
          } else {
            await browserSpeakWithStop(segment);
          }
        } catch {
          if (stopped) break;
          await browserSpeakWithStop(segment);
        }
      }
    } finally {
      processing = false;
      const stopFn = stop;
      if (useVoiceStore.getState().stopCurrentAudio === stopFn) {
        useVoiceStore.getState().setStopCurrentAudio(null);
      }
      doneResolver?.();
    }
  };

  return {
    pushDelta(delta: string) {
      if (!delta || stopped || finalized) return;
      pendingRaw += delta;
      enqueueFromBuffer(false, false);
      armFlushTimer();
      wake();
      void process();
    },
    async finalize() {
      if (stopped) return;
      finalized = true;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      enqueueFromBuffer(true, false);
      wake();
      void process();
      await donePromise;
    },
    stop,
  };
}
