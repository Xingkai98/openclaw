import { describe, expect, it } from "vitest";
import { isGitHubItemRootUrl, parseGitHubItemPath } from "./github-link-target.ts";

describe("isGitHubItemRootUrl", () => {
  it.each([
    ["issue root", "https://github.com/o/r/issues/123", true],
    ["pull root", "https://github.com/o/r/pull/123", true],
    ["trailing slash", "https://github.com/o/r/pull/123/", true],
    ["pull files", "https://github.com/o/r/pull/123/files", false],
    ["pull commits", "https://github.com/o/r/pull/123/commits", false],
    ["commit sha", "https://github.com/o/r/pull/123/commits/abc1234", false],
    ["checks", "https://github.com/o/r/pull/123/checks", false],
    ["issue comment anchor", "https://github.com/o/r/issues/123#issuecomment-456", false],
    ["diff query", "https://github.com/o/r/pull/123/files?diff=split&w=1", false],
  ])("classifies %s", (_kind, href, expected) => {
    expect(isGitHubItemRootUrl(new URL(href))).toBe(expected);
  });
});

describe("parseGitHubItemPath keeps deep-link identity parseable", () => {
  it("parses the item root identity from a deep pull link", () => {
    const target = parseGitHubItemPath(new URL("https://github.com/o/r/pull/123/files"));
    expect(target).toEqual({ kind: "pull", number: 123, owner: "o", repo: "r" });
  });

  it("rejects non-item surfaces", () => {
    expect(parseGitHubItemPath(new URL("https://github.com/o/r/commit/abc"))).toBeNull();
    expect(parseGitHubItemPath(new URL("https://github.com/o/r/discussions/12"))).toBeNull();
  });
});
