import { t } from "@lingui/core/macro";

/**
 * A phone number as people write it at home, turned into the international form Clerk sends codes
 * to: the country is chosen from a list that starts on the phone's own region, the number is typed
 * the local way, and the national 0 (0912 in Taipei, 07700 in London) is dropped for them.
 */

export interface Country {
  /** ISO 3166-1 alpha-2, which also draws the flag. */
  iso: string;
  /** The country calling code, without the plus. */
  dial: string;
  /** How a local number is usually written there, as a hint in the field. */
  example: string;
}

/** Taiwan first (the pilot), then the places the families are most likely to live. */
export const COUNTRIES: readonly Country[] = [
  { iso: "TW", dial: "886", example: "0912 345 678" },
  { iso: "US", dial: "1", example: "201 555 0123" },
  { iso: "CA", dial: "1", example: "416 555 0123" },
  { iso: "GB", dial: "44", example: "07700 900123" },
  { iso: "AU", dial: "61", example: "0412 345 678" },
  { iso: "NZ", dial: "64", example: "021 123 4567" },
  { iso: "SG", dial: "65", example: "8123 4567" },
  { iso: "HK", dial: "852", example: "5123 4567" },
  { iso: "JP", dial: "81", example: "090 1234 5678" },
  { iso: "KR", dial: "82", example: "010 1234 5678" },
  { iso: "MY", dial: "60", example: "012 345 6789" },
  { iso: "TH", dial: "66", example: "081 234 5678" },
  { iso: "VN", dial: "84", example: "091 234 5678" },
  { iso: "PH", dial: "63", example: "0917 123 4567" },
  { iso: "IN", dial: "91", example: "098765 43210" },
  { iso: "DE", dial: "49", example: "01512 3456789" },
  { iso: "FR", dial: "33", example: "06 12 34 56 78" },
  { iso: "NL", dial: "31", example: "06 12345678" },
  { iso: "ES", dial: "34", example: "612 34 56 78" },
  { iso: "RU", dial: "7", example: "8 912 345 6789" },
  { iso: "KZ", dial: "7", example: "8 701 234 5678" },
  { iso: "UA", dial: "380", example: "050 123 4567" },
];

/** The country the list starts on: the phone's own region when Vela knows it, else Taiwan. */
export function defaultCountry(regionCode: string | null | undefined): Country {
  const region = regionCode?.toUpperCase();
  return COUNTRIES.find((country) => country.iso === region) ?? (COUNTRIES[0] as Country);
}

/** The flag of a country, drawn by the phone from its two letters. */
export function flagOf(country: Pick<Country, "iso">): string {
  return [...country.iso.toUpperCase()]
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join("");
}

/** A country's name in the app's language, read as the screen draws. */
export function countryName(country: Pick<Country, "iso">): string {
  switch (country.iso) {
    case "TW":
      return t`Taiwan`;
    case "US":
      return t`United States`;
    case "CA":
      return t`Canada`;
    case "GB":
      return t`United Kingdom`;
    case "AU":
      return t`Australia`;
    case "NZ":
      return t`New Zealand`;
    case "SG":
      return t`Singapore`;
    case "HK":
      return t`Hong Kong`;
    case "JP":
      return t`Japan`;
    case "KR":
      return t`South Korea`;
    case "MY":
      return t`Malaysia`;
    case "TH":
      return t`Thailand`;
    case "VN":
      return t`Vietnam`;
    case "PH":
      return t`Philippines`;
    case "IN":
      return t`India`;
    case "DE":
      return t`Germany`;
    case "FR":
      return t`France`;
    case "NL":
      return t`Netherlands`;
    case "ES":
      return t`Spain`;
    case "RU":
      return t`Russia`;
    case "KZ":
      return t`Kazakhstan`;
    case "UA":
      return t`Ukraine`;
    default:
      return country.iso;
  }
}

/** Russia and Kazakhstan write the national prefix as 8, not 0. */
const TRUNK = new Map<string, RegExp>([["7", /^8/]]);

/**
 * The number in international form (+886912345678), or null when it cannot be one. Whatever she
 * typed around the digits is hers, not the number's; a leading national 0 (or Russia's 8) is
 * dropped; a number already written with its + and country code is taken as it is, whatever
 * country is chosen.
 */
export function toInternational(country: Country, typed: string): string | null {
  const trimmed = typed.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (trimmed.startsWith("00") && digits.length > 10) {
    return `+${digits.slice(2)}`;
  }
  const local = digits.replace(TRUNK.get(country.dial) ?? /^0/, "");
  const full = `${country.dial}${local}`;
  return local.length >= 6 && full.length <= 15 ? `+${full}` : null;
}

/** The international number grouped for reading back: +886 912 345 678. */
export function readable(international: string): string {
  const country = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((candidate) => international.startsWith(`+${candidate.dial}`));
  if (country === undefined) return international;
  // Threes from the left, the last group of up to four: 912 345 678, 201 555 0123.
  let rest = international.slice(country.dial.length + 1);
  const groups: string[] = [];
  while (rest.length > 4) {
    groups.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  groups.push(rest);
  return `+${country.dial} ${groups.join(" ")}`;
}
