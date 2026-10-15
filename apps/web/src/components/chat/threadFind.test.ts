import { describe, expect, it } from "vite-plus/test";
import { formatThreadFindCount, parseThreadFindQuery, stepThreadFindIndex } from "./threadFind";

describe("thread find navigation", () => {
  it("clamps, wraps, and formats positions", () => {
    expect(stepThreadFindIndex(2, 3, 1)).toBe(0);
    expect(stepThreadFindIndex(0, 3, -1)).toBe(2);
    expect(formatThreadFindCount(4, 2)).toBe("2/2");
    expect(formatThreadFindCount(0, 0)).toBe("0/0");
  });
});

describe("thread route find query", () => {
  it("keeps text and hand-typed numbers, bounded, and drops anything else", () => {
    expect(parseThreadFindQuery("  needle ")).toBe("needle");
    expect(parseThreadFindQuery(2026)).toBe("2026");
    expect(parseThreadFindQuery("x".repeat(300))).toHaveLength(200);
    expect(parseThreadFindQuery("   ")).toBeUndefined();
    expect(parseThreadFindQuery(true)).toBeUndefined();
    expect(parseThreadFindQuery({ find: "needle" })).toBeUndefined();
    expect(parseThreadFindQuery(undefined)).toBeUndefined();
  });
});
