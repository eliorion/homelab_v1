# zot — the OCI cache and push target

Replaces the three Nexus **docker** repos. Nexus keeps `pypi-proxy` (and
npm/maven) — those are not OCI and zot does not replace them.

```
registry.eliorion.fr:5000   docker.io pull-through   (proxy)
registry.eliorion.fr:5001   ghcr.io   pull-through   (proxy)
registry.eliorion.fr:5002   hosted: our images + Helm OCI charts  (push target)
```

zot terminates TLS itself rather than relying on a proxy, so the certificate is
valid on every path: the LAN VIP `192.168.1.112`, the tailnet, and from inside
the cluster.

**Always address it as `registry.eliorion.fr:<port>` — including in-cluster.**
The certificate is issued for that name, and Let's Encrypt cannot sign an
in-cluster DNS name like `zot.registry.svc`, so a ClusterIP mirror would fail
verification and push every client back to an `insecure` escape hatch. One name
everywhere is what keeps the flags deleted. In-cluster resolution goes out to
the LAN VIP and hairpins back through Cilium; the extra hop is irrelevant next
to a layer pull.

The ClusterIP `Service/zot` still exists for debugging and for anything that
explicitly opts out of TLS verification. It is not the canonical address.

## Why three processes and not one multi-upstream instance

zot *can* mirror several upstreams from one instance, and that was the original
plan. It is wrong here.

zot keys its storage by **repository path**, not by upstream. A single instance
resolves an incoming repo name by trying its configured registries in order and
taking the first that answers. That is fine until two upstreams share a path —
and in this pipeline they do:

| path | docker.io | ghcr.io |
|---|---|---|
| `aquasecurity/trivy` | yes | yes (the one we use) |
| `gitleaks/gitleaks` | yes | yes (the one we use) |
| `eliorion/*` | squattable | ours |

A collision does not error. It silently serves the wrong image — a
supply-chain hazard, not an inconvenience. Prefix filters can disambiguate the
names you thought of; the failure mode is the name you did not, which falls
through to the catch-all upstream.

Per-upstream **ports** remove the ambiguity by construction, cost three small Go
processes in one pod, and — unlike path-prefixed mirrors — work for every
client. That last point is load-bearing: Talos containerd can do path-prefixed
mirrors (`overridePath: true`), but BuildKit (and therefore the Dagger Engine)
takes a **host:port only**. Ports are the one form both understand.

Adding an upstream (quay.io, registry.k8s.io) is one more `config/*.json`, one
more container, one more port. Neither was needed: quay.io is unused, and
registry.k8s.io images are pulled by kubelet, which caches them on the node.

## TLS

`Certificate registry-tls` → cert-manager → `letsencrypt-*` ClusterIssuer
(DNS-01 via Cloudflare, see
`infrastructure/controllers/staging/cert-manager-issuers/`).

It ships pointing at **letsencrypt-staging**, which issues an untrusted chain.
That is deliberate. Confirm issuance and one forced renewal, then switch:

```bash
kubectl -n registry describe certificate registry-tls        # Ready=True?
kubectl -n registry get secret registry-tls -o jsonpath='{.data.tls\.crt}' \
  | base64 -d | openssl x509 -noout -subject -issuer -dates

cmctl renew registry-tls -n registry                          # force a renewal
kubectl -n registry rollout status sts/zot                    # picked up?

# only then: edit certificate.yaml -> issuerRef.name: letsencrypt-prod
```

**zot reloads its certificate without a restart.** v2.1.20 logs
`TLS certificate watcher started using fsnotify` at boot and watches the mounted
cert files, so a cert-manager renewal is picked up in place. Verified locally
against this exact image and config. Still confirm it once after the first
`cmctl renew` on the real cluster — kubelet updates a Secret mount by swapping a
symlinked directory, and a watcher that follows the file rather than the
directory can miss that.

Once the cert is trusted, **no client needs `--insecure-registry`, a CA, or
`insecure_skip_verify`** — that is the entire point, and it is what lets the
pipeline delete `MIRROR_INSECURE_HTTP` and the dind `--insecure-registry` flags.

DNS: Cloudflare `A registry.eliorion.fr → 192.168.1.112`, **proxy off (grey
cloud)**. RFC1918 in public DNS is publicly resolvable, not publicly reachable.
Do not orange-cloud it: the Cloudflare proxy caps request bodies at 100 MB on
the free tier and `docker push` of a larger layer returns 413.

## Credentials

- `zot-secrets` — bcrypt htpasswd for user `ci`. Mounted by the pod. Contains
  the hash only, never the password.
- `zot-ci-credentials` — the push credential (`username`, `password`,
  `.dockerconfigjson`). **Not** mounted by zot; this is what CI and any puller
  use.

Anonymous **read** is allowed on all three ports; **write** requires `ci` and
only the hosted port accepts writes at all.

```bash
# retrieve the password (needs the staging age key)
SOPS_AGE_KEY_FILE=<key> sops -d \
  ../../staging/zot/zot-ci-credentials.enc.yaml | grep '^  password:'
```

## Upstream credentials (optional)

The proxies pull anonymously. Docker Hub rate-limits anonymous pulls per IP,
which the cache makes rare but not impossible on a cold volume. To authenticate,
add a `sync-credentials.json` key to `zot-secrets`:

```json
{ "registry-1.docker.io": { "username": "…", "password": "…" } }
```

then set `"credentialsFile": "/secret/sync-credentials.json"` under
`extensions.sync` in `config/dockerhub.json`. It is deliberately absent by
default: a missing or unparseable credentials file breaks sync on first boot,
and anonymous works.

## Storage

One 250Gi `ssd-single` volume, three `rootDirectory` subtrees. `ssd-single` is
LINSTOR with a single replica and node-local placement — correct for a cache,
where replication would pay DRBD cost for reproducible bytes. The pod soft-prefers
`staging-controlplane-3` (~462GiB free); cp1 has ~210GiB and already hosts Nexus,
and cp2 is headroom for a Dagger engine.

Losing this volume costs a cold cache, never data: the proxies re-sync on demand
and the hosted repo's releases also live on GHCR.

`dedupe` and `gc` are on, plus a daily `scrub` for integrity. There is no
equivalent of the Nexus ExtDirect compaction CronJob — zot does its own
housekeeping, which is one of the reasons it replaces Nexus here.

## Config changes

`config/*.json` is a `configMapGenerator`, so the ConfigMap name carries a
content hash and editing a file rolls the pod. zot reads its JSON once at
start-up; without the hash a config change would apply only on the next
unrelated restart.

## Image pin

`ghcr.io/project-zot/zot-linux-amd64:v2.1.20`, pinned in `statefulset.yaml`.
`homelab_v1/renovate.json` scopes the kubernetes manager to the db-migrations
paths only, so this pin is **manual** — the same as every other image here.
