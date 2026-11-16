import { describe, expect, it } from "vitest";

import { binScores, formatBytes, formatScore } from "./inspection-format";

describe("binScores", () => {
  it("puts every score in exactly one bin, max in the last", () => {
    const bins = binScores([1, 2, 3, 4, 5], 4);
    expect(bins).toHaveLength(4);
    expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(5);
    expect(bins[3].count).toBe(2); // 4 and 5 (the max) share the top bin
  });

  it("handles identical scores and empty input", () => {
    expect(binScores([2, 2, 2], 3)[0].count).toBe(3);
    expect(binScores([])).toEqual([]);
  });
});

describe("formatters", () => {
  it("formats scores and bytes", () => {
    expect(formatScore(12.34567)).toBe("12.346");
    expect(formatScore(null)).toBe("-");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  });
});
