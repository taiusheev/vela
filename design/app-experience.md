# Vela app experience redesign

7 October 2026 · Native app presentation revision

The app should make the next useful family action clear, then get out of the way. The visual work extends the Kept Light identity and the customer-journey behavior pass rather than replacing its consent, account, family-selection or recovery rules.

## What the audit showed

| Current presentation | Consequence | Redesign |
|---|---|---|
| Similar typography and containers for asks, answers, receipts and replies | People have to parse a record to understand the conversation | Separate the ask context, a clearly framed answer, then family replies and the next action |
| Primary compose button appears before an answer that is ready to reply to | The page can pull people into tomorrow before finishing today | Give the current exchange priority; keep the next ask easy to find |
| A large suggestion leads the composer | System content competes with the person's own words | Start with recipient and format, then the person's text; suggestions are an optional aid |
| Several full rows of chips and descriptions | The send action falls far below the first viewport | Compact the common formats; reveal less common choices and schedule controls deliberately |
| Navigation uses font glyphs | Weight, baseline and meaning vary by platform | One native 24-unit vector icon family, with visible labels |
| Small muted captions and faint input borders | Some text or control boundaries lack adequate contrast | Strengthen caption ink, add meaningful control-edge colour and retain focus indication |
| Early/empty/error states are mostly explanatory paragraphs | The reason for the state and next action are easy to miss | Calm editorial state graphics, specific heading, concise explanation and an actionable recovery |
| Settings look like another content feed | Daily participation and account maintenance compete | Strong section grouping, human names first, clear control rows and visible confirmation dialogs |

The judgments above are design observations from the synthetic app preview, not measured conversion findings. The audit captures are in `audit/`.

## Four roles, four appropriately sized experiences

### Organiser

The current pilot path is admission → sign-in code → connect the existing family → consent pending → first question → accepted/queued → next local morning → answer → reply → Sunday read. The app-first creation path remains behind its capability gate.

Daily Today answers three questions in order: **Who has answered? What did they share? What can I do next?** An answer receives a visible reply action. A morning waiting for an answer stays neutral. A quiet notice explains observable facts and presents a human contact choice. Family and parent choices remain explicit, particularly before away dates, nearby contacts or a weekly read.

### Parent or older relative

An invitation arrives from a recognisable relative through an enabled messenger. No app installation is necessary for that path. Consent, optional health-word sharing, pause and decline remain separate choices. The ordinary morning is previous family replies, a named question and one easy answer. The dedicated parent app surface remains a capability-dependent alternative: generous type and targets, one message at a time, no bottom-tab navigation.

The visual design uses a quiet window, named content and specific receipt wording. Answered means answered. No health or safety conclusion is encoded by the graphic.

### Relative or contributor

Connect approved membership → Today → reply, or select the parent and compose a question. Three common formats lead: words, two photos and voice. Less common formats remain reachable. The send action stays visible in a footer while the form scrolls, with keyboard avoidance on iOS. The default timing is explained close to the send action; schedule changes are optional and never silently override a conflict.

Changing parent preserves written words while resetting parent-bound media and timing as defined by the behavior pass. A failed or uncertain send keeps its original retry identity. The success result names the actual returned recipient and timing and distinguishes acceptance from delivery. A demo clearly says it sent no message.

### Nearby contact

There is no ordinary daily app task. The organiser asks an already-consented nearby person only by taking an explicit action. The contact can accept, decline today, or withdraw. A parent's answer or human resolution settles the notice and stands down the request. The design avoids dispatch, tracking or automatic-rescue imagery.

## Navigation and hierarchy

The existing four destinations remain Today, Exchanges, Sunday and You. The names and native routing remain stable. The graphic language is a window, a reply/conversation, an open book and a person. Labels always accompany the icons. No unread-count badges or manufactured activity rewards are added.

Today is the active conversation. Exchanges is its readable history. Sunday is a slower organiser review with explicit parent context. You holds family maintenance, notifications, personal choices and help. Composer and exchange detail are focused routes with a visible way back.

## Composition rules

- A person's words carry the expressive serif; information and controls carry Inter.
- Use a strong page title, then one clear context line. Avoid repeating the same information across title, eyebrow, receipt and footer.
- An answer has a restrained amber edge and spacious text. Amber is paired with words, never a standalone meaning.
- Reply and compose affordances have real, drawn icons. The primary action remains a clearly labelled control.
- Inputs and unselected interactive chips have meaningful borders. Decorative separators can remain light.
- Ordinary product pages stay precise and calm. Editorial illustration appears at first-use, empty or reflective moments rather than behind family text.
- Motion is a single light appearance, calm transitions, and immediate static alternatives under Reduce Motion.
- Respect text scaling, long family names and keyboard visibility. Visual proof on the web is separate from native accessibility evidence.

## State completeness

Every changed flow must preserve: loading, fresh content, stale content, read failure/retry, no accepted parent, waiting for consent, paused, away, first arrival pending, accepted ask, uncertain send/retry, scheduling conflict, revoked membership and user cancellation. Presentation must not substitute example content for a failed live request.

Confirmations should be visible immediately and contain the actual family or person affected. Leave, pause and removal retain their safeguards. Graphics do not alter request semantics or provider capabilities.

## Review and handoff

The isolated implementation checkout is `/Users/timuraiusheev/Documents/Vela/vela-app-design`. The demo preview uses only synthetic content. The brand kit retains before/after captures, reusable illustration/icon sources, this flow rationale and verification receipts in one place.

Validate changed layouts at small phone width, ordinary phone width, large type and dark appearance. Walk compose → accepted result, parent switching, reply, navigation, Sunday selection and account recovery. Run the repository checks and the demo journeys after integration with the behavior pass. Signed iPhone voice/media permissions, real OTP, provider delivery, native text scaling and a real family week remain separate evidence.

## Implemented surfaces

Today, Ask, exchange detail, Exchanges, Sunday, You, organiser setup and the linked parent-phone screen use the shared visual revision. Existing customer-journey behavior, capabilities, parent targeting, encrypted drafts, uncertain-send identity and accepted-ask feedback remain in place. The parent messenger flow is unchanged. The linked parent-phone screen is reviewed with its synthetic morning fixture; actual incoming content still requires native/device review.

The source graphics are `apps/app/src/components/brand/icon.tsx` (23 icons) and `scene.tsx` (5 scenes). `experience.tsx` contains page headings, answer panels, format tiles, named action rows and empty states. `suggestion.tsx` keeps composer assistance optional. Small light glyphs omit window divisions; larger lights use the approved divided-window grammar. Reduce Motion keeps the light static.

The caption token is #756D62 (4.77:1 against cream), and the interactive control border is #948779 (3.28:1 against cream). These supersede the older caption and rule-border guidance. Tinted surfaces use the stronger secondary ink for small status text and eyebrows (at least 6.38:1 on the light theme tints); the caption ink is reserved for cream or white grounds. Cards use a 20-unit radius, page margins 24, ordinary caption 14/20, and a 34/40 display heading. All graphics use current palette tokens and hide their decorative content from assistive technology; action labels retain the meaning.

The review bundle lives beside the brand book in `15-app-design/`, containing before/after phone captures, exact SVG/PNG icon and scene exports, the four role paths and a local interactive Expo preview. Generated raster illustration was reviewed but held out because its surrounding halo did not meet the intended product style.
