import { describe, expect, it } from "vitest";
import { daysUntil, fmtDate, fmtDateTime, fmtTime, groupLabel, relative, weekNumber } from "./format";
import type { Settings } from "./types";

type Fmt = Pick<Settings, "dateFormat" | "timeFormat" | "weekStart">;
const fmt = (over: Partial<Fmt> = {}): Fmt => ({ dateFormat: "iso", timeFormat: "24", weekStart: 1, ...over });

/** Local-time Date (the suite runs in Europe/Oslo, see vitest.config.ts). */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
/** Thursday 22 October 2026, 14:30 CEST. The clock is never read: every function takes `now`. */
const NOW = local(2026, 10, 22, 14, 30);
/** Node's 12-hour format puts a narrow no-break space before AM/PM; compare with a plain space so the tests do not depend on that. */
const plain = (s: string) => s.replace(/\s/g, " ");

// ---------------------------------------------------------------------------------------------------------------------
describe("fmtDate", () => {
  const thu = local(2026, 10, 22, 23, 59);

  it("iso: yyyy-mm-dd", () => {
    expect(fmtDate(thu, fmt({ dateFormat: "iso" }))).toBe("2026-10-22");
  });
  it("dmy: day month-abbreviation year, without a leading zero", () => {
    expect(fmtDate(thu, fmt({ dateFormat: "dmy" }))).toBe("22 Oct 2026");
    expect(fmtDate(local(2026, 1, 5), fmt({ dateFormat: "dmy" }))).toBe("5 Jan 2026");
  });
  it("mdy: month-abbreviation day, year", () => {
    expect(fmtDate(thu, fmt({ dateFormat: "mdy" }))).toBe("Oct 22, 2026");
    expect(fmtDate(local(2026, 1, 5), fmt({ dateFormat: "mdy" }))).toBe("Jan 5, 2026");
  });
  it("system: the browser's own short date (en-US in the test environment)", () => {
    expect(fmtDate(thu, fmt({ dateFormat: "system" }))).toBe("10/22/2026");
  });
  it("falls back to the system format for an unknown format", () => {
    expect(fmtDate(thu, fmt({ dateFormat: "yyyy" as Fmt["dateFormat"] }))).toBe("10/22/2026");
  });

  it("iso pads month and day with zeros", () => {
    expect(fmtDate(local(2026, 1, 5), fmt({ dateFormat: "iso" }))).toBe("2026-01-05");
    expect(fmtDate(local(2026, 12, 31), fmt({ dateFormat: "iso" }))).toBe("2026-12-31");
  });

  it.each([
    [1, "Jan"],
    [2, "Feb"],
    [3, "Mar"],
    [4, "Apr"],
    [5, "May"],
    [6, "Jun"],
    [7, "Jul"],
    [8, "Aug"],
    [9, "Sep"],
    [10, "Oct"],
    [11, "Nov"],
    [12, "Dec"],
  ])("dmy and mdy abbreviate month %i as %s", (month, name) => {
    expect(fmtDate(local(2026, month, 9), fmt({ dateFormat: "dmy" }))).toBe(`9 ${name} 2026`);
    expect(fmtDate(local(2026, month, 9), fmt({ dateFormat: "mdy" }))).toBe(`${name} 9, 2026`);
  });

  describe("with weekday", () => {
    it("prefixes the English weekday for iso, dmy and mdy", () => {
      expect(fmtDate(thu, fmt({ dateFormat: "iso" }), true)).toBe("Thursday, 2026-10-22");
      expect(fmtDate(thu, fmt({ dateFormat: "dmy" }), true)).toBe("Thursday, 22 Oct 2026");
      expect(fmtDate(thu, fmt({ dateFormat: "mdy" }), true)).toBe("Thursday, Oct 22, 2026");
    });
    it("system: the browser's long date, weekday included", () => {
      expect(fmtDate(thu, fmt({ dateFormat: "system" }), true)).toBe("Thursday, October 22, 2026");
    });
    it("names the right weekday across a week", () => {
      const names = [19, 20, 21, 22, 23, 24, 25].map((day) => fmtDate(local(2026, 10, day), fmt(), true).split(",")[0]);
      expect(names).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    });
  });

  it("uses the local calendar day, not the UTC one", () => {
    // 00:30 on 22 Oct in Oslo is still 21 Oct in UTC.
    expect(fmtDate(new Date("2026-10-21T22:30:00Z"), fmt())).toBe("2026-10-22");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("fmtTime", () => {
  describe("24-hour", () => {
    const t = (h: number, m: number) => fmtTime(local(2026, 10, 22, h, m), fmt({ timeFormat: "24" }));
    it("pads hours and minutes", () => {
      expect(t(14, 5)).toBe("14:05");
      expect(t(9, 7)).toBe("09:07");
    });
    it("handles midnight and the last minute of the day", () => {
      expect(t(0, 0)).toBe("00:00");
      expect(t(23, 59)).toBe("23:59");
    });
  });

  describe("12-hour", () => {
    const t = (h: number, m: number) => plain(fmtTime(local(2026, 10, 22, h, m), fmt({ timeFormat: "12" })));
    it("uses AM/PM without padding the hour", () => {
      expect(t(14, 5)).toBe("2:05 PM");
      expect(t(9, 7)).toBe("9:07 AM");
    });
    it("shows midnight as 12 AM and noon as 12 PM", () => {
      expect(t(0, 0)).toBe("12:00 AM");
      expect(t(12, 0)).toBe("12:00 PM");
      expect(t(0, 45)).toBe("12:45 AM");
    });
    it("handles the last minute of the day", () => {
      expect(t(23, 59)).toBe("11:59 PM");
    });
  });

  it("shows local time, not UTC", () => {
    expect(fmtTime(new Date("2026-10-22T12:30:00Z"), fmt())).toBe("14:30");
  });
});

describe("fmtDateTime", () => {
  it("joins the date and the time with a space", () => {
    const d = local(2026, 10, 22, 14, 5);
    expect(fmtDateTime(d, fmt({ dateFormat: "iso", timeFormat: "24" }))).toBe("2026-10-22 14:05");
    expect(plain(fmtDateTime(d, fmt({ dateFormat: "dmy", timeFormat: "12" })))).toBe("22 Oct 2026 2:05 PM");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("groupLabel", () => {
  describe("day", () => {
    const label = (start: Date, over: Partial<Fmt> = {}, now = NOW) => groupLabel(start, "day", fmt(over), now);

    it("prefixes today with 'Today - '", () => {
      expect(label(local(2026, 10, 22))).toBe("Today - Thursday, 2026-10-22");
    });
    it("prefixes yesterday with 'Yesterday - '", () => {
      expect(label(local(2026, 10, 21))).toBe("Yesterday - Wednesday, 2026-10-21");
    });
    it("has no prefix for earlier days", () => {
      expect(label(local(2026, 10, 20))).toBe("Tuesday, 2026-10-20");
      expect(label(local(2025, 12, 31))).toBe("Wednesday, 2025-12-31");
    });
    it("has no prefix for a day in the future", () => {
      expect(label(local(2026, 10, 23))).toBe("Friday, 2026-10-23");
    });
    it("uses the chosen date format", () => {
      expect(label(local(2026, 10, 22), { dateFormat: "dmy" })).toBe("Today - Thursday, 22 Oct 2026");
      expect(label(local(2026, 10, 21), { dateFormat: "mdy" })).toBe("Yesterday - Wednesday, Oct 21, 2026");
      expect(label(local(2026, 10, 20), { dateFormat: "system" })).toBe("Tuesday, October 20, 2026");
    });
    it("is not thrown off by the 23-hour day when the clocks go forward (29 Mar 2026)", () => {
      expect(label(local(2026, 3, 29), {}, local(2026, 3, 30, 10))).toBe("Yesterday - Sunday, 2026-03-29");
      expect(label(local(2026, 3, 30), {}, local(2026, 3, 30, 10))).toBe("Today - Monday, 2026-03-30");
    });
    it("is not thrown off by the 25-hour day when the clocks go back (25 Oct 2026)", () => {
      expect(label(local(2026, 10, 25), {}, local(2026, 10, 26, 10))).toBe("Yesterday - Sunday, 2026-10-25");
      expect(label(local(2026, 10, 24), {}, local(2026, 10, 26, 10))).toBe("Saturday, 2026-10-24");
    });
    it("does not depend on the time of day of now", () => {
      expect(label(local(2026, 10, 21), {}, local(2026, 10, 22, 0, 1))).toBe("Yesterday - Wednesday, 2026-10-21");
      expect(label(local(2026, 10, 21), {}, local(2026, 10, 22, 23, 59))).toBe("Yesterday - Wednesday, 2026-10-21");
    });
  });

  describe("week", () => {
    const label = (start: Date, over: Partial<Fmt> = {}, now = NOW) => groupLabel(start, "week", fmt(over), now);

    it("marks the current week with 'This week - ' and spans seven days (Monday start)", () => {
      expect(label(local(2026, 10, 19))).toBe("This week - Week 43 · 2026-10-19 – 2026-10-25");
    });
    it("has no prefix for earlier weeks", () => {
      expect(label(local(2026, 10, 12))).toBe("Week 42 · 2026-10-12 – 2026-10-18");
      expect(label(local(2026, 1, 12))).toBe("Week 3 · 2026-01-12 – 2026-01-18");
    });
    it("has no prefix for a later week", () => {
      expect(label(local(2026, 10, 26))).toBe("Week 44 · 2026-10-26 – 2026-11-01");
    });
    it("spans Sunday to Saturday with a Sunday week start, and 'This week' follows that start", () => {
      expect(label(local(2026, 10, 18), { weekStart: 0 })).toBe("This week - Week 43 · 2026-10-18 – 2026-10-24");
      expect(label(local(2026, 10, 11), { weekStart: 0 })).toBe("Week 42 · 2026-10-11 – 2026-10-17");
    });
    it("is the current week on every day of it, Sunday included for Monday weeks", () => {
      for (const now of [local(2026, 10, 19, 0, 1), local(2026, 10, 22, 12), local(2026, 10, 25, 23, 59)]) {
        expect(label(local(2026, 10, 19), {}, now)).toMatch(/^This week - /);
      }
      expect(label(local(2026, 10, 19), {}, local(2026, 10, 26, 0, 1))).not.toMatch(/^This week/);
    });
    it("formats both ends with the chosen date format, without weekday", () => {
      expect(label(local(2026, 10, 12), { dateFormat: "dmy" })).toBe("Week 42 · 12 Oct 2026 – 18 Oct 2026");
      expect(label(local(2026, 10, 12), { dateFormat: "mdy" })).toBe("Week 42 · Oct 12, 2026 – Oct 18, 2026");
      expect(label(local(2026, 10, 12), { dateFormat: "system" })).toBe("Week 42 · 10/12/2026 – 10/18/2026");
    });
    it("ends on the right date when the week crosses a month, or the daylight-saving change", () => {
      expect(label(local(2026, 9, 28))).toBe("Week 40 · 2026-09-28 – 2026-10-04");
      expect(label(local(2026, 10, 19), {}, local(2026, 10, 27))).toBe("Week 43 · 2026-10-19 – 2026-10-25");
    });
  });

  describe("month", () => {
    const label = (start: Date, now = NOW) => groupLabel(start, "month", fmt(), now);

    it("marks the current month with 'This month - '", () => {
      expect(label(local(2026, 10, 1))).toBe("This month - October 2026");
    });
    it("has no prefix for other months, and shows the year", () => {
      expect(label(local(2026, 9, 1))).toBe("September 2026");
      expect(label(local(2025, 12, 1))).toBe("December 2025");
      expect(label(local(2026, 11, 1))).toBe("November 2026");
    });
    it("is the current month on its first and last moment", () => {
      expect(label(local(2026, 10, 1), local(2026, 10, 1, 0, 0))).toMatch(/^This month/);
      expect(label(local(2026, 10, 1), local(2026, 10, 31, 23, 59))).toMatch(/^This month/);
      expect(label(local(2026, 10, 1), local(2026, 11, 1, 0, 0))).not.toMatch(/^This month/);
    });
    it("ignores the date and week format settings", () => {
      expect(groupLabel(local(2026, 9, 1), "month", fmt({ dateFormat: "dmy", weekStart: 0 }), NOW)).toBe("September 2026");
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("relative", () => {
  const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();
  const MIN = 60,
    H = 3600,
    D = 86_400;

  it("says 'never' when there is no timestamp", () => {
    expect(relative(undefined, NOW)).toBe("never");
    expect(relative("", NOW)).toBe("never");
  });

  it.each([
    [0, "just now"],
    [44, "just now"],
    [45, "1 min ago"],
    [89, "1 min ago"],
    [90, "2 min ago"],
    [10 * MIN, "10 min ago"],
    [59 * MIN + 29, "59 min ago"],
    [59 * MIN + 30, "1 h ago"],
    [H, "1 h ago"],
    [2 * H, "2 h ago"],
    [23 * H + 29 * MIN, "23 h ago"],
    [23 * H + 30 * MIN, "1 d ago"],
    [D, "1 d ago"],
    [36 * H, "2 d ago"],
    [10 * D, "10 d ago"],
    [400 * D, "400 d ago"],
  ])("%i seconds ago -> %s", (seconds, expected) => {
    expect(relative(ago(seconds), NOW)).toBe(expected);
  });

  it("says 'just now' for a time slightly in the future (clock skew)", () => {
    expect(relative(new Date(NOW.getTime() + 30_000).toISOString(), NOW)).toBe("just now");
    expect(relative(new Date(NOW.getTime() + 3 * 864e5).toISOString(), NOW)).toBe("just now");
  });

  it("reads an ISO timestamp with a UTC offset", () => {
    expect(relative("2026-10-22T14:00:00+02:00", NOW)).toBe("30 min ago");
  });
});

describe("daysUntil", () => {
  const inMs = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
  const DAY = 864e5;

  it("is null when there is no expiry", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil(undefined, NOW)).toBeNull();
    expect(daysUntil("", NOW)).toBeNull();
  });

  it("counts whole days exactly", () => {
    expect(daysUntil(inMs(30 * DAY), NOW)).toBe(30);
    expect(daysUntil(inMs(DAY), NOW)).toBe(1);
  });

  it("rounds a started day up: a token that expires in 12 hours still has 1 day", () => {
    expect(daysUntil(inMs(12 * 3600_000), NOW)).toBe(1);
    expect(daysUntil(inMs(30 * DAY - 60_000), NOW)).toBe(30);
    expect(daysUntil(inMs(30 * DAY + 60_000), NOW)).toBe(31);
  });

  it("is 0 at the moment of expiry and negative once it has passed", () => {
    expect(daysUntil(inMs(0), NOW)).toBe(0);
    expect(daysUntil(inMs(-3 * DAY), NOW)).toBe(-3);
    // Ceil of a small negative fraction is -0, which compares equal to 0 and prints as "0".
    expect(daysUntil(inMs(-12 * 3600_000), NOW)).toBeLessThanOrEqual(0);
    expect(daysUntil(inMs(-12 * 3600_000), NOW)! > -1).toBe(true);
  });

  it("reads the timestamp GitHub's header was converted to", () => {
    expect(daysUntil("2026-12-01T10:00:00.000Z", NOW)).toBe(40);
  });
});

describe("weekNumber", () => {
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
  it.each([
    [d(2026, 10, 19), 43],
    [d(2026, 1, 12), 3],
    [d(2025, 12, 29), 1], // 2026-W01 starts in 2025
    [d(2027, 1, 4), 1],
    [d(2026, 12, 28), 53],
    [d(2020, 12, 28), 53],
    [d(2021, 1, 4), 1],
  ])("ISO week for the Monday week starting %s is %i", (start, wk) => {
    expect(weekNumber(start, 1)).toBe(wk);
  });
  it.each([
    [d(2026, 10, 18), 43],
    [d(2025, 12, 28), 1],
    [d(2027, 1, 3), 2],
    [d(2026, 12, 27), 1],
  ])("US week for the Sunday week starting %s is %i", (start, wk) => {
    expect(weekNumber(start, 0)).toBe(wk);
  });
});
