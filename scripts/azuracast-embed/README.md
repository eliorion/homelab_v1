# Putting the radio on a website hosted somewhere else

The website does not need to be in the cluster, on the tailnet, or on any
particular host. Everything it needs is already public.

| What | URL | Verified |
|---|---|---|
| Now playing (JSON) | `https://mve-azuracast.eliorion.fr/api/nowplaying/sysadmin` | `200`, `Access-Control-Allow-Origin: *` |
| Audio | `https://mve-azuracast.eliorion.fr/listen/sysadmin/radio.mp3` | `200`, `audio/mpeg`, 192 kbps |

The `*` on that CORS header is what makes this simple: a page on any origin can
`fetch()` the metadata directly. No proxy, no backend, no server-side code.

## Use it

Paste `player.html` into the page. It is one `<div>`, one `<style>`, one
`<script>`, self-contained and scoped under `.azc` so it neither inherits from
nor leaks into the host stylesheet.

Three constants at the top of the script:

```js
var BASE            = "https://mve-azuracast.eliorion.fr";
var STATION         = "sysadmin";
var STREAM_OVERRIDE = null;   // null = follow whatever the API advertises
```

`STREAM_OVERRIDE` is the line to change if the audio ever moves off that
hostname — a direct port-forwarded address, or a relay. Everything else follows
`listen_url` from the API automatically.

## Things that will bite otherwise

- **Serve the page over HTTPS.** A browser refuses to load `http://` audio into
  an `https://` page: the widget renders, the button works, no sound ever
  arrives, and the only thing on screen is the title flipping to
  `Playback blocked`. The widget sets that whenever `play()` rejects — the click
  is a user gesture, so autoplay policy is never the cause and a rejection there
  means the stream itself refused. Both URLs above are HTTPS, so this only
  matters if you repoint at a plain-HTTP host.
- **Pausing drops the connection**, deliberately. A paused `<audio>` that keeps
  its `src` goes on buffering in the background and holds a listener slot for
  nobody. At 0.202 Mbps each (doc 13), idle tabs are not free.
- **Polling pauses with the tab.** A hidden tab stops asking every fifteen
  seconds — this widget is a guest on someone else's page.

## The other direction: push instead of poll

If the site would rather be told than ask, AzuraCast can call it. Administration
→ Web Hooks, and the pod has working outbound internet — verified against
several public hosts, egress `37.65.67.42`, no NetworkPolicies in the namespace.
That posts on every song change and needs nothing inbound at all.

Polling suits a player widget; a webhook suits writing "now playing" into the
site's own database or pushing it to a chat channel.

## What this rides on

The audio path is the Cloudflare tunnel, which is a **knowingly accepted
trade-off** rather than an oversight — see section 4 of
`infrastructure/services/staging/cloudflare/README.md`. Sustained streaming is
restricted by Cloudflare's ToS §2.8; at a small audience it is unlikely to be
noticed, and if it ever is, the fallbacks are a direct port-forwarded path (the
home uplink sustains at least 80 concurrent listeners, measured in doc 11) or an
off-site relay (`scripts/azuracast-relay/`). Either way, only
`STREAM_OVERRIDE` changes here.
