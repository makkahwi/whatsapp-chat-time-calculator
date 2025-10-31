#!/usr/bin/env node

// WhatsApp chat time reports (daily, monthly, overall) with robust parsing.
// Usage:
//   node whatsapp-chat-time.js <chat.txt> [--gap=5] [--mdy|--dmy] [--count-by=start|presence]

const fs = require("fs");
const path = require("path");

// ---- CLI ----
const args = process.argv.slice(2);
if (!args.length) {
  console.error(
    "Usage: node whatsapp-chat-time.js <chat.txt> [--gap=5] [--mdy|--dmy] [--count-by=start|presence]"
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

const COUNT_BY = (() => {
  const a = args.find((a) => a.startsWith("--count-by="));
  const v = a ? a.split("=")[1].toLowerCase() : "start";
  return v === "presence" ? "presence" : "start"; // default safe
})();

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
function fmtDur(ms) {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60),
    m = mins % 60;
  return `${h}h ${m}m`;
}
function dayKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function monthKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// Strict date: build and verify all fields (prevents rollover)
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

// Timestamped line regex (Android export):
// "9/28/25, 10:20 AM - Name: Text"  OR  "28/9/2025, 22:43 - Name: Text"
// Accepts unicode dash and optional comma.
const LINE_RE =
  /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?:\s?(AM|PM))?\s*[-–]\s*(.*)$/i;

function parseLine(line, dateOrder /* "mdy"|"dmy" */) {
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
  )
    return null;

  if (year < 100) year += 2000;
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

// Decide MDY vs DMY by voting, with options to force
function detectDateOrder(lines) {
  if (FORCE_MDY) return "mdy";
  if (FORCE_DMY) return "dmy";
  let mdy = 0,
    dmy = 0;
  for (const raw of lines) {
    const line = normalizeDigits(stripWeirdSpaces(raw));
    const m = line.match(LINE_RE);
    if (!m) continue;
    const a = parseInt(m[1], 10),
      b = parseInt(m[2], 10);
    if (b > 12 && a <= 12) mdy++;
    else if (a > 12 && b <= 12) dmy++;
  }
  if (mdy > dmy) return "mdy";
  if (dmy > mdy) return "dmy";
  const hasAmPm = lines.some((l) => /(?:\sAM|\sPM)\s*[-–]\s/.test(l));
  return hasAmPm ? "mdy" : "dmy";
}

function parseChat(allLines) {
  const dateOrder = detectDateOrder(allLines);
  const msgs = [];
  const rejected = [];
  for (const raw of allLines) {
    const line = normalizeDigits(stripWeirdSpaces(raw));
    const msg = parseLine(line, dateOrder);
    if (msg) msgs.push(msg);
    else if (LINE_RE.test(line) && rejected.length < 5) rejected.push(line);
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

// Split session by day to apportion durations precisely
function splitSessionByDay(s) {
  const parts = [];
  let start = s.start.getTime();
  const end = s.end.getTime();
  if (start === end) {
    parts.push({ day: dayKey(s.start), ms: 0 });
    return parts;
  }
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
  return parts;
}

// ---- Run ----
const raw = fs.readFileSync(path.resolve(filePath), "utf8");
const lines = raw.replace(/\r\n/g, "\n").split("\n");

const { msgs, dateOrder, rejected } = parseChat(lines);
const sessions = groupSessions(msgs, GAP_MIN);

// Aggregations
const perDayDur = new Map(); // YYYY-MM-DD -> ms
const perDayCount = new Map(); // YYYY-MM-DD -> sessions count
const perMonthDur = new Map(); // YYYY-MM -> ms
const perMonthCount = new Map(); // YYYY-MM -> sessions count

for (const s of sessions) {
  // Durations (split by day, then fold to month):
  const parts = splitSessionByDay(s);
  for (const p of parts) {
    perDayDur.set(p.day, (perDayDur.get(p.day) || 0) + p.ms);
    const [y, m, d] = p.day.split("-");
    const mk = `${y}-${m}`;
    perMonthDur.set(mk, (perMonthDur.get(mk) || 0) + p.ms);
  }

  // Counts (by strategy)
  if (COUNT_BY === "presence") {
    // Count session in each day/month it touches
    const seenDays = new Set(parts.map((p) => p.day));
    for (const d of seenDays) {
      perDayCount.set(d, (perDayCount.get(d) || 0) + 1);
      const [y, m] = d.split("-");
      const mk = `${y}-${m}`;
      perMonthCount.set(mk, (perMonthCount.get(mk) || 0) + 1);
    }
  } else {
    // "start": Count only on the start day/month
    const dkey = dayKey(s.start);
    perDayCount.set(dkey, (perDayCount.get(dkey) || 0) + 1);
    const mkey = monthKey(s.start);
    perMonthCount.set(mkey, (perMonthCount.get(mkey) || 0) + 1);
  }
}

const overallMs = sessions.reduce((sum, s) => sum + (s.end - s.start), 0);

// ---- Output ----
console.log(`\n=== WhatsApp Chat Time Calculator ===`);
console.log(`\nFile: ${path.basename(filePath)}`);
console.log(
  `Detected date order: ${dateOrder.toUpperCase()} ${
    FORCE_MDY || FORCE_DMY ? "(forced)" : ""
  }`
);
console.log(`Gap threshold: ${GAP_MIN} minute(s)`);
console.log(`Conversation count method: ${COUNT_BY}\n`);

if (rejected.length) {
  console.log(
    `Note: ${rejected.length} example timestamp-like line(s) were rejected (strict date check):`
  );
  for (const ex of rejected) console.log("  • " + ex);
  console.log("");
}

// 1) Daily report
console.log("=== Daily Report ===");
[...new Set([...perDayDur.keys(), ...perDayCount.keys()])]
  .sort((a, b) => a.localeCompare(b))
  .forEach((day) => {
    const ms = perDayDur.get(day) || 0;
    const cnt = perDayCount.get(day) || 0;
    const mins = Math.round(ms / 60000);
    console.log(
      `  ${day}  |  conversations: ${cnt
        .toString()
        .padStart(3)}  |  duration: ${fmtDur(ms)}  (${mins} min)`
    );
  });
console.log("");

// 2) Monthly report
console.log("=== Monthly Report ===");
[...new Set([...perMonthDur.keys(), ...perMonthCount.keys()])]
  .sort((a, b) => a.localeCompare(b))
  .forEach((mk) => {
    const ms = perMonthDur.get(mk) || 0;
    const cnt = perMonthCount.get(mk) || 0;
    const mins = Math.round(ms / 60000);
    console.log(
      `  ${mk}      |  conversations: ${cnt
        .toString()
        .padStart(3)}  |  duration: ${fmtDur(ms)}  (${mins} min)`
    );
  });
console.log("");

// 3) Overall totals
const overallMins = Math.round(overallMs / 60000);
console.log("=== All File Totals ===");
console.log(`  conversations: ${sessions.length}`);
console.log(`  total duration: ${fmtDur(overallMs)}  (${overallMins} min)\n`);

// Uncomment to debug each session:
// sessions.forEach((s,i)=>{
//   console.log(`  #${i+1}  ${s.start.toISOString()}  →  ${s.end.toISOString()}  |  ${fmtDur(s.end - s.start)}  |  ${s.count} msg(s)`);
// });
