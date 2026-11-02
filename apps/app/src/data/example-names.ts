import { t } from "@lingui/core/macro";

/**
 * The example family's names, in the reader's language (26 October 2026): a Taiwanese organiser
 * previewing Vela meets 小美 and 安安, not Mia and Anna. Read when shown, never at import, so the
 * active language applies.
 */
export function exampleNames() {
  return { mia: t`Mia`, anna: t`Anna`, sam: t`Sam`, igor: t`Igor` };
}
