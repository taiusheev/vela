import { describe, expect, it } from "vitest";
import { COUNTRIES, defaultCountry, flagOf, readable, toInternational } from "./phone.ts";

const country = (iso: string) => {
  const found = COUNTRIES.find((candidate) => candidate.iso === iso);
  if (found === undefined) throw new Error(iso);
  return found;
};

describe("a phone number as people write it at home", () => {
  it("starts on the phone's own country, and on Taiwan when it is not listed", () => {
    expect(defaultCountry("gb").iso).toBe("GB");
    expect(defaultCountry("ZZ").iso).toBe("TW");
    expect(defaultCountry(undefined).iso).toBe("TW");
  });

  it("drops the national 0 and adds the country code", () => {
    expect(toInternational(country("TW"), "0912 345 678")).toBe("+886912345678");
    expect(toInternational(country("TW"), "912-345-678")).toBe("+886912345678");
    expect(toInternational(country("GB"), "07700 900123")).toBe("+447700900123");
    expect(toInternational(country("US"), "(201) 555-0123")).toBe("+12015550123");
    expect(toInternational(country("RU"), "8 912 345 6789")).toBe("+79123456789");
  });

  it("takes a number already written with its country code as it is", () => {
    expect(toInternational(country("TW"), "+44 7700 900123")).toBe("+447700900123");
    expect(toInternational(country("TW"), "0044 7700 900123")).toBe("+447700900123");
  });

  it("refuses what cannot be a number", () => {
    expect(toInternational(country("TW"), "")).toBeNull();
    expect(toInternational(country("TW"), "0912")).toBeNull();
    expect(toInternational(country("TW"), "+12")).toBeNull();
  });

  it("reads the number back grouped, and draws the flag", () => {
    expect(readable("+886912345678")).toBe("+886 912 345 678");
    expect(readable("+12015550123")).toBe("+1 201 555 0123");
    expect(flagOf({ iso: "TW" })).toBe("🇹🇼");
  });
});
