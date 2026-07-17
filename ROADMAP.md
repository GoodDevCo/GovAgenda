# Belle Isle Government Tracker — Roadmap

A public record of what's planned and what's shipped for the tracker.
**Live site:** https://gooddevco.github.io/Belle-Isle/

## Planned

- **Automated weekly refresh** — keep the record current by adding new agenda, packet, and
  minutes entries to `data/topic-archive.json` each week (AI-assisted for accuracy of
  commissioner remarks).
- **Multi-municipality support** — generalize the tracker so it can serve other cities from the
  same codebase: a per-municipality data layer, a simple intake for where each place publishes
  its agendas/minutes and its access points, per-city pages, and a directory landing page.
- **Update tooling** — streamline the process of creating and publishing updates.

## Recently shipped

- **2026-07-17** — Ordinance/resolution numbers now render as a distinct badge (e.g.
  `Ordinance 26-05`) beside the status and category badges; topic titles cleaned up.
- **2026-07-17** — Initial launch: single-source JSON archive → build step → GitHub Pages,
  auto-deployed on every change via GitHub Actions.

---

_Have something to add or a correction to a record? See the contact note in the site footer._
