-- GovAgenda community backend schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS votes (
  item_id TEXT NOT NULL,
  voter   TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  PRIMARY KEY (item_id, voter)
);
CREATE INDEX IF NOT EXISTS idx_votes_item ON votes(item_id);

CREATE TABLE IF NOT EXISTS suggestions (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  title  TEXT NOT NULL,
  descr  TEXT,
  voter  TEXT,
  ts     INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);
