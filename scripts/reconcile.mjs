// GovAgenda weekly reconcile — checks the registry against the city's own word, not
// against itself. Nothing else does this: refresh.mjs asks a model to find what's NEW;
// this asks "does what we already published still match belleislefl.gov/meetings?"
//
// Built after a day (2026-09-21) where every fault shared one shape: the pipeline filled
// a gap with an assumption instead of leaving it visibly empty. A past date with no status
// became "held". A stale archive showed no warning. This is the check that catches that
// class of error going forward — so it deliberately does NOT ask a model anything. A
// checker that shares the blind spot of the thing it checks is decoration.
//
// Runs from the existing weekly mode (see refresh.yml) — no new cron, no new workflow.
// Deterministic, Node 20 global fetch, zero dependencies. Always exits 0: this reports,
// it never fails the job, and a page it can't parse stands down rather than crying wolf.
//
//   node scripts/reconcile.mjs             — real run (needs network + optionally GITHUB_TOKEN)
//   node scripts/reconcile.mjs --selftest  — offline, assertion-based, no network

import { readFileSync } from 'node:fs';

const CALENDAR_URL = 'https://www.belleislefl.gov/meetings';
const MEETINGS_PATH = 'data/meetings.json';
const ISSUE_LABEL = 'calendar-mismatch';

// --- parsing -----------------------------------------------------------------------
//
// The city's calendar page renders each meeting as a line shaped like:
//   09/01/2026 - 6:30pm City Council Meeting - Rescheduled to September 9
//   08/13/2026 - 12:00pm Code Enforcement Hearing - Canceled
// but has also shipped with the title wrapped to the next line instead of trailing the
// time on the same line. Both are handled below. Only an explicit "- Canceled" or
// "- Rescheduled to ..." suffix on the CITY'S OWN row counts as status evidence — a date
// having passed with no marker is not evidence of anything (that was the bug).

const ROW_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)\s*(.*)$/i;
const CANCELED_RE = /-\s*Canceled\s*$/i;
const RESCHEDULED_RE = /-\s*Rescheduled to\s+(.+)$/i;

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

// Strip tags to plain lines: block-level elements become line breaks so a wrapped title
// still lands on its own line rather than being glued to the next row.
function htmlToLines(html) {
  const text = html
    .replace(/<(br|\/p|\/li|\/div|\/tr|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '\n');
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function splitMarker(rest) {
  const canceled = CANCELED_RE.exec(rest);
  if (canceled) return { title: rest.slice(0, canceled.index).trim(), marker: 'canceled', target: null };
  const rescheduled = RESCHEDULED_RE.exec(rest);
  if (rescheduled) {
    return {
      title: rest.slice(0, rest.length - rescheduled[0].length).trim(),
      marker: 'rescheduled',
      target: rescheduled[1].trim(),
    };
  }
  return { title: rest.trim(), marker: null, target: null };
}

// lines -> [{ date: 'YYYY-MM-DD', title, marker: null|'canceled'|'rescheduled', target }]
export function parseCalendarLines(lines) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ROW_RE.exec(lines[i]);
    if (!m) continue;
    const [, mm, dd, yyyy, , rest] = m;
    const date = `${yyyy}-${mm}-${dd}`;
    // Same-line layout: title trails the time. Next-line layout: this row is bare
    // ("MM/DD/YYYY - H:MMam/pm" with nothing after), so the title is the next line.
    const source = rest && rest.length > 0 ? rest : (lines[i + 1] || '');
    const { title, marker, target } = splitMarker(source);
    if (!title) continue;
    rows.push({ date, title, marker, target });
  }
  return rows;
}

// --- diff ----------------------------------------------------------------------------
//
// Matches on DATE ONLY, deliberately — no fuzzy title matching. A checker that guesses
// can be wrong in the same confident way the pipeline was.

export function diff(cityRows, localMeetings) {
  const findings = [];
  const localByDate = new Map();
  for (const m of localMeetings) {
    if (!localByDate.has(m.date)) localByDate.set(m.date, []);
    localByDate.get(m.date).push(m);
  }

  for (const row of cityRows) {
    const local = localByDate.get(row.date) || [];
    if (local.length === 0) {
      findings.push(`MISSING — ${row.date}: city lists "${row.title}", nothing in the registry that day.`);
      continue;
    }
    if (row.marker === 'canceled') {
      const wrong = local.filter((m) => m.status !== 'canceled');
      for (const m of wrong) {
        findings.push(
          `FALSE STATUS — ${row.date} "${m.title}": registry says "${m.status}", city says Canceled.`
        );
      }
    } else if (row.marker === 'rescheduled') {
      const wrong = local.filter((m) => m.status !== 'rescheduled');
      for (const m of wrong) {
        findings.push(
          `FALSE STATUS — ${row.date} "${m.title}": registry says "${m.status}", city says Rescheduled to ${row.target}.`
        );
      }
    }
    // No marker on the city's row → nothing to flag, whatever the registry says.
  }
  return findings;
}

// --- GitHub issue sync -----------------------------------------------------------------

async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} -> ${res.status}`);
  return res.json();
}

async function syncIssue(findings) {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
    console.log('(no GITHUB_TOKEN/GITHUB_REPOSITORY — skipping issue sync)');
    return;
  }
  const open = await gh(`/issues?state=open&labels=${ISSUE_LABEL}`);

  if (findings.length === 0) {
    for (const issue of open) {
      await gh(`/issues/${issue.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: 'Reconciled clean — the registry now matches the city calendar.' }),
      });
      await gh(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
    }
    return;
  }

  const body = [
    `Weekly reconcile against ${CALENDAR_URL} found ${findings.length} mismatch(es):`,
    '',
    ...findings.map((f) => `- ${f}`),
    '',
    'A data mismatch, not a broken pipeline — the refresh itself ran fine.',
  ].join('\n');

  if (open.length === 0) {
    await gh('/issues', {
      method: 'POST',
      body: JSON.stringify({ title: 'Calendar reconcile found mismatches', body, labels: [ISSUE_LABEL] }),
    });
  } else {
    // One living issue, rewritten each week, rather than a pile of comments.
    await gh(`/issues/${open[0].number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    await gh(`/issues/${open[0].number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: `Still mismatched as of this week's run.\n\n${body}` }),
    });
  }
}

// --- run -------------------------------------------------------------------------------

async function main() {
  let html;
  try {
    const res = await fetch(CALENDAR_URL);
    if (!res.ok) throw new Error(`fetch -> ${res.status}`);
    html = await res.text();
  } catch (e) {
    console.log(`Could not reach ${CALENDAR_URL} (${e.message}) — standing down, not reporting a mismatch.`);
    return;
  }

  const cityRows = parseCalendarLines(htmlToLines(html));
  if (cityRows.length === 0) {
    console.log('No meeting rows parsed from the calendar page — standing down, not reporting a mismatch.');
    console.log('(The page layout may have changed; this needs a human look, not a false "calendar vanished" alert.)');
    return;
  }

  const { meetings } = JSON.parse(readFileSync(MEETINGS_PATH, 'utf8'));
  const findings = diff(cityRows, meetings);

  if (findings.length === 0) {
    console.log(`Reconciled clean — ${cityRows.length} city rows, no mismatches.`);
  } else {
    console.log(`${findings.length} mismatch(es):`);
    for (const f of findings) console.log(`  ${f}`);
  }

  await syncIssue(findings);
}

// --- selftest ----------------------------------------------------------------------------

function selftest() {
  let failures = 0;
  const check = (name, cond) => {
    if (!cond) {
      failures++;
      console.error(`FAIL: ${name}`);
    }
  };

  // Same-line layout, canceled marker, entity decoding.
  const sameLine = parseCalendarLines(
    htmlToLines('<div>08/13/2026 - 12:00pm Code Enforcement Hearing - Canceled</div>')
  );
  check('same-line layout parses one row', sameLine.length === 1);
  check('same-line date', sameLine[0]?.date === '2026-08-13');
  check('same-line canceled marker', sameLine[0]?.marker === 'canceled');
  check('same-line title excludes marker', sameLine[0]?.title === 'Code Enforcement Hearing');

  // Next-line layout, rescheduled marker.
  const nextLine = parseCalendarLines(
    htmlToLines('<li>09/01/2026 - 6:30pm</li><li>City Council Meeting - Rescheduled to September 9</li>')
  );
  check('next-line layout parses one row', nextLine.length === 1);
  check('next-line rescheduled marker', nextLine[0]?.marker === 'rescheduled');
  check('next-line rescheduled target', nextLine[0]?.target === 'September 9');

  // Entity decoding on a plain (unmarked) row.
  const plain = parseCalendarLines(htmlToLines('<p>08/25/2026 - 6:30pm Planning &amp; Zoning Board Meeting</p>'));
  check('entity decoding', plain[0]?.title === 'Planning & Zoning Board Meeting');
  check('plain row has no marker', plain[0]?.marker === null);

  // held-vs-canceled catch.
  const heldVsCanceled = diff(
    [{ date: '2026-08-13', title: 'Code Enforcement Hearing', marker: 'canceled', target: null }],
    [{ date: '2026-08-13', title: 'Code Enforcement Hearing', status: 'held' }]
  );
  check('catches false held-vs-canceled', heldVsCanceled.length === 1 && heldVsCanceled[0].includes('FALSE STATUS'));

  // missing-meeting catch.
  const missing = diff(
    [{ date: '2026-09-07', title: 'Special Events Committee Meeting', marker: null, target: null }],
    []
  );
  check('catches missing meeting', missing.length === 1 && missing[0].includes('MISSING'));

  // must-NOT-flag: unmarked city row matching a held local record.
  const clean = diff(
    [{ date: '2026-02-03', title: 'City Council Meeting', marker: null, target: null }],
    [{ date: '2026-02-03', title: 'City Council Meeting', status: 'held' }]
  );
  check('does not flag a normal match', clean.length === 0);

  if (failures > 0) {
    console.error(`${failures} selftest failure(s).`);
    process.exitCode = 1;
  } else {
    console.log('selftest OK.');
  }
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  main().catch((e) => {
    // Reconcile reports; it never fails the job. Log and exit 0 regardless.
    console.log(`reconcile.mjs error (non-fatal): ${e.message}`);
  });
}
