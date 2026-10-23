/** Internal, unconfigured review builder. No routes, persistence or model calls.
 * Live integration needs approved purpose wording and a trustworthy human-review/source loader.
 */
import {
  buildWeeklySupportDraft,
  type WeeklySupportContext,
  type WeeklySupportSelection,
  type WeeklySupportSource,
  type WeeklySupportSuggestion,
} from "@vela/core/weekly-support";
import { hasSensitiveWords } from "./memory-discovery.ts";

export function prepareWeeklySupportReview(
  context: WeeklySupportContext,
  sources: readonly WeeklySupportSource[],
  selections: readonly WeeklySupportSelection[],
): WeeklySupportSuggestion[] {
  const eligible = buildWeeklySupportDraft(context, sources, selections);
  // Screen the entire source, not just the selected quote. A benign excerpt cannot hide health.
  return eligible.filter((item) => {
    const source = sources.find((row) => row.id === item.source.id);
    return source !== undefined && source.text.length <= 10_000 && !hasSensitiveWords(source.text);
  });
}
