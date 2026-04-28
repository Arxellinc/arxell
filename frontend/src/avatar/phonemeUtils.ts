const VOWELS = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY",
  "EH", "ER", "EY", "IH", "IY",
  "OW", "OY", "UH", "UW",
]);

const VOICED = new Set([
  "B", "D", "DH", "G", "JH", "L", "M", "N", "NG", "R", "V", "W", "Y", "Z", "ZH",
]);

export function phonemeWeight(ph: string): number {
  if (VOWELS.has(ph)) return 1.5;
  if (VOICED.has(ph)) return 0.8;
  if (ph === "SIL" || ph === "SP") return 0.35;
  return 0.6;
}

const IPA_ARPABET: [string, string][] = [
  ["eɪ", "EY"], ["aɪ", "AY"], ["ɔɪ", "OY"], ["aʊ", "AW"], ["oʊ", "OW"],
  ["tʃ", "CH"], ["dʒ", "JH"], ["ʧ", "CH"], ["ʤ", "JH"],
  ["iː", "IY"], ["uː", "UW"], ["ɑː", "AA"], ["ɔː", "AO"], ["ɜː", "ER"], ["ɝː", "ER"],
  ["æ", "AE"], ["ɑ", "AA"], ["ʌ", "AH"], ["ə", "AH"], ["ɐ", "AH"],
  ["ɛ", "EH"], ["ɪ", "IH"], ["ɔ", "AO"], ["ʊ", "UH"], ["ɜ", "ER"], ["ɝ", "ER"],
  ["i", "IY"], ["u", "UW"], ["e", "EH"], ["o", "OW"],
  ["p", "P"], ["b", "B"], ["t", "T"], ["d", "D"], ["k", "K"], ["g", "G"],
  ["f", "F"], ["v", "V"], ["θ", "TH"], ["ð", "DH"],
  ["s", "S"], ["z", "Z"], ["ʃ", "SH"], ["ʒ", "ZH"],
  ["m", "M"], ["n", "N"], ["ŋ", "NG"],
  ["l", "L"], ["ɹ", "R"], ["r", "R"], ["j", "Y"], ["w", "W"], ["h", "HH"],
];

export function parseIpaPhonemes(ipa: string): string[] {
  const result: string[] = [];
  const words = ipa.replace(/[ˈˌ.]/g, "").split(/[\s\n]+/).filter(Boolean);
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
      if (!matched) i++;
    }
    result.push("SIL");
  }
  while (result.length > 0 && result[result.length - 1] === "SIL") result.pop();
  return result;
}

const VOWEL_MAP: Record<string, string> = {
  a: "AA", e: "EH", i: "IH", o: "OW", u: "UW",
};
const CONSONANT_MAP: Record<string, string> = {
  b: "B", c: "K", d: "D", f: "F", g: "G",
  h: "HH", j: "JH", k: "K", l: "L", m: "M",
  n: "N", p: "P", q: "K", r: "R", s: "S",
  t: "T", v: "V", w: "W", x: "K", y: "Y", z: "Z",
};

export function textToPhonemeSequence(text: string): string[] {
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

      if (ch === "e" && i === word.length - 1 && word.length > 2) {
        i++; continue;
      }

      if (ch === "k" && next === "n") { result.push("N");  i += 2; continue; }
      if (ch === "w" && next === "r") { result.push("R");  i += 2; continue; }
      if (ch === "g" && next === "h") {
        const after = i + 2 < word.length ? word[i + 2] : "";
        if (!after || after === "t") { i += 2; continue; }
        result.push("F"); i += 2; continue;
      }

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

      if (next && ch === "c" && "eiy".includes(next)) { result.push("S");  i++; continue; }
      if (next && ch === "g" && "ei".includes(next))  { result.push("JH"); i++; continue; }

      if (next && ch === next && "bcdfgjklmnprstvz".includes(ch)) { i++; continue; }

      const ph = ch ? (VOWEL_MAP[ch] ?? CONSONANT_MAP[ch]) : undefined;
      if (ph) result.push(ph);
      i++;
    }
    result.push("SIL");
  }
  return result;
}

export interface PhonemeEvent {
  phoneme: string;
  startMs: number;
  endMs: number;
}

export function buildPhonemeTimeline(
  text: string,
  durationMs: number,
  ipaPhonemes?: string,
): PhonemeEvent[] {
  const phonemes = ipaPhonemes
    ? parseIpaPhonemes(ipaPhonemes)
    : textToPhonemeSequence(text);
  if (!phonemes.length) return [];

  const weights = phonemes.map(phonemeWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const timelineMs = Math.max(140, durationMs * 0.78);
  const msPerWeight = timelineMs / totalWeight;

  const timeline: PhonemeEvent[] = [];
  let elapsed = 0;
  for (let i = 0; i < phonemes.length; i++) {
    const dur = (weights[i] ?? 0.6) * msPerWeight;
    const ph = phonemes[i] ?? "SIL";
    timeline.push({
      phoneme: ph,
      startMs: elapsed,
      endMs: elapsed + dur,
    });
    elapsed += dur;
  }
  return timeline;
}
