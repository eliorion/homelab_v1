# La Paix du Cœur: 5 website reworks

Five bilingual (French-first, English at full parity) redesign proposals for
[lapaixducoeur.ca](https://www.lapaixducoeur.ca), the Christian association La Paix du Cœur /
Kimia Na Motema, founded in Montréal in 2014.

- Start with [`BRAINSTORM.md`](BRAINSTORM.md). It covers the research, the audit of the current site, the principles and the recommended technology.
- [`shared/BUILD-BRIEF.md`](shared/BUILD-BRIEF.md) is the technical contract every site meets.

| # | Folder | Concept | Look | Feature focus |
|---|---|---|---|---|
| 1 | [`site-1-lumiere`](site-1-lumiere/) | **Lumière d'espérance** (Light of Hope) | Bright, sunrise gradient, a soft light that follows the cursor | Giving and transparency: donation widget, Le Cercle du Cœur, impact counters, "where your gift goes" slider, transparency page |
| 2 | [`site-2-lettre`](site-2-lettre/) | **Lettre d'amour** (Love Letter) | Cream paper, ink serif, wax seals, a heart that draws itself | Stories and faith: story hub, «Les voix du cœur» podcast, prayer and hope wall, letters of encouragement |
| 3 | [`site-3-kimia`](site-3-kimia/) | **Kimia** (Peace) | Embroidered folk illustration, a thread that sews itself down the page as you scroll | Mission and journey: timeline since 2014, flip cards for the aid areas, map that shows regions only, 4-step volunteer form |
| 4 | [`site-4-nord`](site-4-nord/) | **Chaleur du Nord** (Northern Warmth) | Calm Nordic look with a Québec feel, knit bands, winter snow | Local mobilization: events and street-outreach calendar with a subscribable feed, food-drive finder, volunteer shifts, toolkits |
| 5 | [`site-5-coeur-ouvert`](site-5-coeur-ouvert/) | **Cœur ouvert** (Open Heart) | Bold editorial magazine, coral accent, the word ESPOIR zooms in on scroll | Awareness and campaigns: scroll story, Christmas 2026 campaign, ambassadors, shareable verse cards, video hub, press kit |

Each site has screenshots in `screenshots/` and its own `README.md`, which covers the design system, features, editing workflow and verification.

## Common to all five
- **Security:** static site with no database, no WordPress login and no plugins. Security headers in `_headers`, including a strict CSP with no inline scripts. Donations go through Zeffy (placeholder) and Interac. **Bank account numbers are no longer published.**
- **Search visibility (SEO):**
  - separate `/fr/` and `/en/` addresses with translated page names
  - language-alternate links between the two versions
  - a unique title, description and canonical link on every page, plus Open Graph tags
  - structured data for search engines: the organization, with a donate action, plus articles, events and breadcrumbs
  - a sitemap and RSS feeds
- **Easy editing:** Sveltia CMS at `/admin`, with French and English side by side. It covers news, events, photos, video and audio, page text and settings.
- **Accessibility and speed:** WCAG 2.2 AA targets and about 15 KB of JavaScript per page. YouTube only loads when the visitor clicks, and images are responsive WebP.
- **Privacy (Québec Law 25):** a privacy page, analytics that set no cookies, and a commitment on consent for photos of children.
- **Honesty:** every figure, name, date or story we don't know is shown as a visible
  «Exemple — à confirmer» / "Sample — to confirm" marker. The client must supply the real data.

## Adding content and syncing the calendar
- [`shared/EDITOR-GUIDE.md`](shared/EDITOR-GUIDE.md): the staff guide. Events go in Google Calendar; news, photos, video and audio go through `/admin`.
- [`shared/tools/calendar-sync.mjs`](shared/tools/calendar-sync.mjs): imports the association's public Google Calendar into any site's `content/events/`. It handles repeating events, cancelled or moved dates, all-day events, and bilingual titles and descriptions. Test feed: `shared/tools/fixtures/google-calendar-sample.ics`.
- [`shared/deploy/publish.yml`](shared/deploy/publish.yml): GitHub Actions template. Each run syncs the calendar, builds the site and deploys it to Cloudflare Pages. It runs hourly and on every CMS save, and has a manual "Run workflow" button.
- Every site publishes subscribable feeds (`/calendar.ics`, `/fr/calendrier.ics`, `/en/calendar.ics`) and shows a "S'abonner à l'agenda / Subscribe" block (Apple, Google, Outlook, copy link).
- [`overview/proposals.html`](overview/proposals.html): source of the client-facing overview page.

```bash
node shared/tools/calendar-sync.mjs --site site-4-nord --ics "<Google Calendar public iCal URL>"
```

## Preview a site

```bash
cd site-N-*/ && node build.mjs          # rebuild (Node 22, no dependencies)
python3 -m http.server -d dist 8000     # then open http://localhost:8000/fr/
```

## Questions for the client before production
1. Is the organization a CRA-registered charity? We need its number, and whether it issues tax receipts.
2. Who is on the team or board? Who will be the named privacy officer under Law 25?
3. Which countries or cities are served outside Montréal?
4. Do they have real photos taken with consent, figures and testimonials?
5. Do they want a Zeffy account? Which social media accounts do they use?
6. Which concept, or which mix of features from several concepts, do they prefer?
