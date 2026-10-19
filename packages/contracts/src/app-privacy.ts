import { z } from "zod";

/** The exact English permission shown and fingerprinted by the testing app. Change its version when meaning changes. */
export const APP_PRIVACY_VERSION = "app-privacy.v1";
export const APP_PRIVACY_TEXT =
  "Vela is a free, invitation-only test run by Timur Aiusheev in Taipei, Taiwan (t.aiusheev@gmail.com). We save your account details and the family setup and messages you choose to provide. OpenAI in the United States processes family text and voice transcripts for summaries, suggestions and weekly reads; Deepgram in the United States processes voice notes into text. OpenAI API data is not used for training by default, but abuse-monitoring logs may keep inputs and outputs for up to 30 days, with safety or legal exceptions. The founder can read family exchanges to operate and review the test. Your parent portrait and optional calling number stay on this device; photos deliberately sent as messages are uploaded. Your parent decides separately whether to join and whether health words may be shared. You cannot agree for another adult. Vela is not a medical or emergency service. You can stop, withdraw consent or request access, correction or deletion by contacting the founder. Read the full privacy notice for recipients, retention and rights. By choosing Agree and continue, you confirm you are an adult authorised to provide this information, accept the service terms, and explicitly permit the AI processing described here for the information you choose to share.";
export const AppPrivacyAcceptance = z.strictObject({
  version: z.literal(APP_PRIVACY_VERSION),
  ai_processing: z.literal(true),
  terms: z.literal(true),
});
export type AppPrivacyAcceptance = z.infer<typeof AppPrivacyAcceptance>;
export const appPrivacyAcceptance = (): AppPrivacyAcceptance => ({
  version: APP_PRIVACY_VERSION,
  ai_processing: true,
  terms: true,
});
