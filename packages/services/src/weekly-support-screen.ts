import { hasSensitiveWords } from "./memory-discovery.ts";

// This private cohort supports English source text only. A profile/STT label is insufficient:
// require English phrase evidence as well as compatible script. Short fragments, mixed scripts
// and uncertain language stay out. This is a conservative gate, not a language-identification claim.
const ENGLISH_EVIDENCE =
  /\b(?:we|my|our|your|you|the|this|that|these|those|could|would|please|someone|it|let's|used|played|went|made)\b/i;
const LATIN_SCRIPT = /^[\p{Script=Latin}\P{Letter}]*$/u;
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/u;
const ADDITIONAL_SENSITIVE = [
  /\b(?:medic\w*|remedio\w*|rodilla\w*|douleur\w*|schmerz\w*|hypertens\w*|vomit\w*|nausea\w*|seizure\w*|overdose\w*|suicid\w*)\b/i,
  /\b(?:hit|struck|beat|threaten\w*|forced|abuse\w*|assault\w*)\s+(?:me|us|him|her|them)\b/i,
  /\b(?:do not|don't)\s+(?:want to|wanna)\s+(?:be alive|live)\b/i,
  /\b(?:kill|harm|hurt)\s+(?:myself|yourself|himself|herself|themselves)\b/i,
  /\bend\s+(?:my|your|his|her|their)\s+life\b/i,
  /\b(?:wish i (?:was|were) dead|disappear forever)\b/i,
];

// Replace only the ambiguous token, retaining every surrounding character for screening.
// Every exception has paired tests with sensitive content beside the ordinary phrase.
const ORDINARY_CONTEXTS: readonly [RegExp, string][] = [
  [/(\bbirthday\s+)party\b/gi, "$1occasion"],
  [
    /(\b(?:came|come|coming|went|go|going|walked|walk|walking|got|get|getting|travelled|traveled)\s+)back\b(?=\s+(?:from|to|home)\b)/gi,
    "$1returned",
  ],
  [
    /\bsugar\b(?=\s+(?:in|to)\s+(?:(?:the|my|our|a)\s+)?(?:cookies|cake|cakes|biscuits|bread|jam|dough|batter)\b)/gi,
    "ingredient",
  ],
  [
    /(\b(?:photos|pictures|videos|novel|book|film|movie|games?)\b[^.!?;]{0,40}\bon\s+(?:(?:my|our|your|the|a)\s+)?)tablet\b/gi,
    "$1device",
  ],
  [/(\bweather\s+(?:(?:is|was|felt|turned|got)\s+)?)cold\b/gi, "$1chilly"],
  [/\bcold\b(?=\s+(?:weather|air|day|morning|winter)\b)/gi, "chilly"],
  [/(\bit\s+(?:is|was|felt)\s+)cold\b(?=\s+(?:outside|outdoors)\b)/gi, "$1chilly"],
  [/\bfall\b(?=\s+(?:colou?rs|leaves|foliage|season)\b)/gi, "autumn"],
  [/(\b(?:[Mm]y|[Oo]ur)\s+friend\s+)Bill\b/g, "$1friendname"],
  [/\beye\b(?=\s+of\s+(?:the|a|my|your|our)\s+needle\b)/gi, "opening"],
  [
    /(\b(?:drew|draw|painted|paint|sketched|sketch)\s+(?:(?:a|the|red|pink|small|little)\s+){0,4})heart\b(?=[^.!?;]{0,40}\bcard\b)/gi,
    "$1symbol",
  ],
  [/(\bwe\s+)died\b(?=\s+laughing\s+at\b)/gi, "$1laughed"],
];

/** Report-only screening. Never mutates the original quote or calls an AI provider. */
export function isOrdinaryWeeklySupportSource(text: string, language: string): boolean {
  if (language !== "en" || !LATIN_SCRIPT.test(text) || BIDI_CONTROLS.test(text)) return false;
  let screened = text
    .normalize("NFKD")
    .replace(/\p{Mark}|\p{Cf}/gu, "")
    .replace(/[’‘]/g, "'");
  screened = screened.replace(/\b(?:[a-z][.\-_· ]+){3,}[a-z]\b/gi, (letters) =>
    letters.replace(/[.\-_· ]/g, ""),
  );
  if (
    (!ENGLISH_EVIDENCE.test(screened) && !/\bI\b/.test(screened)) ||
    ADDITIONAL_SENSITIVE.some((p) => p.test(screened))
  )
    return false;
  for (const [pattern, replacement] of ORDINARY_CONTEXTS)
    screened = screened.replace(pattern, replacement);
  return !hasSensitiveWords(screened);
}
