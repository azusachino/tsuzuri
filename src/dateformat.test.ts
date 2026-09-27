import { describe, expect, test } from "vitest";
import { formatDate, isoWeek, localeWeek } from "./dateformat.ts";

describe("formatDate", () => {
  const date = new Date(2026, 8, 6, 9, 5, 7);

  test("formats the moment tokens templates use", () => {
    expect(formatDate(date, "YYYY-MM-DD")).toBe("2026-09-06");
    expect(formatDate(date, "YYYY-[Q]Q")).toBe("2026-Q3");
    expect(formatDate(date, "YY M D DDD DDDD")).toBe("26 9 6 249 249");
    expect(formatDate(date, "dddd, MMMM Do")).toBe("Sunday, September 6th");
    expect(formatDate(date, "ddd MMM d")).toBe("Sun Sep 0");
    expect(formatDate(date, "HH:mm:ss h A")).toBe("09:05:07 9 AM");
    expect(formatDate(date, "YYYY/[weekly]/[w]WW")).toBe("2026/weekly/w36");
  });

  test("distinguishes locale weeks from ISO weeks", () => {
    const newYear = new Date(2021, 0, 1);
    expect(isoWeek(newYear)).toEqual({ year: 2020, week: 53 });
    expect(localeWeek(newYear)).toEqual({ year: 2021, week: 1 });
    expect(formatDate(newYear, "gggg-[W]ww")).toBe("2021-W01");
    expect(formatDate(newYear, "GGGG-[W]WW")).toBe("2020-W53");
    expect(formatDate(new Date(2021, 11, 26), "gggg-[W]ww")).toBe("2022-W01");
  });

  test("keeps bracketed text and unknown letters literal", () => {
    expect(formatDate(date, "[Daily] YYYY x")).toBe("Daily 2026 x");
  });
});
