/**
 * GovAgenda community backend — Cloudflare Worker + D1.
 *
 * Endpoints (all JSON):
 *   GET  /api/board            -> { votes: {id:count}, statuses: {id:status} }
 *   POST /api/vote   {id,voter} -> { id, votes, voted }   (toggles the voter's vote)
 *   POST /api/suggest {title,desc,voter} -> { ok: true }   (queues a new idea for review)
 *   POST /api/admin/status {id,status,key} -> { ok, id, status }  (admin only; key === env.ADMIN_KEY)
 *
 * Votes are deduped per (item, voter); "voter" is an anonymous id the browser
 * generates and stores locally — no login required. Item titles/descriptions/statuses
 * still live in data/community.json on the site; this service only holds live vote
 * counts and submitted ideas.
 */
const ALLOWED_ORIGINS = ['https://govagenda.org', 'https://www.govagenda.org'];

function headersFor(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
}
function json(obj, headers, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers });
}
function clean(s, max) { return String(s == null ? '' : s).slice(0, max); }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const headers = headersFor(req.headers.get('Origin') || '');
    if (req.method === 'OPTIONS') return new Response(null, { headers });

    try {
      if (url.pathname === '/api/board' && req.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT item_id, COUNT(*) AS votes FROM votes GROUP BY item_id'
        ).all();
        const votes = {};
        (rows.results || []).forEach((r) => { votes[r.item_id] = r.votes; });
        const srows = await env.DB.prepare('SELECT item_id, status FROM item_statuses').all();
        const statuses = {};
        (srows.results || []).forEach((r) => { statuses[r.item_id] = r.status; });
        return json({ votes, statuses }, headers);
      }

      if (url.pathname === '/api/vote' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const id = clean(body.id, 64);
        const voter = clean(body.voter, 64);
        if (!id || !voter) return json({ error: 'bad request' }, headers, 400);
        const existing = await env.DB.prepare(
          'SELECT 1 FROM votes WHERE item_id=? AND voter=?'
        ).bind(id, voter).first();
        if (existing) {
          await env.DB.prepare('DELETE FROM votes WHERE item_id=? AND voter=?').bind(id, voter).run();
        } else {
          await env.DB.prepare('INSERT INTO votes(item_id,voter,ts) VALUES(?,?,?)')
            .bind(id, voter, Date.now()).run();
        }
        const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM votes WHERE item_id=?')
          .bind(id).first();
        return json({ id, votes: c.n, voted: !existing }, headers);
      }

      if (url.pathname === '/api/suggest' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const title = clean(body.title, 140).trim();
        if (!title) return json({ error: 'title required' }, headers, 400);
        await env.DB.prepare(
          'INSERT INTO suggestions(title,descr,voter,ts,status) VALUES(?,?,?,?,?)'
        ).bind(title, clean(body.desc, 1000), clean(body.voter, 64), Date.now(), 'pending').run();
        return json({ ok: true }, headers);
      }

      if (url.pathname === '/api/admin/status' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        if (!env.ADMIN_KEY || clean(body.key, 200) !== env.ADMIN_KEY) {
          return json({ error: 'unauthorized' }, headers, 401);
        }
        const id = clean(body.id, 64);
        const status = clean(body.status, 32);
        const allowed = ['idea', 'investigating', 'developing', 'deploying', 'completed'];
        if (!id || allowed.indexOf(status) === -1) return json({ error: 'bad request' }, headers, 400);
        await env.DB.prepare(
          'INSERT INTO item_statuses(item_id,status,updated) VALUES(?,?,?) ON CONFLICT(item_id) DO UPDATE SET status=excluded.status, updated=excluded.updated'
        ).bind(id, status, Date.now()).run();
        return json({ ok: true, id, status }, headers);
      }

      return json({ error: 'not found' }, headers, 404);
    } catch (e) {
      return json({ error: 'server error' }, headers, 500);
    }
  },
};
