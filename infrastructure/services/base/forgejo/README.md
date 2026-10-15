# Forgejo

A mirror of `eliorion/asp` with CI on the shared Dagger engine. **GitHub stays the home of the
code, the release flow and the only deploy path** (Flux reads GitHub); Forgejo gives a second CI
verdict and warms the same cache. Plan and diagram: asp `docs/28-forgejo-dagger-ci.md`.

| file | what it declares |
|---|---|
| `release.yaml` | `HelmRelease forgejo`, chart `forgejo-helm` 17.3.0 (Forgejo 15.0.10 LTS), one replica, 20Gi `ssd` |
| `bootstrap.yaml` | the bootstrap sidecar's script: org `eliorion`, repo `eliorion/asp`, the mirror deploy key, org variable `DAGGER_RUNNER_HOST`, runners `runner-0..3` |
| `certificate.yaml` | `git-tls` for `git.eliorion.fr`, `letsencrypt-prod` (DNS-01) |
| `gateway.yaml` | `HTTPRoute` on the shared `cilium-gw` listener `https-git`, plus the `ReferenceGrant` for the cert |
| `ingress-tailscale.yaml` | tailnet UI at `https://forgejo.tail45b0ca.ts.net` |
| `../databases/forgejo/` + `../../staging/databases/forgejo/` | CNPG `forgejo-db`, 2 instances, WAL + daily base backup to R2 `forgejo-cnpg-staging` |
| `../../staging/forgejo/` | sops secrets (admin, runner secrets, R2 dump token) and the `forgejo-dump` CronJob |
| `../forgejo-runner/` | the runners |

## Front doors

| path | address | who |
|---|---|---|
| `https://git.eliorion.fr` | Cilium Gateway `192.168.1.111`, listener `https-git` | browsers, HTTPS clones, the runners |
| `ssh://git@git.eliorion.fr` (port 22) | `forgejo-ssh` LoadBalancer `192.168.1.113` | SSH clones, the GitHub mirror push |
| `https://forgejo.tail45b0ca.ts.net` | Tailscale Ingress | the UI off-LAN |

`git.eliorion.fr` is a grey-cloud Cloudflare A record to `192.168.1.111`: it resolves publicly, the
address stays RFC1918. SSH on the same name works because the SSH LoadBalancer and the Gateway are
different addresses; set `Host git.eliorion.fr / HostName 192.168.1.113` in `~/.ssh/config`, or add
a second record. The tailnet door has no subnet route to `.111`, so links Forgejo prints and the
Keycloak login (both built from `ROOT_URL`) only work on the LAN.

`/metrics` is served unauthenticated on the HTTP port, so it is reachable through the Gateway from
the LAN. It holds counts, not content.

## Login

Keycloak realm `staging-apps`, client `forgejo` (`../keycloak/realm/realm-apps.yaml`). The OAuth2
source `keycloak` refuses any account without `forgejo-users` in its `groups` claim, and creates the
Forgejo account on first login. No local registration. The local `forgejo-admin` (sops,
`staging/forgejo/forgejo-admin.enc.yaml`) exists for the bootstrap sidecar and break-glass.

## How code arrives

asp `.github/workflows/forgejo-mirror.yaml` pushes every branch and tag to
`ssh://git@git.eliorion.fr/eliorion/asp.git` with a write deploy key (public half in
`release.yaml`, private half in the asp secret `FORGEJO_MIRROR_SSH_KEY`). A real push, so Forgejo
fires `on: push`; a pull mirror would not fire Actions. PRs exist only on GitHub.

## Backups (Cloudflare R2, never Garage)

- `forgejo-db`: WAL continuously + base backup daily 03:00, 7-day retention, bucket
  `forgejo-cnpg-staging`.
- `forgejo-dump` CronJob, daily 03:37: `forgejo dump` (repos, attachments, config, SQL) to
  `forgejo-dump-staging`, trimmed after 14 days; bucket versioning and object lock are the retention.

Both buckets and their tokens are created in the Cloudflare dashboard, one token per bucket,
Object Read & Write on that bucket only.

**Restore drill:** new CNPG Cluster with `bootstrap.recovery` from `r2-store` (archive the result
under `forgejo-db-v2`), then unpack the newest dump into a fresh `gitea-shared-storage` volume
(`data/`, `repos/` under `/data/git/`), then point the HelmRelease at both. The code itself is also
on GitHub.
