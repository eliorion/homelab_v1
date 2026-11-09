# Concept 5 — «Cœur ouvert» / Open Heart

A bold editorial, magazine-style rework of lapaixducoeur.ca for **La Paix du Cœur / Kimia Na Motema**, built for awareness and fundraising campaigns. French first, English at full parity.

```bash
node build.mjs                          # content/ + src/ + static/ -> dist/  (Node 22, zero dependencies)
python3 -m http.server -d dist 8150     # preview at http://localhost:8150
```

`BUILD_DATE=2026-11-09T12:00:00-05:00 node build.mjs` pins "now". It drives the countdowns, the "days until Christmas" ticker and which events count as upcoming.

## Art direction

| | |
|---|---|
| Palette | Paper `#F5F1EA`, paper-2 `#EAE3D8`, ink `#141414`, and **one** accent: coral `#E8503A` |
| Contrast | Coral on paper is 3.3:1, so it is used for **large text, fills and borders only**. Small coral text on paper uses `#B23A26` (5.3:1). Coral on ink is 4.95:1, and so is ink on coral, which is why coral buttons have ink labels. Muted text: `#5C564E` on paper (6.4:1), `#ADA79E` on ink (7.7:1) |
| Type | **Anton** (condensed display, always uppercase) + **Source Serif 4** (body, italic for verses and pull quotes). Self-hosted latin woff2, about 208 KB total. Self-hosting means no Google request (Law 25) and lets the canvas card generator use the real fonts |
| Photos | Black and white via CSS `grayscale()`. Key images get a coral **duotone**: the grayscale image is set to `mix-blend-mode: multiply` over a coral background. Offset coral/ink "print" shadows. Colour returns on hover |
| Layout | Asymmetric 12-column grid, oversized outlined section numbers (`01`–`14`), folio rules, drop caps, big pull quotes, figures set as type ("2014 · 4 · 3 · 0 $" — real facts only, no invented statistics) |
| Section themes | `.theme-ink`, `.theme-coral` and `.theme-paper2` swap a small set of CSS variables (`--fg`, `--bg`, `--accent-text`, `--focus`…), so every component re-colours itself and keeps AA contrast |

**Signature motion: «ESPOIR / HOPE».** On the home page, a 280vh section pins the word ESPOIR, which zooms from 22% to full bleed as you scroll. The lead line fades out and the follow-up line fades in. It is driven by a registered custom property `--p`:
- **CSS scroll timelines** (`animation-timeline: view()`) where supported, so it runs off the main thread.
- A **JS fallback** (rAF + IntersectionObserver, `site.js`) elsewhere.
- With **reduced motion** or neither of the above, it is a static, fully legible section.

Headings and blocks also reveal on scroll through CSS `view()` timelines. They never hide content when the browser lacks support.

## Pages (FR / EN, translated slugs)

| | FR | EN |
|---|---|---|
| Language chooser | `/` | `/` |
| Home — scrollytelling in 4 chapters | `/fr/` | `/en/` |
| About + ethical storytelling charter | `/fr/a-propos/` | `/en/about/` |
| Missions | `/fr/missions/` | `/en/missions/` |
| News + articles + RSS | `/fr/nouvelles/…` | `/en/news/…` |
| Events + event pages + `.ics` | `/fr/evenements/…` | `/en/events/…` |
| Media (gallery, podcast) | `/fr/mediatheque/` | `/en/media/` |
| Video hub | `/fr/videos/` | `/en/videos/` |
| Give (Zeffy placeholder + Interac) | `/fr/soutenir/` | `/en/give/` |
| Campaigns index + campaign pages | `/fr/campagne/noel-2026/` | `/en/campaign/christmas-2026/` |
| Ambassadors / peer fundraising | `/fr/ambassadeurs/` | `/en/ambassadors/` |
| Shareable verse cards | `/fr/cartes/` | `/en/cards/` |
| Press kit | `/fr/presse/` | `/en/press/` |
| Contact | `/fr/contact/` | `/en/contact/` |
| Privacy (Law 25) | `/fr/confidentialite/` | `/en/privacy/` |
| 404 (bilingual) | `/404.html` | |

## Features (the awareness engine)

- **Home as a narrative.** Ps 82:3 opens as the headline. Then: 01 the need (dignity-first, no faces in distress) → 02 the heart of the Lord turned to the weakest (mission, Jas 1:27) → ESPOIR → 03 what we do (figures, the 4 aid areas, the 3 programmes) → 04 what you can do (coral chapter, Prov 19:17). Followed by the campaign spotlight, the journal, the agenda and a featured video.
- **Christmas 2026 campaign** (CMS collection `campaigns`): vertical SVG thermometer + bar, raised vs goal, donors; a live countdown to 25 Dec 2026 (Montréal time); a ×2 matching-gift banner; the gift catalogue (basket, coat, school supplies, boots, outreach meal, child's gift) with add buttons, quantity steppers, a total, the total after matching, an "in honour of" field, and **Continue to Zeffy** (placeholder notice). Share bar. A site-wide coral ticker shows days left; it is set in Settings → Banner.
- **Ambassadors**: 3 staggered steps, a sample leaderboard (an accessible `<table>` that stacks on mobile), and a "Start your page" form (occasion, date, goal, campaign, CASL-style consent).
- **Shareable cards**: `<canvas>` generator. Pick one of 4 verses/messages or write your own (140 characters), 3 styles (coral / ink / paper), square 1080² or story 1080×1920. The text is auto-fitted and drawn in Anton and Source Serif. **Download PNG**, plus **Web Share API with files** where `navigator.canShare({files})` is true.
- **Video hub**: click-to-load facades, which load nothing from YouTube until clicked, then `youtube-nocookie.com`. Clickable **chapters** seek the embed (`start=`). Captions note, with `cc_load_policy=1` and `cc_lang_pref` set to the page language. Placeholder id `M7lc1UVf-VE` is labelled as a sample.
- **Press kit**: FR + EN boilerplates (short/long) with copy buttons, key facts, colour and black PNG logos to download, free-to-use B&W photos, media contact.
- **Give**: once/monthly toggle, amounts that say what they fund (`[Exemple]`), live impact sentence, Zeffy placeholder, an Interac box with a copy button, «Coordonnées bancaires sur demande», tax receipts marked «[si enregistré]».
- **Podcast** «Les voix du cœur»: custom player (play/pause, scrubber, time, speed) around `<audio>`, with a transcript. The audio is an 8-second generated tone (`static/assets/audio/`).
- Newsletter in every footer (topics + consent), contact form, ambassador form. Each has a **honeypot** + a **Turnstile placeholder comment** and shows a JS confirmation. **In production a Cloudflare Pages Function** (`/api/contact`, `/api/newsletter`, `/api/ambassador`) receives the POST and verifies Turnstile server-side.
- A "Sommaire" contents overlay (magazine table of contents) with focus trap and Esc. Without JS it falls back to CSS `:target`.

Every unknown fact is visibly marked: «Exemple — à confirmer» / "Sample — to confirm" badges, or `[à confirmer]` inline. This covers figures, the matching donor, the leaderboard, events, news, team, charity number, privacy officer and social links.

## SEO, security, accessibility

- Every page has: `<html lang="fr-CA|en-CA">`, a unique title and description, a canonical link, reciprocal hreflang (fr-CA, en-CA, x-default — `/` for the homes, the FR page otherwise), and Open Graph + Twitter card tags. OG images for the site, campaign and ambassadors are 1200×630 JPGs in the site's style.
- JSON-LD `@graph`: **NGO** (`@id` `…/#org`, `potentialAction` DonateAction) and WebPage on every page; **BreadcrumbList** on inner pages; **NewsArticle**; **Event** (on the list and on detail pages).
- `sitemap.xml` with `xhtml:link` alternates, `robots.txt`, RSS per language, `.ics` per event per language (RFC 5545 folded lines), plus a Google Calendar link.
- `dist/_headers` (Cloudflare Pages):
  - HSTS, nosniff, Referrer-Policy, Permissions-Policy, `X-Frame-Options: DENY` + `frame-ancestors 'none'`, COOP.
  - A strict CSP: `script-src 'self'`, `style-src 'self'` (no inline scripts or `style=` attributes anywhere; progress bars are SVG `width` attributes and runtime values use CSSOM), and `frame-src` limited to youtube-nocookie.
  - `/admin/*` removes those headers with `!` and sets a looser CSP for Sveltia (unpkg, GitHub API).
  - When the real Zeffy embed and Cloudflare Web Analytics are added, extend `frame-src` with `https://www.zeffy.com`, `script-src` with `https://static.cloudflareinsights.com`, and `connect-src` with `https://cloudflareinsights.com`.
- Accessibility:
  - Skip link, exactly one H1 per page, alt text on every image (decorative poster and brand images use `alt=""` with a labelled parent), and visible 3px focus rings in a per-theme colour.
  - `role="progressbar"` with readable `aria-valuetext`; a countdown with a static screen-reader sentence instead of a ticking live region; a polite live region on the basket total.
  - Labelled form controls with 44–48px targets, and full `prefers-reduced-motion` support.
- Performance: no framework and no CDN JS. `site.js` is about 11 KB, plus `campaign.js` or `cards.js` on their pages only, so at most about 16 KB per page. Images use responsive `<picture>` (webp + jpg, 640w and full sizes, width and height set, lazy below the fold); the build reads image dimensions itself. Two preloaded fonts.

## Editing content (Sveltia CMS at `/admin`)

Everything staff edit lives in `content/` as JSON with `fr` / `en` keys (Sveltia i18n `structure: single_file`, default locale `fr`). Collections:
- **Campagnes**: goal, raised, donors, end date, matching, gift catalogue, story.
- **Nouvelles**, **Événements**, **Médiathèque**: video id + chapters, audio + transcript, photos.
- **Pages**: every page's copy, including the home chapters and the ESPOIR word.
- **Réglages**: email, Zeffy URL, charity number, social links, verse of the week, campaign ticker.

Uploads go to `static/assets/uploads` (`/assets/uploads/…`). Before going live, set `backend.repo` in `admin/config.yml` (and optionally `base_url` for an OAuth worker). Sveltia is pinned to `@sveltia/cms@0.250.2`.

Rules the build relies on:
- Slugs are per-language fields (`slug`): lowercase letters, digits and hyphens.
- Images referenced from content must exist under `static/`. A sibling `.webp` and a `-640` variant are picked up automatically if present.
- Event dates are ISO with an offset (`2026-12-19T18:00:00-05:00`).
- Only **one** campaign should be `active` at a time. It is the one shown in the home spotlight, the give page and the ticker.

## Layout of this folder

```
build.mjs            orchestrator: pages, .ics, RSS, sitemap, root chooser, 404, asset hashes
src/i18n.mjs         routes (translated slugs) + UI strings
src/lib.mjs          escaping, French typography (narrow no-break spaces), mini Markdown, <picture>, icons
src/layout.mjs       <head>/SEO/JSON-LD, masthead, Sommaire overlay, footer
src/pages.mjs        page renderers
src/css/site.css     the whole design system
src/js/              site.js (core), campaign.js (gift basket), cards.js (canvas generator)
content/             staff-editable JSON
admin/               Sveltia CMS
static/              _headers, robots.txt, favicon, fonts, images, audio, press logos
dist/                build output (committed for preview)
screenshots/         home-desktop.png, home-mobile.png (full page, reduced-motion render so the ESPOIR section shows its final state)
```

## Known gaps / to confirm with the client

- Zeffy form and ticketing links, the Turnstile site key, and the Pages Functions behind the forms are placeholders.
- All figures, events, news, the leaderboard, the matching donor, the team, the charity number, the privacy officer, social accounts and countries abroad are samples.
- The video id is a public placeholder; the podcast audio is a generated tone.
- The client logo is a raster PNG (480×416). An SVG version would sharpen the header mark and press kit.
