/**
 * What onboarding offers (spec §14.1 A1). The places match the Telegram onboarding's list
 * (`packages/services/src/onboarding.ts`), so a family starts from the same choices on either path.
 * Their names are message descriptors, shown in the app's language (build plan 3.1).
 */

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export interface ZoneChoice {
  label: MessageDescriptor;
  zone: string;
}

export interface CountryChoice {
  code: string;
  label: MessageDescriptor;
  /** The country's zones; a country with one needs no second choice. */
  zones: ZoneChoice[];
}

export const countries: CountryChoice[] = [
  { code: "TW", label: msg`Taiwan`, zones: [{ label: msg`Taiwan`, zone: "Asia/Taipei" }] },
  {
    code: "US",
    label: msg`United States`,
    zones: [
      { label: msg({ comment: "a time zone", message: "Eastern" }), zone: "America/New_York" },
      { label: msg({ comment: "a time zone", message: "Central" }), zone: "America/Chicago" },
      { label: msg({ comment: "a time zone", message: "Mountain" }), zone: "America/Denver" },
      { label: msg({ comment: "a time zone", message: "Pacific" }), zone: "America/Los_Angeles" },
      { label: msg`Alaska`, zone: "America/Anchorage" },
      { label: msg`Hawaii`, zone: "Pacific/Honolulu" },
    ],
  },
  { code: "GB", label: msg`United Kingdom`, zones: [{ label: msg`UK`, zone: "Europe/London" }] },
  {
    code: "CA",
    label: msg`Canada`,
    zones: [
      { label: msg({ comment: "a time zone", message: "Atlantic" }), zone: "America/Halifax" },
      { label: msg({ comment: "a time zone", message: "Eastern" }), zone: "America/Toronto" },
      { label: msg({ comment: "a time zone", message: "Central" }), zone: "America/Winnipeg" },
      { label: msg({ comment: "a time zone", message: "Mountain" }), zone: "America/Edmonton" },
      { label: msg({ comment: "a time zone", message: "Pacific" }), zone: "America/Vancouver" },
    ],
  },
  {
    code: "AU",
    label: msg`Australia`,
    zones: [
      { label: msg`Sydney`, zone: "Australia/Sydney" },
      { label: msg`Brisbane`, zone: "Australia/Brisbane" },
      { label: msg`Adelaide`, zone: "Australia/Adelaide" },
      { label: msg`Darwin`, zone: "Australia/Darwin" },
      { label: msg`Perth`, zone: "Australia/Perth" },
    ],
  },
  {
    code: "SG",
    label: msg`Singapore`,
    zones: [{ label: msg`Singapore`, zone: "Asia/Singapore" }],
  },
  { code: "JP", label: msg`Japan`, zones: [{ label: msg`Japan`, zone: "Asia/Tokyo" }] },
  { code: "DE", label: msg`Germany`, zones: [{ label: msg`Germany`, zone: "Europe/Berlin" }] },
  { code: "IN", label: msg`India`, zones: [{ label: msg`India`, zone: "Asia/Kolkata" }] },
];

/**
 * The languages with complete copy; she reads her mornings in one of them. Each is written in its
 * own language, the same whatever language the app is in.
 */
export const languages: { value: "en" | "zh-TW"; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
];

/** When she usually wakes; her morning comes half an hour later (flows §3.1). */
export const wakeTimes = [
  "05:30",
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
] as const;

/** The same arithmetic as the service's `addMinutesToLocalTime`: her morning follows her waking. */
export function arrivalAfter(wake: string): string {
  const [hour, minute] = wake.split(":").map(Number);
  const total = ((hour ?? 0) * 60 + (minute ?? 0) + 30) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The organiser's own zone, for their account; the country's first zone if the device has none. */
export function deviceZone(fallback: string): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : fallback;
  } catch {
    return fallback;
  }
}
