# Forgejo

The forge for the production repositories, starting with `eliorion/asp`, with CI on the shared
Dagger engine. **Today GitHub is still the home** (PRs, releases, and Flux reads GitHub) and Forgejo
receives every push and gives a second CI verdict from the same cache. **The target is the reverse**
(owner, 2026-10-16): Forgejo is the home and push-mirrors to GitHub, GitHub is the fallback, and
`homelab_v1` alone stays on GitHub so the cluster can be rebuilt without anything running in it.
The switch, the fallback runbook and what remains before the cutover: asp
`docs/30-forgejo-dagger-ci.md`.

| file | what it declares |
|---|---|
| `release.yaml` | `HelmRelease forgejo`, chart `forgejo-helm` 17.3.0 (Forgejo 15.0.10 LTS), one replica, 20Gi `ssd` |
| `bootstrap.yaml` | the bootstrap sidecar's script: org `eliorion`, repo `eliorion/asp`, the GitHub → Forgejo deploy key, org variables `DAGGER_RUNNER_HOST` and `CI_RUNNER`, runners `runner-0..3` |
| `certificate.yaml` | `git-tls` for `git.eliorion.fr`, `letsencrypt-prod` (DNS-01) |
| `gateway.yaml` | `HTTPRoute` on the shared `cilium-gw` listener `https-git`, plus the `ReferenceGrant` for the cert |
| `ingress-tailscale.yaml` | tailnet UI at `https://forgejo.tail45b0ca.ts.net` |
| `../databases/forgejo/` + `../../staging/databases/forgejo/` | CNPG `forgejo-db`, 2 instances, WAL + daily base backup to R2 `forgejo-cnpg-staging` |
| `../../staging/forgejo/` | `secrets/`: ExternalSecrets from OpenBao (admin, runner secrets); the R2 dump token (sops) and the `forgejo-dump` CronJob |
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
Forgejo account on first login. No local registration. The local `forgejo-admin` exists for the
bootstrap sidecar and break-glass.

## Credentials (OpenBao, seed BEFORE the first reconcile)

Application credentials live in OpenBao, as for the other `staging-apps` clients
(`../keycloak/README.md`). `kv/identity/*` is read in `identity` (the realm import Job, which
holds back EVERY realm edit while a key it reads is missing); `kv/forgejo/*` in `forgejo`
(`eso-namespaces.txt`). With the `bao` login from `../openbao/README.md`:

```bash
bao kv put kv/identity/forgejo-oidc-client client-secret="$(openssl rand -base64 32)"
bao kv put kv/forgejo/admin password="$(openssl rand -base64 24)"
bao kv put kv/forgejo/runner-secrets \
  runner-0="$(openssl rand -hex 20)" runner-1="$(openssl rand -hex 20)" \
  runner-2="$(openssl rand -hex 20)" runner-3="$(openssl rand -hex 20)"
```

The two R2 tokens stay sops files, like every CNPG backup token:
`staging/databases/forgejo/r2-backup-credentials.enc.yaml` and
`staging/forgejo/r2-dump-credentials.enc.yaml`, from their `.example` templates.

## How code arrives

**While GitHub is the home** (asp variable `FORGE_HOME` unset): asp
`.github/workflows/forgejo-mirror.yaml` pushes every branch and tag to
`ssh://git@192.168.1.113/eliorion/asp.git` with a write deploy key (public half in `release.yaml`,
private half in the asp secret `FORGEJO_MIRROR_SSH_KEY`). A real push, so Forgejo fires
`on: push`; a pull mirror would not fire Actions.

**At the cutover** (`FORGE_HOME=forgejo` on GitHub, which stops that workflow's automatic runs):
Forgejo pushes to GitHub with its built-in push mirror, sync on commit. Forgejo generates the SSH
key and returns its public half, which goes on GitHub as a WRITE deploy key that main's ruleset
lets bypass the PR rule. Deliberately not created by the bootstrap sidecar: in the fallback runbook
the push mirror must stay off while GitHub is written to, and a sidecar would recreate it on every
restart.

```bash
curl -u forgejo-admin:<password> -H 'Content-Type: application/json' \
  -X POST https://git.eliorion.fr/api/v1/repos/eliorion/asp/push_mirrors \
  -d '{"remote_address":"ssh://git@github.com/eliorion/asp.git","use_ssh":true,"sync_on_commit":true,"interval":"8h0m0s"}'
# -> .public_key: add it at github.com/eliorion/asp/settings/keys, "Allow write access"
```

The push mirror is `--mirror`: refs that exist only on GitHub (a release-please branch, a
Dependabot branch) are pruned, which is why the release flow moves to Forgejo first.

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
