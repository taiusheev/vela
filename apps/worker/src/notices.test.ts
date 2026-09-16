import { describe, expect, inject, it } from "vitest";
import {
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
