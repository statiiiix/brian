// Pure helpers for Brian-bench: no network, no DB, unit-tested.

// Rewrite the test-schema connection URL to the isolated bench schema.
// Handles both raw and percent-encoded search_path options.
export function benchUrl(testUrl: string): string {
  const encoded = testUrl.replace("search_path%3Dtest", "search_path%3Dbench");
  if (encoded !== testUrl) return encoded;
  const plain = testUrl.replace("search_path=test", "search_path=bench");
  if (plain !== testUrl) return plain;
  throw new Error("URL does not carry a test search_path; refusing to guess the bench DB");
}

export interface PageFile {
  path: string;
  bytes: number;
}

// Deterministic corpus selection: size-filter, sort by path, stride-sample
// evenly so the picks spread across handbook sections.
export function selectPages(
  files: PageFile[],
  n: number,
  minBytes = 2000,
  maxBytes = 15000
): string[] {
  const eligible = files
    .filter((f) => f.bytes >= minBytes && f.bytes <= maxBytes)
    .map((f) => f.path)
    .sort();
  if (eligible.length <= n) return eligible;
  const stride = eligible.length / n;
  const picks: string[] = [];
  for (let i = 0; i < n; i++) picks.push(eligible[Math.floor(i * stride)]);
  return picks;
}
