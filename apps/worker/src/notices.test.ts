import { describe, expect, inject, it } from "vitest";
import {
  NoticeVersionError,
  noticesModule,
  noticeVersion,
  renderNotice,
  renderNotices,
  UnsupportedMarkdownError,
} from "../scripts/notice-markdown.ts";
import { PRIVACY_NOTICES } from "./notices.generated.ts";
import { unfilledPlaceholders } from "./notices.ts";

describe("the committed notices module", () => {
  // The Worker serves only the module. A notice edited without `pnpm --filter @vela/worker notices`
  // would never reach families, so CI fails here instead.
  it("is what the notices in plan/materials/pilot render to today", () => {
    expect(PRIVACY_NOTICES).toEqual(renderNotices(inject("noticeSources")));
  });
});

describe("approved notification-preference notice", () => {
  it("serves the v17 scope in both languages", () => {
    expect(PRIVACY_NOTICES.en.version).toBe("privacy-notice.v17");
    expect(PRIVACY_NOTICES["zh-TW"].version).toBe("privacy-notice.v17");
    // ADR-62: a family starts as soon as it is set up; the founder reviews and removes afterwards.
    expect(PRIVACY_NOTICES.en.html).toContain("Each family can start as soon as it is set up.");
    expect(PRIVACY_NOTICES.en.html).not.toContain("only once the founder has approved it");
    expect(PRIVACY_NOTICES["zh-TW"].html).toContain("每個家庭設定好之後就可以開始。");
    // Onboarding v2: what to avoid is matched in code and never sent to an AI provider.
    expect(PRIVACY_NOTICES.en.html).toContain("These answers are never sent to an AI provider.");
    expect(PRIVACY_NOTICES["zh-TW"].html).toContain("這些答案不會傳給任何 AI 服務。");
    // ADR-60: Vela may ask the people nearby itself, so neither notice says it never contacts anyone.
    expect(PRIVACY_NOTICES.en.html).toContain("when nobody in the family has answered");
    expect(PRIVACY_NOTICES.en.html).not.toContain("Vela never contacts anyone on its own");
    expect(PRIVACY_NOTICES["zh-TW"].html).toContain("家人兩個小時都沒有回應 Vela 的通知");
    expect(PRIVACY_NOTICES["zh-TW"].html).not.toContain("Vela 絕不會自行聯絡任何人");
    // ADR-59: the weekly read goes out as drafted, so neither notice promises a check before sending.
    expect(PRIVACY_NOTICES.en.html).toContain("sends it to the organisers straight away");
    expect(PRIVACY_NOTICES.en.html).not.toContain("the founder checks it before anything is sent");
    expect(PRIVACY_NOTICES["zh-TW"].html).toContain("並馬上傳給發起人");
    expect(PRIVACY_NOTICES["zh-TW"].html).not.toContain("創辦人在任何內容送出之前先檢查");
    expect(PRIVACY_NOTICES.en.html).toContain("Notification choices:");
    expect(PRIVACY_NOTICES.en.html).toContain(
      "They are not shown to other family members or sent to an AI provider.",
    );
    expect(PRIVACY_NOTICES["zh-TW"].html).toContain("通知偏好：");
    expect(PRIVACY_NOTICES["zh-TW"].html).toContain("刪除帳號時，Vela 會清除這些通知偏好。");
  });
});

describe("the photo box in the notice (ADR-58, ADR-61)", () => {
  it("says, in both languages, what the box keeps, for how long, and when OpenAI sees a photo", () => {
    expect(PRIVACY_NOTICES.en.html).toContain("<h2>The photo box</h2>");
    expect(PRIVACY_NOTICES.en.html).toContain(
      "Photos are only sent to OpenAI when someone asks for suggestions.",
    );
    expect(PRIVACY_NOTICES.en.html).not.toContain(
      "Photos in the box are not sent to an AI provider",
    );
    expect(PRIVACY_NOTICES["zh-TW"].html).toContain("<h2>相片盒</h2>");
    expect(PRIVACY_NOTICES["zh-TW"].html).toContain(
      "只有在有人請 Vela 建議問題時，照片才會傳給 OpenAI。",
    );
  });
});

describe("a notice's Markdown", () => {
  it("takes the page title from its # heading, as plain text", () => {
    const notice = renderNotice("> **Draft.**\n\n# Vela pilot: `privacy` **notice**\n\nText.\n");

    expect(notice.title).toBe("Vela pilot: privacy notice");
    expect(notice.html).toContain(
      "<h1>Vela pilot: <code>privacy</code> <strong>notice</strong></h1>",
    );
  });

  it("escapes every character of text, in paragraphs, cells, and code spans alike", () => {
    const notice = renderNotice(
      '# T\n\nA <script>"x"</script> & it\'s `<b>`\n\n| a<b> | c |\n|---|---|\n| "d" | e&f |\n',
    );

    expect(notice.html).not.toContain("<script>");
    expect(notice.html).not.toContain("<b>");
    expect(notice.html).not.toContain('"');
    expect(notice.html).toContain(
      "<p>A &lt;script&gt;&quot;x&quot;&lt;/script&gt; &amp; it&#39;s <code>&lt;b&gt;</code></p>",
    );
    expect(notice.html).toContain("<th>a&lt;b&gt;</th>");
    expect(notice.html).toContain("<td>&quot;d&quot;</td><td>e&amp;f</td>");
  });

  it("renders lists, numbered lists, block quotes, tables, and paragraphs as their elements", () => {
    const notice = renderNotice(
      [
        "> **Draft.**",
        "> Second line.",
        "",
        "# Title",
        "",
        "## Section",
        "",
        "- one",
        "- **two**",
        "",
        "1. first",
        "2. *second*",
        "",
        "| Kind | How long |",
        "|---|---|",
        "| Voice | 30 days |",
        "",
        "A paragraph",
        "on two lines.",
      ].join("\n"),
    );

    expect(notice.html).toBe(
      [
        "<blockquote>",
        "<p><strong>Draft.</strong>\nSecond line.</p>",
        "</blockquote>",
        "<h1>Title</h1>",
        "<h2>Section</h2>",
        "<ul>\n<li>one</li>\n<li><strong>two</strong></li>\n</ul>",
        "<ol>\n<li>first</li>\n<li><em>second</em></li>\n</ol>",
        "<table>\n<thead><tr><th>Kind</th><th>How long</th></tr></thead>\n<tbody>\n<tr><td>Voice</td><td>30 days</td></tr>\n</tbody>\n</table>",
        "<p>A paragraph\non two lines.</p>",
      ].join("\n"),
    );
  });

  it("links only to https and mailto addresses, and leaves a blank in brackets as text", () => {
    const notice = renderNotice(
      "# T\n\nWrite to [the founder](mailto:founder@vela.example) or [CONTACT ADDRESS].\n",
    );

    expect(notice.html).toContain(
      "<a href='mailto:founder@vela.example'>the founder</a> or [CONTACT ADDRESS].",
    );
    expect(unfilledPlaceholders(notice.html)).toEqual(["CONTACT ADDRESS"]);
    expect(() => renderNotice("# T\n\n[the notice](http://vela.example/privacy)\n")).toThrow(
      UnsupportedMarkdownError,
    );
  });

  // Syntax the generator does not read would reach families as stray symbols; it throws instead,
  // naming the line, so the notice edit is caught before anything is committed.
  it.each([
    ["an indented list", "# T\n\n- one\n  - nested\n"],
    ["a fence", "# T\n\n```\ncode\n```\n"],
    ["raw HTML", "# T\n\n<div>x</div>\n"],
    ["a setext heading", "# T\n\nHeading\n---\n"],
    ["a * list", "# T\n\n* one\n"],
    ["a heading below level 3", "# T\n\n#### Deep\n"],
    ["an unclosed code span", "# T\n\nA `span\n"],
    ["a table without a rule", "# T\n\n| a | b |\n| c | d |\n"],
    ["a notice without a title", "## Only a section\n"],
  ])("refuses %s", (_what, markdown) => {
    expect(() => renderNotice(markdown)).toThrow(UnsupportedMarkdownError);
  });
});

describe("a notice's version", () => {
  const en =
    "# Vela pilot: privacy notice\n\nVersion `privacy-notice.v2` · last updated 17 September 2026\n";
  const zhTw =
    "# Vela 試辦計畫：隱私權告知事項\n\n版本 `privacy-notice.v2`・最後更新：2026 年 9 月 17 日\n";

  // An adult's tap on "I've read it" records the version of the notice they read (flows §3.3).
  it("is read from each notice's version line and written into the module", () => {
    const notices = renderNotices({ en, "zh-TW": zhTw });

    expect([notices.en.version, notices["zh-TW"].version]).toEqual([
      "privacy-notice.v2",
      "privacy-notice.v2",
    ]);
    expect(noticesModule({ en, "zh-TW": zhTw })).toContain('version: "privacy-notice.v2",');
    expect(noticeVersion(en)).toBe("privacy-notice.v2");
  });

  it("is what the committed notices carry", () => {
    expect(PRIVACY_NOTICES.en.version).toMatch(/^privacy-notice\.v[1-9]\d*$/);
    expect(PRIVACY_NOTICES["zh-TW"].version).toBe(PRIVACY_NOTICES.en.version);
  });

  it("is required: a notice without a version line is refused", () => {
    expect(() =>
      renderNotices({ en: "# Vela pilot\n\nNo version here.\n", "zh-TW": zhTw }),
    ).toThrow(NoticeVersionError);
  });

  // One Config.privacyNoticeVersion is recorded whichever language an adult read.
  it("must be the same in both languages", () => {
    expect(() =>
      renderNotices({ en, "zh-TW": zhTw.replace("privacy-notice.v2", "privacy-notice.v1") }),
    ).toThrow(/versions differ/);
  });
});
