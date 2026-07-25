// GovAgenda automated refresh — the "engine that keeps the record current."
//
// Runs on a schedule (see .github/workflows/refresh.yml). It:
//   1. Reads the canonical archive (data/topic-archive.json).
//   2. Asks Claude — with live web search — to find ONLY what is new since the
//      last recorded entry, straight from official Belle Isle / Orange County sources.
//   3. Merges the result APPEND-ONLY (never edits or deletes prior timeline entries),
//      behind hard guardrails (official-source-required, dedupe, schema validation).
//   4. Writes the file back. The workflow then rebuilds + deploys only if it changed.
//
// Pure Node 20 (global fetch, no npm deps). Env:
//   ANTHROPIC_API_KEY  (required)  — repo secret.
//   REFRESH_MODEL      (optional)  — model id; defaults below. Override to change models
//                                    without editing code.
//   REFRESH_MODE       (optional)  — "watch" (default) or "weekly". Weekly also writes a
//                                    week roll-up entry into `weeks`. The workflow sets this.
//   REFRESH_MAX_SEARCHES (optional)— cap on web searches per run (cost guardrail). Default 8.

import { readFileSync, writeFileSync } from 'node:fs';

const DATA_PATH = 'data/topic-archive.json';
const MODEL = process.env.REFRESH_MODEL || 'claude-sonnet-4-5';
const MODE = (process.env.REFRESH_MODE || 'watch').toLowerCase();
const MAX_SEARCHES = parseInt(process.env.REFRESH_MAX_SEARCHES || '8', 10);
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set. Nothing to do.');
  process.exit(1);
}

// ---- Guardrails ------------------------------------------------------------

// Only these hosts count as a primary/official source. Every new item MUST cite
// at least one. This is the neutrality + accuracy gate for fully-automatic publish.
const OFFICIAL_HOSTS = [
  'belleislefl.gov',
  'mccmeetings.blob.core.usgovcloudapi.net', // Belle Isle agenda/minutes/packet PDFs
  'library.municode.com',                    // codified ordinances
  'ocfl.net', 'orangecountyfl.net', 'orangecountyfl.gov',
  'ocpafl.org',                              // Orange County Property Appraiser
  'octaxcol.com',                            // Orange County Tax Collector
  'occompt.com',                             // Orange County Comptroller
  'ocfelections.gov', 'ocfelections.com',    // Supervisor of Elections
  'orlando.gov',
  'floridahealth.gov', 'myfloridahouse.gov', 'flsenate.gov', 'dos.fl.gov',
  'transparency.flocksafety.com',            // official transparency portals referenced in the data
];
const VALID_STATUS_CLASS = new Set(['s-amber', 's-teal', 's-slate']);

const isOfficial = (url) => {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return OFFICIAL_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  } catch { return false; }
};
const hasOfficialLink = (links) =>
  Array.isArray(links) && links.some((l) => l && typeof l.url === 'string' && isOfficial(l.url));

// ---- Load current state ----------------------------------------------------

const raw = readFileSync(DATA_PATH, 'utf8');
let data;
try { data = JSON.parse(raw); }
catch (e) { console.error('ERROR: archive is not valid JSON:', e.message); process.exit(1); }

data.topics ||= [];
data.weeks ||= [];

const topicById = new Map(data.topics.map((t) => [t.id, t]));
const existingWeekOf = new Set(data.weeks.map((w) => w.weekOf));

// Compact snapshot so the model knows exactly what already exists and returns only NEW material.
const snapshot = data.topics.map((t) => ({
  id: t.id,
  title: t.title,
  status: t.status,
  docNum: t.docNum || null,
  timeline: (t.timeline || []).map((e) => ({ date: e.date, meeting: e.meeting, event: e.event })),
}));

const today = new Date().toISOString().slice(0, 10);

// ---- Build the research instruction ---------------------------------------

const SYSTEM = `You are the automated research engine for GovAgenda, a neutral, bipartisan civic
tool that tracks the local government of the City of Belle Isle, Florida (a ~7,000-resident city
inside Orange County). Your job: find what is GENUINELY NEW in Belle Isle city government since the
records already on file, using official primary sources, and return it as strict JSON.

Rules that are non-negotiable (this publishes automatically with no human review):
- OFFICIAL SOURCES ONLY. Every item you return must link to a primary/official source: the city
  site (belleislefl.gov), the Belle Isle agenda/minutes/packet PDFs on
  mccmeetings.blob.core.usgovcloudapi.net, Municode, or an Orange County constitutional-officer site.
  Local news may inform you but is NOT an acceptable citation. If you cannot find an official source,
  DO NOT include the item.
- NEUTRAL, FACTUAL, NO OPINION. State what happened and who it affects in plain English. Never take a
  side. Commissioner remarks must be summarized or quoted faithfully from official minutes only.
- ONLY NEW MATERIAL. Do not repeat anything already in the provided snapshot (match on topic id +
  date + event). If a meeting has no minutes/agenda posted yet, return nothing for it.
- CORRECT ORDINANCE STATUS. Belle Isle ordinances require TWO readings to become law. First reading =
  not yet law. Only mark "Adopted" when minutes show a passing second-reading vote. Resolutions pass
  in a single vote.
- "the board"/"council" = Belle Isle FL City Council. Never Belle Isle Park in Michigan — discard it.
- When in doubt, omit. A small accurate update beats a padded or speculative one.`;

const schemaSpec = `Return ONLY a single JSON object (no prose, no markdown fences) with this shape:
{
  "asOf": "${today}",
  "newTopics": [
    {
      "id": "kebab-case-id", "title": "...", "category": "Budget|Land Use / Zoning|Public Safety|Governance|Infrastructure|Elections|Other",
      "docType": "Ordinance|Resolution" (omit if not a numbered doc), "docNum": "26-07" (omit if none),
      "status": "First reading|Pending 2nd reading|On agenda|Adopted|Approved|Awarded|Exploratory|Budgeted|In progress",
      "statusClass": "s-amber (in progress/pending) | s-teal (done/adopted/approved) | s-slate (early/exploratory)",
      "pinned": false, "updated": "YYYY-MM-DD", "summary": "1-3 neutral sentences.",
      "timeline": [ { "date":"YYYY-MM-DD","dateLabel":"Mon D, YYYY","meeting":"City Council|Budget Committee|...","event":"short headline","detail":"1-4 factual sentences","remarks":[{"who":"Comm. X","role":"Commissioner","text":"faithful quote/summary"}],"links":[{"label":"Jul 21 agenda →","url":"https://official..."}] } ]
    }
  ],
  "newTimelineEntries": [
    { "topicId": "existing-topic-id", "entry": { same entry shape as above } }
  ],
  "statusUpdates": [
    { "topicId": "existing-topic-id", "status": "Adopted", "statusClass": "s-teal", "updated": "YYYY-MM-DD" }
  ],
  "weekEntry": ${MODE === 'weekly'
    ? `{ "weekOf":"YYYY-MM-DD (Monday of the week just ended)","label":"Week of Mon D–D, YYYY","compiled":"${today}","intro":"1-2 sentence neutral overview","highlights":[{"topicId":"...","line":"one plain sentence"}] }`
    : 'null'}
}
Every newTopic and every newTimelineEntry.entry MUST contain at least one links[] item whose url is an
official source. statusUpdates must correspond to a change documented by a source you also add as a
newTimelineEntry for that same topic. If there is nothing new, return empty arrays and weekEntry ${MODE === 'weekly' ? 'as your best roll-up of the snapshot' : 'null'}.`;

const userMsg = `Today is ${today}. Mode: ${MODE}.
Here is the snapshot of what GovAgenda already has on file (do not repeat any of it):

${JSON.stringify(snapshot, null, 0)}

Research the City of Belle Isle, FL for anything new since these records — newly posted agendas,
minutes, packets, adopted ordinances/resolutions, budget/millage actions, public notices, and
upcoming meetings. Start from the city's official meeting portal and site. Then return the JSON.

${schemaSpec}`;

// ---- Call the API (server-side web search) ---------------------------------

async function callClaude() {
  const body = {
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }],
    messages: [{ role: 'user', content: userMsg }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${t.slice(0, 500)}`);
  }
  const json = await res.json();
  // Concatenate all final text blocks (web_search results are handled server-side).
  const text = (json.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text;
}

function extractJson(text) {
  // Be tolerant of accidental prose/fences: grab the outermost {...}.
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) throw new Error('No JSON object in model output.');
  return JSON.parse(text.slice(s, e + 1));
}

// ---- Validate + merge (append-only) ----------------------------------------

const validEntry = (en) =>
  en && typeof en.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(en.date) &&
  typeof en.event === 'string' && en.event.trim() &&
  typeof en.detail === 'string' && en.detail.trim() &&
  hasOfficialLink(en.links);

const normEntry = (en) => ({
  date: en.date,
  dateLabel: en.dateLabel || en.date,
  meeting: en.meeting || 'City Council',
  event: en.event.trim(),
  detail: en.detail.trim(),
  remarks: Array.isArray(en.remarks) ? en.remarks.filter((r) => r && r.who && r.text) : [],
  links: en.links.filter((l) => l && l.url && l.label),
});

const entryKey = (topicId, en) => `${topicId}::${en.date}::${(en.event || '').toLowerCase().trim()}`;
const seen = new Set();
for (const t of data.topics)
  for (const en of t.timeline || []) seen.add(entryKey(t.id, en));

let added = 0, skipped = 0;
const log = [];

async function main() {
  const text = await callClaude();
  let out;
  try { out = extractJson(text); }
  catch (e) { console.error('ERROR parsing model output:', e.message); console.error(text.slice(0, 800)); process.exit(1); }

  // 1) New topics (must be genuinely new ids; if id exists, route entries into it).
  for (const t of out.newTopics || []) {
    if (!t || !t.id || !t.title) { skipped++; continue; }
    const entries = (t.timeline || []).filter(validEntry).map(normEntry);
    if (!entries.length) { skipped++; log.push(`skip new topic ${t.id}: no sourced timeline entry`); continue; }
    if (topicById.has(t.id)) {
      // Collision → treat its entries as appends to the existing topic.
      for (const en of entries) {
        const k = entryKey(t.id, en);
        if (seen.has(k)) { skipped++; continue; }
        topicById.get(t.id).timeline.push(en); seen.add(k); added++;
      }
      continue;
    }
    const statusClass = VALID_STATUS_CLASS.has(t.statusClass) ? t.statusClass : 's-amber';
    const topic = {
      id: t.id, title: t.title,
      ...(t.docType ? { docType: t.docType } : {}),
      ...(t.docNum ? { docNum: t.docNum } : {}),
      category: t.category || 'Other',
      status: t.status || 'In progress',
      statusClass,
      pinned: false,
      updated: t.updated || today,
      summary: (t.summary || '').trim(),
      timeline: entries,
    };
    data.topics.push(topic);
    topicById.set(topic.id, topic);
    for (const en of entries) seen.add(entryKey(topic.id, en));
    added++; log.push(`+ new topic ${topic.id} (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})`);
  }

  // 2) New timeline entries on existing topics.
  for (const item of out.newTimelineEntries || []) {
    const t = item && topicById.get(item.topicId);
    if (!t) { skipped++; continue; }
    if (!validEntry(item.entry)) { skipped++; log.push(`skip entry on ${item.topicId}: invalid/unsourced`); continue; }
    const en = normEntry(item.entry);
    const k = entryKey(t.id, en);
    if (seen.has(k)) { skipped++; continue; }
    t.timeline.push(en); seen.add(k);
    if (en.date >= (t.updated || '')) t.updated = en.date;
    added++; log.push(`+ entry ${t.id} ${en.date} "${en.event}"`);
  }

  // 3) Status advances on existing topics (top-level status only; timeline never edited).
  //    Only honored if that topic also received a sourced new entry this run.
  const touchedThisRun = new Set(log.filter((l) => l.startsWith('+ entry ') || l.startsWith('+ new topic ')).map(() => true));
  for (const su of out.statusUpdates || []) {
    const t = su && topicById.get(su.topicId);
    if (!t || !su.status) { skipped++; continue; }
    const gotSourcedEntry = (out.newTimelineEntries || []).some((i) => i.topicId === su.topicId && validEntry(i.entry))
      || (out.newTopics || []).some((nt) => nt.id === su.topicId);
    if (!gotSourcedEntry) { skipped++; log.push(`skip status ${su.topicId}: no accompanying sourced entry`); continue; }
    t.status = su.status;
    if (VALID_STATUS_CLASS.has(su.statusClass)) t.statusClass = su.statusClass;
    t.updated = su.updated || today;
    log.push(`~ status ${t.id} → ${su.status}`);
  }

  // 4) Weekly roll-up (weekly mode only), append-only by weekOf.
  if (MODE === 'weekly' && out.weekEntry && out.weekEntry.weekOf) {
    if (!existingWeekOf.has(out.weekEntry.weekOf)) {
      const w = out.weekEntry;
      data.weeks.push({
        weekOf: w.weekOf,
        label: w.label || `Week of ${w.weekOf}`,
        compiled: w.compiled || today,
        intro: (w.intro || '').trim(),
        highlights: Array.isArray(w.highlights) ? w.highlights.filter((h) => h && h.topicId && h.line) : [],
      });
      added++; log.push(`+ week ${w.weekOf}`);
    }
  }

  // ---- Commit to disk only if something changed ----------------------------
  if (added === 0) {
    console.log(`No new material (skipped ${skipped}). Archive unchanged. Mode=${MODE}.`);
    console.log(log.join('\n'));
    process.exit(0);
  }

  // Keep topics sorted by most-recent activity (pinned first), matching how the site reads.
  data.meta.lastUpdated = today;
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`Refresh complete: ${added} added, ${skipped} skipped. Mode=${MODE}.`);
  console.log(log.join('\n'));
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
