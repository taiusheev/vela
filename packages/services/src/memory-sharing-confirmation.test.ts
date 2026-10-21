import {
  MEMORY_KEEP_VERSION,
  MEMORY_SHARE_EXPLANATION_EN,
  MEMORY_SHARE_VERSION,
  MemoryShareChoice,
  MemorySharePreview,
} from "@vela/contracts";
import { describe, expect, it } from "vitest";
import {
  buildMemorySharingConfirmation,
  MEMORY_SHARE_PRESENTATION_MS,
  type MemorySharingSnapshot,
  matchesMemorySharingConfirmation,
} from "./memory-sharing-confirmation.ts";
import { RICH_MEMORY_CONSENT_VERSION } from "./rich-memories.ts";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const now = Date.parse("2026-10-22T00:00:00Z");
function recipient(snapshot: MemorySharingSnapshot, index = 0) {
  const value = snapshot.recipients[index];
  if (!value) throw new Error("Missing synthetic recipient");
  return value;
}
function fixture(): MemorySharingSnapshot {
  return {
    owner: { familyId: id(1), memberId: id(2), userId: id(3), membershipRevision: id(4) },
    memoryId: id(5),
    quote: "I still laugh about the picnic with the dancing umbrella.",
    lang: "en",
    sharingRevision: id(6),
    sourceDigest: "a".repeat(64),
    purposeConsentId: id(7),
    purposeVersion: RICH_MEMORY_CONSENT_VERSION,
    keepConsentId: id(8),
    keepVersion: MEMORY_KEEP_VERSION,
    eligible: true,
    recipients: [
      {
        familyId: id(1),
        memberId: id(12),
        userId: id(13),
        membershipRevision: id(14),
        displayName: "Mira",
        eligible: true,
      },
      {
        familyId: id(1),
        memberId: id(9),
        userId: id(10),
        membershipRevision: id(11),
        displayName: "Alex",
        eligible: true,
      },
    ],
  };
}
async function presented() {
  const snapshot = fixture();
  const result = await buildMemorySharingConfirmation(snapshot.owner, snapshot, id(20), now);
  if (!result) throw new Error("Synthetic presentation should be available");
  const choice = {
    presentation_id: result.preview.presentation_id,
    presentation_sha256: result.preview.presentation_sha256,
    confirmation_version: MEMORY_SHARE_VERSION,
  };
  return { snapshot, ...result, choice };
}

describe("read-only named memory sharing confirmations", () => {
  it("shows only exact words and explicitly named recipients, with a copying caveat", async () => {
    const { snapshot, preview, record, choice } = await presented();
    expect(MemorySharePreview.safeParse(preview).success).toBe(true);
    expect(preview.quote).toBe(snapshot.quote);
    expect(preview.recipients.map((r) => r.display_name)).toEqual(["Alex", "Mira"]);
    expect(preview.explanation).toBe(MEMORY_SHARE_EXPLANATION_EN);
    expect(preview.expires_at).toBe(new Date(now + MEMORY_SHARE_PRESENTATION_MS).toISOString());
    expect(
      await matchesMemorySharingConfirmation(snapshot.owner, snapshot, record, choice, now),
    ).toBe(true);
    const evidence = JSON.stringify(record);
    expect(evidence).not.toContain(snapshot.quote);
    expect(evidence).not.toContain("Mira");
    expect(evidence).not.toContain("Alex");
  });

  it("canonicalizes recipient order without changing or extending the audience", async () => {
    const { snapshot, preview } = await presented();
    snapshot.recipients.reverse();
    const reordered = await buildMemorySharingConfirmation(snapshot.owner, snapshot, id(20), now);
    expect(reordered?.preview).toEqual(preview);
  });

  const changes: [string, (snapshot: MemorySharingSnapshot) => void][] = [
    [
      "edited quote",
      (s) => {
        s.quote += " Again!";
      },
    ],
    [
      "different memory",
      (s) => {
        s.memoryId = id(99);
      },
    ],
    [
      "changed source",
      (s) => {
        s.sourceDigest = "b".repeat(64);
      },
    ],
    [
      "new purpose consent",
      (s) => {
        s.purposeConsentId = id(99);
      },
    ],
    [
      "new keep consent",
      (s) => {
        s.keepConsentId = id(99);
      },
    ],
    [
      "changed language",
      (s) => {
        s.lang = "zh-TW";
      },
    ],
    [
      "revoked then recreated sharing",
      (s) => {
        s.sharingRevision = id(99);
      },
    ],
    [
      "recipient renamed",
      (s) => {
        recipient(s).displayName = "Different person";
      },
    ],
    [
      "recipient account rebound",
      (s) => {
        recipient(s).userId = id(99);
      },
    ],
    [
      "recipient left and rejoined",
      (s) => {
        recipient(s).membershipRevision = id(99);
      },
    ],
    [
      "recipient removed",
      (s) => {
        s.recipients.pop();
      },
    ],
    [
      "new family member added",
      (s) => {
        s.recipients.push({
          ...recipient(s),
          memberId: id(97),
          userId: id(98),
          displayName: "Sam",
        });
      },
    ],
    [
      "owner account rebound",
      (s) => {
        s.owner.userId = id(99);
      },
    ],
    [
      "owner left and rejoined",
      (s) => {
        s.owner.membershipRevision = id(99);
      },
    ],
  ];
  it.each(changes)("rejects the old confirmation after %s", async (_label, change) => {
    const { snapshot, record, choice } = await presented();
    const originalActor = { ...snapshot.owner };
    change(snapshot);
    expect(
      await matchesMemorySharingConfirmation(originalActor, snapshot, record, choice, now),
    ).toBe(false);
  });

  it.each(["eligible", "purposeVersion", "keepVersion"])(
    "fails closed for invalid %s",
    async (field) => {
      const { snapshot, record, choice } = await presented();
      const changed = { ...snapshot, [field]: field === "eligible" ? false : "old@1" };
      expect(await buildMemorySharingConfirmation(snapshot.owner, changed, id(20), now)).toBeNull();
      expect(
        await matchesMemorySharingConfirmation(snapshot.owner, changed, record, choice, now),
      ).toBe(false);
    },
  );

  it("does not let an organiser or another family member confirm the author's words", async () => {
    const { snapshot, record, choice } = await presented();
    const other = { ...snapshot.owner, memberId: id(9), userId: id(10) };
    expect(await buildMemorySharingConfirmation(other, snapshot, id(20), now)).toBeNull();
    expect(await matchesMemorySharingConfirmation(other, snapshot, record, choice, now)).toBe(
      false,
    );
  });

  it.each([
    "family",
    "self",
    "same user",
    "duplicate member",
    "duplicate user",
    "ambiguous names",
    "inactive",
  ])("rejects %s recipients", async (reason) => {
    const s = fixture();
    const first = recipient(s);
    const second = recipient(s, 1);
    if (reason === "family") first.familyId = id(99);
    if (reason === "self") first.memberId = s.owner.memberId;
    if (reason === "same user") first.userId = s.owner.userId;
    if (reason === "duplicate member") first.memberId = second.memberId;
    if (reason === "duplicate user") first.userId = second.userId;
    if (reason === "ambiguous names") first.displayName = "  ＡＬＥＸ  ";
    const input =
      reason === "inactive" ? { ...s, recipients: [{ ...first, eligible: false }, second] } : s;
    expect(await buildMemorySharingConfirmation(s.owner, input, id(20), now)).toBeNull();
  });

  it("bounds the selected audience and never supports family-wide or empty sharing", async () => {
    const s = fixture();
    expect(
      await buildMemorySharingConfirmation(s.owner, { ...s, recipients: [] }, id(20), now),
    ).toBeNull();
    const many = Array.from({ length: 51 }, (_, n) => ({
      ...recipient(s),
      memberId: id(n + 100),
      userId: id(n + 200),
      displayName: `Person ${n}`,
    }));
    expect(
      await buildMemorySharingConfirmation(s.owner, { ...s, recipients: many }, id(20), now),
    ).toBeNull();
    expect(
      MemoryShareChoice.safeParse({ ...(await presented()).choice, share_with_family: true })
        .success,
    ).toBe(false);
  });

  it("rejects expiry at the boundary, future issuance, invalid clocks and reused records", async () => {
    const { snapshot, record, choice } = await presented();
    const check = (r: unknown, time: number) =>
      matchesMemorySharingConfirmation(snapshot.owner, snapshot, r, choice, time);
    expect(await check(record, record.expiresAt - 1)).toBe(true);
    expect(await check(record, record.expiresAt)).toBe(false);
    expect(await check(record, now - 1)).toBe(false);
    expect(await check(record, Number.NaN)).toBe(false);
    expect(await check({ ...record, expiresAt: record.expiresAt + 1 }, now)).toBe(false);
    expect(await check({ ...record, consumedAt: now }, now)).toBe(false);
    expect(
      await buildMemorySharingConfirmation(
        snapshot.owner,
        snapshot,
        id(20),
        Number.POSITIVE_INFINITY,
      ),
    ).toBeNull();
  });

  it("rejects forged fields, unknown fields and old versions without echoing words", async () => {
    const { snapshot, record, choice } = await presented();
    for (const changed of [
      { ...choice, presentation_id: id(99) },
      { ...choice, presentation_sha256: "f".repeat(64) },
      { ...choice, confirmation_version: "memory.share@0" },
      { ...choice, recipient_ids: [id(99)] },
      null,
    ]) {
      expect(
        await matchesMemorySharingConfirmation(snapshot.owner, snapshot, record, changed, now),
      ).toBe(false);
    }
    expect(
      await matchesMemorySharingConfirmation(
        snapshot.owner,
        snapshot,
        { ...record, memoryId: id(99) },
        choice,
        now,
      ),
    ).toBe(false);
    expect(
      await matchesMemorySharingConfirmation(
        snapshot.owner,
        snapshot,
        { ...record, owner: { ...record.owner, userId: id(99) } },
        choice,
        now,
      ),
    ).toBe(false);
  });

  it("does not mutate server snapshots or consume records in this read-only layer", async () => {
    const { snapshot, record, choice } = await presented();
    const before = JSON.stringify({ snapshot, record });
    await matchesMemorySharingConfirmation(snapshot.owner, snapshot, record, choice, now);
    expect(JSON.stringify({ snapshot, record })).toBe(before);
  });
});
