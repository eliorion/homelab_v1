# Site 1 — «Lumière d'espérance» / Light of Hope

A bilingual (FR/EN) static website for **La Paix du Cœur / Kimia Na Motema**. Its main engine is **giving and transparency**.

Preview: `node build.mjs && python3 -m http.server -d dist 8110`, then open http://localhost:8110/

## Concept

The site is bright, hopeful and minimal, in the spirit of a sunrise and of charity: water's positive tone. It shows the moment things turn around, not the need. Every gift is made visible: each amount says what it pays for, a slider shows where the money goes, and a transparency page carries the governance and the annual report.

### Design system

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFFBF5` | warm off-white page background |
| `--ink` | `#22201E` | charcoal text (15.7:1 on bg) |
| `--muted` | `#5E564D` | secondary text (≥ 7:1) |
| `--leaf` | `#2D6A0F` | logo leaf green, the **only** action colour (6.4:1 with white text, AA) |
| `--sunrise` | peach `#FFD6B8` → gold `#FFC56E` → coral `#F7A08D` | accent gradient: hero light, closing panel, date blocks, highlights |
| `--amber-*` | `#7A4B0B` on `#FFF1D6` | the "sample / to confirm" badge and the `[à confirmer]` marks |
| Aid-area colours | food `#E98A3B`, clothing `#E2667A`, school `#3F8FB5`, material `#5F9A1C` | donut and allocation bars |

- **Type:** **Outfit** (a geometric sans, variable 300–800) for everything, plus **Fraunces Italic** (a light serif) for Bible verses and quotes. Both fonts are self-hosted in `static/fonts/`, so there are no requests to Google and the CSP stays `'self'`.
- **Shapes:** rounded cards (22–40 px radius), pill buttons, and photos inside soft frames with a warm `soft-light` overlay. The hero and Cercle photos sit in an **arch**, a rising-sun shape.
- **Signature motion:**
  - On load, a sunrise radial gradient **rises** behind the hero and the hero text lifts in, staggered.
  - On fine-pointer devices, a warm **radial glow follows the cursor** across the hero.
  - Counters **count up** the first time they come into view, and progress and report bars grow.
  - All of this is turned off for touch (the glow) and for `prefers-reduced-motion` (everything). Without JS the final values are already in the HTML.

## Features

**Giving engine**
- **Donate page** (`/fr/soutenir/`, `/en/give/`): the donation widget
  - one-time / monthly toggle, with *monthly* preselected and marked "recommended"
  - a separate set of amounts for each frequency, each labelled with what it pays for (`25 $ = un panier alimentaire…`, marked as a sample)
  - a custom amount
  - a "cover the fees" checkbox that computes 3 % live (with a note that Zeffy charges no fees)
  - dedicating the gift "in honour of / in memory of", with a name and a notification email
  - a live summary, and a CTA **"Continuer vers Zeffy"** (a placeholder; it shows a prototype notice)
- **Interac** block with steps and a **copy-to-clipboard** email address. **"Coordonnées bancaires sur demande"**: bank details on request, linked to a contact form whose subject is already set.
- **Gifts in kind** wish list, a **prayer support** form (with an opt-in to the prayer chain), and other ways to give.
- **Le Cercle du Cœur** (`/fr/cercle-du-coeur/`, `/en/heart-circle/`): what members receive, three steps, progress toward the goal of 100 members (sample figure), a testimonial placeholder and an FAQ. A teaser for it is on the home page and on the donate page.
- **"Where your gift goes"**: a slider from $10 to $500 that live-updates a donut and four bars for the aid areas (food, clothing, school, material). It shows each area's dollar share and what it buys ("≈ 1,6 panier alimentaire"). The percentages and unit costs are samples, set in `content/settings.json → allocation`.
- **Impact counters** that count up on scroll. Sample figures carry an asterisk and a badge.
- A sticky **Donner / Give** button in the header with a gentle heartbeat icon. On mobile, a **bottom donate bar** appears after you scroll past the hero and hides when the footer is in view.

**Transparency** (`/fr/transparence/`, `/en/transparency/`), with a sticky table of contents:
- legal identity: CRA charity number and NEQ shown as `[à confirmer]`
- the board: Frère Ronny plus placeholders
- the **2025 annual report as a web page**: highlight figures, plus revenue and expense bars (sample figures)
- the safeguarding and ethical-storytelling commitments
- a fraud warning
- a tax-receipt FAQ, which also carries `FAQPage` JSON-LD

**Everything else in the brief**
- Home, About (story, mission, values, verse, timeline, team), Missions (programmes, the four aid areas, field actions, where we serve).
- News list and articles, plus an RSS feed per language at `/fr/nouvelles/rss.xml` and `/en/news/rss.xml`.
- Events list and event pages. Each event has an `.ics` file and a Google Calendar link; the benefit evening also has a Zeffy ticket placeholder.
- The media library (Médiathèque / Media):
  - **YouTube click-to-load facade** that loads `youtube-nocookie.com` only after a click. The poster is local and the IDs are labelled samples.
  - Styled **audio player** for the «Les voix du cœur» podcast, around a generated 9-second sample tone, with a transcript.
  - Photo gallery with a `<dialog>` lightbox.
- Contact page with a message form (its subject can be preset from the URL with `?sujet=banque` or `?sujet=nature`) and a volunteer form with skill chips. There is also a newsletter form in the footer with CASL consent.
- Privacy policy under Law 25: a privacy officer `[à confirmer]`, cookieless analytics, YouTube loaded on click, photo consent, data retention and incidents.
- `/` is a bilingual language chooser, with no geolocation redirect. There is also a bilingual `404.html`.
- French typography is applied automatically at build time: narrow no-break spaces before `: ; ! ?` and inside « ».

## SEO, security and accessibility

Every page has:
- `lang`, a unique `<title>` and meta description, a canonical link and reciprocal `hreflang` (fr-CA, en-CA and x-default)
- Open Graph and Twitter card tags, with a generated 1200×630 OG image per language
- breadcrumbs
- JSON-LD in an `@graph`: `NGO` (`@id` `/#org`, with a `DonateAction`), `WebSite`, `WebPage`, `BreadcrumbList`, plus `NewsArticle`, `Event`, `FAQPage` and `VideoObject` where they apply

The FR/EN switch always leads to the *same* page in the other language, translated slugs included.

`dist/sitemap.xml` lists every page with `xhtml:link` alternates. `robots.txt` disallows `/admin/`.

`static/_headers` (Cloudflare Pages / Netlify) sets:
- HSTS (preload), `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy`, a restrictive `Permissions-Policy` and COOP
- a strict CSP: `script-src 'self'` (plus Cloudflare Web Analytics and Turnstile for production), `style-src 'self'`, `frame-src` limited to youtube-nocookie, Turnstile and Zeffy, and `form-action 'self' zeffy.com`
- a separate, looser CSP for `/admin/*`, applied after removing the site-wide one with `! Content-Security-Policy`

There are **no inline scripts and no `style=""` attributes**; the only inline `<script>` blocks are JSON-LD. Dynamic values are set through the CSSOM, which the CSP allows.

Accessibility:
- skip link, one H1 per page, alt text on every image
- 3 px visible focus rings
- native radio and checkbox inputs behind the custom controls
- `aria-live` on the donation summary and the gift-slider results
- AA contrast throughout
- reduced-motion support

Performance:
- no frameworks; `main.js` is about 12 KB, unminified
- one CSS file
- `<picture>` with WebP and JPG at 640 and 1200 widths, with `width` and `height` set and `loading="lazy"`
- only the Outfit Latin font file is preloaded

## Structure

```
build.mjs            zero-dependency Node 22 build (helpers, routing, ICS, RSS, sitemap)
src/i18n.mjs         routes with translated slugs, UI strings, French typography
src/templates.mjs    layout and every page template
src/styles.css       design system
src/main.js          menu, hero glow, count-up, gift slider, donation widget, copy,
                     forms, YouTube facade, audio player, lightbox, TOC, mobile bar
content/             what staff edit (JSON; i18n single_file = { fr: {...}, en: {...} })
  settings.json      email, Zeffy URL, Cercle members and goal, gift allocation, verse of the week
  pages/*.json       copy for home, about, missions, give, circle, transparency, contact, privacy, listings
  news/ events/ media/
admin/               Sveltia CMS (index.html + config.yml)
static/              _headers, robots.txt, manifest, favicons, fonts, img (pre-sized variants), audio
scripts/verify.mjs   Playwright check: console errors, 404s, H1, alt, overflow, hreflang, inline scripts
scripts/screenshots.mjs
screenshots/         home-desktop.png, home-mobile.png
dist/                build output
```

## Editing content (Sveltia CMS)

1. `/admin/` loads Sveltia CMS `0.248.1` from unpkg. Staff sign in with GitHub. In production, set `repo` and the OAuth `base_url` in `admin/config.yml`; these are marked `[à confirmer]`.
2. There are collections for **Nouvelles**, **Événements**, **Médiathèque**, **Réglages du site** and **Pages**.
   - French and English are edited side by side; French is the default.
   - Fields shared by both languages (dates, images, YouTube ID) use `i18n: duplicate`.
   - Each language has its own `slug` field, which gives the translated URLs.
   - Ticking **sample** shows the «Exemple — à confirmer» badge.
   - Uploads land in `static/img/`. A new image without pre-sized `-640` and `-1200` variants is still served correctly, as a plain `<picture>`.
3. A commit triggers a Cloudflare Pages build (`node build.mjs`, output `dist`).

Any text written as `[à confirmer]` or `[to confirm]` is automatically styled as an amber placeholder. To replace a sample, remove the brackets and untick **sample**.

## Forms in production

Contact, volunteer, prayer and newsletter forms each have a honeypot field (`website`) and a Turnstile placeholder comment. In this prototype, JS validates the form and shows a friendly confirmation. In production, a **Cloudflare Pages Function** (for example `functions/api/contact.js`) would:
- receive the POST
- verify Turnstile on the server
- drop the submission if the honeypot is filled
- email it to the association or store it

The donation CTA would open the real **Zeffy** form at `settings.donate_url`.

## Calendar sync

Regular events (outreach, food drives) are best kept in the association's public **Google Calendar**; the CMS form stays for special events with a photo and long text. Staff conventions (title `FR | EN`, `Catégorie:` and `Inscription:` lines, an `EN` line before the English text…) are in `../shared/EDITOR-GUIDE.md`.

A scheduled job imports the calendar, then the site rebuilds:

```bash
node ../shared/tools/calendar-sync.mjs --site . --ics "<settings.calendar_ics_source>"   # writes content/events/gcal-*.json
node build.mjs
```

- Only `gcal-*.json` files are created or deleted; never edit them in the CMS (the next sync overwrites them). Their `source` is `google-calendar`: bodies keep simple line breaks, and an event from `00:00` to `23:59` is shown as «Toute la journée / All day» (`DTSTART;VALUE=DATE` in the .ics, a date-only `startDate` in JSON-LD). When several events share a title (a weekly series), the page `<title>` gets the date.
- Feeds, with every upcoming event (end ≥ build time): `/calendar.ics` (bilingual), `/fr/calendrier.ics`, `/en/calendar.ics`. UTC times, `X-WR-CALNAME`, CRLF, 75-octet folding; the `UID` is the event file name, so it is stable across rebuilds and identical in the per-event `.ics`.
- The **S'abonner / Subscribe** block (events list, `#s-abonner` / `#subscribe`; compact in each event's sidebar; a link from the home page events section) offers `webcal://`, Google Calendar (`render?cid=`), Outlook.com (`addfromweb`) and a copy-link button for the page language's feed.
- Settings: `calendar_google_public_url` (optional; adds «Voir dans Google Agenda») and `calendar_ics_source` (staff only, read by the sync job, never rendered).

## Verify

```bash
node build.mjs
python3 -m http.server -d dist 8110 &
NODE_PATH=$(npm root -g) node scripts/verify.mjs 8110        # every page × 375/1440 px
NODE_PATH=$(npm root -g) node scripts/screenshots.mjs 8110   # writes screenshots/home-*.png
```

## To confirm with the client

- CRA charity number and NEQ; whether tax receipts are issued
- board and team; the privacy and safeguarding officers
- every figure: counters, the Cercle membership, the gift allocation, unit costs, the annual report
- testimonials and real events
- the real Zeffy URLs and YouTube or podcast IDs
- social accounts
- the GitHub repository and the CMS OAuth endpoint

`static/img` was generated from `../shared/assets` (resized to 640 and 1200 px in WebP and JPG, the emblem cropped from the logo, favicons, OG images). `boy-portrait-bw` is deliberately not used.
