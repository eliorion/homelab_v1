# Site 3: Kimia (Paix du cœur / Peace of the Heart)

This concept is one of five reworks of lapaixducoeur.ca. The art direction is folk, embroidered and led by illustration, and it honours the heritage of the name *Kimia Na Motema* (Lingala for "peace of the heart"). The main engine is **mission and journey**: a timeline from 2014, the four areas of aid as flip cards, a map that protects privacy, volunteer sign-up matched to skills, and a gallery.

Preview: `node build.mjs && node scripts/serve.mjs 8130`, then open http://localhost:8130. This server applies `_headers`, so the CSP is enforced exactly as it would be in production.

## Design system

| Token | Value | Use |
|---|---|---|
| sand / cream | `#FBF3E6` / `#FFFAF1` | page / cards ("linen") |
| plum | `#4A2545` (dark `#2E1530`) | headings, dark sections, footer |
| terracotta | `#C2603D` decorative · `#A4482A` text and buttons (5.4:1 on sand) | the thread, primary CTA |
| sage | `#8FA98A` decorative · `#3F5A3C` small labels (7:1) | leaves, kickers |
| mustard | `#E0A93B` · light `#F6E3B4` | accents on plum (6:1), sample badges |

The raw brand terracotta (3.8:1) and sage (2.3:1 on sand) are never used for body text, only for large or decorative elements. The darker variants above carry text. Every text pairing is AA or better.

- **Type.** Fraunces (variable, `SOFT 100`, which gives the rounded, Recoleta-like feel) for headings and verses, and Nunito for body text. Both are **self-hosted** woff2 files in `static/assets/fonts`, loaded with no request to Google, which matters for Law 25. There are 2 families in total.
- **Motifs**, all original and hand-built in SVG (`src/templates/svg.mjs`):
  - a hero embroidery hoop holding a stitched heart, cupped by two hands inside a leaf wreath (it echoes the logo), with a needle and thread
  - wax-print-inspired pattern tiles in `static/assets/patterns/`: concentric "sun" band, zigzag, lozenge, seeds. These are abstract and not copied from any brand.
  - four aid-area "fabric patch" emblems
  - six gallery illustrations
  - a "hoop map"
  - a cross-stitch motif
  - dashed "stitch" borders on cards. These are an inset `::before` with a dashed border, so they need no extra markup.
- **Signature motion: the thread** (`src/js/site.js`). A dashed embroidery thread is generated from the positions of `[data-knot]` sections. It runs down the page gutters, crosses between sections in an S-curve, and leaves a knot at each crossing. It sews itself in as you scroll: an SVG mask is revealed by `stroke-dashoffset`, a needle dot follows the tip, and knots fill mustard as they are reached. On mobile it becomes a gentle line along the left edge. With `prefers-reduced-motion` the thread is drawn complete and static, and reveal and sway animations are disabled. The hoop also sways slightly and the map threads drift.
- **Privacy by design.** Illustrations stand in for children's photos. No photo is a single-child close-up, and `boy-portrait-bw` is not used.

## Features

- **Timeline** (`/fr/notre-histoire/`, `/en/our-story/`), from 2014 to today:
  - a sticky year scrubber that tracks scroll and centres the current year
  - filter chips by type of action, with a live-region count
  - a progress thread down the centre
  - alternating cards on desktop
  - `<details>` for "learn more"
  - Only 2014 is marked **Fait confirmé**. Every other milestone carries an «Exemple — à confirmer» badge.
- **Four aid areas** (`/missions/`): 3D flip cards. The front shows the emblem and summary. The back shows "how it works" and "how you can help". The hidden face is `inert`, focus moves to the back, and Esc flips back. With reduced motion the flip becomes a crossfade. Without JS both faces show stacked.
- **Where we serve** (`/fr/ou-nous-servons/`, `/en/where-we-serve/`):
  - concentric hoops: Montréal (confirmed), several Canadian cities, and international `[à confirmer]`
  - zone buttons (`aria-pressed`, arrow keys) that drive the info panel and highlight the ring, and clicking a ring also works
  - symbolic dots, with a visible caption and a "Why no exact locations?" panel that explains child safety
- **Volunteer** (`/fr/benevolat/`, `/en/volunteer/`): a 4-step form.
  - Steps: you → skills chips (12, including cuisine, transport, enseignement, traduction, prière and photo) → days, times, frequency and languages (including Lingala and Swahili) → message, a review summary and consent.
  - Each step is validated, with errors linked through `aria-describedby`.
  - It has a stepper and a live "Étape 2 sur 4" status, plus a honeypot and a Turnstile placeholder.
  - The confirmation is personalised by first name.
  - Without JS it falls back to one long form.
- **Gallery** (`/mediatheque/`):
  - 11 photos and 6 illustrations, with category filters
  - a lightbox built on `<dialog>`: focus is trapped and restored on close, ← → navigate within the *filtered* set, Esc and backdrop click close it, and it shows a counter and caption
  - thumbnails link to the full image, so it works without JS
- **Workshops** (`/ateliers/`, `/workshops/`): four formats, upcoming workshops (the `atelier`-category events, with Event JSON-LD), the topics offered, and a "propose a workshop" call to action.
- **Events**: a filterable list with a date stamp, a detail page for each event, an `.ics` file per event plus a full `calendrier.ics` / `calendar.ics`, and Google Calendar links. Venues are city-level or "shared with registered volunteers". Past events drop out automatically at build time (`BUILD_DATE`).
- **News**: a featured post with a grid, articles with NewsArticle markup, previous/next links, sharing by email or copy-link, and RSS for each language.
- **Media**: a YouTube facade (local illustrated poster; the `youtube-nocookie` iframe is created only on click; the id is a labelled sample) and a custom audio player around `<audio>` (play/pause, seek with `aria-valuetext`, speed control, a 9-second sample tone, and a transcript).
- **Give**:
  - one-time or monthly giving, with impact amounts that rewrite the sentence "Your gift of $40 can provide…" (custom amounts also map to an impact)
  - a Zeffy button that is clearly a demo
  - an Interac card with a copy button
  - «Coordonnées bancaires sur demande» (no bank numbers are published)
  - tax receipts `[si enregistré]`
  - other ways to give, and transparency commitments
- **Also included:**
  - About: verbatim mission text, the meaning of the name, values, programmes, a team of placeholders (Frère Ronny plus `[à confirmer]`), an ethical-storytelling charter, and verses
  - Contact: a form, plus 211/911 guidance
  - Privacy (Law 25): privacy officer `[à confirmer]`, cookieless analytics, photo consent, CASL
  - a newsletter form in the footer (CASL consent)
  - a 404 page
  - a language-chooser root page

All copy is native French with English at parity. Placeholders such as `[à confirmer]` are automatically highlighted by `t()` in `src/templates/lib.mjs`. French typography (non-breaking spaces inside « » and before `: ; ! ?`, and curly apostrophes) is applied at build time.

## SEO and technical

- **Translated slugs** come from `src/templates/i18n.mjs` (`ROUTES`). The FR/EN switch on every page, including articles and events, links to the twin page.
- **Every page has:**
  - `lang` set to fr-CA or en-CA
  - a unique title and description (checked)
  - a canonical link
  - reciprocal hreflang for fr-CA, en-CA and x-default (on the two home pages x-default points to the `/` chooser)
  - Open Graph tags with `static/assets/og-{fr,en}.png`, generated by `scripts/og.mjs`
- **JSON-LD:**
  - an `@graph` with `NGO` (`@id` `https://lapaixducoeur.ca/#org`, including `DonateAction`) and `WebPage` on every page
  - `BreadcrumbList` on inner pages
  - `NewsArticle` on articles
  - `Event` with Montréal UTC offsets computed for EST/EDT
- **Sitemap and robots:** `sitemap.xml` with `xhtml:link` alternates (48 URLs), and `robots.txt` (disallows `/admin/`).
- **`_headers`:**
  - HSTS, nosniff, `X-Frame-Options: DENY` and `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy, COOP
  - a strict CSP (`script-src 'self'`, `style-src 'self'`): no inline scripts, and no `style=""` attributes (the checker verifies both). JSON-LD is the only inline `<script>`.
  - `/admin/*` detaches the CSP (`! Content-Security-Policy`) and sets a looser one for Sveltia (unpkg, GitHub API), plus `noindex` and `no-store`.
- **Performance:**
  - no framework and no CDN JS. Each page loads `boot.js` (46 B), `site.js` (~10 KB) and at most two page scripts, ~15 KB in total at most.
  - responsive `<picture>`: webp plus jpg, 480w and 960w variants, `width` and `height` set, lazy loading
  - fonts preloaded
  - the CSS is one file
- **Forms** (contact, newsletter, volunteer, give):
  - validated in JS, with a honeypot and a `<!-- Turnstile -->` placeholder
  - on success they show a friendly confirmation; nothing is sent
  - **In production**, a Cloudflare Pages Function at each `action` (`/api/contact`, `/api/newsletter`, `/api/benevolat`) would verify the Turnstile token and the honeypot, then email or store the submission.

## Editing content (Sveltia CMS)

- **Admin:** `/admin/` loads Sveltia CMS 0.249.1 (pinned). Its config, `admin/config.yml`, uses `i18n.structure: single_file`, locales `[fr, en]` and default `fr`, so French and English appear side by side.
- **Collections:**
  - **News**, **Events** and **Media**: folder collections, one JSON file per entry shaped `{ "fr": {...}, "en": {...} }`
  - **Settings**: email, Interac, Zeffy URL, charity number, verse of the week, social links (empty = shown as `[liens à confirmer]`)
  - **Pages**: all 13 page-copy files
- **Images:** uploads go to `static/assets/uploads` (`/assets/uploads`). Known photos referenced as `/assets/img/<name>-<w>.jpg` are upgraded at build time to a responsive `<picture>`. New uploads render as a plain lazy `<img>`; in production, Astro image processing would add variants.
- **Regenerating the config:** the page and settings fields in `admin/config.yml` are generated from the content shapes by `node scripts/cms-config.mjs`. This matters because the CMS drops undeclared keys on save, so re-run the script after adding a key.
- **Before go-live:** set `backend.repo` and deploy the Sveltia CMS authenticator Worker (`base_url`).

## Files

```
build.mjs               content + templates -> dist/ (zero dependencies, Node 22)
content/                settings.json, pages/*.json, news/*.json (4), events/*.json (7), media/*.json (19)
src/templates/          layout.mjs (head/header/footer/SEO), pages.mjs, svg.mjs (illustrations), i18n.mjs (routes, UI strings), lib.mjs
src/css/site.css        design system
src/js/                 boot, site (nav, forms, filters, thread), timeline, cards, map, volunteer, gallery, media, give
src/images.json         photo variant sizes (made once with PIL from ../shared/assets)
static/                 _headers, robots.txt, icons, fonts, patterns, img, audio, og images
admin/                  Sveltia CMS
scripts/serve.mjs       preview server that applies _headers
scripts/check.mjs       QA: links, SEO, hreflang reciprocity, inline script/style, then Playwright at 375 and 1440 px
scripts/og.mjs          renders the OG images (Playwright, dev only)
scripts/cms-config.mjs  generates admin/config.yml
```

## Verification

`node build.mjs`, then `node scripts/serve.mjs 8130 &`, then `node scripts/check.mjs`:

- **Static checks**, on 52 HTML pages:
  - every internal `href`/`src`/`srcset` resolves
  - titles and descriptions are unique
  - canonical, OG, NGO, DonateAction and BreadcrumbList are present
  - hreflang is reciprocal
  - there are no inline scripts or styles
- **Browser checks**, every page at 375 and 1440 px, with CSP enforced: no console errors, no 4xx, exactly one H1, alt on every image, no horizontal overflow.
- **Interaction checks** (26): flip and focus, timeline filter and scrubber, map buttons and arrow keys, volunteer step validation and confirmation, lightbox focus trap, filtered navigation and focus return, YouTube facade, audio playback, give impact text, newsletter validation, mobile menu, the language switch on articles, and the thread under reduced motion. All pass.

Screenshots are in `screenshots/` (`home-desktop.png`, `home-mobile.png`).

## Known gaps

- **Placeholder data:** every figure, date after 2014, venue, team name, country, testimonial and event is a labelled sample awaiting the client. The YouTube id and the audio file are placeholders.
- **Forms and donations:** forms post nowhere until the Pages Functions exist. The Zeffy link is a placeholder URL.
- **Illustrations:** they are original but made programmatically. An illustrator could refine the hands and the clothes scene for the final launch.
