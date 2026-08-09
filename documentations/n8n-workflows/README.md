# n8n workflow import templates

**Not applied by Flux.** Import through the n8n UI (*Workflows → ⋯ → Import from
File*). The live workflow then lives in the `n8n-db` Postgres like everything
else in n8n — that is the accepted trade-off of running a platform, and the
reason `apps/staging/databases/n8n/` has a `ScheduledBackup`.

Re-export here (*⋯ → Download*) after a meaningful edit. The repo `.gitignore`
blanket-ignores `*.json` as a credentials catch-all; this directory is negated so
re-exports actually commit. A workflow export references credentials by id and
name only — **never** export the credentials themselves.

| File | Schedule | What it does |
|---|---|---|
| `linkedin-drip.json` | `47 7 * * 1-5` Europe/Paris | Publishes the next queued LinkedIn draft from `eliorion/My-blog` |

---

## `linkedin-drip`

A port of `My-blog@dev`'s `linkedin/publish.py next` into n8n, replacing the
`k8s/linkedin-drip/` CronJob that repo ships. Same schedule, same queue, same
API calls — the difference is that it lives with every other automation instead
of in its own namespace, and it writes the queue marker through the GitHub
Contents API rather than `git clone`/`commit`/`push`.

### Why it had to move off GitHub-hosted runners

From `My-blog@dev:plan-auto-post-linkedin.md`:

1. `POST /rest/images?action=initializeUpload` returns an HTML 400 (WAF page)
   from GitHub's datacenter ranges — reproduced 2026-07-30 and 2026-07-31. Posts
   went out text-only through the script's fallback.
2. GitHub `schedule` fired up to ~2h20 late, or was dropped entirely, on three
   consecutive days.

> **The `n8n` namespace must keep egressing via the home ISP.** Routing it
> through Tailscale or any VPN exit reintroduces a datacenter IP and silently
> brings the image block back — posts keep succeeding, just without their cover.
> The Tailscale *Ingress* on the n8n Service is inbound only and does not affect
> this. Verify with the `ipcheck` snippet in `documentations/10-n8n-automation.md`.

### How it works

```
Schedule → Config → List repo tree → Enumerate drafts → Fetch draft (per draft)
        → Select draft → Has cover image? ─┬─ yes → Fetch PNG → Init upload → Upload bytes ─┐
                                           └─ no ─────────────────────────────────────────┬─┴→ Build payload
        → Post to LinkedIn → Record marker → Commit marker → Result
```

Queue state is the `published:` marker in each draft's frontmatter, committed
back to `dev` — exactly as `publish.py` does it. There is no separate queue file
and no state inside n8n.

Two independent stops, both inherited from `cmd_next()`:

- any draft already carries **today's** `published:` date → stop. This is the
  idempotency guard that makes a manual re-run safe.
- no unpublished draft left → stop.

Either way the execution ends clean with no items, not as an error.

### Faithfulness to publish.py

The Code nodes were diffed against `publish.py` over all 165 real drafts:

| Checked | Result |
|---|---|
| Draft ordering vs `_draft_posts()` | identical |
| PNG sibling detection | identical |
| Next-draft choice vs `cmd_next()` | identical |
| Already-published-today guard | fires on the same dates |
| Full POST body vs `publish_file()` | byte-identical, all 165 |
| Frontmatter rewrite | byte-identical (bar the timestamp) |
| Rewritten file re-parses as published | yes |

Two details are easy to get wrong and are deliberate:

- **Escape set is `\|{}@[]()<>`** — `publish.py`'s `_ESCAPE_CHARS`. `#` is
  *not* escaped, so hashtags keep working; neither are `*`, `_`, `~`. Widening
  the set turns every hashtag into literal text.
- **`isReshareDisabledByAuthor: false`**, not `isReenabledForReshareByAuthor`.

`LinkedIn-Version` is `202606` and the `User-Agent` is
`linkedin-drip/1.0 (…)`, both matching `publish.py`.

### Credentials

| Credential | Type | Notes |
|---|---|---|
| `LinkedIn Bearer` | Header Auth | name `Authorization`, value `Bearer <token>` |
| `GitHub My-blog PAT` | GitHub API | fine-grained PAT, **Contents: read and write**, `eliorion/My-blog` only |

LinkedIn issues no refresh token for `w_member_social`, so the access token
expires every 60 days — **the current one expires 2026-09-26**. Renew with
`python linkedin/publish.py auth` on the laptop and paste the new value into the
credential. `publish.py` stays the tool for minting tokens and for
`status`/manual `publish`; only the scheduled run moved.

### After importing

Set the **Config** node — `owner`, `repo`, `branch` (`dev`), `personUrn`
(`urn:li:person:DxKqhDF5zi`), `apiVersion`, `userAgent`, `timezone` — then pick
the two credentials on the nodes that flag them.

> **Retry stays OFF on `Post to LinkedIn`.** A retry after a partial success
> posts twice; LinkedIn has no idempotency key. The image nodes deliberately use
> `onError: continueRegularOutput` so a WAF block degrades to a text-only post
> instead of aborting, mirroring `publish.py`.

### Before enabling — avoid double-posting

Three things could publish the same queue. Exactly one must be live:

1. this workflow,
2. `My-blog@dev:k8s/linkedin-drip/` — **do not deploy it**; it is superseded,
3. `.github/workflows/linkedin-drip.yaml` — already `workflow_dispatch`-only, no
   `schedule:`. Leave it that way; it stays the manual fallback if the cluster
   is down, at the cost of a text-only post.

### First run

Run it manually with **`Post to LinkedIn` disabled** and check that `Build
payload`'s output matches what `python linkedin/publish.py status` says is next.
Then enable, execute once, and confirm:

- the post is live **with its cover image** — no `imageSkipped` in `Result`
- a `chore(linkedin): mark draft as published [skip ci]` commit landed on `dev`

`imageSkipped` being non-empty means the upload was rejected — check egress
before trusting the schedule.

### Monitoring

Per `documentations/10-n8n-automation.md`, workflow failures surface in n8n's
Executions view rather than as pushes. For this one there is a second signal
that needs no tooling: `dev` should get a marker commit every weekday. A gap of
more than a day means the job stopped.
