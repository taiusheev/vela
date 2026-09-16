/**
 * What the Worker wires itself to (code design §8, §9): the inbound door, the scheduler tick, the
 * three queue jobs, the nightly jobs, and the admin page's actions and reads, with the ports every
 * one of them receives. Everything else in the package is a flow's own business. The test harness
 * is not here: it lives behind `@vela/services/testing`, so production code cannot reach it.
 */
export {
  ADMIN_OVERVIEW_PATH,
  type AddContactInput,
  type AdminContext,
  type AdminOverviewRow,
  type AdminView,
  addContact,
  adminLink,
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
  recordAdminView,
  recordConsent,
  recordContactConsent,
  removeContact,
  type SendWeeklyReadInput,
  type SendWeeklyReadResult,
  type SetAwayInput,
  sendWeeklyRead,
  setAway,
} from "./admin.ts";
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
export { errorLabel, VELA_ERROR_CODES, VelaError, type VelaErrorCode } from "./errors.ts";
export { type DeliveryResult, deliverOutbound } from "./gateway.ts";
export { handleInbound } from "./inbound/router.ts";
export { applyRetention, draftWeeklyRead, rollupMetrics } from "./jobs.ts";
export { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
export { loadScheduleInput, type ReconcileResult, reconcile, tickMember } from "./tick.ts";
