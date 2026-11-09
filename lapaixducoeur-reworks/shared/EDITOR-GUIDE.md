# Editor guide: adding content without a developer

This guide is for La Paix du Cœur staff and volunteers. It applies to all five concepts.

Everything is done from a phone or a computer, in two familiar places:

| I want to… | Where | Time on the site |
|---|---|---|
| Add a **maraude, food drive, workshop, prayer evening** (including weekly ones) | **Google Calendar**, «La Paix du Cœur — Événements» | Within 1 hour, automatically |
| Cancel or move **one date** of a recurring event | Google Calendar: open that date → *Delete this event* or edit only this event | Within 1 hour |
| Add a **special event** with a long text, photo, ticketing | Site admin `/admin` → **Événements** → *New* | 1–2 minutes after *Publish* |
| Post a **news item** (text + photos) | `/admin` → **Nouvelles** → *New* | 1–2 minutes |
| Add a **video** | Upload to YouTube, then `/admin` → **Médiathèque** → paste the link | 1–2 minutes |
| Add an **audio / podcast episode** | Upload to the podcast host (Spotify for Creators / Buzzsprout), then `/admin` → paste the link + transcript | 1–2 minutes |
| Add **photos** to the gallery | `/admin` → **Médiathèque** → drag and drop | 1–2 minutes |
| Change the **verse of the week**, email, donation link | `/admin` → **Réglages** | 1–2 minutes |
| Publish **right now** (don't wait for the hour) | GitHub → *Actions* → «Publish site» → *Run workflow* | about 1 minute |

---

## 1. Events: Google Calendar is the source of truth

### One-time set-up (about 10 minutes, done once)

1. In Google Calendar (the association's Google account), create a new calendar named **La Paix du Cœur — Événements**.
2. Open *Settings → Access permissions* and tick **Make available to public**. Use this calendar only for public events.
3. Under *Integrate calendar*, copy the **Public address in iCal format**. Give it to whoever runs the site; it goes into the `CALENDAR_ICS_URL` setting. Also copy the **public URL**, which goes into `/admin` → Réglages → `calendar_google_public_url`.
4. Add the volunteers who coordinate events as calendar editors under *Share with specific people → Make changes to events*. They don't need access to anything else.

### Writing an event

| Field | What to write | Example |
|---|---|---|
| **Title** | French title, then ` \| `, then English title | `Maraude du jeudi soir \| Thursday-night street outreach` |
| **Location** | The public meeting place. **Never** a child's home or an orphanage address | `Sortie du métro Atwater, Montréal` |
| **Time / repeat** | As usual; "Weekly on Thursday" works | |
| **Description** | French text. Then a line containing only `EN`, then the English text | see below |

Optional lines in the description, each on its own line, in French or English, anywhere in the text:

```
Catégorie: maraude          (maraude, collecte, atelier, prière, gala)
Inscription: https://www.zeffy.com/…   (registration / tickets link)
Quartier: Saint-Michel
Rendez-vous: sortie du métro Atwater
Prix: Gratuit
Image: fruit.jpg            (a photo already on the site; otherwise one is chosen by category)
```

A full description looks like this:

```
Repas chauds, vêtements chauds et écoute auprès des personnes sans-abri du centre-ville.
Aucune expérience requise.
Catégorie: maraude
Rendez-vous: sortie du métro Atwater
EN
Hot meals, warm clothes and a listening ear downtown. No experience needed.
```

- **No English text?** The English page shows the French text marked "(In French)". Adding English is better.
- **Category omitted?** The site guesses it from words like *maraude*, *collecte*, *atelier*, *prière*.
- **Internal meetings:** set the event's visibility to **Private**. Private events are never published.
- **Cancel one date:** delete that occurrence only. The site removes it at the next sync.
- **Past events** drop off the site automatically.

### What visitors get

Every events page has a **«S'abonner à notre agenda / Subscribe»** block (Apple, Google, Outlook, copy link). People who subscribe see new events appear in their own calendar app without doing anything, which is the best reminder tool the association can have.

---

## 2. The site admin (`/admin`)

The admin page is **Sveltia CMS**. You sign in with GitHub. Two-factor authentication is mandatory; turn it on in GitHub's settings.

- **French and English side by side.** Each entry shows the French and English versions together. Write the French first.
- **Translate button.** Sveltia can pre-fill the English with **DeepL**. Under *Preferences → Translation*, paste a free DeepL API key, then use the 🌐 *Translate* button on any field. Always reread the result: it is a starting point, not a final text. Faith vocabulary (Yéhoshoua, Elohim) must stay as the association writes it.
- **Drafts.** *Save* keeps a draft. *Publish* puts it online in 1–2 minutes. If the editorial workflow is enabled, a second person approves before publication.
- **Photos.** Drag and drop JPG or PNG files. Keep them under about 2 MB and about 2000 px wide; phone photos are fine.
  - The **description (alt text)** is required in both languages. Describe what is shown for people who can't see it, e.g. «Des bénévoles trient des denrées».
- **Videos.** Upload to YouTube, setting *Public* or *Unlisted*. Paste the link. The site loads the player only when someone clicks, which keeps pages fast and private.
- **Audio.** Upload episodes to a podcast host and paste the link. Paste the **transcript** too: it helps deaf visitors, and Google reads it.

### Before you publish a photo of a child: the checklist

- [ ] Written consent from the guardian, plus the child's own agreement if they are old enough. File it in the shared consent folder.
- [ ] First name only, or no name. No school, no exact place, no family story that could identify the child.
- [ ] Dignity: joy, activity, hands, from behind. Never a distress close-up.
- [ ] No location data in the file. Turn off location in the phone's camera settings. Before production, the developer should make the build strip metadata from uploaded images.

---

## 3. When something looks wrong

| Symptom | Fix |
|---|---|
| A Google Calendar event isn't on the site after an hour | Check the calendar is **public** and the event isn't *Private*. Then run *Publish site* manually |
| The English page shows "(In French)" | Add the `EN` section to the event description |
| A news item disappeared | `/admin` → open it → check it isn't still a *Draft* |
| Something is broken after a change | GitHub keeps every version. The developer can restore the previous one in one click |

**Who to contact:** [à confirmer: name and email of the person responsible for the site]
