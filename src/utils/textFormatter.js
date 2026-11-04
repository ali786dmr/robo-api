
const pronunciationMap = [
  [/\ball-rounder\b/gi, "all rounder"],
  [/\ballrounder\b/gi, "all rounder"],
  [/\bwicket-keeper\b/gi, "wicket keeper"],
  [/\bwicketkeeper\b/gi, "wicket keeper"],
  [/\bT20\b/gi, "tee twenty"],
  [/\bODI\b/g, "one day international"],
  [/\bIPL\b/g, "I P L"],
  [/\bBCCI\b/g, "B C C I"],
  [/\bAI\b/g, "A I"],
  [/\bCPU\b/g, "C P U"],
  [/\bWi-Fi\b/gi, "why fie"]
];

export function formatSpeechText(text) {
  if (!text) return "";

  let result = text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0F\u200D]/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/[#*_~]/g, "");

  for (const [pattern, replacement] of pronunciationMap) {
    result = result.replace(pattern, replacement);
  }

  return result
    .replace(/\s+/g, " ")
    .trim();
}