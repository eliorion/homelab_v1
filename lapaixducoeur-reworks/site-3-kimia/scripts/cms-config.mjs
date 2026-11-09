#!/usr/bin/env node
// Writes admin/config.yml for Sveltia CMS. News/events/media are declared by hand; page and settings
// fields are inferred from content/pages/*.json so every key is declared (the CMS drops undeclared keys on save).
// Re-run after adding a key to a page file: node scripts/cms-config.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const json = (p) => JSON.parse(readFileSync(`${ROOT}${p}`, 'utf8'));
const label = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

function infer(name, v, i18n = true) {
  const f = { name, label: label(name) };
  if (Array.isArray(v)) {
    f.widget = 'list';
    if (typeof v[0] === 'object') f.fields = Object.entries(v[0]).map(([k, x]) => infer(k, x, null));
    else f.field = { name: 'item', label: 'Item', widget: 'string' };
  } else if (v && typeof v === 'object') {
    f.widget = 'object';
    f.fields = Object.entries(v).map(([k, x]) => infer(k, x, null));
  } else if (typeof v === 'number') f.widget = 'number';
  else if (typeof v === 'boolean') f.widget = 'boolean';
  else if (name === 'body') f.widget = 'markdown';
  else f.widget = String(v).length > 90 ? 'text' : 'string';
  if (i18n !== null) f.i18n = typeof v === 'number' || typeof v === 'boolean' ? 'duplicate' : i18n;
  return f;
}

const pageNames = { home: 'Accueil / Home', about: 'À propos / About', story: 'Notre histoire / Our story (frise)', missions: 'Missions', serve: 'Où nous servons / Where we serve', workshops: 'Ateliers / Workshops', volunteer: 'Bénévolat / Volunteer', events: 'Événements (intro)', news: 'Nouvelles (intro)', media: 'Médiathèque (intro)', give: 'Soutenir / Give', contact: 'Contact', privacy: 'Confidentialité / Privacy' };
const pages = readdirSync(`${ROOT}content/pages`).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const settings = json('content/settings.json').fr;
const SETTING_HINTS = {
  calendar_google_public_url: { label: 'Google Agenda — lien public (affichage web)', hint: 'Facultatif. Lien « URL publique de cet agenda » dans Google Agenda (Paramètres de l’agenda > Intégrer l’agenda). S’il est rempli, le site affiche « Voir dans Google Agenda ».' },
  calendar_ics_source: { label: 'Google Agenda — adresse iCal (synchronisation)', hint: 'Réservé à l’équipe : « Adresse publique au format iCal » de l’agenda. La tâche de synchronisation la lit ; elle n’est jamais affichée sur le site.' },
};
const settingField = (k, v) => (SETTING_HINTS[k] ? { ...infer(k, v), ...SETTING_HINTS[k], required: false, i18n: 'duplicate' } : infer(k, v));

const dup = 'duplicate';
const config = {
  backend: { name: 'github', repo: 'OWNER/REPO', branch: 'main', base_url: 'https://sveltia-cms-auth.EXAMPLE.workers.dev' },
  publish_mode: 'editorial_workflow',
  media_folder: 'static/assets/uploads',
  public_folder: '/assets/uploads',
  site_url: 'https://lapaixducoeur.ca',
  display_url: 'https://lapaixducoeur.ca',
  locale: 'fr',
  i18n: { structure: 'single_file', locales: ['fr', 'en'], default_locale: 'fr' },
  collections: [
    {
      name: 'news', label: 'Nouvelles / News', label_singular: 'Nouvelle', folder: 'content/news', format: 'json', extension: 'json', create: true, i18n: true,
      identifier_field: 'title', slug: '{{year}}-{{slug}}', summary: '{{date}} — {{title}}', sortable_fields: ['date', 'title'],
      fields: [
        { name: 'title', label: 'Titre / Title', widget: 'string', i18n: true },
        { name: 'slug', label: 'Adresse (slug) — minuscules et tirets', widget: 'string', i18n: true, pattern: ['^[a-z0-9-]+$', 'minuscules, chiffres et tirets'] },
        { name: 'date', label: 'Date', widget: 'datetime', time_format: false, date_format: 'YYYY-MM-DD', format: 'YYYY-MM-DD', i18n: dup },
        { name: 'category', label: 'Catégorie', widget: 'string', i18n: true },
        { name: 'sample', label: 'Contenu d’exemple (badge « à confirmer »)', widget: 'boolean', default: false, i18n: dup },
        { name: 'image', label: 'Image', widget: 'image', i18n: dup },
        { name: 'imageAlt', label: 'Texte alternatif de l’image (obligatoire)', widget: 'string', i18n: true },
        { name: 'summary', label: 'Résumé', widget: 'text', i18n: true },
        { name: 'body', label: 'Texte', widget: 'markdown', i18n: true },
      ],
    },
    {
      name: 'events', label: 'Événements / Events', label_singular: 'Événement', folder: 'content/events', format: 'json', extension: 'json', create: true, i18n: true,
      description: 'Astuce : les événements réguliers (maraudes, collectes) se gèrent plus simplement dans Google Agenda ; ils apparaissent ici automatiquement après la synchronisation. Utilisez ce formulaire pour les événements spéciaux avec photo et texte long.',
      identifier_field: 'title', slug: '{{fields.start}}-{{slug}}', summary: '{{start}} — {{title}}', sortable_fields: ['start', 'title'],
      fields: [
        { name: 'title', label: 'Titre / Title', widget: 'string', i18n: true },
        { name: 'slug', label: 'Adresse (slug)', widget: 'string', i18n: true, pattern: ['^[a-z0-9-]+$', 'minuscules, chiffres et tirets'] },
        { name: 'start', label: 'Début (heure de Montréal)', widget: 'datetime', format: 'YYYY-MM-DDTHH:mm', i18n: dup },
        { name: 'end', label: 'Fin (heure de Montréal)', widget: 'datetime', format: 'YYYY-MM-DDTHH:mm', i18n: dup },
        { name: 'category', label: 'Type', widget: 'select', options: ['collecte', 'maraude', 'atelier', 'priere', 'communaute'], i18n: dup },
        { name: 'venue', label: 'Lieu (ville ou « communiqué aux inscrits » — jamais d’adresse sensible)', widget: 'string', i18n: true },
        { name: 'summary', label: 'Résumé', widget: 'text', i18n: true },
        { name: 'body', label: 'Détails', widget: 'markdown', i18n: true },
        { name: 'image', label: 'Illustration', widget: 'image', required: false, i18n: dup },
        { name: 'ticketUrl', label: 'Lien Zeffy (billets / inscription)', widget: 'string', required: false, i18n: dup },
        { name: 'sample', label: 'Contenu d’exemple', widget: 'boolean', default: false, i18n: dup },
        { name: 'source', label: 'Source', widget: 'hidden', required: false, i18n: dup },
      ],
    },
    {
      name: 'media', label: 'Médiathèque / Media', label_singular: 'Média', folder: 'content/media', format: 'json', extension: 'json', create: true, i18n: true,
      identifier_field: 'title', summary: '{{type}} · {{title}}', sortable_fields: ['order', 'title'],
      fields: [
        { name: 'type', label: 'Type', widget: 'select', options: ['photo', 'illustration', 'video', 'audio'], i18n: dup },
        { name: 'category', label: 'Catégorie (galerie)', widget: 'select', options: ['alimentaire', 'vestimentaire', 'academique', 'communaute', 'foi', 'maraude', 'video', 'audio'], i18n: dup },
        { name: 'title', label: 'Titre', widget: 'string', i18n: true },
        { name: 'src', label: 'Image (photo, illustration ou affiche vidéo)', widget: 'image', required: false, i18n: dup, hint: 'Photo d’enfant : seulement avec consentement écrit du parent ou tuteur.' },
        { name: 'alt', label: 'Texte alternatif', widget: 'string', required: false, i18n: true },
        { name: 'caption', label: 'Légende', widget: 'text', required: false, i18n: true },
        { name: 'youtubeId', label: 'Identifiant YouTube (vidéo)', widget: 'string', required: false, i18n: dup },
        { name: 'audioUrl', label: 'Fichier audio', widget: 'file', required: false, i18n: dup },
        { name: 'duration', label: 'Durée (audio)', widget: 'string', required: false, i18n: dup },
        { name: 'transcript', label: 'Transcription (audio)', widget: 'markdown', required: false, i18n: true },
        { name: 'sample', label: 'Contenu d’exemple', widget: 'boolean', required: false, default: false, i18n: dup },
        { name: 'order', label: 'Ordre', widget: 'number', i18n: dup },
      ],
    },
    {
      name: 'settings', label: 'Réglages / Settings', i18n: true, editor: { preview: false },
      files: [{ name: 'settings', label: 'Réglages du site', file: 'content/settings.json', format: 'json', i18n: true, fields: Object.entries(settings).map(([k, v]) => settingField(k, v)) }],
    },
    {
      name: 'pages', label: 'Pages', i18n: true, editor: { preview: false },
      files: pages.map((p) => ({ name: p, label: pageNames[p] || p, file: `content/pages/${p}.json`, format: 'json', i18n: true, fields: Object.entries(json(`content/pages/${p}.json`).fr).map(([k, v]) => infer(k, v)) })),
    },
  ],
};

// Minimal YAML emitter (objects, arrays, scalars).
const q = (s) => (typeof s === 'string' ? (/^[\w./-]+$/.test(s) && !/^(true|false|null|yes|no|\d.*)$/i.test(s) ? s : JSON.stringify(s)) : String(s));
function yaml(v, ind = '') {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? `${ind}- ${yaml(x, `${ind}  `).trimStart()}` : `${ind}- ${q(x)}`)).join('\n');
  return Object.entries(v).map(([k, x]) => {
    if (x && typeof x === 'object') {
      if (Array.isArray(x) && x.every((y) => typeof y !== 'object')) return `${ind}${k}: [${x.map(q).join(', ')}]`;
      return `${ind}${k}:\n${yaml(x, `${ind}  `)}`;
    }
    return `${ind}${k}: ${q(x)}`;
  }).join('\n');
}
writeFileSync(`${ROOT}admin/config.yml`, `# Sveltia CMS — generated by scripts/cms-config.mjs (edit that script, not this file).\n# Before go-live: set backend.repo, and an OAuth endpoint (Sveltia CMS Authenticator on Cloudflare Workers).\n${yaml(config)}\n`);
console.log('admin/config.yml written');
