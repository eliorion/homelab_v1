# Site 2 — « Lettre d’amour » / Love Letter

Concept #2 of the five La Paix du Cœur / Kimia Na Motema reworks (see `../BRAINSTORM.md`, `../shared/BUILD-BRIEF.md`).

The whole site reads like a handwritten letter from the association. The home page opens on a letter: a dateline, «&nbsp;Chère amie, cher ami,&nbsp;», a signature with a heart that draws itself, and Psalm 82:3 as the P.S. The main engine is **stories and faith**: a story hub, the «&nbsp;Les voix du cœur&nbsp;» podcast, a moderated prayer and hope wall, letters of encouragement and a verse of the week.

## Run it

```bash
node build.mjs                 # zero dependencies, Node 22 → dist/
node tests/serve.mjs 8120      # serves dist/ and applies dist/_headers (CSP included), like Cloudflare Pages
node tests/verify.cjs 8120     # Playwright: every page × FR/EN × 375/1440 px
```

`python3 -m http.server -d dist 8120` also works, but it does not apply the security headers.

## Design system

| Token | Value | Use |
|---|---|---|
| `--paper` | `#FAF5EC` | page background. A fractal-noise SVG grain sits over the whole document (`body::after`, multiply) |
| `--paper-2` | `#F2E8D7` | page heads and alternate sections |
| `--sheet` | `#FFFCF6` | letters, cards, notes |
| `--ink` | `#1F2A44` | text, primary buttons, player, give band |
| `--rose` / `--rose-deep` | `#C9786A` / `#A2483A` | hand-drawn strokes and seals / text accents and the Give button (AA on paper and white) |
| `--green` | `#4E7A3A` | the logo’s green, used quietly (tags, the Lingala note) |

- **Type:** Fraunces (headings, letter body, story body, verses; the variable `SOFT`/`opsz` axes make the italics look like ink) plus DM Sans (UI and running text). These are the only two Google families.
- **Motifs** (`src/svg.mjs`, all inline SVG, no image files):
  - hand-drawn heart and underline that draw themselves (`stroke-dashoffset`, started when scrolled into view)
  - deckled/torn edges between sections (seeded random path)
  - wax seals
  - an envelope that closes and gets sealed when a letter is sent
  - fleurons for letterpress verses
  - taped polaroids with handwritten margin notes
  - postcards (with a stamp) and lined notes on the prayer wall
- **Motion:** slow 1.1 s fades. `prefers-reduced-motion` turns every animation off and shows the hearts already drawn.

## Pages (FR / EN, translated slugs)

| | FR | EN |
|---|---|---|
| Home | `/fr/` | `/en/` |
| About | `/fr/a-propos/` | `/en/about/` |
| Missions | `/fr/missions/` | `/en/missions/` |
| Story hub + 4 long-form stories | `/fr/histoires/…` | `/en/stories/…` |
| Podcast | `/fr/balado/` | `/en/podcast/` |
| Prayer & hope wall | `/fr/mur-de-priere/` | `/en/prayer-wall/` |
| Letter of encouragement | `/fr/lettre-d-encouragement/` | `/en/letter-of-encouragement/` |
| Ethical storytelling charter | `/fr/charte-recit-ethique/` | `/en/ethical-storytelling/` |
| News + 3 articles, RSS | `/fr/nouvelles/…` | `/en/news/…` |
| Events + 4 event pages, `.ics` | `/fr/evenements/…` | `/en/events/…` |
| Media (gallery, video, audio) | `/fr/mediatheque/` | `/en/media/` |
| Give | `/fr/soutenir/` | `/en/give/` |
| Contact | `/fr/contact/` | `/en/contact/` |
| Privacy (Law 25) | `/fr/confidentialite/` | `/en/privacy/` |

`/` is a bilingual chooser with no automatic redirect, and `/404.html` is bilingual.

## Features

- **Story hub:**
  - tag filters (Espoir, Famille, Éducation, Maraudes, Foi, Communauté) with `aria-pressed` and a live result count; `?tag=` deep links from the tags on each story
  - long-form pages with Roman-numeral chapters, a drop cap, a pull quote, a closing letterpress verse and a consent note
  - an "answer this story" call to action (write / pray / give)
  - stories are a CMS collection, use first names only and carry a sample badge
- **«&nbsp;Les voix du cœur&nbsp;» podcast:**
  - a custom player around `<audio>`: play/pause, scrubbing (a range input with `aria-valuetext`), −15/+15 s, speed (1×, 1.25×, 1.5×, 2×, 0.75×), elapsed and total time
  - the native controls stay as the no-JS fallback
  - episode list with "Listen" buttons that load the episode into the player
  - expandable FR + EN transcripts shown side by side, each with its `lang` attribute
  - episodes are a CMS collection; the audio files are short generated tone samples, labelled as such
- **Prayer & hope wall:**
  - post form with a prayer/hope choice, an anonymous option that disables the name field, a "private, just pray" option, a character counter, a honeypot, a Turnstile placeholder comment and a moderation notice
  - a masonry of notes and postcards; each card has an «&nbsp;J’ai prié&nbsp;» counter kept per viewer in `localStorage` (wrapped in try/catch)
  - filter by kind
  - approved messages are a CMS collection (`published` flag)
- **Letter of encouragement:**
  - safety rules (always delivered by the team, never direct contact with a child, no contact details), writing prompts, and a ruled-paper letter form
  - on submit, the envelope closes and a wax seal stamps it
- **Verse of the week** comes from `content/settings.json` and appears on the home and contact pages.
- **Give:**
  - a mock Zeffy form with one-time/monthly and amounts tied to what they fund, all labelled as samples; the button label updates live
  - Interac card with a copy button; bank details on request only; CRA receipts marked «&nbsp;[si enregistré]&nbsp;»
- **Events:** invitation-style cards, `.ics` per event (UTC, RFC 5545 folding), Google Calendar links, Event JSON-LD and a Zeffy registration placeholder.
- **Media:**
  - YouTube click-to-load facade using a local poster (no request to YouTube before the click), then a `youtube-nocookie` iframe; the video id is a labelled sample
  - polaroid gallery with a `<dialog>` lightbox; audio item
- **Newsletter** «&nbsp;La lettre du cœur&nbsp;» in the footer, with a CASL consent checkbox.

### Forms in production

Every form has a honeypot (`website`) and a `<!-- Turnstile … -->` placeholder. In the prototype, JS validates the form and shows a friendly confirmation. Nothing is sent. In production each form would POST to a **Cloudflare Pages Function** (e.g. `functions/api/prayer.js`). That function verifies Turnstile and the honeypot, then emails the team or stores the entry for moderation. Approved prayer-wall messages are published through the CMS `prayers` collection.

## SEO, accessibility, security

- Every page has:
  - `<html lang="fr-CA|en-CA">`, a unique title and meta description, a canonical link and reciprocal hreflang (fr-CA, en-CA, x-default)
  - Open Graph tags, with a 1200×630 crop of the page photo
  - a FR/EN switch to the same page in the other language
  - a skip link and a single H1
  - alt text on every image, visible focus rings and AA contrast
- JSON-LD `@graph`:
  - on every page: `NGO` (`@id` `https://lapaixducoeur.ca/#org`) with a `DonateAction`, and `WebPage`
  - on inner pages: `BreadcrumbList`
  - on its own page type: `NewsArticle`, `Event`, `Article` (stories), `PodcastSeries`
- `sitemap.xml` with `xhtml:link` alternates, `robots.txt`, and an RSS feed per language.
- `_headers`:
  - HSTS, nosniff, Referrer-Policy, Permissions-Policy, `X-Frame-Options: DENY` and `frame-ancestors 'none'`
  - a strict CSP: `script-src 'self'`, no inline scripts or styles, fonts only from Google, frames only from youtube-nocookie and Zeffy
  - `/admin/*` detaches that CSP (`! Content-Security-Policy`) and sets a looser one for Sveltia
- Images use `<picture>` with WebP and a JPEG fallback, 640 w and full-size `srcset`, `width`/`height`, and `loading="lazy"` except on the hero.
- JS is about 13 KB in total, unminified, across `main.js` and `player.js`, with no libraries.

## Editing content (Sveltia CMS)

Open `/admin/`. `admin/config.yml` is set up as follows:

- GitHub backend, with the repo and auth worker marked `[à confirmer]`
- `i18n: single_file`, locales `[fr, en]`, default `fr`
- `media_folder: static/assets/img`
- collections: **stories, episodes, prayers, news, events, media, pages** (each page has its own file) and **settings** (verse of the week, email, CRA number, social links)

Each content file is JSON shaped as `{ "fr": {…}, "en": {…} }`. Fields that are not translated live only under `fr`, and `build.mjs` falls back to them for English. Slugs are translated per language. An image path under `/assets/img/<name>.jpg` automatically gets the responsive WebP and 640 w variants when they exist.

## Known gaps / to confirm with the client

- Placeholders still to fill: CRA number, privacy officer, board, countries served abroad, social links, postal address, real figures.
- Every story, prayer, event, news item, episode, amount and video id is sample content, and each one is labelled.
- Placeholder integrations: Zeffy embed URL, Turnstile site key, CMS repo and OAuth worker, and the Pages Functions for the forms.
- Audio is a generated soft tone, not real speech.
