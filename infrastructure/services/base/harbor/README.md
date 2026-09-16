# harbor

The cluster's OCI registry: a pull-through cache for `docker.io` and `ghcr.io`, a push
target for CI, and the registry UI. Replaces the Nexus docker proxies (ports 5000/5001/5002)
and the zot deployment that briefly preceded it.

Serves a publicly-trusted Let's Encrypt certificate on `registry.eliorion.fr`, so **no client
needs `--insecure-registry`, a CA file, or `insecure_skip_verify`** — on the LAN, on the
tailnet, or from a laptop on hotel wifi.

## How it is wired

| file | what it declares |
|---|---|
| `namespace.yaml` | namespace `registry` |
| `repository.yaml` | `HelmRepository harbor` → `https://helm.goharbor.io` |
| `release.yaml` | `HelmRelease harbor`, chart `1.19.2` (app 2.15.2), `targetNamespace: registry` |
| `certificate.yaml` | `Certificate registry-tls` for `registry.eliorion.fr` |
| `nginx-cert-reload.yaml` | hourly CronJob + scoped RBAC that rolls `harbor-nginx` when the cert changes |
| `../databases/harbor/cluster.yaml` | CNPG `Cluster harbor-db`, 2 instances, 20Gi |
| `../../staging/harbor/harbor-admin.enc.yaml` | SOPS admin password |

Exposed on the Cilium LB-IPAM address **192.168.1.112** (the address zot held), ports 80/443.
The Cloudflare A record for `registry.eliorion.fr` is grey-cloud (unproxied): the name resolves
publicly, the address stays RFC1918, and DNS-01 issuance needs no inbound reachability.

## Two front doors, on purpose

Harbor supports exactly one `externalURL`, but it has two audiences with
different needs, so it gets two paths to the same pods.

| path | who | TLS |
|---|---|---|
| `registry.eliorion.fr` (LB `192.168.1.112`) | **data only** — node containerd, the Dagger engine, CI | Harbor's own cert, `letsencrypt-prod` |
| `harbor.tail45b0ca.ts.net` (tailscale Ingress) | **the UI**, humans | a real Tailscale-issued certificate |

The LoadBalancer is restricted with `sourceRanges` to the three nodes and the
pod CIDR. It is **not** removed, and it cannot be: containerd pulls happen on
the NODE, and the nodes are LAN-only (`192.168.1.101-103`) — they are not on the
tailnet. Dropping the LB would make node-level mirroring impossible.

The Ingress deliberately does NOT point at the `harbor` Service. Its nginx
answers `:80` with `return 301 https://$host$request_uri`, and `$host` is the
tailnet name, so that redirect would loop straight back into this Ingress. The
path rules there are harbor-nginx's own routing table with the redirect removed.

Nor is it the `tailscale.com/expose` annotation. Expose is an L3 forward, so the
browser would get Harbor's own certificate — issued for `registry.eliorion.fr`,
not the tailnet name, so it fails hostname verification. The Ingress terminates
TLS with a Tailscale certificate for `harbor.tail45b0ca.ts.net` instead, which
requires **HTTPS Certificates** enabled in the Tailscale admin console
(DNS → HTTPS Certificates); without it the proxy comes up with no certificate.

**Caveat, from the one-hostname limit:** the registry token realm is pinned to
`externalURL`, so a `docker login`/`docker pull` against the *tailnet* name gets
a 401 pointing at `registry.eliorion.fr`. Browsing and logging into the UI work
over the tailnet; pulling images does not. Pull over the LAN name.

## Transparent pull-through — the whole point

Requirement: `docker.io/library/nginx` must hit the local cache **without rewriting the image
reference** in any chart, Dockerfile or pod spec.

Harbor's proxy cache is **project-scoped** — its real path is
`/v2/dockerhub-proxy/library/nginx`. So the rewrite happens in each client's *mirror* config,
never in the image reference. On Talos that is `overridePath`, which is Sidero's own documented
Harbor shape (Talos ships a unit test named `TestGenerateHostsWithHarbor`).

A pull of `docker.io/library/nginx:latest` goes out as:

```
HEAD https://registry.eliorion.fr/v2/dockerhub-proxy/library/nginx/manifests/latest?ns=docker.io
```

### The path is spelled DIFFERENTLY per client. This is the trap.

| client | value | why |
|---|---|---|
| Talos | `https://registry.eliorion.fr/v2/dockerhub-proxy` (and `/v2/ghcr-public`) + `overridePath: true` | scheme **and** `/v2`; `overridePath` stops containerd appending a second `/v2` |
| Dagger engine (`../dagger/config/engine.json`) | `registry.eliorion.fr/dockerhub-proxy` | **no scheme, no `/v2`** — BuildKit does `path.Join("/v2", mirrorPath)` itself. Adding `/v2` yields `/v2/v2/…` and 404s every pull |
| k3s / k3d (asp `e2e_common.py`) | full URL with `/v2/<project>` | generated `registries.yaml` |
| Docker daemon | **cannot** be transparent | Docker's `registry-mirrors` is Docker-Hub-only and accepts no path. Pull by full name instead |

Since 2026-09-16 CI is a client too: `Eliorion/asp` holds
`DOCKERHUB_MIRROR`/`GHCR_MIRROR` in the BuildKit spelling and
`K3D_DOCKERHUB_MIRROR`/`K3D_GHCR_MIRROR` in the containerd spelling, replacing the
Nexus proxies ([`../../../../documentations/04-ci-runners-cache.md`](../../../../documentations/04-ci-runners-cache.md)).

The Docker-daemon row is measured, not inferred: with
`--registry-mirror=https://registry.eliorion.fr/v2/dockerhub-proxy`, `dockerd` requested
`https://registry.eliorion.fr/v2/dockerhub-proxy/v2/library/busybox/manifests/1.37?ns=docker.io`,
logged `trying next host after status: 404 Not Found`, and pulled from Docker Hub — a mirror
that appears configured and caches nothing.

### Both proxy projects MUST be Public

A public Harbor project grants `repository:pull` to the anonymous user. That is what makes
pulls work with **no `imagePullSecrets` and no node credentials** — it is the mechanism for
"any container, no configuration", not a cosmetic setting. Private projects break the
requirement.

## Talos mirror config

Lives in `bootstraping/talconfig.yaml` as standalone `RegistryMirrorConfig` documents, **not**
`machine.registries.mirrors`. That matters: in the legacy block `overridePath` is a
*mirror-level* bool fanned onto every endpoint, which would strip `/v2` from the upstream
fallback too and break it. In document form it is per-endpoint. (`machine.registries` is also
deprecated in Talos v1.13.4.)

Three absolutes:

- **Never set `skipFallback`.** It promotes the last endpoint to containerd's `server =` root
  and removes the implicit upstream. Harbor runs *inside* the cluster it feeds, so that turns a
  Harbor outage into a cold-start deadlock on all three control planes at once.
- **Never define a `*` mirror.** Talos reserves it for the on-node image cache, and node images
  come from `factory.talos.dev` — a host with no Harbor project.
- Mirrors carry `capabilities = ['pull','resolve']`; **push never traverses a mirror.** CI
  pushes to `registry.eliorion.fr/<project>/…` by real name.

It must only ever be applied while `registry.eliorion.fr` serves a chain that verifies against
the system trust store — containerd rejects an untrusted chain on every node simultaneously.
The `internal-endpoints` blackbox probe (`monitoring/configs/staging/blackbox-probes`) checks
exactly that, with TLS verification, every minute. Applied 2026-09-15, one node at a time,
verifying a real pull between each:

```bash
talosctl -n 192.168.1.101 read /etc/cri/conf.d/hosts/docker.io/hosts.toml
# expect: override_path = true under the Harbor host, and NO `server =` line
```

## Certificate renewal — the one regression versus zot

zot watched its certificate with fsnotify and reloaded in place. **Harbor's nginx does not.**
Its image is stock `nginx -g 'daemon off;'`, and the chart emits no `checksum/secret` under
`certSource: secret`. Left alone, a cert-manager renewal is not picked up and the registry
serves an expired certificate — a scheduled ~60-day total CI outage.

`nginx-cert-reload.yaml` closes it: hourly, it sha256s the live `tls.crt`, compares it to an
annotation on the `harbor-nginx` Deployment, and patches the annotation (rolling the pod) only
when they differ. Its RBAC is scoped by `resourceNames` to that one Secret and that one
Deployment.

Prove it after any change to the reload job:

```bash
cmctl renew registry-tls -n registry
# within the hour: harbor-nginx rolls, and the new leaf is served
openssl s_client -connect registry.eliorion.fr:443 </dev/null 2>/dev/null | openssl x509 -noout -dates
```

`registry-tls` issues from `letsencrypt-prod` (5 duplicate certificates per week), so do not
loop that renew. It was proven on staging first — issued 2026-09-13, force-renewed 2026-09-15 —
per `../../../controllers/staging/cert-manager-issuers/README.md`. A `dnsNames` change goes
back through staging the same way.

`privateKey.rotationPolicy: Always` gives a fresh key on every renewal. That is safe only
because nothing pins this certificate's public key; a client that did would break at each
renewal.

## Harbor objects as code

The e2e project and its robots are not clicked in the UI: the Job in `config/` (Flux Kustomization
`infra-harbor-config`, path `infrastructure/services/staging/harbor/config`) calls the Harbor API
with the `harbor-admin` Secret and converges, idempotently, on every run:

- project `e2e`: a normal (not proxy-cache) **private** project, quota 50Gi — proxy-cache
  projects refuse pushes;
- tag retention on it: keep images pushed in the last 7 days **or** the 5 most recent per
  repository, daily at 03:00;
- a weekly garbage-collection schedule, created only if Harbor has none (retention untags; only
  GC frees the disk). An existing schedule is left alone;
- robot `robot$e2e+ci`: push + pull on `e2e`, for the asp `build-scan` job (a push checks for
  existing blobs first, hence pull);
- robot `robot$e2e+pull`: pull on `e2e`, for the dev platform's run pods.

**You choose the robot secrets, Harbor does not.** `PATCH /robots/{id}` takes a caller-supplied
secret (create ignores one and generates its own, so every run PATCHes), so both live in `staging/harbor/config/e2e-robots.enc.yaml`
(template: `e2e-robots.enc.yaml.exemple`): Secret `harbor-robot-e2e-ci` and Secret
`harbor-e2e-pull`, which is also the dockerconfigjson reflector mirrors into `dev-platform`. Each
run sets the secret from Git, so rotating a robot is an edit of that file; update the GitHub
secret `HARBOR_E2E_PUSH_TOKEN` in the same change for `e2e+ci`.

A secret must be 8-128 characters with an upper, a lower and a digit; the Job refuses anything
else before calling Harbor. The Job is re-created after `ttlSecondsAfterFinished` (a day), so a
change made in the UI to these objects is reverted within a day. Objects not listed here —
the proxy projects below — are untouched.

Proven against Harbor 2.15.2 on a scratch project (since deleted): create, a second idempotent
run, a secret rotation (the old secret's token grants no actions), GC schedule creation, and the
two robots' token scopes (`push,pull` and `pull`). That proof ran the update path twice before
checking a token, which hid that create ignores the secret: the first live run left both robots
with Harbor's own random secrets (a token with no actions) until the PATCH moved to every run.

## Proxy projects are runtime state, not manifests

A chart cannot express them. After Harbor is up, create the registry endpoints and proxy-cache
projects (live on 2026-09-15):

```bash
# dockerhub-proxy  → https://hub.docker.com   (type: docker-hub)   public   Talos, Dagger
# ghcr-public      → https://ghcr.io          (type: github-ghcr)  public   Talos, Dagger
# ghcr-proxy       → https://ghcr.io          (type: github-ghcr)  private  credentialed clients only
```

Attach upstream credentials to the Docker Hub endpoint — an authenticated cache raises the
anonymous rate limit considerably. `ghcr-proxy` **requires** them: the eliorion packages are
private, and without credentials Harbor answers
`404 repository ghcr-proxy/... not found`. The PAT comes from the central
`ghcr-pull-secret`, which reflector mirrors into this namespace.

**API trap:** *creating* a registry endpoint takes a nested `credential` object, but
*updating* one takes **flat** `credential_type` / `access_key` / `access_secret`. A PUT with
the nested form returns **200 and silently stores nothing**, and
`POST /registries/ping` then still returns 200 because ghcr.io answers anonymously for public
repos. Always read the endpoint back and check `credential.access_key` is non-null.

`ghcr-proxy` is **private** (unlike `dockerhub-proxy`): it holds private images, and a public
project would let anything that can reach Harbor pull them anonymously. Pulling from it
therefore needs Harbor credentials.

**The Talos `ghcr.io` mirror uses `ghcr-public`, not `ghcr-proxy`** (decided 2026-09-15). The
nodes hold no Harbor credentials, and containerd cannot use a pod's GitHub pull secret against
Harbor, so a `ghcr-proxy` mirror answered every pull with `401` and fell back to `ghcr.io`
— working, never cached. With `ghcr-public`, measured on each node:

- a public ghcr image (`astral-sh/uv`): `401` → anonymous token → `200` from Harbor, cached;
- a private `ghcr.io/eliorion/*` image with the namespace's `ghcr-pull-secret`: Harbor `401`
  → `404`, containerd falls back to `ghcr.io` with the pod's credentials, pull succeeds.

Rejected: a pull-only Harbor robot account for `ghcr-proxy` in the Talos config. It would cache
the private images too, at the cost of a credential on every node able to pull all of them.

Verify each before touching any client config:

```bash
curl -sI https://registry.eliorion.fr/v2/dockerhub-proxy/library/nginx/manifests/latest
```

## Why it is like this

**External CNPG, not the bundled Postgres.** Harbor's database holds project config, RBAC,
robot accounts and scan history — none of it reproducible. The house pattern is CNPG (nine
clusters already), so it gets backups and failover the way everything else does. Redis stays
bundled: it is a pure cache.

**`externalURL` must equal the hostname clients actually use, exactly.** It pins the token-auth
realm, portal redirects, webhook payload URLs and scanner callbacks. A mismatch produces
authentication failures that look like a broken registry.

**Blobs on `ssd-single`, not `hdd`.** `hdd` is SeaweedFS, a network filesystem. Registry content
is reproducible, so a single node-local replica is the right trade; `ssd` would replicate every
layer over DRBD on the hottest write path.

**Chart pinned, and do not drop to app 2.15.0** — proxy-cache pulls were broken there
(`goharbor/harbor#23025`, fixed 2026-04-13). Proxy cache is the feature this deployment exists
for, so treat a working pull through each project as a release gate, not an assumption.

## Rejected

**Per-upstream hostnames** (`dockerhub.eliorion.fr`, `ghcr.eliorion.fr`). Harbor supports
exactly one hostname (`goharbor/harbor#8243`, still open — one `externalURL`, one ingress host).
It would need an external L7 proxy per hostname that prepends `/v2/<project>/` *and* relays
Harbor's `Www-Authenticate: Bearer realm=…` challenge — more moving parts for an identical
outcome, since every path-capable client handles paths natively. There is also no external-dns,
so each hostname is a manual Cloudflare record.

**zot**, which this replaces. It satisfied transparent pull-through *structurally* — one
upstream per port, so containerd needed no path rewriting — in ~380Mi across one pod, with no
database. Harbor costs roughly 5× the requests, ~9× the pods, a database in the critical path,
and makes transparency conditional on per-client config rather than automatic. It was chosen
anyway for the UI, projects/RBAC/robot accounts/quotas/retention, built-in Trivy scanning,
replication, and Keycloak OIDC — none of which zot has.

## Known gaps

- **No backup wiring yet.** `harbor-db` has no ObjectStore or ScheduledBackup, unlike
  `keycloak-db` and `ai-gateway-db`. Scan history and robot accounts would be lost on a cluster
  rebuild; projects are cheap to recreate. Follow the `keycloak/` pattern in
  `../databases/README.md` to add it.
- **OIDC is not enabled.** Login is the local admin account from `harbor-admin.enc.yaml`.
  Keycloak wiring is additive and independent; it was deferred so the registry could be proven
  working first.
