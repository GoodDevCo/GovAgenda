// GovAgenda — meetings registry sync.
//
// `data/meetings.json` is the canonical list of every public meeting GovAgenda has a record of.
// This script keeps it honest and current without any manual bookkeeping:
//
//   1. Derives meeting records from every timeline entry in data/topic-archive.json, so any
//      meeting referenced by a tracked topic is guaranteed to exist on the calendar.
//   2. Re-links topicIds on every run (a meeting shows what tracked topics were on its agenda).
//   3. Enriches records with agenda/minutes URLs found in the topics' source links.
//   4. Regenerates PROJECTED future meetings from each body's published cadence — these carry
//      confirmed:false, render as "Expected" on the site, and are replaced automatically the
//      moment a confirmed record for that date appears.
//
// Confirmed records are APPEND-ONLY: this script never deletes or rewrites one (it only fills in
// blanks). Only projections are regenerated.
//
// Pure Node 20, no deps.  Run: `node scripts/sync-meetings.mjs [--dry-run]`
// Also run automatically by scripts/refresh.mjs after it merges new material.

import { readFileSync, writeFileSync } from 'node:fs';

const MEETINGS_PATH = 'data/meetings.json';
const ARCHIVE_PATH = 'data/topic-archive.json';
const DRY = process.argv.includes('--dry-run');

// How far ahead to project the regular schedule.
const PROJECT_MONTHS = 6;

const today = new Date().toISOString().slice(0, 10);

const reg = JSON.parse(readFileSync(MEETINGS_PATH, 'utf8'));
const arch = JSON.parse(readFileSync(ARCHIVE_PATH, 'utf8'));
reg.meetings ||= [];
reg.meta ||= {};
reg.meta.bodies ||= [];

const bodies = reg.meta.bodies;
const bodyByName = new Map(bodies.map((b) => [b.name.toLowerCase(), b]));
const bodyById = new Map(bodies.map((b) => [b.id, b]));

const log = [];

// ---- helpers ---------------------------------------------------------------

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const dateLabel = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${MONTHS[+m - 1]} ${+d}, ${y}`;
};

// Map a free-text meeting name from the topic archive onto a known body + kind.
function classify(meetingName) {
  const s = String(meetingName || '').toLowerCase();
  let body = 'City Council';
  if (s.includes('budget committee')) body = 'Budget Committee';
  else if (s.includes('planning') || s.includes('zoning') || s.includes('p&z')) body = 'Planning & Zoning Board';
  else if (s.includes('code enforcement')) body = 'Code Enforcement';
  else if (s.includes('tree')) body = 'Tree Advisory Board';
  else if (s.includes('special events')) body = 'Special Events Committee';
  else if (s.includes('police advisory')) body = 'Police Advisory Board';

  let kind = 'Regular';
  if (s.includes('workshop')) kind = 'Workshop';
  else if (s.includes('trim') || s.includes('public hearing') || s.includes('budget hearing')) kind = 'Public hearing';
  else if (s.includes('special') && body === 'City Council') kind = 'Special';
  else if (body === 'Code Enforcement' || s.includes('hearing')) kind = 'Hearing';
  return { body, kind };
}

const KIND_SUFFIX = { Regular: '', Hearing: '', Workshop: '-workshop', Special: '-special',
                      'Public hearing': '-hearing', 'Public meeting': '-public', Event: '-event', Closure: '-closure' };

function slugForBody(name) {
  const b = bodyByName.get(String(name).toLowerCase());
  if (b) return b.id;
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
const meetingId = (date, body, kind) => `${date}-${slugForBody(body)}${KIND_SUFFIX[kind] || ''}`;

// nth weekday of a month, e.g. nthWeekday(2026, 7, 2, 3) -> 3rd Tuesday of July 2026 (weekday 0=Sun)
function nthWeekday(year, month /*1-12*/, weekday, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + shift + (nth - 1) * 7;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null; // month doesn't have that nth weekday
  return d.toISOString().slice(0, 10);
}

// ---- 1. wipe projections (they are always regenerated) ---------------------

const before = reg.meetings.length;
reg.meetings = reg.meetings.filter((m) => m.confirmed !== false);
if (before !== reg.meetings.length) log.push(`- cleared ${before - reg.meetings.length} projected meeting(s)`);

const byId = new Map(reg.meetings.map((m) => [m.id, m]));
// index of confirmed meetings by date+body, so archive-derived records match calendar records
const confirmedKey = (date, body) => `${date}::${slugForBody(body)}`;
const confirmedByDateBody = new Map();
for (const m of reg.meetings) {
  const k = confirmedKey(m.date, m.body);
  if (!confirmedByDateBody.has(k)) confirmedByDateBody.set(k, []);
  confirmedByDateBody.get(k).push(m);
}

// ---- 2. derive / enrich from the topic archive ----------------------------

const AGENDA_RE = /MEET-Agenda-/i;
const MINUTES_RE = /MEET-Minutes-/i;
const PACKET_RE = /MEET-Packet-/i;

// reset the derived link so a removed topic can't leave a stale association behind
for (const m of reg.meetings) m.topicIds = [];

for (const t of arch.topics || []) {
  for (const e of t.timeline || []) {
    const { body, kind } = classify(e.meeting);
    const candidates = confirmedByDateBody.get(confirmedKey(e.date, body)) || [];
    // Prefer an exact kind match; otherwise the first record for that body that day.
    let m = candidates.find((c) => c.kind === kind) || candidates[0];

    if (!m) {
      m = {
        id: meetingId(e.date, body, kind),
        date: e.date,
        time: null,
        timeConfirmed: false,
        body,
        kind,
        title: `${body}${kind === 'Regular' ? ' Meeting' : ` — ${kind}`}`,
        status: e.date < today ? 'held' : 'scheduled',
        confirmed: true,
        source: 'archive',
        location: reg.meta.defaultLocation || null,
        agendaUrl: null, packetUrl: null, minutesUrl: null, videoUrl: null,
        topicIds: [],
        note: 'Derived from a tracked topic’s record; not yet matched to the city’s published calendar entry.',
        calendarUrl: reg.meta.calendarUrl || null,
      };
      // A date that lands exactly on the body's regular cadence gets that body's usual start
      // time, flagged as unconfirmed so the site can say "usual start time".
      const b = bodyById.get(slugForBody(body));
      if (b && b.cadence) {
        const [y, mo] = e.date.split('-').map(Number);
        const hit = (b.cadence.nth || []).some((n) => nthWeekday(y, mo, b.cadence.weekday, n) === e.date);
        if (hit) { m.time = b.cadence.time; m.timeConfirmed = false; }
      }
      reg.meetings.push(m);
      byId.set(m.id, m);
      const k = confirmedKey(m.date, m.body);
      if (!confirmedByDateBody.has(k)) confirmedByDateBody.set(k, []);
      confirmedByDateBody.get(k).push(m);
      log.push(`+ meeting ${m.id} (from topic ${t.id})`);
    }

    if (!m.topicIds.includes(t.id)) m.topicIds.push(t.id);

    // Fill in document links we learn from the topic's sources (never overwrite an existing one).
    for (const l of e.links || []) {
      if (!l || !l.url) continue;
      if (!m.agendaUrl && AGENDA_RE.test(l.url)) { m.agendaUrl = l.url; log.push(`~ ${m.id} agenda link`); }
      if (!m.packetUrl && PACKET_RE.test(l.url)) { m.packetUrl = l.url; log.push(`~ ${m.id} packet link`); }
      if (!m.minutesUrl && MINUTES_RE.test(l.url)) { m.minutesUrl = l.url; log.push(`~ ${m.id} minutes link`); }
    }
  }
}

// ---- 3. advance status of past meetings ------------------------------------

for (const m of reg.meetings) {
  if (m.date < today && m.status === 'scheduled') { m.status = 'held'; log.push(`~ ${m.id} scheduled → held`); }
  m.topicIds.sort();
  if (!m.dateLabel) m.dateLabel = dateLabel(m.date);
}

// ---- 4. regenerate projections from each body's cadence --------------------

const start = new Date(today + 'T00:00:00Z');
const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + PROJECT_MONTHS);
const endIso = end.toISOString().slice(0, 10);

let projected = 0;
for (const b of bodies) {
  if (!b.project || !b.cadence) continue;
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur.toISOString().slice(0, 10) <= endIso) {
    const y = cur.getUTCFullYear(), mo = cur.getUTCMonth() + 1;
    for (const n of b.cadence.nth || []) {
      const iso = nthWeekday(y, mo, b.cadence.weekday, n);
      if (!iso || iso <= today || iso > endIso) continue;
      // Skip if the city (or the archive) already gives us a real meeting for this body that day.
      if ((confirmedByDateBody.get(confirmedKey(iso, b.name)) || []).length) continue;
      const id = `${iso}-${b.id}-expected`;
      if (byId.has(id)) continue;
      const m = {
        id, date: iso, dateLabel: dateLabel(iso),
        time: b.cadence.time, timeConfirmed: false,
        body: b.name, kind: b.defaultKind || 'Regular',
        title: b.defaultTitle || `${b.name} Meeting`,
        status: 'scheduled', confirmed: false, source: 'projected',
        location: reg.meta.defaultLocation || null,
        agendaUrl: null, packetUrl: null, minutesUrl: null, videoUrl: null,
        topicIds: [],
        note: `Expected from the regular schedule (${b.cadenceLabel}). Not yet posted on the city’s calendar — confirm before attending.`,
        calendarUrl: reg.meta.calendarUrl || null,
      };
      reg.meetings.push(m); byId.set(id, m); projected++;
    }
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
}
log.push(`+ ${projected} projected meeting(s) through ${endIso}`);

// ---- 5. write --------------------------------------------------------------

reg.meetings.sort((a, b) => (a.date === b.date
  ? String(a.time || '00:00').localeCompare(String(b.time || '00:00'))
  : a.date.localeCompare(b.date)));

// Only write when the substance actually changed. This script runs every day; stamping a fresh
// `lastSynced` on a no-op run would produce a daily commit (and a daily deploy) that says nothing.
const priorSynced = reg.meta.lastSynced;
delete reg.meta.lastSynced;
const body = JSON.stringify(reg, null, 2);
const priorBody = (() => {
  try {
    const p = JSON.parse(readFileSync(MEETINGS_PATH, 'utf8'));
    delete p.meta.lastSynced;
    return JSON.stringify(p, null, 2);
  } catch { return null; }
})();
const changed = body !== priorBody;
reg.meta.lastSynced = changed ? today : (priorSynced || today);

const summary = `Meetings sync: ${reg.meetings.length} total (${reg.meetings.filter((m) => m.confirmed !== false).length} confirmed, ${projected} expected)${changed ? '' : ' — no change'}.`;
if (DRY) {
  console.log('[DRY RUN] ' + summary + ' No file written.');
  console.log(log.join('\n'));
} else if (changed) {
  writeFileSync(MEETINGS_PATH, JSON.stringify(reg, null, 2) + '\n');
  console.log(summary);
  console.log(log.join('\n'));
} else {
  console.log(summary);
}
