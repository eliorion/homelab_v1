# La Paix du Cœur: brainstorming for 5 site reworks

Research date: 2026-11-09. Three research agents worked in parallel:
1. Inventory and audit of the current site, lapaixducoeur.ca.
2. A survey of strong nonprofit and child-welfare websites and of 2025–2026 design trends.
3. Best practice on security, SEO and content management for a small bilingual charity in Quebec.

This file condenses what they found and turns it into five distinct concepts. The sites themselves are in `site-1-*` … `site-5-*`.

---

## 1. What the client asked for

| # | Client goal (French original, paraphrased) | What we deliver in every concept |
|---|---|---|
| 1 | Look more modern, professional and attractive | Five different art directions, all with real typography, a proper colour system and fast, responsive layouts |
| 2 | Stronger security | A static site with no database, no `wp-login` page and no plugins to patch. Security headers via `_headers` (CSP, HSTS, etc.). Donations go through a hosted platform. Bank details are no longer published |
| 3 | Better visibility and search ranking | Bilingual `/fr/` and `/en/` addresses with hreflang. Unique titles and meta descriptions. NGO, Event and NewsArticle structured data (JSON-LD). A sitemap. Fast pages and accessibility (WCAG 2.2 AA) |
| 4 | Easy content management (images, video, audio, news, events) | Content lives in plain files edited through **Sveltia CMS** at `/admin`, a form-based editor with French and English side by side. Staff only fill in forms |
| 5 | Convey love, compassion and the wish to help orphans | Faith-rooted, dignity-first storytelling, a warm visual language, and the heart-in-hands logo used as a recurring motif |
| 6 | Not just a showcase: communication, awareness, mobilization | Each concept puts its weight on a different engine: giving, stories, community, events or campaigns |

## 2. Audit of the current site

The site runs on WordPress with the Colibri theme, hosted on OVH, and is in French only. Main findings:

- **SEO:** every page has an empty `<title>`. There are no meta descriptions or Open Graph tags. The home page has four H1 headings while inner pages have none. One link is broken (`/enfants-orphelins` returns 404). The WordPress "Sample page" and "Hello world" defaults are still published.
- **Security:** the WordPress username is exposed through the author archive, and `readme.html` is public. There are no security headers and the PHP version is disclosed. Two form plugins are installed. **The full bank account, transit and SWIFT numbers are published in plain text**, which invites fraud and impersonation.
- **Content:** there are no news posts, events, team, figures, testimonials or English version. Almost every photo is a stock image, some unrelated (gold coins, a highway). No image has alt text. The French text has typos (nécissiteux, Accadémique, Orphélins, «Aucune évènement», «Contacter nous»).
- **Speed:** about 15 Google Font families load on every page, along with 400–750 KB full-size background images and 17–26 scripts.
- **Giving:** donors have no way to pay online and no tax-receipt information. The PayPal option was planned but never wired up.

What is worth keeping:
- the logo: a green heart held by two hands inside a leafy wreath
- the name *Kimia Na Motema* (Lingala for "peace of the heart")
- the Bible verses (Ps 82:3, Jas 1:27, Prov 19:17)
- the mission text, the 2014 founding in Montréal, and the four aid areas: food, clothing, school support, and material or financial help
- the programmes: food drives, street outreach («maraudes»), training workshops, and support for other associations

## 3. Inspiration (sites studied)

| Site | What we borrow |
|---|---|
| charity: water | A hopeful rather than pitiful tone. A monthly giving circle ("The Spring") that shows donors their impact. Donation amounts that each say what they pay for |
| Hope and Homes for Children | Four dignity principles. Stories told by the people closest to the children. A campaign that never needed a child's face |
| SOS Children's Villages | Sponsoring a *place or programme* rather than choosing a child from a catalogue |
| Compassion / World Vision Canada | A letters-and-relationship model. A gift catalogue for gifts "in honour of" someone, which works especially well at Christmas |
| The Children's Society, WaterAid | Every figure paired with a story. Donate buttons that say what the money does |
| Obama Foundation | Restraint: only five top-level paths through the site |
| SolarAid, Farm Africa | The cause turned into an interaction (a light that follows the cursor). Type that animates on scroll to carry the story's turn |
| Coptic Orphans | Show children's resilience and joy, never pity |
| Fondation des Canadiens (Montreal Canadiens Foundation) | A bilingual Quebec site that won an Awwwards Honorable Mention |

## 4. Principles shared by all five concepts

1. **Hope before need.** Show the moment things turn around, not the deprivation, and no "poverty porn". Children appear in group shots, from behind, through their hands, or as illustrations. We use first names only and never name an exact place. An *Ethical storytelling* commitment is published on the site.
2. **The faith identity is honoured, not hidden.** The client is a Christian association and uses Messianic vocabulary (Yéhoshoua, Elohim). Scripture, prayer support and a prayer wall are part of the identity, and each concept sets how prominent they are.
3. **French first, English at full parity.** This follows Quebec's French-language law (Bill 96). The French is written natively, not translated. A visible FR/EN switch keeps the visitor on the matching page.
4. **No invented facts.** Wherever the client has to supply real data (figures, charity number, team, countries), the prototype shows a clearly marked placeholder: `[à confirmer]` in French, `[to confirm]` in English.
5. **Safe giving.** We recommend a **Zeffy** embed (Montreal-based, free for nonprofits, automatic CRA tax receipts), with **Interac** e-Transfer as the alternative. Bank details are given only on request.
6. **Law 25.** A bilingual privacy policy names a privacy officer. Analytics are cookieless, so no consent banner is needed. The site shows a commitment on consent for children's photos.

## 5. Recommended technology (for production)

| Layer | Choice | Why |
|---|---|---|
| Site | Static HTML generated from content files. The prototypes use a zero-dependency Node build; production would move to **Astro** | No server code means almost nothing to attack, near-perfect speed scores, and free hosting |
| Hosting | **Cloudflare Pages** (Netlify works too) | Free, automatic HTTPS, a global network, and a `_headers` file for security headers |
| Content editing | **Sveltia CMS** (Decap-compatible) at `/admin`, with GitHub login | Form-based and bilingual; images upload by drag and drop; drafts and reviews are possible |
| Donations and tickets | **Zeffy** (CanadaHelps as a second listing) | 0% fees and bilingual CRA tax receipts |
| Video and audio | YouTube (embedded from the youtube-nocookie domain, loaded only on click) or Vimeo; a podcast host such as Spotify for Creators or Buzzsprout | No heavy files in the site, and players don't slow the page |
| Forms | A honeypot field plus Cloudflare Turnstile, verified on the server | No reCAPTCHA tracking |
| Analytics | Cloudflare Web Analytics | No cookies, so it fits Law 25 without a banner |
| Visibility | Google for Nonprofits, Ad Grants (up to $10k USD a month in search ads), a Google Business Profile, Search Console | Visibility for free |

Alternatives:
- **Hardened managed WordPress** with Polylang, if staff insist on WordPress. It needs weekly updates.
- **Wix Studio Multilingual**, if there is no developer at all. It brings vendor lock-in and weaker SEO control.

## 6. Feature pool (45 ideas, grouped)

- **Giving:** amounts that say what they fund ("$25 = school supplies"); monthly giving circle «Le Cercle du Cœur»; gifts "in honour of" someone with an e-card; a Christmas gift catalogue; sponsoring a *programme* rather than a child; birthday fundraisers; a legacy-giving page; gifts in kind (a wish list); an option to cover the fees.
- **Transparency:** impact counters; a chart of where each dollar goes that responds to the amount; a project tracker; annual reports as web pages; a page for the CRA number and the board; a safeguarding policy; an ethical-storytelling charter.
- **Stories and media:** a story hub with tags; long-form scroll stories; "where are they now" follow-ups; a podcast «Les voix du cœur» with bilingual transcripts; a photo and video gallery; a children's art gallery (with consent); a field journal.
- **Mobilization:** volunteer sign-up matched by skills; a calendar of food drives and street outreach with .ics files; an events calendar with Zeffy tickets; an ambassador and fundraising programme; toolkits for churches and schools; a moderated prayer wall and messages of hope; a newsletter with chosen topics, consent compliant with Canada's anti-spam law (CASL); a countdown campaign with a progress bar; shareable cards for social media.
- **Platform:** FR/EN switch on every page; a high-contrast option; captions everywhere; a bilingual FAQ; an app-like (PWA) install option for regular supporters.

## 7. The five concepts

| # | Name | Art direction | Main engine (features it emphasizes) |
|---|---|---|---|
| 1 | **Lumière d'espérance** (Light of Hope) | Bright, hopeful and minimal, like the sunrise: peach-to-gold gradient, large geometric sans-serif, a soft light following the cursor | **Giving and transparency:** amount buttons tied to impact, the monthly «Cercle du Cœur», impact counters, a chart of where each dollar goes, a transparency page |
| 2 | **Lettre d'amour** (Love Letter) | Warm paper texture, ink-blue serif, handwritten accents, rose-clay colour, slow fades | **Stories and faith:** story hub, a «Les voix du cœur» audio player with transcripts, a moderated prayer and hope wall, letters of encouragement, the verse of the week |
| 3 | **Kimia** (Peace) | A folk, embroidered, illustration-led look that nods to the Kimia Na Motema heritage: stitched heart, terracotta, sage, mustard and plum; lines of thread connecting the sections | **Mission and journey:** a timeline since 2014, the four aid areas shown as illustrated cards, a privacy-safe map at region level, volunteer sign-up by skill, the gallery |
| 4 | **Chaleur du Nord** (Northern Warmth) | Calm and Nordic with a Quebec feel: snow, pine green, maple red, birch; documentary photos | **Local community mobilization:** an events and street-outreach calendar with .ics files, a food-drive finder, volunteer shifts, toolkits for churches and schools, newsletter topic choices, news |
| 5 | **Cœur ouvert** (Open Heart) | A bold editorial magazine: large condensed headlines, off-white and ink with a single coral accent, black-and-white photos with colour accents, type that zooms on scroll | **Awareness and campaigns:** a scroll story, a Christmas campaign with a progress bar, ambassador and fundraising pages, shareable quote cards, video hub, press kit |
