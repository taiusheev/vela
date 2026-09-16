/**
 * `@vela/services/testing`: everything a test outside this package needs to run the services against
 * a real database without a platform — one PGlite, a clock that moves only when told, in-memory
 * queues, recording fakes for Telegram, the AI, storage, and the scheduler, and the rows a pilot
 * family starts from. It is a separate entry point so nothing in production can import it.
 */
export type {
  AcknowledgedTap,
  ClosedButtons,
  FailedSend,
  FailureOptions,
  FakeTelegram,
  SentMessage,
} from "./fake-telegram.ts";
export type {
  FakeClock,
  FakeHeartbeat,
  FakeLogger,
  FakeMediaStore,
  FakeQueue,
  FakeRandom,
  FakeScheduler,
  LogEntry,
  QueuedJob,
} from "./fakes.ts";
export {
  createHarness,
  type FakeQueues,
  HARNESS_START,
  type Harness,
  type HarnessOptions,
  type JobHandlers,
} from "./harness.ts";
export {
  type SeedExchangeOptions,
  type SeededFamily,
  type SeedFamilyOptions,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedLinkedGroup,
  seedNearbyContact,
} from "./seed.ts";
