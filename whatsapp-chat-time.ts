#!/usr/bin/env node

// Node.js script: compute WhatsApp chat time by sessions (gap < N minutes),
// aggregate per day, and overall total. Robust to MDY/DMY and rejects rollover dates.

const fs = require("fs");
const path = require("path");

// ---- CLI ----
const args = process.argv.slice(2);
if (!args.length) {
  console.error(
    "Usage: node whatsapp-chat-time.js <chat.txt> [--gap=5] [--mdy|--dmy]"
  );
  process.exit(1);
}
const filePath = args.find((a) => !a.startsWith("--"));
const GAP_MIN = (() => {
  const a = args.find((a) => a.startsWith("--gap="));
  const n = a ? parseInt(a.split("=")[1], 10) : 5;
  return Number.isFinite(n) && n >= 0 ? n : 5;
})();
const FORCE_MDY = args.includes("--mdy");
const FORCE_DMY = args.includes("--dmy");

// ---- Helpers ----
const arabicIndicMap = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "٫": ".",
  "٬": ",",
};
function normalizeDigits(s) {
  return s.replace(
    /[\u0660-\u0669\u066B\u066C]/g,
    (ch) => arabicIndicMap[ch] ?? ch
  );
}
function stripWeirdSpaces(s) {
  // remove RTL marks & narrow/nb spaces
  return s.replace(/[\u200E\u200F\u202F\u00A0]/g, " ");
}
function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}
function fmtDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate()
  )} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtDur(ms) {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60),
    m = mins % 60;
  return `${h}h ${m}m`;
}
function dayKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Strict date: build and then verify no rollover occurred
function makeStrictLocalDate(y, m, d, hh, mm) {
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d ||
    dt.getHours() !== hh ||
    dt.getMinutes() !== mm
  )
    return null;
  return dt;
}

// Accept both:
//  "9/28/25, 10:20 AM - Name: Text"
//  "28/9/2025, 22:43 - Name: Text"
// Unicode dash accepted; comma after date optional.
const LINE_RE =
  /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?:\s?(AM|PM))?\s*[-–]\s*(.*)$/i;

function parseLine(line, dateOrder /* "mdy" | "dmy" */) {
  const m = line.match(LINE_RE);
  if (!m) return null;

  let n1 = parseInt(m[1], 10);
  let n2 = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  let hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  const ampm = (m[6] || "").toUpperCase();
  const rest = m[7] || "";

  if (
    !Number.isFinite(n1) ||
    !Number.isFinite(n2) ||
    !Number.isFinite(year) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  // Year normalize
  if (year < 100) year += 2000;

  // 12h -> 24h
  if (ampm === "AM" && hour === 12) hour = 0;
  if (ampm === "PM" && hour < 12) hour += 12;

  let month, day;
  if (dateOrder === "mdy") {
    month = n1;
    day = n2;
  } else {
    day = n1;
    month = n2;
  }

  // Strict bounds check before constructing date
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const ts = makeStrictLocalDate(year, month, day, hour, minute);
  if (!ts) return null;

  // Extract sender + text (optional)
  let sender, text;
  const idx = rest.indexOf(": ");
  if (idx > -1) {
    sender = rest.slice(0, idx).trim();
    text = rest.slice(idx + 2);
  } else {
    text = rest.trim();
  }

  return { ts, sender, text };
}

// Try to detect date order by sampling lines.
// Heuristic votes: if n2>12 and n1<=12 -> MDY vote; if n1>12 and n2<=12 -> DMY vote.
// If tie/ambiguous -> default to MDY if any line uses AM/PM + looks US-like; else DMY.
function detectDateOrder(lines) {
  let votesMDY = 0,
    votesDMY = 0,
    checked = 0;
  for (const raw of lines) {
    const line = normalizeDigits(stripWeirdSpaces(raw));
    const m = line.match(LINE_RE);
    if (!m) continue;
    checked++;
    const a = parseInt(m[1], 10),
      b = parseInt(m[2], 10);
    if (b > 12 && a <= 12) votesMDY++;
    else if (a > 12 && b <= 12) votesDMY++;
  }
  if (FORCE_MDY) return "mdy";
  if (FORCE_DMY) return "dmy";
  if (votesMDY > votesDMY) return "mdy";
  if (votesDMY > votesMDY) return "dmy";

  // fallback: if there are AM/PM occurrences, lean MDY (common in US-style exports)
  const hasAmPm = lines.some((l) => /(?:\sAM|\sPM)\s*[-–]\s/.test(l));
  return hasAmPm ? "mdy" : "dmy";
}

function parseChat(allLines) {
  const dateOrder = detectDateOrder(allLines);
  const msgs = [];
  const rejected = [];
  for (const rawLine of allLines) {
    const line = normalizeDigits(stripWeirdSpaces(rawLine));
    const msg = parseLine(line, dateOrder);
    if (msg) msgs.push(msg);
    else {
      // keep a few examples of rejected lines that looked like timestamps
      if (LINE_RE.test(line) && rejected.length < 5) rejected.push(line);
    }
  }
  msgs.sort((a, b) => a.ts - b.ts);
  return { msgs, dateOrder, rejected };
}

function groupSessions(msgs, gapMin) {
  if (!msgs.length) return [];
  const th = gapMin * 60 * 1000;
  const out = [];
  let cur = { start: msgs[0].ts, end: msgs[0].ts, count: 1 };
  for (let i = 1; i < msgs.length; i++) {
    const prev = msgs[i - 1].ts.getTime();
    const curr = msgs[i].ts.getTime();
    if (curr - prev < th) {
      cur.end = msgs[i].ts;
      cur.count++;
    } else {
      out.push(cur);
      cur = { start: msgs[i].ts, end: msgs[i].ts, count: 1 };
    }
  }
  out.push(cur);
  return out;
}

function splitSessionByDay(s) {
  const parts = [];
  let start = s.start.getTime();
  const end = s.end.getTime();
  while (start < end) {
    const d = new Date(start);
    const midnight = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + 1
    ).getTime();
    const sliceEnd = Math.min(end, midnight);
    parts.push({ day: dayKey(new Date(start)), ms: sliceEnd - start });
    start = sliceEnd;
  }
  // Single-message sessions have 0 duration; still count on its day as 0ms.
  if (parts.length === 0) parts.push({ day: dayKey(s.start), ms: 0 });
  return parts;
}

// ---- Run ----
const raw = fs.readFileSync(path.resolve(filePath), "utf8");
const lines = raw.replace(/\r\n/g, "\n").split("\n");

const { msgs, dateOrder, rejected } = parseChat(lines);
const sessions = groupSessions(msgs, GAP_MIN);

// Per-day totals
const perDay = new Map();
for (const s of sessions) {
  for (const p of splitSessionByDay(s)) {
    perDay.set(p.day, (perDay.get(p.day) || 0) + p.ms);
  }
}
const overallMs = sessions.reduce((sum, s) => sum + (s.end - s.start), 0);

// ---- Output ----
console.log(`\nFile: ${path.basename(filePath)}`);
console.log(
  `Detected date order: ${dateOrder.toUpperCase()}  ${
    FORCE_MDY || FORCE_DMY ? "(forced)" : ""
  }`
);
console.log(`Messages parsed: ${msgs.length}`);
console.log(`Sessions (gap < ${GAP_MIN} min): ${sessions.length}`);
console.log(
  `Overall total chat time: ${fmtDur(overallMs)}  (${Math.round(
    overallMs / 60000
  )} minutes)\n`
);

if (rejected.length) {
  console.log(
    `Note: ${rejected.length} example timestamp-like line(s) were rejected due to invalid dates (no rollover allowed):`
  );
  for (const ex of rejected) console.log("  • " + ex);
  console.log("");
}

console.log("Per-day totals:");
[...perDay.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .forEach(([day, ms]) => {
    const mins = Math.round(ms / 60000);
    console.log(`  ${day}: ${fmtDur(ms)}  (${mins} min)`);
  });

// Uncomment to list sessions for debugging:
/*
console.log("\nSessions:");
sessions.forEach((s, i) => {
  console.log(`  #${i+1}  ${fmtDate(s.start)}  →  ${fmtDate(s.end)}  |  ${fmtDur(s.end - s.start)}  |  ${s.count} msg(s)`);
});
*/
