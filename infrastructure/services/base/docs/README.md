# docs

The live architecture docs of the asp repo, on the tailnet only:

- `https://docs.tail45b0ca.ts.net` — `main`
- `https://docs.tail45b0ca.ts.net/<pr>/` — every open PR, refreshed **3-5 s** after each push

One pod runs one VitePress dev server for all of them (asp `docs/site/preview/server.mjs`): every
5 s it lists the open PRs through the GitHub API (token only; with the deploy key it serves `main` alone), fetches only `services/**/docs/**` of the changed
heads, and the dev server hot-reloads the pages. Chart `k8s/charts/docs-preview` in the asp repo
(image `docs-preview`); this folder only deploys it.

| File | What |
|---|---|
| `namespace.yaml` | Namespace `docs`, PodSecurity `restricted` |
| `release.yaml` | HelmRelease `docs-preview` (source: GitRepository `docs-preview` in `clusters/staging/sources.yaml`); values = environment overrides only, never image tags |
| `ingress-tailscale.yaml` | the `docs` tailnet device |
| `../../staging/docs/secrets/` | ExternalSecret `docs-preview-github` from OpenBao `kv/docs/docs-preview-github`, and the SOPS Secret `docs-preview-deploy-key` (`docs-preview-deploy-key.enc.yaml`) |

Also wired elsewhere: `docs` in `openbao/config/eso-namespaces.txt` and in the reflector's
`ghcr-pull-secret` namespaces, and a Homepage entry (Apps → Docs).

## Credentials: a deploy key now, the token for PR previews

One at a time (the server would pick the token if both were there):

| Credential | Serves | Where |
|---|---|---|
| read-only **deploy key** (GitHub deploy key id 167220488) | **live `main` only**: git over SSH on port 443 (`ssh.github.com`, so the chart's HTTPS egress covers it) against GitHub's host keys pinned in the image. A deploy key cannot call the API, so no PR is listed | SOPS Secret `docs-preview-deploy-key`, key `ssh-privatekey`, `release.yaml` `deployKey.secretName` |
| fine-grained **token** (below) | `main` and every open PR | OpenBao `kv/docs/docs-preview-github`; optional, the pod starts without it |

Neither: the server exits at once with `fatal_config_error` in its log.

**Rotating the deploy key**: generate a new pair (`ssh-keygen -t ed25519 -N '' -C docs-preview -f key`),
add `key.pub` as a **read-only** deploy key in GitHub (Eliorion/asp, Settings > Deploy keys), write the
private key into `ssh-privatekey` of `../../staging/docs/secrets/docs-preview-deploy-key.enc.yaml`
(`sops` on that file, recipients from `.sops.yaml`), merge, wait for Flux to apply the Secret, then
`kubectl -n docs rollout restart deploy/docs-preview`: the server copies the key once at startup, so
without a restart it keeps fetching with the old one. Check `/status` (a fresh `lastSuccess`, no
`Permission denied (publickey)` in `lastError`), and only then delete the old key in GitHub. Revoking
in an emergency is the same: delete the key in GitHub, then restart the pod.

**Why SOPS and not OpenBao.** This is an application credential, which `../openbao/README.md` (What
stays in SOPS) puts in OpenBao. It is a deliberate exception: no OpenBao admin session was available to
seed it, and the owner picked a SOPS-held deploy key to get the docs up. It is read-only on one repo;
moving it to OpenBao later means an ExternalSecret beside `docs-preview-github` and deleting the
`.enc.yaml`.

### The GitHub token (PR previews)

A **fine-grained, read-only** token, only for `Eliorion/asp`, permissions **Contents: read** and
**Pull requests: read** (Metadata: read is implied). Not a reused one: the ARC and Renovate tokens can
write or administer, and this pod's dev server is on the tailnet.

```bash
kubectl -n openbao port-forward svc/openbao 8200:8200 &
export BAO_ADDR=https://127.0.0.1:8200
# log in as in ../openbao/README.md, then:
bao kv put kv/docs/docs-preview-github token=<the token>
```

Then, in one homelab change, remove `deployKey` from `release.yaml` and the SOPS Secret (and its
`kustomization.yaml` entry), and delete deploy key 167220488 in GitHub. PR pages are rendered in this
pod by a dev server running as the same user, so a key left mounted beside the token is a second,
never-expiring credential within reach of a PR. The HelmRelease upgrade recreates the pod, which also
picks up the token: `GITHUB_TOKEN` is an env var, read only when the container starts. If you seed the
token without that change, restart the pod yourself once the ExternalSecret has synced
(`kubectl -n docs rollout restart deploy/docs-preview`), or it keeps serving main only.

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
