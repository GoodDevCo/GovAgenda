# GovAgenda community backend (Cloudflare Workers + D1)

Free, scalable, self-owned backend for the Community board: site-wide vote counts and
submitted ideas. No login required for voters. Item metadata (titles/descriptions/statuses)
stays in `data/community.json`; this service only stores live vote counts and new suggestions.

## Cost & scale
- Cloudflare Workers free tier: ~100,000 requests/day.
- D1 free tier: 5 GB storage, millions of reads/day.
- More than enough for a town — or many towns — at $0. Scales globally on the edge if needed.

## One-time deploy (~15 min)

Two ways: the Cloudflare **dashboard** (all in the browser) or the **wrangler CLI**. CLI steps:

1. Create a free account at cloudflare.com, then install the CLI: `npm i -g wrangler` and `wrangler login`.
2. Create the database: `wrangler d1 create govagenda_community` → copy the printed `database_id`
   into `wrangler.toml`.
3. Load the schema: `wrangler d1 execute govagenda_community --remote --file=./schema.sql`
4. Deploy: `wrangler deploy` → note the URL it prints, e.g.
   `https://govagenda-community.<your-subdomain>.workers.dev`

## Turn it on in the site
Set that Worker URL as `meta.apiBase` in `data/community.json` and rebuild/push. The Community
board then reads live vote counts from `/api/board`, records votes via `/api/vote`, and (once the
on-site form is enabled) posts new ideas to `/api/suggest`. If `apiBase` is empty or the service
is unreachable, the board falls back to the seeded counts — it never breaks.

## Review submitted ideas
`wrangler d1 execute govagenda_community --remote --command="SELECT * FROM suggestions ORDER BY ts DESC"`
Promote good ones into `data/community.json` (as `status:"idea"`), and progress items through
`idea → investigating → developing → deploying → completed` as work moves.

## Abuse notes (v1)
Votes dedupe per (item, anonymous browser id). If spam becomes an issue, add IP rate-limiting
and a simple proof-of-work or Turnstile check to `/api/vote` and `/api/suggest`.
