import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import type { ApiFamily, ApiMe, NearbyConsent } from "@vela/contracts";
import { dayMonth, listOf } from "./format.ts";
import { languages } from "./onboarding.ts";

/** One kept-light member on You: her light and where her Vela Light stands (spec A12). */
export interface KeptLightRow {
  memberId: string;
  name: string;
  light: "on" | "waiting";
  paused: boolean;
  /** "Vela Light trial · ends 12 Oct", "Vela Light", "Free", "Has not said yes yet". */
  line: string;
  /** Where her Vela Light stands: never started, in its trial, paid for, or ended. */
  plan: "none" | "trial" | "active" | "ended";
  /** When the trial ends, as a day and month, while it runs. */
  trialEnds?: string;
}

/** The family as You shows it: whose light is kept, who else asks and replies, who is nearby. */
export interface YouFamily {
  familyId: string;
  familyName: string;
  me: {
    memberId: string;
    name: string;
    line: string;
    organiser: boolean;
    lightOn: boolean;
    paused: boolean;
  };
  keptLight: KeptLightRow[];
  /** Everyone else, who asks and replies; undefined when there is nobody but the reader. */
  others?: { names: string; line: string };
  /** The people nearby, for organisers only; undefined for anyone else. */
  nearby?: { names: string; line: string };
}

/** The city a time zone is named for, as the prototype shows it: "Asia/Taipei" is Taipei. */
function placeOf(tz: string): string {
  return (tz.split("/").pop() ?? tz).replaceAll("_", " ");
}

function languageOf(code: string): string {
  return languages.find((language) => language.value === code)?.label ?? code;
}

function roleOf(organiser: boolean): string {
  return organiser
    ? t({ context: "role", message: "organiser" })
    : t({ context: "role", message: "family" });
}

function planOf(member: ApiFamily["members"][number]): KeptLightRow["plan"] {
  switch (member.subscription?.status) {
    case undefined:
      return "none";
    case "trial":
      return "trial";
    case "active":
    case "grace":
      return "active";
    default:
      return "ended";
  }
}

function trialLine(endsAt: string | null): string {
  if (endsAt === null) return t`Vela Light trial`;
  const date = dayMonth(endsAt);
  return t`Vela Light trial · ends ${date}`;
}

function planLine(member: ApiFamily["members"][number]): string {
  if (member.light === "waiting") return t`Has not said yes yet`;
  const subscription = member.subscription;
  switch (subscription?.status) {
    case "trial":
      return trialLine(subscription.trial_ends_at);
    case "active":
      return "Vela Light";
    case "grace":
      return t`Vela Light · payment due`;
    default:
      return t`Free`;
  }
}

function nearbyNames(contacts: readonly string[]): string {
  const names = listOf(contacts);
  return t`Nearby: ${names}`;
}

function consentLine(name: string, consent: NearbyConsent): string {
  switch (consent) {
    case "yes":
      return t`${name} said yes`;
    case "no":
      return t`${name} said no`;
    default:
      return t`${name} has not said yes yet`;
  }
}

function nearbyLine(nearby: NonNullable<ApiFamily["nearby"]>): string {
  if (nearby.every((contact) => contact.consent === "yes")) {
    return nearby.length === 1 ? t`Said yes` : t`All said yes`;
  }
  return nearby.map((contact) => consentLine(contact.name, contact.consent)).join(" · ");
}

export function toYouFamily(family: ApiFamily, me: ApiMe | undefined): YouFamily {
  const mine = family.members.find((member) => member.member_id === family.me.member_id);
  const keptLight = family.members.filter(
    (member): member is typeof member & { light: "on" | "waiting" } =>
      member.member_id !== family.me.member_id && member.light !== "off",
  );
  const others = family.members.filter(
    (member) => member.member_id !== family.me.member_id && member.light === "off",
  );
  const nearby = family.nearby;
  const user = me?.user;
  return {
    familyId: family.family.id,
    familyName: family.family.name,
    me: {
      memberId: family.me.member_id,
      organiser: family.me.role === "organiser",
      paused: mine?.status === "paused",
      name: user?.display_name ?? mine?.display_name ?? t`You`,
      line: [
        roleOf(family.me.role === "organiser"),
        ...(user === undefined ? [] : [languageOf(user.language), placeOf(user.tz)]),
      ].join(" · "),
      lightOn: mine?.light === "on",
    },
    keptLight: keptLight.map((member) => {
      const plan = planLine(member);
      return {
        memberId: member.member_id,
        name: member.display_name,
        light: member.light,
        paused: member.status === "paused",
        line: member.status === "paused" ? t`Paused · ${plan}` : plan,
        plan: planOf(member),
        ...(member.subscription?.trial_ends_at == null
          ? {}
          : { trialEnds: dayMonth(member.subscription.trial_ends_at) }),
      };
    }),
    ...(others.length === 0
      ? {}
      : {
          others: {
            names: listOf(others.map((member) => member.display_name)),
            line: t`Ask and reply · free`,
          },
        }),
    ...(nearby === null
      ? {}
      : {
          nearby:
            nearby.length === 0
              ? {
                  names: t`Nobody nearby yet`,
                  line: t`Someone who could look in, if it goes quiet`,
                }
              : {
                  names: nearbyNames(nearby.map((contact) => contact.name)),
                  line: nearbyLine(nearby),
                },
        }),
  };
}

/**
 * The example family, shown with no API or nobody signed in; it matches the prototype. It is built
 * each time it is read, from the same lines as a real family, so its words are in the app's
 * language, which is its organiser's too.
 */
export function youFixture(): YouFamily {
  // 12 Oct at noon on the reader's own clock, so the day shown is the 12th in every time zone.
  const trialEndsAt = new Date(2026, 9, 12, 12).toISOString();
  return {
    familyId: "example",
    familyName: t`The Chens`,
    me: {
      memberId: "me",
      organiser: true,
      name: "Anna",
      line: [roleOf(true), languageOf(i18n.locale), "Taipei"].join(" · "),
      lightOn: false,
      paused: false,
    },
    keptLight: [
      {
        memberId: "m1",
        name: t`Mom`,
        light: "on",
        paused: false,
        line: trialLine(trialEndsAt),
        plan: "trial",
        trialEnds: dayMonth(trialEndsAt),
      },
    ],
    others: { names: listOf(["Mia", "Sam", "Igor"]), line: t`Ask and reply · free` },
    nearby: {
      names: nearbyNames(["Lena", "Petro"]),
      line: [consentLine("Lena", "yes"), consentLine("Petro", "waiting")].join(" · "),
    },
  };
}
