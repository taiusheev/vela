/**
 * ADR-62 end to end: a closed-test family made in the app is approved as it is made, so the app
 * opens instead of "Your family is set up", and her yes starts her light with no founder alert.
 * Each step reads admission the way the Worker does per request (`admissionWithRoster`), from the
 * base the Worker's config gives (`PILOT_FAMILY_APPROVAL=auto` or `on`).
 */
import { ApiCreatedFamily, type InboundEvent } from "@vela/contracts";
import { encodeButton } from "@vela/core";
import { members, outbound, pilotFamilies, pushDevices, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { createApiFamily } from "./api-families.ts";
import { handleConsentButton, handleInviteStart } from "./consent.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import {
  type PilotAdmission,
  pilotAccountAwaitsFamily,
  pilotApiAccountAllowed,
  pilotCanActivate,
} from "./pilot-admission.ts";
import { admissionWithRoster, unapproveFamily } from "./pilot-roster.ts";
import { createHarness, type Harness } from "./testing/harness.ts";

const AUTO: PilotAdmission = {
  telegramUserIds: [],
  familyIds: [],
  languages: ["en", "zh-TW"],
  autoApprove: true,
};
const BY_HAND: PilotAdmission = { telegramUserIds: [], familyIds: [], languages: ["en", "zh-TW"] };
const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const HER_TELEGRAM = "2001";

const REQUEST = {
  country: "TW",
  kept_light_member: {
    display_name: "Mom",
    address_form: "Mrs Chen",
    language: "zh-TW",
    tz: "Asia/Taipei",
    wake_time: "07:30",
  },
};

let h: Harness;
let accountId: string;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  const [account] = await h.db
    .insert(users)
    .values({
      authSubject: identity.authSubject,
      displayName: "Mia",
      language: "zh-TW",
      tz: "Asia/Taipei",
    })
    .returning();
  if (account === undefined) throw new Error("Missing account");
  accountId = account.id;
});
afterAll(async () => {
  await h.close();
});

/** The organiser sets the family up in the app, as `POST /v1/families` does in production. */
async function setUpInApp(base: PilotAdmission) {
  const result = await createApiFamily(
    { ...h.deps, config: { ...h.config, pilotAdmission: base } },
    identity,
    "key-setup",
    REQUEST,
  );
  return ApiCreatedFamily.parse(result.response.body);
}

/** What the app's next request sees: the Worker reads the approved families per request. */
async function appOpens(base: PilotAdmission): Promise<"opens" | "waiting screen"> {
  const admission = (await admissionWithRoster(h.db, base)) ?? base;
  if (await pilotApiAccountAllowed(h.db, identity, admission)) return "opens";
  expect(await pilotAccountAwaitsFamily(h.db, identity, admission)).toBe(true);
  return "waiting screen";
}

/** The organiser's phone allows Vela's notifications (onboarding asks), so they can be reached. */
async function phoneAllowsNotifications(): Promise<void> {
  await h.db.insert(pushDevices).values({
    userId: accountId,
    installationId: "019a0000-0000-7000-8000-00000000b001",
    token: "ExponentPushToken[auto-approve-organiser]",
    platform: "ios",
    permission: "granted",
  });
}

let sequence = 0;
function fromHer(extra: Partial<InboundEvent> & Pick<InboundEvent, "kind">): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `auto:${sequence}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: HER_TELEGRAM, displayName: "Mom", languageCode: "zh-TW" },
    conversation: { externalId: HER_TELEGRAM, kind: "private" },
    messageId: String(sequence),
    ...extra,
  };
}

/** Mom opens the invite link and taps yes, with admission as the pilot Worker reads it. */
async function momSaysYes(base: PilotAdmission, token: string, herId: string): Promise<void> {
  const admission = (await admissionWithRoster(h.db, base)) ?? base;
  const deps = { ...h.deps, config: { ...h.config, pilotAdmission: admission } };
  await handleInviteStart(deps, fromHer({ kind: "start", startParam: token }));
  await h.run({ outbound: (job: OutboundJob) => deliverOutbound(deps, job.outboundId) });
  const action = { type: "consent" as const, memberId: herId, accept: true };
  await handleConsentButton(
    deps,
    fromHer({ kind: "button", buttonData: encodeButton(action), callbackId: `cb${sequence}` }),
    action,
  );
  await h.run({ outbound: (job: OutboundJob) => deliverOutbound(deps, job.outboundId) });
}

async function founderAlerts(): Promise<number> {
  const rows = await h.db
    .select({ key: outbound.idempotencyKey })
    .from(outbound)
    .where(eq(outbound.conversationId, h.config.adminConversationId ?? ""));
  return rows.filter((row) => row.key.includes("family_waiting")).length;
}

describe("ADR-62: a family set up in the app with approval automatic", () => {
  it("opens the app at once instead of the waiting screen", async () => {
    const family = await setUpInApp(AUTO);
    expect((await h.db.select().from(pilotFamilies)).map((row) => row.familyId)).toEqual([
      family.family.id,
    ]);
    expect(await appOpens(AUTO)).toBe("opens");
  });

  it("starts her light on her yes, with no alert to the founder", async () => {
    const family = await setUpInApp(AUTO);
    await phoneAllowsNotifications();
    const herId = family.kept_light_member.id;
    const token = new URL(family.invite.url).searchParams.get("start") ?? "";
    await momSaysYes(AUTO, token, herId);

    const [her] = await h.db.select().from(members).where(eq(members.id, herId));
    expect(her).toMatchObject({ status: "active", lightOn: true });
    expect(await founderAlerts()).toBe(0);
  });

  it("still stops a family the founder removes, and keeps it removed", async () => {
    const family = await setUpInApp(AUTO);
    await phoneAllowsNotifications();
    expect(
      await unapproveFamily(h.deps, { admin: "founder@example.com" }, family.family.id),
    ).toBe("unapproved");
    expect(await appOpens(AUTO)).toBe("waiting screen");
    const admission = (await admissionWithRoster(h.db, AUTO)) ?? AUTO;
    expect(
      await pilotCanActivate(
        h.db,
        admission,
        family.family.id,
        family.kept_light_member.id,
      ),
    ).toBe(false);
  });
});

describe("before ADR-62: approval by hand", () => {
  it("shows the waiting screen, and her yes alerts the founder instead of starting the light", async () => {
    const family = await setUpInApp(BY_HAND);
    await phoneAllowsNotifications();
    expect(await h.db.select().from(pilotFamilies)).toEqual([]);
    expect(await appOpens(BY_HAND)).toBe("waiting screen");

    const herId = family.kept_light_member.id;
    const token = new URL(family.invite.url).searchParams.get("start") ?? "";
    await momSaysYes(BY_HAND, token, herId);
    const [her] = await h.db.select().from(members).where(eq(members.id, herId));
    expect(her?.lightOn).toBe(false);
    expect(await founderAlerts()).toBe(1);
  });
});
