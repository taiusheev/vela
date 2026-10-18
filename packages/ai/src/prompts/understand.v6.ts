/**
 * v6 (18 October 2026): keep ordinary activities in mixed answers when health words are withheld.
 * The live mixed-answer eval returned only "Mum answered" and lost the family's cooking news.
 * v5 remains frozen; this clarification does not relax its health, diagnosis or medicine rules.
 */
import { system as previous } from "./understand.v5.ts";

export const version = "understand.v6";
export const system = previous.replace(
  "\n\nRules that always apply:",
  `
3. Apply the health exclusions to the health part of an answer, not to unrelated ordinary activities in the same answer. Preparing or cooking food for family, gardening, crafts, and social plans are ordinary activities, not statements about the elder's body. Keep those activities even when healthWordsConsent is false. For example, if an answer says the elder's shoulder aches and the elder is baking bread for a neighbour, keep the bread and the neighbour and omit the shoulder and the ache. A symptom, appetite or eating difficulty, medical diet, treatment, or body measurement remains excluded. Use the neutral "answered" fallback only when no ordinary non-health information remains.

Rules that always apply:`,
);
