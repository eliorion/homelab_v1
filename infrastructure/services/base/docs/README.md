# docs

The live architecture docs of the asp repo, on the tailnet only:

- `https://docs.tail45b0ca.ts.net` — `main`
- `https://docs.tail45b0ca.ts.net/<pr>/` — every open PR, refreshed **3-5 s** after each push

One pod runs one VitePress dev server for all of them (asp `docs/site/preview/server.mjs`): every
5 s it lists the open PRs through the GitHub API, fetches only `services/**/docs/**` of the changed
heads, and the dev server hot-reloads the pages. Chart `k8s/charts/docs-preview` in the asp repo
(image `docs-preview`); this folder only deploys it.

| File | What |
|---|---|
| `namespace.yaml` | Namespace `docs`, PodSecurity `restricted` |
| `release.yaml` | HelmRelease `docs-preview` (source: GitRepository `docs-preview` in `clusters/staging/sources.yaml`); values = environment overrides only, never image tags |
| `ingress-tailscale.yaml` | the `docs` tailnet device |
| `../../staging/docs/secrets/` | ExternalSecret `docs-preview-github` from OpenBao `kv/docs/docs-preview-github` |

Also wired elsewhere: `docs` in `openbao/config/eso-namespaces.txt` and in the reflector's
`ghcr-pull-secret` namespaces, and a Homepage entry (Apps → Docs).

## Before the first reconcile: the GitHub token

A **fine-grained, read-only** token, only for `Eliorion/asp`, permissions **Contents: read** and
**Pull requests: read** (Metadata: read is implied). Not a reused one: the ARC and Renovate tokens can
write or administer, and this pod's dev server is on the tailnet.

```bash
kubectl -n openbao port-forward svc/openbao 8200:8200 &
export BAO_ADDR=https://127.0.0.1:8200
# log in as in ../openbao/README.md, then:
bao kv put kv/docs/docs-preview-github token=<the token>
```

Deploy only after the asp release `docs-preview-v0.1.0` has written `images.docsPreview.tag` (an empty
tag pulls nothing).

## Health

- `/healthz` (liveness): fails when VitePress stops answering or the poll loop hangs — never on a
  GitHub outage (the pod keeps serving the last docs).
- `/status` on port 8081: served heads, last poll, last error:
  `kubectl -n docs exec deploy/docs-preview -- wget -qO- localhost:8081/status`.
- If VitePress exits, the container exits and restarts.

## Traps

- **Host headers:** `preview.allowedHosts` in `release.yaml` must list the tailnet device name (`docs`),
  its MagicDNS name and the Service name Homepage monitors; Vite answers 403 to any other.
- **Egress:** the chart's NetworkPolicy allows DNS and TCP 443 to public addresses only (GitHub).
