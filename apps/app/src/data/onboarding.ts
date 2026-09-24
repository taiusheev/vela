/**
 * What onboarding offers (spec §14.1 A1). The places match the Telegram onboarding's list
 * (`packages/services/src/onboarding.ts`), so a family starts from the same choices on either path.
 */

export interface ZoneChoice {
  label: string;
  zone: string;
}

export interface CountryChoice {
  code: string;
  label: string;
  /** The country's zones; a country with one needs no second choice. */
  zones: ZoneChoice[];
}

export const countries: CountryChoice[] = [
  { code: "TW", label: "Taiwan", zones: [{ label: "Taiwan", zone: "Asia/Taipei" }] },
  {
    code: "US",
    label: "United States",
    zones: [
      { label: "Eastern", zone: "America/New_York" },
      { label: "Central", zone: "America/Chicago" },
      { label: "Mountain", zone: "America/Denver" },
      { label: "Pacific", zone: "America/Los_Angeles" },
      { label: "Alaska", zone: "America/Anchorage" },
      { label: "Hawaii", zone: "Pacific/Honolulu" },
    ],
  },
  { code: "GB", label: "United Kingdom", zones: [{ label: "UK", zone: "Europe/London" }] },
  {
    code: "CA",
    label: "Canada",
    zones: [
      { label: "Atlantic", zone: "America/Halifax" },
      { label: "Eastern", zone: "America/Toronto" },
      { label: "Central", zone: "America/Winnipeg" },
      { label: "Mountain", zone: "America/Edmonton" },
      { label: "Pacific", zone: "America/Vancouver" },
    ],
  },
  {
    code: "AU",
    label: "Australia",
    zones: [
      { label: "Sydney", zone: "Australia/Sydney" },
      { label: "Brisbane", zone: "Australia/Brisbane" },
      { label: "Adelaide", zone: "Australia/Adelaide" },
      { label: "Darwin", zone: "Australia/Darwin" },
      { label: "Perth", zone: "Australia/Perth" },
    ],
  },
  { code: "SG", label: "Singapore", zones: [{ label: "Singapore", zone: "Asia/Singapore" }] },
  { code: "JP", label: "Japan", zones: [{ label: "Japan", zone: "Asia/Tokyo" }] },
  { code: "DE", label: "Germany", zones: [{ label: "Germany", zone: "Europe/Berlin" }] },
  { code: "IN", label: "India", zones: [{ label: "India", zone: "Asia/Kolkata" }] },
];

/** The languages with complete copy; she reads her mornings in one of them. */
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
