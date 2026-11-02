import type { ApiMoment } from "@vela/contracts";
import { describe, expect, it, vi } from "vitest";
import { exchangesFixture } from "./exchanges.ts";
import {
  byMonth,
  demoMemories,
  filterCounts,
  fromApiMoment,
  fromApiStories,
  hasMoreWords,
  memoriesOf,
  narrowMemories,
  saysEnough,
} from "./memories.ts";

// The macros compile away when the app is bundled; here `t` reads the English as written.
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (line, part, index) => `${line}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

function moment(id: string, fields: Partial<ApiMoment> = {}): ApiMoment {
  return {
    exchange_id: id,
    member_id: "m1",
    member_name: "Mom",
    asked_by: "Mia",
    question: "What did you do today?",
    words: "We walked along the river after lunch and counted the boats until tea.",
    quote: null,
    kind: null,
    at: "2026-10-20T08:00:00Z",
    photo_id: null,
    voice: null,
    kept: false,
    kept_by: null,
    story_id: null,
    fades_at: "2026-11-19T08:00:00Z",
    ...fields,
  };
}

describe("her memories", () => {
  it("are more than a greeting, in English and in Chinese", () => {
    expect(saysEnough("Fine, thanks, all well here.")).toBe(false);
    expect(
      saysEnough("We walked along the river after lunch and counted the boats until tea."),
    ).toBe(true);
    expect(saysEnough("今天很好")).toBe(false);
    expect(saysEnough("早上去市場買了很大的魚，回家煮了湯，鄰居也來一起吃。")).toBe(true);
  });

  it("come from the server where it sends them, opening in the chat only where it can", () => {
    const exchanges = exchangesFixture();
    const { memories } = memoriesOf(
      { moments: [moment("x1"), moment("elsewhere")], stories: [], keptIds: new Set() },
      exchanges,
    );
    expect(memories.map((memory) => [memory.id, memory.opens])).toEqual([
      ["x1", true],
      ["elsewhere", false],
    ]);
  });

  it("are her longer answers from an older server, which sends none", () => {
    const { memories, stories } = memoriesOf(
      { moments: undefined, stories: [], keptIds: new Set(["x2"]) },
      exchangesFixture(),
    );
    // The garden answer is long enough, the kept one is shown however short, and no story is told.
    expect(memories.map((memory) => [memory.id, memory.kept])).toEqual([
      ["x1", false],
      ["x2", true],
      ["x3", false],
    ]);
    expect(stories).toEqual([]);
  });

  it("say when there is more of her answer than the phrase shown", () => {
    expect(hasMoreWords({ quote: "We walked.", words: "We walked. Then tea." })).toBe(true);
    expect(hasMoreWords({ quote: "We walked.", words: "We walked." })).toBe(false);
    expect(hasMoreWords({ quote: null, words: "We walked." })).toBe(false);
  });

  it("narrow by what is kept, a photo, her voice, a parent and a word", () => {
    const memories = [
      fromApiMoment(moment("a", { kept: true }), new Set()),
      fromApiMoment(moment("b", { photo_id: "00000000-0000-4000-8000-000000000001" }), new Set()),
      fromApiMoment(
        moment("c", { member_id: "m2", voice: { media_id: "v", duration_ms: 3000 } }),
        new Set(),
      ),
      fromApiMoment(
        moment("d", { words: "The radio sang in the kitchen all morning long today." }),
        new Set(),
      ),
    ];
    const ids = (filter: Parameters<typeof narrowMemories>[1]) =>
      narrowMemories(memories, filter).map((memory) => memory.id);
    expect(ids({ filter: "kept", query: "", parent: undefined })).toEqual(["a"]);
    expect(ids({ filter: "open", query: "", parent: undefined })).toEqual(["b", "c", "d"]);
    expect(ids({ filter: "photos", query: "", parent: undefined })).toEqual(["b"]);
    expect(ids({ filter: "voice", query: "", parent: undefined })).toEqual(["c"]);
    expect(ids({ filter: "all", query: "", parent: "m2" })).toEqual(["c"]);
    expect(ids({ filter: "all", query: "RADIO", parent: undefined })).toEqual(["d"]);
    expect(filterCounts(memories)).toEqual({ all: 4, open: 3, kept: 1, photos: 1, voice: 1 });
  });
});

describe("stories", () => {
  it("are told only while two of their memories are shown, and kept when all are", () => {
    const memories = [
      fromApiMoment(moment("a", { kept: true }), new Set()),
      fromApiMoment(moment("b", { kept: true }), new Set()),
    ];
    const story = (ids: string[]) => ({
      id: "s",
      member_id: "m1",
      member_name: "Mom",
      title: "the river",
      moment_ids: ids,
      kept: false,
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-02T00:00:00Z",
    });
    expect(fromApiStories([story(["a", "gone"])], memories)).toEqual([]);
    expect(fromApiStories([story(["a", "b"])], memories)[0]?.kept).toBe(true);
  });

  it("in the example are titled only with a phrase of hers, as a server's must be", () => {
    const { moments = [], stories = [] } = demoMemories(exchangesFixture());
    for (const story of stories) {
      const quotes = story.moment_ids.map(
        (id) => moments.find((item) => item.exchange_id === id)?.quote ?? "",
      );
      expect(quotes.some((quote) => quote.includes(story.title))).toBe(true);
      expect(story.moment_ids.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the book", () => {
  it("reads a month at a time, oldest month first", () => {
    const months = byMonth(["2026-11-02", "2026-10-30", "2026-10-01"], (day) => day.slice(0, 7));
    expect(months).toEqual([
      { month: "2026-10", items: ["2026-10-30", "2026-10-01"] },
      { month: "2026-11", items: ["2026-11-02"] },
    ]);
  });
});
