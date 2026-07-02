import { describe, it, expect } from "vitest";
import { benchUrl, selectPages, type PageFile } from "./lib.js";

describe("benchUrl", () => {
  it("rewrites the test search_path to bench", () => {
    const u = "postgresql://u:p@host:5432/db?options=-c%20search_path%3Dtest%2Cpublic";
    expect(benchUrl(u)).toContain("search_path%3Dbench%2Cpublic");
    const plain = "postgresql://u:p@host:5432/db?options=-c search_path=test,public";
    expect(benchUrl(plain)).toContain("search_path=bench,public");
  });

  it("throws when the URL has no test search_path", () => {
    expect(() => benchUrl("postgresql://u:p@host/db")).toThrow(/search_path/);
  });
});

describe("selectPages", () => {
  const files: PageFile[] = Array.from({ length: 100 }, (_, i) => ({
    path: `content/handbook/${String(i).padStart(3, "0")}.md`,
    bytes: 1000 + i * 200, // 1000..20800
  }));

  it("filters by size and returns exactly n deterministic paths", () => {
    const a = selectPages(files, 10);
    const b = selectPages(files, 10);
    expect(a).toEqual(b);
    expect(a.length).toBe(10);
    for (const p of a) {
      const f = files.find((x) => x.path === p)!;
      expect(f.bytes).toBeGreaterThanOrEqual(2000);
      expect(f.bytes).toBeLessThanOrEqual(15000);
    }
  });

  it("spreads selections across the sorted list (stride sampling)", () => {
    const picks = selectPages(files, 5);
    const idx = picks.map((p) => files.findIndex((f) => f.path === p));
    for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBeGreaterThan(1);
  });

  it("returns all eligible files when n exceeds the pool", () => {
    const few: PageFile[] = [
      { path: "a.md", bytes: 3000 },
      { path: "b.md", bytes: 100 }, // too small
      { path: "c.md", bytes: 5000 },
    ];
    expect(selectPages(few, 10)).toEqual(["a.md", "c.md"]);
  });
});
