# GovAgenda — Roadmap

A public record of what's planned and what's shipped for GovAgenda — local government agendas
and meeting records, in plain view. **First city: Belle Isle, FL.**
**Live site:** https://govagenda.org/

## Planned — in priority order

_Foundation: an automated weekly refresh keeps the record current (AI-assisted for accuracy of
commissioner remarks)._

1. **Follow topics → alerts** — subscribe to a topic and get notified when it moves, by email, text (SMS), and RSS.
2. **Multi-municipality expansion** — serve other towns from the same codebase: per-city data, a simple intake for where each place publishes its agendas/minutes, per-city pages, and a directory landing page.
3. **Subscribe to the meetings calendar** — a live calendar feed you subscribe to once, so new and changed meetings appear in Google/Apple Calendar automatically (today you add meetings one at a time, or download them).
4. **Agenda preview** — the actual items on an upcoming agenda, in plain language, before the meeting happens.
5. **Jargon glossary tooltips** — government terms most residents don't use every day (quorum, millage, variance, first reading, consent agenda) are underlined wherever they appear; hover or tap for a plain-language definition without leaving the page.
6. **Weekly digest email** — a Monday roundup of the topics you follow.
7. **Per-official accountability pages** — a neutral, per-commissioner record of their quotes, positions, and votes.
8. **Trending topics & search trends** — surface what the community is actually watching.
9. **National-significance / severity tag** — flag when a local item ties to a bigger national issue, tuned to your interests.
10. **Rights Watch — Bill of Rights lens** — neutrally flag topics that implicate constitutional rights, with the dialog they raise.
11. **Sticky & shareable watchlist** — pins that persist and share as a link.
12. **Shareable / embeddable topic links** — deep-link and embed any topic.
13. **Vote / position tracking** — who voted how, where the record shows it.
14. **Full-text search of source documents** — search inside agendas/minutes and jump to the page.
15. **Open data / API + downloads** — publish the dataset for others to build on.

## Recently shipped

- **2026-07-28** — **Meetings calendar.** A month-by-month calendar of every public meeting — City Council, Budget Committee, Planning & Zoning, Code Enforcement and the advisory boards — with real start times, the location, and the agenda, packet, minutes and video the city published for each. Meetings the city has posted show as **Confirmed**; dates projected from each body's regular schedule show as **Expected** with a note to confirm before you go. A **Past meetings** link opens the full record back to February 2026, each meeting showing which tracked topics were on its agenda. Add any upcoming meeting to Google Calendar, download it as an `.ics` file for Apple Calendar or Outlook, or grab everything upcoming in one file.
- **2026-07-28** — Plain-language "what this means" summaries on every topic — a short, collapsible, plain-English explainer alongside the neutral factual record, clearly separating what's confirmed from what's still undecided.
- **2026-07-28** — "Ask ChatGPT / Ask Claude" buttons on every topic — jump into your own AI assistant with the full sourced context pre-loaded, no extra typing.
- **2026-07-28** — Visual refresh: new color palette with light/dark mode, refreshed Follow / Add-to-Calendar / source-link UI.
- **2026-07-25** — Automated weekly refresh is live: the tracker now updates itself from official sources on a schedule (daily watch + Monday roll-up), append-only and source-verified — no manual data entry.
- **2026-07-18** — Community board: propose ideas and vote on what GovAgenda builds next.
- **2026-07-18** — Live on the custom domain **[govagenda.org](https://govagenda.org/)** over HTTPS.
- **2026-07-18** — New look: logo added, site retheme.
- **2026-07-17** — Rebrand to **GovAgenda**. Ordinance/resolution numbers now render as a distinct badge (e.g.
`Ordinance 26-05`) beside the status and category badges; topic titles cleaned up.
- **2026-07-17** — Initial launch: single-source JSON archive → build step → GitHub Pages,
auto-deployed on every change via GitHub Actions.

---

_Have something to add or a correction to a record? See the contact note in the site footer._
