import type { Group, Settings } from "./types";
import { startOfDay, startOfMonth, startOfWeek } from "./feed";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

type Fmt = Pick<Settings, "dateFormat" | "timeFormat" | "weekStart">;

export function fmtDate(d: Date, f: Fmt, withWeekday = false): string {
  const wd = withWeekday ? d.toLocaleDateString("en-US", { weekday: "long" }) + ", " : "";
  switch (f.dateFormat) {
    case "iso":
      return wd + `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    case "dmy":
      return wd + `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
    case "mdy":
      return wd + `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    default:
      return withWeekday
        ? d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })
        : d.toLocaleDateString();
  }
}

export function fmtTime(d: Date, f: Fmt): string {
  if (f.timeFormat === "12") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDateTime(d: Date, f: Fmt): string {
  return `${fmtDate(d, f)} ${fmtTime(d, f)}`;
}

export function groupLabel(start: Date, group: Group, f: Fmt, now: Date): string {
  if (group === "day") {
    const diff = Math.round((startOfDay(now).getTime() - start.getTime()) / 864e5);
    const long = fmtDate(start, f, true);
    return diff === 0 ? "Today - " + long : diff === 1 ? "Yesterday - " + long : long;
  }
  if (group === "week") {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const wk = weekNumber(start, f.weekStart);
    const cur = startOfWeek(now, f.weekStart).getTime() === start.getTime();
    return `${cur ? "This week - " : ""}Week ${wk} · ${fmtDate(start, f)} – ${fmtDate(end, f)}`;
  }
  const cur = startOfMonth(now).getTime() === start.getTime();
  return (cur ? "This month - " : "") + start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function relative(iso: string | undefined, now: Date): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  return Math.ceil((Date.parse(iso) - now.getTime()) / 864e5);
}

/**
 * Week number of the week starting at `start`.
 * Monday weeks use ISO 8601 (week 1 contains the first Thursday). Sunday weeks use the US convention
 * (week 1 contains January 1).
 */
export function weekNumber(start: Date, weekStart: 0 | 1): number {
  if (weekStart === 1) {
    const thursday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 3);
    const jan1 = new Date(thursday.getFullYear(), 0, 1);
    return Math.floor(Math.round((thursday.getTime() - jan1.getTime()) / 864e5) / 7) + 1;
  }
  const saturday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const jan1 = new Date(saturday.getFullYear(), 0, 1);
  return Math.floor((Math.round((saturday.getTime() - jan1.getTime()) / 864e5) + jan1.getDay()) / 7) + 1;
}
