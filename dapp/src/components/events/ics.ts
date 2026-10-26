// A one-event .ics file, so "Add to calendar" works with every calendar app
// (Google, Apple, Outlook) without an integration. Times are written in UTC.

const stamp = (sec: number) => new Date(sec * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// RFC 5545 text escaping: backslash, semicolon, comma, newline.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Lines over 75 octets are folded with CRLF + space.
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,73}/g)!.join("\r\n ");

export function buildIcs(e: {
  id: string; title: string; description: string; venueName: string;
  lat: number; lng: number; startsAt: number; endsAt: number; url: string;
}): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GoodDrops//Events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@gooddrops.xyz`,
    `DTSTAMP:${stamp(Math.floor(Date.now() / 1000))}`,
    `DTSTART:${stamp(e.startsAt)}`,
    `DTEND:${stamp(e.endsAt)}`,
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc(`${e.description ? `${e.description}\n\n` : ""}G$ drops unlock when it starts. ${e.url}`)}`,
    `LOCATION:${esc(e.venueName)}`,
    `GEO:${e.lat.toFixed(6)};${e.lng.toFixed(6)}`,
    `URL:${e.url}`,
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)} starts in an hour`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
