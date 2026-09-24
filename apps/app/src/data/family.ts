import type { ApiFamily, ApiMe } from "@vela/contracts";
import { dayMonth } from "./format.ts";
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

function planLine(member: ApiFamily["members"][number]): string {
  if (member.light === "waiting") return "Has not said yes yet";
  const subscription = member.subscription;
  switch (subscription?.status) {
    case "trial":
      return subscription.trial_ends_at === null
        ? "Vela Light trial"
        : `Vela Light trial · ends ${dayMonth(subscription.trial_ends_at)}`;
    case "active":
      return "Vela Light";
    case "grace":
      return "Vela Light · payment due";
    default:
      return "Free";
  }
}

function nearbyLine(nearby: NonNullable<ApiFamily["nearby"]>): string {
  if (nearby.every((contact) => contact.consent === "yes")) {
    return nearby.length === 1 ? "Said yes" : "All said yes";
  }
  return nearby
    .map((contact) =>
      contact.consent === "yes"
        ? `${contact.name} said yes`
        : contact.consent === "no"
          ? `${contact.name} said no`
          : `${contact.name} has not said yes yet`,
    )
    .join(" · ");
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
  const role = family.me.role === "organiser" ? "organiser" : "family";
  const user = me?.user;
  return {
    familyId: family.family.id,
    familyName: family.family.name,
    me: {
      memberId: family.me.member_id,
      organiser: family.me.role === "organiser",
      paused: mine?.status === "paused",
      name: user?.display_name ?? mine?.display_name ?? "You",
      line: [
        role,
        ...(user === undefined ? [] : [languageOf(user.language), placeOf(user.tz)]),
      ].join(" · "),
      lightOn: mine?.light === "on",
    },
    keptLight: keptLight.map((member) => ({
      memberId: member.member_id,
      name: member.display_name,
      light: member.light,
      paused: member.status === "paused",
      line: member.status === "paused" ? `Paused · ${planLine(member)}` : planLine(member),
      plan: planOf(member),
      ...(member.subscription?.trial_ends_at == null
        ? {}
        : { trialEnds: dayMonth(member.subscription.trial_ends_at) }),
    })),
    ...(others.length === 0
      ? {}
      : {
          others: {
            names: others.map((member) => member.display_name).join(", "),
            line: "Ask and reply · free",
          },
        }),
    ...(nearby === null
      ? {}
      : {
          nearby:
            nearby.length === 0
              ? { names: "Nobody nearby yet", line: "Someone who could look in, if it goes quiet" }
              : {
                  names: `Nearby: ${nearby.map((contact) => contact.name).join(", ")}`,
                  line: nearbyLine(nearby),
                },
        }),
  };
}

/** The example family, shown with no API or nobody signed in; it matches the prototype. */
export const youFixture: YouFamily = {
  familyId: "example",
  familyName: "The Chens",
  me: {
    memberId: "me",
    organiser: true,
    name: "Anna",
    line: "organiser · English · Taipei",
    lightOn: false,
    paused: false,
  },
  keptLight: [
    {
      memberId: "m1",
      name: "Mom",
      light: "on",
      paused: false,
      line: "Vela Light trial · ends 12 Oct",
      plan: "trial",
      trialEnds: "12 Oct",
    },
  ],
  others: { names: "Mia, Sam, Igor", line: "Ask and reply · free" },
  nearby: { names: "Nearby: Lena, Petro", line: "Lena said yes · Petro has not said yes yet" },
};
