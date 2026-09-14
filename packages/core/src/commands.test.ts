import { catalogs } from "@vela/copy";
import { describe, expect, it } from "vitest";
import { PARENT_COMMAND_KEYWORDS, type ParentCommand, parseParentCommand } from "./commands.ts";

describe("parseParentCommand", () => {
  it.each<[string, ParentCommand]>([
    // en
    ["stop", "stop"],
    ["pause", "stop"],
    ["start", "start"],
    ["resume", "start"],
    ["what does the family see", "what_family_sees"],
    // zh-TW
    ["停", "stop"],
    ["停止", "stop"],
    ["暫停", "stop"],
    ["不要了", "stop"],
    ["開始", "start"],
    ["繼續", "start"],
    ["家人看到什麼", "what_family_sees"],
    ["家人看得到什麼", "what_family_sees"],
    ["家人看得到什么", "what_family_sees"],
    // ja
    ["やめて", "stop"],
    ["再開", "start"],
    ["家族には何が見える", "what_family_sees"],
    // de
    ["Stopp", "stop"],
    ["Weiter", "start"],
    ["Was sieht die Familie", "what_family_sees"],
    // hi
    ["रुको", "stop"],
    ["शुरू करो", "start"],
    ["परिवार क्या देखता है", "what_family_sees"],
    // ru
    ["Не надо", "stop"],
    ["Старт", "start"],
    ["Что видит семья", "what_family_sees"],
  ])("reads %s as %s", (text, command) => {
    expect(parseParentCommand(text)).toBe(command);
  });

  it("ignores case, surrounding whitespace, and surrounding punctuation", () => {
    expect(parseParentCommand("  STOP!  ")).toBe("stop");
    expect(parseParentCommand("Stop.")).toBe("stop");
    expect(parseParentCommand("\n\tstart\n")).toBe("start");
    expect(parseParentCommand("What does the family see?")).toBe("what_family_sees");
    expect(parseParentCommand("「停」")).toBe("stop");
    expect(parseParentCommand("停！")).toBe("stop");
    expect(parseParentCommand("開始。")).toBe("start");
    expect(parseParentCommand("家人看到什麼？")).toBe("what_family_sees");
    expect(parseParentCommand("「家人看得到什麼？」")).toBe("what_family_sees");
    expect(parseParentCommand("　家人看得到什麼 ?\n")).toBe("what_family_sees");
    expect(parseParentCommand("रुको।")).toBe("stop");
    expect(parseParentCommand("«Стоп»")).toBe("stop");
    expect(parseParentCommand("/stop")).toBe("stop");
    expect(parseParentCommand("​stop​")).toBe("stop");
  });

  it("folds full-width and half-width forms", () => {
    expect(parseParentCommand("ＳＴＯＰ")).toBe("stop");
    expect(parseParentCommand("ｽﾄｯﾌﾟ")).toBe("stop");
    expect(parseParentCommand("　停　")).toBe("stop");
  });

  it("tolerates extra spaces between the words of a phrase", () => {
    expect(parseParentCommand("what  does the\nfamily   see")).toBe("what_family_sees");
  });

  it.each([
    "I had to stop at the market",
    "don't stop",
    "stop it now",
    "please start",
    "我停了一下",
    "停一下再說",
    "今天開始下雨了",
    "家人看得到什麼照片",
    "家人看得到",
    "what does the family see about me today",
    "Не надо было",
    "stopp bitte nicht",
    "",
    "   ",
    "!!!",
    "s t o p",
    "stops",
  ])("does not treat %j as a command", (text) => {
    expect(parseParentCommand(text)).toBeNull();
  });

  it("reads every listed keyword as its own command, so no keyword means two commands", () => {
    for (const [command, keywords] of Object.entries(PARENT_COMMAND_KEYWORDS)) {
      for (const keyword of keywords) {
        expect(parseParentCommand(keyword)).toBe(command);
      }
    }
  });

  it("recognises the words the copy tells her to say", () => {
    const zh = catalogs["zh-TW"];
    const quoted = (text: string): string[] =>
      [...text.matchAll(/「([^」]+)」/g)].map((match) => match[1] ?? "");
    expect(quoted(zh["consent.request"]).map(parseParentCommand)).toEqual(["stop"]);
    expect(quoted(zh["parent.stopped"]).map(parseParentCommand)).toEqual(["start"]);
    expect(catalogs.en["consent.request"]).toContain("say stop");
    expect(parseParentCommand("stop")).toBe("stop");
    expect(catalogs.en["parent.stopped"]).toContain("Say start");
    expect(parseParentCommand("start")).toBe("start");
  });
});
