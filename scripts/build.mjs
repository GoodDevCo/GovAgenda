// Build script: reads the canonical JSON archive + the HTML template,
// injects the data, and writes the self-contained page to public/index.html.
// Pure Node, no dependencies. Run: `node scripts/build.mjs`
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DATA_PATH = 'data/topic-archive.json';
const TPL_PATH = 'scripts/template.html';
const OUT_DIR = 'public';
const OUT_PATH = `${OUT_DIR}/index.html`;

const raw = readFileSync(DATA_PATH, 'utf8');

// Validate JSON before building so a bad commit fails the Action loudly.
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  console.error('ERROR: data/topic-archive.json is not valid JSON:', e.message);
  process.exit(1);
}
const topicCount = (parsed.topics || []).length;

// Guard the closing-tag sequence so the embedded JSON can't break out of the <script> block.
const safeJson = raw.replace(/<\/script>/gi, '<\\/script>');

const tpl = readFileSync(TPL_PATH, 'utf8');
if (!tpl.includes('__ARCHIVE_JSON__')) {
  console.error('ERROR: template is missing the __ARCHIVE_JSON__ placeholder.');
  process.exit(1);
}

// Use a replacer FUNCTION so `$` sequences in the data (e.g. "$300,000") are inserted
// literally and not interpreted as replacement patterns.
// Inline the logo as a data URI so the page stays a single self-contained file.
const logoUri = 'data:image/png;base64,' + readFileSync('assets/govagenda-logo.png').toString('base64');
const logoDarkUri = 'data:image/png;base64,' + readFileSync('assets/govagenda-logo-dark.png').toString('base64');

// Community feedback board data.
const communityRaw = readFileSync('data/community.json', 'utf8');
try { JSON.parse(communityRaw); } catch (e) {
  console.error('ERROR: data/community.json is not valid JSON:', e.message);
  process.exit(1);
}
const safeCommunity = communityRaw.replace(/<\/script>/gi, '<\\/script>');

// Meetings registry — the canonical calendar of every public meeting on record.
// Kept current by scripts/sync-meetings.mjs (run standalone or by scripts/refresh.mjs).
const meetingsRaw = readFileSync('data/meetings.json', 'utf8');
let meetingsParsed;
try { meetingsParsed = JSON.parse(meetingsRaw); } catch (e) {
  console.error('ERROR: data/meetings.json is not valid JSON:', e.message);
  process.exit(1);
}
const meetingCount = (meetingsParsed.meetings || []).length;
const safeMeetings = meetingsRaw.replace(/<\/script>/gi, '<\\/script>');

const html = tpl
  .replace('__ARCHIVE_JSON__', () => safeJson)
  .replace('__LOGO_DATA_URI__', () => logoUri)
  .replace('__LOGO_DARK_DATA_URI__', () => logoDarkUri)
  .replace('__COMMUNITY_JSON__', () => safeCommunity)
  .replace('__MEETINGS_JSON__', () => safeMeetings);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, html);

// Custom domain for GitHub Pages. Written into the published artifact so the
// domain persists across every Actions deploy.
writeFileSync(`${OUT_DIR}/CNAME`, 'govagenda.org\n');

// ---- Subscribable calendar feed -------------------------------------------
// public/calendar.ics is what the site's "Subscribe to calendar" link points at (via webcal://).
// It is regenerated on every deploy, so a subscriber's calendar picks up new meetings, new times
// and cancellations on its own — that is what makes it a subscription rather than a download.
// Only CONFIRMED meetings go in the feed: nobody should get a projected date pushed into their
// personal calendar as though the city had announced it.
const TZID = 'America/New_York';
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZID}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT',
  'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST',
  'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// RFC 5545: no content line over 75 OCTETS — note octets, not characters. An em dash is 3 bytes,
// so folding on character count silently produces 77-octet lines. Fold on encoded length instead,
// and never split a multi-byte character across the boundary.
const icsFold = (line) => {
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  if (bytes(line) <= 75) return line;
  const out = [];
  let cur = '', limit = 75;                       // first line 75, continuations 74 (+1 for the leading space)
  for (const ch of line) {                        // iterate by code point, not UTF-16 unit
    if (bytes(cur) + bytes(ch) > limit) { out.push(cur); cur = ''; limit = 74; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.join('\r\n ');
};
const ymd = (d) => d.replace(/-/g, '');
const plusHours = (date, time, hrs) => {
  const [h, mi] = String(time).split(':').map(Number);
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, mi || 0) + hrs * 3600000);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}T${z(d.getUTCHours())}${z(d.getUTCMinutes())}00`;
};
const nextDay = (date) => {
  const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};

const city = String(meetingsParsed.meta?.jurisdiction || '').replace(/^City of\s*/, '').replace(/,.*$/, '');
const feed = (meetingsParsed.meetings || []).filter((m) => m.confirmed !== false);
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GovAgenda//Meetings//EN', 'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH', `X-WR-CALNAME:${icsText((city ? city + ' ' : '') + 'public meetings')}`,
  `X-WR-CALDESC:${icsText('Public meetings tracked by GovAgenda — https://govagenda.org/')}`,
  `X-WR-TIMEZONE:${TZID}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'].concat(VTIMEZONE);

for (const m of feed) {
  const lines = ['BEGIN:VEVENT', `UID:${m.id}@govagenda.org`];
  if (m.time) {
    lines.push(`DTSTART;TZID=${TZID}:${ymd(m.date)}T${String(m.time).replace(':', '')}00`);
    lines.push(`DTEND;TZID=${TZID}:${plusHours(m.date, m.time, 2)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${ymd(m.date)}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(m.date)}`);
  }
  const desc = [];
  if (m.time && m.timeConfirmed === false) desc.push('Start time shown is this body\u2019s usual start time — confirm on the official agenda.');
  if (!m.time) desc.push('Start time not yet published — added as an all-day entry.');
  if (m.note) desc.push(m.note);
  if (m.agendaUrl) desc.push('Agenda: ' + m.agendaUrl);
  if (m.minutesUrl) desc.push('Minutes: ' + m.minutesUrl);
  if (m.calendarUrl) desc.push('City meeting calendar: ' + m.calendarUrl);
  desc.push('Tracked on GovAgenda — https://govagenda.org/');
  lines.push(`SUMMARY:${icsText((city ? city + ' — ' : '') + (m.title || m.body))}`);
  if (m.location) lines.push(`LOCATION:${icsText(m.location)}`);
  lines.push(`DESCRIPTION:${icsText(desc.join('\n'))}`);
  lines.push(m.status === 'canceled' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED');
  lines.push('END:VEVENT');
  ics.push(...lines);
}
ics.push('END:VCALENDAR');
writeFileSync(`${OUT_DIR}/calendar.ics`, ics.map(icsFold).join('\r\n') + '\r\n');

console.log(`Built ${OUT_PATH} — ${html.length} bytes, ${topicCount} topics, ${meetingCount} meetings.`);
console.log(`Built ${OUT_DIR}/calendar.ics — ${feed.length} confirmed meetings in the subscribable feed.`);
