/**
 * What the Worker wires itself to (code design §8, §9): the inbound door; the member's scheduler
 * tick and the cron's reconciliation; the three queue jobs and their messages; the nightly jobs;
 * the admin page's reads and actions, with their input and result types, its paths, and the admin
 * link; the channel quota the cron records for the overview; the ports all of them receive; and
 * `VelaError`, whose code the Worker turns into a status, with `errorLabel`, which logs a failure
 * without its message. Everything else in the package,
 * including the helpers these call themselves, is a flow's own business. The test harness is not
 * here: it lives behind `@vela/services/testing`, so production code cannot reach it.
 */
export { completeAccountLink, issueAccountLinkCode, startAccountLink } from "./account-linking.ts";
export {
  ADMIN_OVERVIEW_PATH,
  type AddContactInput,
  type AdminContext,
  type AdminOverview,
  type AdminOverviewRow,
  addContact,
  adminLink,
  type CreateInviteInput,
  createInvite,
  deleteFamily,
  endAway,
  type FailedOutboundOptions,
  type FailedOutboundRow,
  type FamilyPage,
  type FamilyPageAnswer,
  type FamilyPageWeeklyRead,
  familyPagePath,
  loadAdminOverview,
  loadFailedOutbound,
  loadFamilyPage,
  type MarkLeftResult,
  markDeceased,
  markLeft,
  type RecordConsentInput,
  type RecordContactConsentInput,
  recordConsent,
  recordContactConsent,
  removeContact,
  type SendWeeklyReadInput,
  type SendWeeklyReadResult,
  type SetAwayInput,
  sendWeeklyRead,
  setAway,
} from "./admin.ts";
export {
  authorizeFamilyAccess,
  type FamilyAccess,
  type FamilyAccessResult,
  type SessionIdentity,
} from "./api-access.ts";
export { disableApiAccount, provisionApiAccount, updateApiAccount } from "./api-account-writes.ts";
export { loadApiFamilyPlan, loadApiMe, provisionApiUser } from "./api-accounts.ts";
export {
  type AfterCommit,
  type ApiNudges,
  nothingAfterCommit,
  runAfterCommit,
} from "./api-after-commit.ts";
export {
  AskDayTakenError,
  AskPhotoMissingError,
  AskVoiceMissingError,
  composeApiAsk,
} from "./api-asks.ts";
export {
  deviceTokenHash,
  memberOfDeviceToken,
  removeApiDevice,
  setUpApiDevice,
} from "./api-device.ts";
export { type ApiExchangePageQuery, loadApiExchange, loadApiExchanges } from "./api-exchanges.ts";
export { AlreadyOrganiserError, type ApiFamilyDeps, createApiFamily } from "./api-families.ts";
export { loadApiFamily } from "./api-family.ts";
export {
  ApiIdempotencyError,
  type ApiMutationAction,
  type ApiMutationRequest,
  runApiMutation,
} from "./api-idempotency.ts";
export { loadApiLights } from "./api-lights.ts";
export {
  MAX_LIVE_PHOTOS_PER_FAMILY,
  MAX_PHOTOS_PER_ACCOUNT_DAY,
  MediaRefusedError,
  readApiMedia,
  type UploadApiMediaDeps,
  uploadApiMedia,
} from "./api-media.ts";
export { leaveApiFamily, MemberChangeRefusedError, pauseApiMember } from "./api-members.ts";
export { addApiNearby, NearbyRefusedError, removeApiNearby } from "./api-nearby.ts";
export {
  loadApiPrecision,
  PRECISION_MONTHS,
  type QuietPrecisionMonth,
  VELA_MONTH_MINIMUM,
} from "./api-precision.ts";
export { type ApiPushDeps, registerApiPushDevice, removeApiPushDevice } from "./api-push.ts";
export {
  loadApiQuiet,
  markApiQuietUseful,
  QuietUsefulRefusedError,
  resolveApiQuiet,
} from "./api-quiet.ts";
export { ReplyRefusedError, replyToApiExchange } from "./api-replies.ts";
export { loadApiToday } from "./api-today.ts";
export { startApiTrial, TrialRefusedError } from "./api-trial.ts";
export { MAX_VOICE_BYTES, MAX_VOICES_PER_ACCOUNT_DAY, uploadApiVoice } from "./api-voice.ts";
export { loadApiWeeklyRead } from "./api-weekly-read.ts";
export { type ApiBookEntry, loadApiBook, removeApiBookEntry } from "./book.ts";
export type {
  ChannelRegistry,
  Clock,
  Config,
  Deps,
  Heartbeat,
  JobQueue,
  Logger,
  MediaJob,
  MediaStore,
  MemberScheduler,
  OutboundJob,
  PushFailure,
  PushMessage,
  PushPort,
  PushReceipt,
  PushResult,
  Random,
  UnderstandJob,
} from "./deps.ts";
export { pushFailureOf } from "./deps.ts";
export { deviceInboundEvent, loadDeviceMessages, readDeviceMedia } from "./device-messages.ts";
export {
  type DeviceVoiceRefusal,
  DeviceVoiceRefusedError,
  MAX_DEVICE_VOICE_BYTES,
  storeDeviceVoice,
} from "./device-voice.ts";
export { errorLabel, VelaError } from "./errors.ts";
export { type DeliveryResult, deliverOutbound } from "./gateway.ts";
export { handleInbound } from "./inbound/router.ts";
export { applyRetention, rollupMetrics } from "./jobs.ts";
export { askApiToLookIn, LookInRefusedError } from "./nearby-ask.ts";
export { inviteApiNearby, NearbyInviteRefusedError } from "./nearby-consent.ts";
export { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
export type { DeviceAlerts } from "./push-devices.ts";
export { type BilledChannel, type ChannelQuotaSnapshot, recordChannelQuota } from "./quota.ts";
export {
  BANK_PROMPT_VERSION,
  pickBankItem,
  type RenderedSuggestion,
  renderSuggestion,
  type SuggestionOutcome,
  type SuggestionsRun,
  writeSuggestionFor,
  writeSuggestions,
} from "./suggestions.ts";
export { type ReconcileResult, reconcile, tickMember } from "./tick.ts";
