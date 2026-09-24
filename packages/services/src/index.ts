/**
 * What the Worker wires itself to (code design §8, §9): the inbound door; the member's scheduler
 * tick and the cron's reconciliation; the three queue jobs and their messages; the nightly jobs;
 * the admin page's reads and actions, with their input and result types, its paths, and the admin
 * link; the ports all of them receive; and `VelaError`, whose code the Worker turns into a status,
 * with `errorLabel`, which logs a failure without its message. Everything else in the package,
 * including the helpers these call themselves, is a flow's own business. The test harness is not
 * here: it lives behind `@vela/services/testing`, so production code cannot reach it.
 */
export { completeAccountLink, issueAccountLinkCode, startAccountLink } from "./account-linking.ts";
export {
  ADMIN_OVERVIEW_PATH,
  type AddContactInput,
  type AdminContext,
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
export { AskDayTakenError, composeApiAsk } from "./api-asks.ts";
export { type ApiExchangePageQuery, loadApiExchanges } from "./api-exchanges.ts";
export { AlreadyOrganiserError, type ApiFamilyDeps, createApiFamily } from "./api-families.ts";
export {
  ApiIdempotencyError,
  type ApiMutationAction,
  type ApiMutationRequest,
  runApiMutation,
} from "./api-idempotency.ts";
export { loadApiLights } from "./api-lights.ts";
export { ReplyRefusedError, replyToApiExchange } from "./api-replies.ts";
export { loadApiToday } from "./api-today.ts";
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
  Random,
  UnderstandJob,
} from "./deps.ts";
export { errorLabel, VelaError } from "./errors.ts";
export { type DeliveryResult, deliverOutbound } from "./gateway.ts";
export { handleInbound } from "./inbound/router.ts";
export { applyRetention, rollupMetrics } from "./jobs.ts";
export { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
export { type ReconcileResult, reconcile, tickMember } from "./tick.ts";
