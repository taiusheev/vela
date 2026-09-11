// Time helpers. Everything family-facing is computed in the family member's own IANA zone.

export interface LocalNow {
  day: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
}

export function localNow(tz: string, at: Date = new Date()): LocalNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = Number(get("hour")) % 24; // en-CA can yield "24" at midnight
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
  };
}

export function parseHHMM(s: string): number | null {
  const m = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

export function fmtTimeIn(tz: string, iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function yesterday(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Zones offered as buttons during onboarding. Label -> IANA.
export const TZ_CHOICES: [string, string][] = [
  ["Москва / Moscow", "Europe/Moscow"],
  ["Калининград", "Europe/Kaliningrad"],
  ["Самара", "Europe/Samara"],
  ["Екатеринбург", "Asia/Yekaterinburg"],
  ["Омск", "Asia/Omsk"],
  ["Новосибирск", "Asia/Novosibirsk"],
  ["Красноярск", "Asia/Krasnoyarsk"],
  ["Иркутск / Улан-Удэ", "Asia/Irkutsk"],
  ["Якутск", "Asia/Yakutsk"],
  ["Владивосток", "Asia/Vladivostok"],
  ["Алматы", "Asia/Almaty"],
  ["Ташкент", "Asia/Tashkent"],
  ["Бишкек", "Asia/Bishkek"],
  ["Тбилиси", "Asia/Tbilisi"],
  ["Ереван", "Asia/Yerevan"],
  ["Баку", "Asia/Baku"],
  ["Минск", "Europe/Minsk"],
  ["Киев / Kyiv", "Europe/Kyiv"],
  ["Кишинёв", "Europe/Chisinau"],
  ["Taipei", "Asia/Taipei"],
  ["Belgrade", "Europe/Belgrade"],
  ["Istanbul", "Europe/Istanbul"],
  ["Berlin", "Europe/Berlin"],
  ["Limassol", "Asia/Nicosia"],
  ["Bangkok", "Asia/Bangkok"],
  ["Bali", "Asia/Makassar"],
  ["Tel Aviv", "Asia/Jerusalem"],
  ["London", "Europe/London"],
  ["New York", "America/New_York"],
  ["Los Angeles", "America/Los_Angeles"],
];
