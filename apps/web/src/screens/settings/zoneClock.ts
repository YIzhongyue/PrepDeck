import { useEffect, useState } from "react";

// The account's time zone as Settings shows it (issue #47): its UTC offset,
// the wall-clock time there now, and when the daily email next goes out.

export interface ZoneClock {
  offset: string;
  time: string;
  hour: number;
}

// null for a zone this browser cannot format, which only happens for a name
// the server stores but the browser's own zone database lacks.
export function zoneClock(timeZone: string, at: Date): ZoneClock | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23", timeZoneName: "shortOffset" }).formatToParts(at);
    const offset = (parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT").replace(/^GMT/, "UTC");
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const time = at.toLocaleTimeString([], { timeZone, hour: "numeric", minute: "2-digit" });
    return { offset, time, hour };
  } catch {
    return null;
  }
}

// The same wording as the delivery-time picker's options.
export function hourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// The scheduled job sends during the delivery hour itself
// (worker scheduled/sendDailyReviewEmails.ts), so once that hour has begun
// today's email is out or on its way and the next one is tomorrow's.
export function nextDeliveryLabel(sendHourLocal: number, clock: ZoneClock): string {
  return `${clock.hour < sendHourLocal ? "today" : "tomorrow"} ${hourLabel(sendHourLocal)}`;
}

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
