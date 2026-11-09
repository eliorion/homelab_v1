# Build brief: shared by all 5 reworks

Read `../BRAINSTORM.md` first. It covers the client goals, audit findings, principles, the tech choices and the five concepts. This brief adds the content and the technical contract every site must meet.

## Client content (verbatim French; use it, fix the typos, write native English)

- **Name:** L'association chrétienne **La Paix du Cœur / Kimia Na Motema**. "Kimia na motema" is Lingala for "peace of the heart". Founded in **2014 in Montréal**. Christian, non-profit, offers everything free of charge.
- **Faith vocabulary.** Keep the client's terms: Yéhoshoua (Jésus), Elohim, YHWH, Tehilim. In English write "Yehoshua (Jesus)" and "Elohim".
- **Hero verse:** «Défendez le faible et l'orphelin, rendez justice à l'affligé et au pauvre.» — Tehilim (Psaumes) 82:3
- **About:** «L'association chrétienne La Paix du Cœur / Kimia Na Motema est une œuvre inspirée par le Seigneur Yéhoshoua, portée par un groupe de chrétiens animés par l'amour d'Elohim et la compassion envers les personnes démunies. Nous œuvrons humblement et de manière désintéressée pour la seule gloire d'Elohim. Fondée en 2014 à Montréal (Canada), cette vision a vu le jour afin d'apporter soutien et espérance aux orphelins.»
- **Mission:** «Par la grâce du Seigneur, le Pourvoyeur et le Rémunérateur de ceux qui le cherchent, l'association chrétienne La Paix du Cœur a pour mission de révéler aux nations le Cœur du Seigneur, tourné vers les plus faibles, les veuves, les veufs, les orphelins, les démunis et les sans-abris sans distinction de langue, de couleur ou de race. Œuvrant dans un esprit d'amour et de service, cette association chrétienne à but non lucratif offre tout gratuitement, pour la seule gloire d'Elohim.»
- **Verses:**
  - «La religion pure et sans souillure devant notre Elohîm et Père, c'est de visiter les orphelins et les veuves dans leurs tribulations…» — Yaacov (Jacques) 1:27
  - «Celui qui a pitié du pauvre prête à YHWH, qui lui rendra son bienfait.» — Proverbes 19:17
- **Programmes:**
  1. Soutien aux nécessiteux: «Aide alimentaire, vestimentaire, financière et spirituelle aux personnes vivant des situations difficiles.»
  2. Ateliers de formation: «Ateliers, séminaires, conférences et campagnes de sensibilisation.» The goal is to make people self-reliant (autonomes).
  3. Aider d'autres associations: «Soutenir les projets d'autres associations porteuses de projets socio-humanitaires.»
- **Actions:**
  - Collectes alimentaires in supermarkets.
  - Maraudes (street outreach) «dans les rues de plusieurs villes du Canada à destination des sans-abri, des orphelinats et des étudiants».
- **Four aid areas:** Alimentaire, Vestimentaire, Académique, Matérielle ou financière.
- **Ways to support:** «Votre soutien par les prières, e-mails et encouragement est une bénédiction. Vous pouvez de même soutenir notre association financièrement, matériellement ou humainement.»
- **Contact:** lapaixducoeur.ca@gmail.com (also the Interac e-Transfer address). No phone, street address or social accounts are known. Show social links as `[à confirmer]` placeholders, or leave them out.
- **Unknown (always use marked placeholders, never invent):**
  - charity / CRA number
  - team and board ("Frère Ronny" is the only known name)
  - countries served abroad
  - figures and statistics
  - testimonials
  - real events and news

  Wherever you need a figure, a person, a date or a story, write sample content in the right shape and label it visibly: a small badge «Exemple — à confirmer» / "Sample — to confirm", or `[à confirmer]` inline. Sample events dated after 2026-11-09 are fine if they are labelled as samples.
- **Donating:**
  - Zeffy is the recommended online platform. Show a donate form or button that clearly says it would be powered by Zeffy (placeholder, no real embed URL).
  - Interac e-Transfer goes to the email above.
  - **Do NOT publish bank account numbers.** Write «Coordonnées bancaires sur demande» / "Bank details on request".
  - Mention CRA tax receipts as conditional: «[si enregistré]».

## Assets

`../shared/assets/` holds:
- `logo.png`: green heart in two hands inside a leafy wreath, 480×416, transparent background.
- The client's existing photos, as `.jpg` and `.webp`, max 1600 px wide: `children-joy`, `children-play`, `widows`, `elders`, `bible-study`, `bread-sharing`, `food-bank-volunteers`, `lunchboxes`, `fruit`, `clothing`, `library`, and `boy-portrait-bw`. **Do not** use `boy-portrait-bw` as a hero: it is a single-child pity close-up, against the dignity principles.

Copy the assets you use into your site's own folder at build time; each site must be self-contained. Inline SVG illustrations and patterns are encouraged. Don't hotlink external images. You may load Google Fonts with at most 2 families, or use system fonts.

## Technical contract

Each site lives in `lapaixducoeur-reworks/site-N-<slug>/`:

```
site-N-slug/
  README.md          concept, design system, features, how to build/edit (English)
  build.mjs          zero-dependency Node 22 script: content + templates -> dist/
  content/           everything staff edit (JSON or Markdown with front-matter), fr+en fields
    settings.json    site name, email, social, donate URL, verse of the week…
    news/*.md|json   ≥3 sample news posts
    events/*.json    ≥3 sample events
    media/*.json     gallery/video/audio items (video = YouTube id, audio = file URL or embed)
    pages/…          page copy as you see fit
  src/               templates, css, js
  admin/             index.html + config.yml for Sveltia CMS (i18n: structure multiple_files or single_file, locales [fr, en], default fr), with collections for news, events, media, settings and pages; media_folder set
  static/            _headers (security headers + CSP), robots.txt, favicon, assets
  dist/              build output (commit it so it can be previewed)
```

`node build.mjs` must produce `dist/` with:
- `dist/index.html`: a small language chooser, or a redirect to `/fr/` with links to both languages (no geolocation redirect).
- `/fr/…` and `/en/…` page trees with **translated slugs**. At least:
  - home: `/fr/`, `/en/`
  - about: `/fr/a-propos/`, `/en/about/`
  - missions: `/fr/missions/`, `/en/missions/`
  - news list and each article: `/fr/nouvelles/<slug>/`, `/en/news/<slug>/`
  - events list, with each event: `/fr/evenements/`, `/en/events/`
  - media / gallery: `/fr/mediatheque/`, `/en/media/`
  - support / donate: `/fr/soutenir/`, `/en/give/`
  - contact
  - privacy policy (Law 25: privacy officer `[à confirmer]`, cookieless analytics, photo consent)
  - plus whatever pages your concept's features need
- Every page has:
  - `<html lang>` and a unique `<title>` and meta description
  - a canonical link
  - **reciprocal hreflang** (fr-CA, en-CA, x-default)
  - Open Graph tags
  - a working FR/EN switch that goes to the *same* page in the other language
  - a skip link, one H1, alt text on every image, visible focus states, AA contrast
  - `prefers-reduced-motion` respected
- JSON-LD:
  - `NGO` with an `@id` on every page, with `potentialAction` DonateAction
  - `NewsArticle` on articles
  - `Event` on events
  - `BreadcrumbList` on inner pages
- `dist/sitemap.xml` with xhtml:link alternates, and `dist/robots.txt`.
- `dist/_headers`:
  - HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors / X-Frame-Options
  - a CSP compatible with what you actually load: **no inline scripts**, so put JS in files; inline JSON-LD `<script type="application/ld+json">` is fine under a `script-src 'self'` policy because it isn't executed
  - a looser CSP block for `/admin/*`
- Feeds: `.ics` file per event (plus "Add to calendar" links); an RSS feed for news per language is a bonus.
- Forms (contact, newsletter, volunteer, prayer wall…): a honeypot field plus a Turnstile placeholder comment. They must work visibly without a backend: on submit, show a friendly confirmation in JS and note in the README that a Cloudflare Pages Function would receive it in production.
- YouTube: use a click-to-load facade (thumbnail + button, then load the `youtube-nocookie` iframe). Use a plausible placeholder video id and label it as a sample.
- Audio: a styled player around `<audio>`. Put a tiny generated sample file in assets, for example a few seconds of soft tone made with ffmpeg, or point to a placeholder and label it. Include a transcript.
- Performance:
  - no frameworks and no JS libraries from CDNs
  - total JS under ~30 KB per page
  - responsive `<picture>` with webp plus a jpg fallback, `loading="lazy"`, width and height set
- Mobile first, tested at 375 px wide and 1440 px wide.

## Verify before you finish

1. `node build.mjs` runs clean.
2. Serve `dist/` (e.g. `npx --yes http-server dist -p <port>` or `python3 -m http.server -d dist <port>`). Use a port unique to your site: site N uses 81N0.
3. With Playwright (pre-installed; `require('playwright')`), load every page in both languages at 375 and 1440 px. Fail on:
   - console errors
   - 404s on internal links or assets
   - missing H1
   - missing alt
   - horizontal overflow on mobile
4. Look at screenshots of the home page (desktop and mobile) and at least two inner pages, and fix anything ugly. Save the final home screenshots as `screenshots/home-desktop.png` and `screenshots/home-mobile.png` (deviceScaleFactor 1, full page is fine) in your site folder.
5. Do **not** `git commit` or push. The coordinator does that. Don't touch other site folders or `../shared/`.

Report back briefly: what you built, the feature list, verification results, and any known gaps.
