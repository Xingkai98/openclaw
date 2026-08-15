// Control UI tests cover file-kind classification and file-link label
// disambiguation, including the linear-time suffix-index path.
import { describe, expect, it } from "vitest";
import { fileKindForPath, shortestFileLabels } from "./file-kind.ts";

// Reference implementation of the previous quadratic algorithm, kept only to
// prove the suffix-index rewrite stays byte-for-byte equivalent on the shared
// cases below.
function referenceShortestFileLabels(paths: readonly string[]): Map<string, string> {
  const unique = [...new Set(paths)];
  const segmentsByPath = new Map(unique.map((path) => [path, path.split(/[\\/]/).filter(Boolean)]));
  const suffixKey = (segments: readonly string[], depth: number) =>
    segments.slice(-depth).join("/");
  const labels = new Map<string, string>();
  for (const path of unique) {
    const segments = segmentsByPath.get(path) ?? [];
    let depth = 1;
    while (
      depth < segments.length &&
      unique.some(
        (other) =>
          other !== path &&
          suffixKey(segmentsByPath.get(other) ?? [], depth) === suffixKey(segments, depth),
      )
    ) {
      depth += 1;
    }
    labels.set(path, segments.slice(-depth).join(path.includes("\\") ? "\\" : "/"));
  }
  return labels;
}

describe("shortestFileLabels", () => {
  it("labels a unique basename with the basename alone", () => {
    const labels = shortestFileLabels(["src/components/Button.tsx", "src/lib/util.ts"]);
    expect(labels.get("src/components/Button.tsx")).toBe("Button.tsx");
    expect(labels.get("src/lib/util.ts")).toBe("util.ts");
  });

  it("grows the label only far enough to tell equal basenames apart", () => {
    const labels = shortestFileLabels(["ui/src/app.ts", "api/src/app.ts", "D:\\work\\app.ts"]);
    expect(labels.get("ui/src/app.ts")).toBe("ui/src/app.ts");
    expect(labels.get("api/src/app.ts")).toBe("api/src/app.ts");
    expect(labels.get("D:\\work\\app.ts")).toBe("work\\app.ts");
  });

  it("deduplicates repeated identical paths", () => {
    const labels = shortestFileLabels(["a/app.ts", "a/app.ts", "a/app.ts", "b/app.ts"]);
    expect(labels.size).toBe(2);
    expect(labels.get("a/app.ts")).toBe("a/app.ts");
    expect(labels.get("b/app.ts")).toBe("b/app.ts");
  });

  it("falls back to the full path when one path is a suffix of another", () => {
    const labels = shortestFileLabels(["b", "a/b"]);
    expect(labels.get("b")).toBe("b");
    expect(labels.get("a/b")).toBe("a/b");
  });

  it("preserves the separator style of the original path", () => {
    const labels = shortestFileLabels(["D:\\work\\Button.tsx", "D:\\home\\Button.tsx"]);
    expect(labels.get("D:\\work\\Button.tsx")).toBe("work\\Button.tsx");
    expect(labels.get("D:\\home\\Button.tsx")).toBe("home\\Button.tsx");
  });

  it("disambiguates paths that differ only in separator style", () => {
    const labels = shortestFileLabels(["a/b", "a\\b"]);
    expect(labels.get("a/b")).toBe("a/b");
    expect(labels.get("a\\b")).toBe("a\\b");
  });

  it("handles dotfiles, extensionless names, and Unicode basenames", () => {
    const labels = shortestFileLabels([".gitignore", "Makefile", "文档/示例.md"]);
    expect(labels.get(".gitignore")).toBe(".gitignore");
    expect(labels.get("Makefile")).toBe("Makefile");
    expect(labels.get("文档/示例.md")).toBe("示例.md");
  });

  it("drops empty segments and renders an empty path as empty", () => {
    const labels = shortestFileLabels(["a//b/c.ts", "/a/b", ""]);
    expect(labels.get("a//b/c.ts")).toBe("c.ts");
    expect(labels.get("/a/b")).toBe("b");
    expect(labels.get("")).toBe("");
  });

  it("is transparent to line/column suffixes (the parser strips them before calling)", () => {
    // shortestFileLabels sees only the path; a colon that survives parsing is
    // part of a filename segment and must not be treated as a separator.
    const labels = shortestFileLabels(["src/notes", "src/notes:v2"]);
    expect(labels.get("src/notes")).toBe("notes");
    expect(labels.get("src/notes:v2")).toBe("notes:v2");
  });

  it("matches the reference implementation across structured inputs", () => {
    const cases: string[][] = [
      ["a/b/c.ts", "a/b/d.ts"],
      ["x/app.ts", "y/app.ts", "z/app.ts"],
      ["a/b", "a\\b", "c/b"],
      ["src/lib/foo.ts", "src/lib/bar.ts", "test/lib/foo.ts"],
      ["packages/a/src/index.ts", "packages/b/src/index.ts", "packages/a/src/util.ts"],
      ["README.md", "docs/README.md", "docs/README.md"],
      ["one", "two/one", "three/two/one"],
      [".env", "config/.env", "config/prod/.env"],
      ["深/層/文件.ts", "深/其他/文件.ts"],
      ["", "a", "a/b", "a/b/c"],
    ];
    for (const input of cases) {
      const actual = shortestFileLabels(input);
      const expected = referenceShortestFileLabels(input);
      expect([...actual.entries()]).toEqual([...expected.entries()]);
    }
  });

  it("scales near-linearly on thousands of unique short paths", () => {
    const paths = Array.from(
      { length: 4000 },
      (_, index) => `src/module${index % 80}/file${index}.ts`,
    );
    const start = performance.now();
    const labels = shortestFileLabels(paths);
    const elapsedMs = performance.now() - start;

    expect(labels.size).toBe(4000);
    expect(labels.get("src/module0/file0.ts")).toBe("file0.ts");
    expect(labels.get("src/module79/file3999.ts")).toBe("file3999.ts");
    // Generous ceiling: the previous quadratic implementation measured ~4.4s at
    // 4k unique paths in this environment, while the linear walk is ~20ms, so
    // 2s leaves roughly two orders of magnitude of headroom for CI variance.
    expect(elapsedMs).toBeLessThan(2000);
  });
});

describe("fileKindForPath", () => {
  it.each([
    ["README.md", "markdown"],
    ["package.json", "package"],
    ["src/components/Button.tsx", "component"],
    ["src/index.ts", "code"],
    ["config/app.yaml", "data"],
    ["scripts/run.sh", "shell"],
    ["docs/logo.png", "image"],
    [".gitignore", "file"],
    ["unknown.zzz", "file"],
  ])("classifies %s as %s", (path, kind) => {
    expect(fileKindForPath(path)).toBe(kind);
  });
});
