# Site 4 — «Chaleur du Nord» / Northern Warmth

Concept #4 of the five La Paix du Cœur / Kimia Na Motema reworks. It pairs a calm, Scandinavian layout with a Québec feel (snow, pine, wool, maple, birch). Its main engine is **local community mobilization**: what is happening this week, where to drop off food, which shift needs people, and how a church, school or business can organize its own drive.

Preview: `node build.mjs && node tools/serve.mjs 8140`, then open <http://localhost:8140/>.

## Design system

| Token | Value | Use |
|---|---|---|
| Snow | `#F4F4F1` | page background |
| Pine | `#2F4A3F` (deep `#22382F`) | hero, primary buttons, labels, footer |
| Maple | `#B5332E` | donate CTAs, date-tile caps, focus ring. Used sparingly: 5.5:1 on snow, 6:1 with white text |
| Birch | `#E8DFD0` (soft `#F0EADF`) | verse band, info sections, knit band |
| Charcoal | `#23272A` / muted `#5A615E` | text (muted is 5.8:1 on snow) |
| Event types | maraude pine, collecte amber `#8A5A12`, atelier lake `#2B5A7E`, culte dusk `#6A4C7D`, gala maple | tags, chips, calendar entries |

- **Type:** two self-hosted families, which keeps Google out of the request path (Law 25) and keeps the CSP at `font-src 'self'`.
  - *Manrope* variable (200–800) for everything.
  - *Source Serif 4* italic for Scripture only.
- **Photos:** `tools/prepare-assets.py` grades every client photo once: muted warmth, about 20 % less saturation and lifted blacks. It writes 640/1024/1600 px WebP and JPEG files, plus `manifest.json` with each photo's size. `boy-portrait-bw` is not used.
- **Signature details:**
  - a hand-knit *Fair Isle* band (hearts and snowflakes in V-stitches) that `build.mjs` generates as SVG in a birch version and a pine version
  - a knit texture behind the newsletter band
  - thin rules, small-caps labels and calendar-style date tiles
  - a light falling-snow canvas on the home hero only, from November to March. It is off when the visitor prefers reduced motion, pauses when off-screen, and has a visible "Arrêter la neige / Stop the snow" button (WCAG 2.2.2). The choice is remembered.

## Features

**Mobilization engine**
- **Events calendar** (`/fr/evenements/`, `/en/events/`):
  - month grid and list views (on a phone, the grid shows coloured dots with the month's agenda below)
  - type filters: Maraude, Collecte, Atelier, Culte/prière, Gala
  - shareable URL state (`?view=list&type=maraude`); the last view used is remembered
  - the list is rendered on the server, so it works without JS
  - each event page has an address in plain text (no map), the meeting point, and "Add to calendar" (Google, `.ics`, Outlook.com)
  - each event page has an RSVP form, or a Zeffy ticket placeholder for the gala
  - volunteer shifts with the number of spots left, and Event JSON-LD
- **Calendar feeds:**
  - `/calendar.ics`: combined and bilingual, subscribable through `webcal://` or a Google "add by URL" link
  - `/fr/evenements/calendrier.ics` and `/en/events/calendar.ics`: one feed per language
  - one `.ics` file per event
  - every feed carries a VTIMEZONE for America/Toronto
- **Food-drive finder** (`/fr/collectes/`, `/en/food-drives/`):
  - sample partner drop-off points with dates and hours
  - filters by neighbourhood (Montréal-Nord, Saint-Michel, Villeray, Rivière-des-Prairies, Saint-Léonard) and by "next 30 days"
  - each date has an add-to-calendar link
  - a "most-needed items" list and a "become a drop-off point" call to action
- **Volunteer shifts** (`/fr/benevolat/`, `/en/volunteer/`):
  - built from the `shifts` of each event, with a dot gauge of the spots left; full shifts point to the waiting list
  - "Je m'inscris" preselects the shift in the sign-up form, which also has an age check and a first-time flag
  - an FAQ
- **Toolkits** (`/fr/trousses/`, `/en/toolkits/`):
  - accessible tabs for Churches, Schools and Businesses (all panels are visible without JS)
  - ideas, a checklist, and social-media captions with Copy buttons
  - a printable HTML checklist per audience (`/fr/trousses/eglises/` and so on, with print CSS) and a `.txt` download
- **Newsletter** (`/fr/infolettre/`, `/en/newsletter/`, plus a band on the home page):
  - topic preferences: Nouvelles, Événements, Prière, Bénévolat
  - a choice of language
  - an unticked, required CASL express-consent checkbox that names the sender, its contact details and how to withdraw
  - a note on double opt-in
- **News** with category filters, NewsArticle JSON-LD and an RSS feed per language (`/fr/nouvelles/rss.xml`, `/en/news/rss.xml`).

**Everything else the brief requires**
- **Media:**
  - YouTube click-to-load facade, using a local poster image and `youtube-nocookie`. The video ID is a sample.
  - a styled `<audio>` player for an 8-second sample tone, with a transcript
  - a captioned photo gallery
- **Give:**
  - amount cards that say what each gift funds (sample values), one-time or monthly
  - a Zeffy form placeholder
  - Interac e-Transfer steps with a copy button
  - "Coordonnées bancaires sur demande" (no bank numbers anywhere)
  - CRA receipts marked `[si enregistré]`
  - in-kind gifts, and an FAQ with FAQPage JSON-LD
- **Content pages:**
  - About: verbatim client text, values, timeline, team placeholder, verses
  - Missions: three programmes, two field actions, four aid areas
  - Contact: form, email; no phone or address
  - Privacy (Law 25): privacy officer `[à confirmer]`, cookieless analytics, photo consent
  - Ethical storytelling commitment
  - a bilingual 404 page and a language chooser at `/`
- **Placeholders:** every invented fact is marked. "Exemple — à confirmer" / "Sample — to confirm" badges sit on events, news, media and drop-off points; inline `[à confirmer]` text is highlighted automatically by the Markdown renderer.

## SEO, accessibility, security

- **Every page has:**
  - a unique title and meta description, a canonical link, and Open Graph and Twitter tags
  - reciprocal `hreflang` for fr-CA, en-CA and x-default (x-default is `/` for the home pair and the French page otherwise)
  - a FR/EN switch that leads to the same page in the other language, translated slugs included
  - one `@graph` JSON-LD block: `NGO` (`@id` `https://lapaixducoeur.ca/#org`, with a `DonateAction`), `WebPage` and a `BreadcrumbList` on inner pages. Event, NewsArticle, VideoObject and FAQPage are added where they apply.
- **Accessibility:**
  - a skip link, one H1 per page, visible focus rings (snow and maple), AA contrast, labelled fields
  - `aria-pressed` filters, `aria-live` result counts, and keyboard tabs (arrows, Home, End)
  - the mobile menu closes with Escape
  - `prefers-reduced-motion` is respected
- **Typography:** French pages get narrow no-break spaces inside « guillemets » at build time.
- **Security headers** (`src/headers.txt`, copied to `dist/_headers`):
  - HSTS (with preload), nosniff, a Referrer-Policy, a Permissions-Policy, X-Frame-Options DENY and COOP
  - a strict CSP with no inline scripts and no inline styles. It allows only `'self'` plus Cloudflare Web Analytics, Turnstile, and the YouTube-nocookie and Zeffy frames.
  - `/admin/*` detaches the main CSP with `! Content-Security-Policy` and sets a looser one for Sveltia (unpkg, GitHub API, blob:). It is also `noindex`.
- **Performance:**
  - `main.js` is about 12 KB and `calendar.js` about 5.5 KB (events page only), with no libraries and no CDN
  - every image is a `<picture>` (WebP with JPEG fallback) with `srcset`, width and height, and `loading="lazy"` below the fold
  - CSS and JS URLs carry a content hash (`?v=`), so `/assets/*` can be cached as immutable

## Structure

```
build.mjs            zero-dependency Node 22 build: content/ + src/ -> dist/
content/             everything staff edit (Sveltia single_file i18n: { "fr": {…}, "en": {…} })
  settings.json      name, email, Interac, Zeffy URLs, socials, verse of the week, top-bar announcement
  events/*.json      12 sample events (type, start/end in Montréal time, neighbourhood, shifts, rsvp)
  dropoffs/*.json    7 sample food-drive drop-off points
  news/*.json        5 sample posts (Markdown body)
  media/*.json       video / audio / photo items
  pages/*.json       copy for each page (home, about, missions, toolkits, give, privacy…)
src/
  lib.mjs            escaping, mini-Markdown, time-zone maths, .ics writer, calendar links, <picture>
  strings.mjs        translated routes + interface strings
  layout.mjs         <head>, header, footer, JSON-LD, icons
  views.mjs          one function per page type
  css/site.css       the design system
  js/main.js         nav, forms, filters, tabs, copy/share, YouTube facade, audio, snow
  js/calendar.js     month grid / list / filters (events page only)
  headers.txt        becomes dist/_headers
admin/               Sveltia CMS (index.html + config.yml)
static/              copied as-is: fonts, graded images, audio, favicons, uploads/
tools/
  prepare-assets.py  one-off photo grading, logo and favicon variants, OG card, sample audio (Pillow + ffmpeg)
  serve.mjs          local preview that applies _headers (CSP included), pretty URLs and the 404 page
  verify.mjs         Playwright check of every page at 375 and 1440 px
dist/                build output (committed for preview)
screenshots/         home-desktop.png, home-mobile.png
```

## Build, preview, verify

```bash
node build.mjs                 # BUILD_DATE=2026-11-09 node build.mjs pins "today" (past events, finder)
node tools/serve.mjs 8140      # http://localhost:8140
node tools/verify.mjs          # needs the server; exits 1 on any problem
```

`verify.mjs` fails a page on any of these:
- a console error, which includes CSP violations because the preview server sends the real headers
- an internal 404
- an H1 count other than one, a missing alt, or an image without width and height
- horizontal overflow at 375 px
- a missing title, description, canonical, skip link or hreflang, or hreflang that is not reciprocal
- a field without a label, an inline script, more than 30 KB of JS, or missing or invalid JSON-LD

It also requests every internal link.

The build runs at build time, so past events move to "Past events" and past food-drive dates drop out on each rebuild. In production, schedule a daily rebuild with a Cloudflare Pages deploy hook.

## Editing content (Sveltia CMS)

`/admin/` loads Sveltia CMS `0.252.0` from unpkg.
- **Config:** `admin/config.yml` uses i18n `single_file` with locales `[fr, en]` and default `fr`. Uploaded files go to `static/uploads` and are served as `/uploads`.
- **Collections:**
  - Événements: shifts are edited inside each event
  - Points de collecte
  - Nouvelles: with a draft flag
  - Médiathèque
  - Réglages
  - Pages: one entry per page
- **Fields:**
  - translatable fields sit side by side in FR and EN
  - shared fields (dates, type, image) use `i18n: duplicate`
  - each language has its own slug; when it is empty, the build generates one from the title
- **Before going live:** replace `repo` and `base_url` in the config (GitHub OAuth via `sveltia-cms-auth` on Cloudflare Workers).

Staff workflow: log in, fill in the form, save. Each save is a commit, and Cloudflare Pages rebuilds the site in about 30 s.

## Production notes

- **Forms:**
  - Contact, volunteer, RSVP and newsletter post to `/api/*`. In this prototype, `main.js` intercepts the submit, enforces native validation, drops honeypot hits silently and shows a confirmation.
  - In production, a **Cloudflare Pages Function** receives each form, verifies the **Turnstile** token on the server (the widget markup is left as a comment in each form), and then forwards the data. The newsletter goes to a CASL-compliant list tool that sends the double opt-in email; volunteer sign-ups go to email or a sheet.
  - The spots-left counters are static sample data. Making them live would take a small KV or D1 counter behind the same function.
- **Zeffy:** paste the form and ticketing URLs into Réglages. The form's `action` then points to Zeffy and the placeholder note disappears; an iframe embed is already allowed by the CSP.
- **Analytics:** add the Cloudflare Web Analytics beacon script tag. Its domains are already in the CSP.

## Known gaps / to confirm with the client

- **Placeholders:** every event, shift count, drop-off point and partner store, news post, figure, team member, charity number, social link and privacy officer is a labelled sample or placeholder. The YouTube ID is a public sample video, and the audio file is a generated tone.
- **Photos:** the client's existing images, graded. They should be replaced with photos of real activities taken with consent.
- **Snow timing:** the snow follows the visitor's own clock (November to March). Add `?neige=1` to force it on for a demo.
