# Customer journeys and experience checks

7 October 2026. This is the journey contract for the customer-flow improvement pass. It builds on `05-product-spec-v2.md`, the messenger flows and the release capabilities; it does not enable a deferred product or claim device/real-family evidence.

## The promise at every step

One small exchange from real family, an easy answer, and a clear next step when a morning is quiet. People should always know who an action is for, what happened, what happens next, and how to stop. A successful send is different from a delivered morning, an answer, and a read-back. Silence and a failed network read are different states.

## Who uses it

| Customer | First useful moment | Daily habit | Controls and exit |
| --- | --- | --- | --- |
| Organiser, often an adult child living elsewhere | Parent agrees; first family ask is ready for the parent's local morning | Check the light, ask or reply, share turns with relatives | Nearby contacts, calling number by permission, away dates, own pause, help and leave; another organiser must remain reachable |
| Parent or other adult with a kept light | A recognisable invitation from a relative, then an easy yes or no in their own messenger | Hear yesterday's family replies, receive one named ask, answer by tap/text/voice/photo | See what the family sees, choose health-word sharing separately, stop/start and decline without pressure |
| Adult relative, including a busy student or grandchild | Join the approved family; see a real answer and send a short reply | Respond to their turn with words, two photos or a voice note; reactions take one tap | Clear recipient and timing, editable suggestions, retained written drafts, own pause/resume and leave |
| Nearby neighbour or relative | Read the organiser's invitation and agree or decline; no app/account required | Nothing in ordinary days; respond only when the organiser explicitly asks to look in | Say can't today, receive a stand-down when the parent answers, stop to withdraw |

Children may contribute through an admitted adult's phone. The current pilot admits approved adults; this pass does not introduce child accounts or change participant eligibility.

## Complete paths

### Organiser: setup to the first week

Invitation/admission → email code → existing Telegram family connection → confirm the correct family → parent consent in the parent's own chat → first ask → first arrival at the parent's local hour → first answer and light → human reply → next-morning read-back → first Sunday read.

In the current free pilot, the founder prepares the Telegram family and roster. The app connects that existing membership; connecting never creates organiser privileges. A contributor must join the approved family group first. The app offers help at the connection step, preserves entered names/codes after a failure, and lets an expired challenge be replaced. The broader app-first setup stays behind its existing capability: name/address/language/location/hour → first ask → optional nearby contacts → messenger invite → waiting for consent. A shared invitation is not acceptance.

### Parent: invitation to an ordinary morning

Relative shares invitation → parent opens Telegram or enabled LINE → recognisable organiser/address form, privacy notice and silence explanation → yes/no → separate optional health-word question → first morning tomorrow → hear previous replies if any → named ask → tap or own words → acknowledgement → day complete.

The parent need not install Vela or make an account. A no sends nothing and tells the organiser calmly. Stop pauses future mornings; start restores them. Expired links point back to the inviter. No answer is labelled as illness or an emergency. Delivery, acknowledgements and read-backs require live messenger evidence independently of an app demo.

### Relative: joining and contributing in seconds

Approved family group → read the notice → participate in the messenger, or sign in and connect the same membership in the app → Today → reply to an answer, or Ask → explicit parent → common format → words/photo/voice → parent's next morning or an available later date → confirmed queue outcome → Today.

An ask is never silently redirected from an unavailable parent. Switching parent resets parent-specific media and timing while retaining written words. An uncertain send retries its original body and identity. An accepted ask names its recipient and scheduled date, or says it is waiting for an available morning. Older replies say whether the parent will hear them; every human reply remains visible to the family.

### Organiser and nearby contact: a quiet morning

Ordinary arrival → one gentle repeat → quiet notice with facts → organiser uses their usual call/chat, marks a known explanation, waits two hours, or asks a consented nearby contact → contact accepts/declines today's request → parent's answer or organiser resolution → notice settled and contacted people stood down.

Away dates suppress the quiet ladder while morning asks continue. The organiser chooses the correct parent before changing away dates or nearby contacts. A loading/error state never claims there are no contacts or that the limit was reached. Vela is not an emergency service; customer wording remains factual and calm.

### Returning, several parents/families, and leaving

Return → last successful read plus freshness → focus/foreground refresh → retry after network failure. Select the family before acting; each family's data/draft keys stay separate. On Sunday select the parent explicitly; that same parent supplies the weekly read and story question. Notification taps select an available matching family before opening its ask/exchange; a revoked membership does not reopen it. Explicit unknown parent links fail closed.

Own pause explains what stops before confirmation. Resume restores turns. Leaving names the family, explains its consequences and preserves the last-active-organiser rule. Removing a kept story asks for confirmation. Sign-out clears session data. Data access/correction/deletion and consent changes use the existing help route; no private family content is needed in a support message.

## Improvements from this audit

| Gap | Acceptance check |
| --- | --- |
| No resend/recovery on sign-in; code sends could overlap | Resend with cooldown, change-address action, correct delivery destination, six-digit validation, busy guards; signup fallback only for an unknown identity |
| A connection dead end has no help action | Existing-family requirements and roles are clear; help/privacy are reachable and opening failures have a usable fallback |
| Only the first family is reachable | A session-scoped family chooser; reads follow the chosen membership; family-specific UI state resets; notification opens the matching authorised family |
| Sunday/story/nearby/phone setup favour the first parent | Parent choices and recipient names remain consistent; each parent's nearby/phone action has an explicit id |
| Unknown away/nearby ids fall back to another person | Unknown explicit recipient renders a recovery action and sends nothing |
| Failed or stale reads have dead ends | Focus/pull/manual retry on You, Sunday, book and precision; nearby retries and accurate loading/limit states |
| No morning yet has little guidance | Waiting-for-yes, paused and pre-first-arrival states explain the next step without inventing content |
| Accepted asks disappear without an outcome | Today confirms the actual returned recipient and scheduled date or queued timing, distinct from delivery |
| Pause, leave and story removal are easy to trigger accidentally | Named confirmation, busy controls, truthful consequences and recoverable failure |
| Keyboard and helper labels obscure forms | Keyboard taps remain usable; inputs have a concise field label separate from explanatory help |

## Verification and release boundaries

Use synthetic content for browser/automated journeys. Required checks: pure selection/auth/recovery regressions, complete catalogue checks, `pnpm check`, CI including PostgreSQL contention, and Maestro journeys for daily and recovery paths. Review phone-width screens with long names and large text where available. Record each audit row's source and test evidence in the PR.

Signed iPhone input/permissions/media/accessibility, real OTP delivery, signed-in multi-family switching, connection expiry, parent consent, nearby consent, next-morning read-back and the observed family week remain independent live checks. Existing release gates apply. No purchase, billing, new notification channel, parent-app activation or real-family invitation is implied by this experience pass.
