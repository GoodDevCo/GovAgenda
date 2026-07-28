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

console.log(`Built ${OUT_PATH} — ${html.length} bytes, ${topicCount} topics, ${meetingCount} meetings.`);
