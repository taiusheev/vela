import { expect, it } from "vitest";
import { hasSensitiveWords } from "./memory-discovery.ts";
import { isOrdinaryWeeklySupportSource } from "./weekly-support-screen.ts";

// Supplemental cases fixed before implementing the improved screen. The original100 stay unchanged.
const ordinary = [
  "I baked cakes for my granddaughter's birthday party.",
  "Let's plan a birthday party at home.",
  "We came back from the beach.",
  "I walked back from the museum.",
  "I used a spoon of sugar in the cake.",
  "We added sugar to cookies.",
  "We looked at pictures on the tablet.",
  "I read a novel on my tablet.",
  "The cold weather kept us indoors.",
  "It was cold outside, so we painted.",
  "We enjoyed the fall colors in the park.",
  "I collected fall leaves for a collage.",
  "My friend Bill brought a puzzle.",
  "I invited my friend Bill to lunch.",
  "The eye of a needle is tiny.",
  "I threaded the eye of my needle.",
  "We drew a heart on a card for you.",
  "I painted a pink heart on your card.",
  "We died laughing at a silly cartoon.",
  "We died laughing at that comedy.",
];
const sensitive = [
  "My knee hurt at the birthday party.",
  "We came back from the hospital.",
  "I used brown sugar in cookies; my blood sugar is high.",
  "I swallowed a tablet while viewing photos.",
  "The cold weather made my chest hurt.",
  "I had a fall while collecting fall leaves.",
  "My friend Bill cannot pay his bills.",
  "The doctor checked my eye after I threaded a needle.",
  "I drew a heart on the card. My heart is racing.",
  "We died laughing at the film. My friend died yesterday.",
  "Could you help me? My medi\u200ccine changed.",
  "My MEDICATION changed today.",
  "My medicaton changed yesterday.",
  "My m.e.d.i.c.i.n.e changed today.",
  "I vomited after lunch.",
  "Someone struck me last night.",
  "My neighbour threatened me yesterday.",
  "I don't want to live any more.",
  "I want to end my life.",
  "I want to kill myself.",
];
const languageCases = [
  ["Je regarde les fleurs du jardin.", "en", false],
  ["Me gustan las flores del jardín.", "en", false],
  ["Eu gosto das flores do jardim.", "en", false],
  ["Ich sehe Blumen im Garten.", "en", false],
  ["Mi piace guardare i fiori.", "en", false],
  ["My rodilla duele desde ayer.", "en", false],
  ["My médicament a changé hier.", "en", false],
  ["My remédio mudou ontem.", "en", false],
  ["My douleur est plus forte.", "en", false],
  ["My schmerzen sind schlimmer.", "en", false],
  ["Orchids!", "en", false],
  ["Photo box 7", "en", false],
  ["🙂", "en", false],
  ["My orchids opened.", "en", true],
  ["My café photos look lovely.", "en", true],
  ["My orchids opened.", "zh-TW", false],
  ["My orchids opened.", "und", false],
  ["My orchids opened.", "fr", false],
  ["My medіcine changed.", "en", false], // Cyrillic i, not Latin.
  ["我的花開了, my flowers opened.", "en", false],
  ["i played piano.", "en", true],
  ["i used sugar in cookies.", "en", true],
] as const;

it.each(ordinary)("keeps an ordinary report context: %s", (text) => {
  expect(isOrdinaryWeeklySupportSource(text, "en")).toBe(true);
});
it.each(sensitive)("does not exempt sensitive surrounding text: %s", (text) => {
  expect(isOrdinaryWeeklySupportSource(text, "en")).toBe(false);
});
it.each(ordinary.flatMap((safe) => sensitive.map((unsafe) => [safe, unsafe] as const)))(
  "keeps whole-source screening for %s + %s",
  (safe, unsafe) => expect(isOrdinaryWeeklySupportSource(`${safe} ${unsafe}`, "en")).toBe(false),
);
it.each(languageCases)("requires supported language evidence: %s (%s)", (text, lang, eligible) => {
  expect(isOrdinaryWeeklySupportSource(text, lang)).toBe(eligible);
});
it("keeps the stricter shared memory/model screen unchanged", () => {
  for (const text of ordinary) expect(hasSensitiveWords(text)).toBe(true);
});
