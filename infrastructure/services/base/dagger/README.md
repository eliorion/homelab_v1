# Dagger Engine

The build engine for the CI pipeline. Runners hold no Docker daemon: they run
`dagger call`, which connects here and executes the whole pipeline as containers
inside this engine.

## Why StatefulSet and not Deployment

`/var/lib/dagger` contains a **`buildkitd.lock`**. Two engine processes cannot
share one volume — this is a documented blocker, not a theoretical one. So
persistence *plus* more than one replica **forces** a volume per pod, and
`volumeClaimTemplates` is the only thing that provides it. A Deployment can
only offer either one shared volume (corruption) or `emptyDir` (a cache that
dies on every restart, reschedule, drain and version bump).

The stable pod names are the second reason. Clients pick their engine
deterministically:

```bash
IDX=$(( 0x$(printf %s "$SERVICE" | sha1sum | cut -c1-2) % 2 ))
export _EXPERIMENTAL_DAGGER_RUNNER_HOST="kube-pod://dagger-engine-$IDX?namespace=dagger"
```

so a given service always lands on the same warm cache while both replicas stay
in use. A round-robin Service would cold-miss roughly half the time, which
defeats the point of persisting the cache at all.

| | Deployment ×2 emptyDir | **StatefulSet ×2 PVC** | DaemonSet + host disk |
|---|---|---|---|
| lock safety | safe | safe | safe |
| cache across restart | lost | **survives** | survives until node loss |
| cache hit rate | ~50% | ~100% | ~100%, 3 caches |
| addressing | `tcp://` — plaintext, unauthenticated | `kube-pod://` — apiserver TLS + authz | `kube-pod://$(hostname)` |
| Talos fit | fine | fine | poor: read-only rootfs needs a user volume |

## Connection: kube-pod://, never tcp://

Dagger's own documentation states that `tcp://` sends every query and response
in plaintext with no authentication. `kube-pod://` execs a session helper
through the apiserver instead, so the transport is the apiserver's TLS and the
authorization is Kubernetes RBAC. There is deliberately **no TCP listener** and
the Service is headless — it exists only because a StatefulSet requires one.

## Security

`rbac.yaml` grants `pods/get` + `pods/exec` on exactly `dagger-engine-0` and
`dagger-engine-1`.

**Exec into a privileged pod is node-root-equivalent.** Anything holding that
Role can run code as root on cp2 or cp3. That is inherent to Dagger on
Kubernetes, and it drives three rules:

1. Dedicated namespace, nothing cluster-wide, `resourceNames`-pinned.
2. `list` is **not** granted — `resourceNames` cannot constrain a list, so it
   would hand over namespace enumeration for no benefit.
3. **Fork pull requests must never run on runners bound to this Role.** Gate on
   `github.event.pull_request.head.repo.full_name == github.repository`.

## Both config files must exist

The image ships **two** files in `/etc/dagger`: `engine.json` (Dagger's own
schema — GC, security, registries) and `engine.toml` (BuildKit's). The
entrypoint runs `dagger-engine --config /etc/dagger/engine.toml`.

Mounting the ConfigMap at `/etc/dagger` **replaces the whole directory**, so a
ConfigMap carrying only `engine.json` deletes `engine.toml`. The engine then
falls back to parsing the JSON as TOML and CrashLoops on its opening brace:

```
dagger-engine: (1, 1): parsing error: keys cannot contain { character
failed to parse config
```

`config/engine.toml` is therefore committed empty and generated alongside
`engine.json`. Do not drop it because it looks like it holds nothing — its
existence is the point.

And the container passes **no `args`**. `--config` is BuildKit's flag and parses
TOML only, so `--config /etc/dagger/engine.json` appended a second `--config`
that won and aimed the TOML parser at the JSON. `engine.json` needs no flag at
all — `/etc/dagger/engine.json` is a hardcoded path inside the engine binary.

`security.insecureRootCapabilities: true` in `engine.json` is needed only for
the e2e leg, which runs k3s nested inside a Dagger container. If that approach
is abandoned, set it `false` — the engine is meaningfully safer without it.

## Cache sizing

100Gi `ssd-single` per pod, with `engine.json` GC set to `maxUsedSpace: 70GB`,
`reservedSpace: 10GB`, `minFreeSpace: 20%`. The GC ceiling is deliberately well
under the volume size: BuildKit measures its own store, not the filesystem, and
a full volume fails builds in confusing ways rather than evicting.

`ssd-single` is LINSTOR with one replica and node-local placement. Replicating a
build cache over DRBD would pay network cost on the hottest write path in the
pipeline for bytes that are disposable by definition. `hdd` (SeaweedFS) is
disqualified outright: `/var/lib/dagger` holds live container filesystems, and a
network filesystem there is a known performance killer.

**Accepted trade-off:** a node-local volume means that if cp2 dies,
`dagger-engine-0` stays `Pending` until it returns. That is what the second
replica covers, and it is why `nodeAffinity` is `required` on cp2/cp3 (cp1 has
~210GiB free and hosts Nexus) with `podAntiAffinity` keeping one engine per node.

## Registry mirrors

`engine.json` routes base-image pulls through Harbor
(`../harbor/README.md`). The hostname is `registry.eliorion.fr`, **not**
`harbor.registry.svc` — the certificate is issued for the public name, and
Let's Encrypt cannot sign an in-cluster DNS name. Using one name everywhere
keeps TLS valid on every path and avoids any `insecure` escape hatch.
In-cluster resolution goes out to the LAN VIP and back via Cilium; the extra
hop is irrelevant next to a layer pull.

Harbor serves a letsencrypt-STAGING chain (there is no prod ClusterIssuer), which the
engine's system trust store rejects — measured as
`x509: certificate signed by unknown authority`, then `trying next host`, so every pull
silently fell through to upstream and Harbor was never used. The dedicated
`registry.eliorion.fr` entry pins the two LE staging ROOTS via `ca`, so a renewal needs no
engine change. It is a separate host entry on purpose: an `insecure`/`ca` inside the
`docker.io` block would apply to the UPSTREAM fallback host, weakening the safety net rather
than the mirror.

**NEVER break the `ca` path as a way to "turn Harbor off".** A missing or unreadable file
makes the engine return that error out of its whole registry-host builder, so docker.io AND
ghcr.io fail with no upstream attempt at all — a total outage, not a degraded mirror. The
kill switch is removing the `mirrors` arrays, or unsetting `DAGGER_RUNNER_HOST`.

`ghcr.io` points at **`ghcr-public`**, not `ghcr-proxy`. `engine.json` has no credentials
field at all, and `ghcr-proxy` is private, so that mirror could only ever 401. Every ghcr
image this module pulls is public (`astral-sh/uv`, `aquasecurity/trivy`); private
`eliorion/*` images 404 at Harbor and fall through to ghcr.io, where the pod's pull secret
applies.

**The mirror value carries a PATH and no scheme:**
`registry.eliorion.fr/dockerhub-proxy`. Harbor's proxy cache is project-scoped,
and BuildKit does `path.Join("/v2", mirrorPath)` itself — writing
`…/v2/dockerhub-proxy` here yields `/v2/v2/dockerhub-proxy` and 404s every pull.
Talos spells the same mirror the opposite way (scheme *and* `/v2`, plus
`overridePath`); see the Harbor README's per-client table.

BuildKit falls through to the canonical registry when a mirror fails, so Harbor
being down degrades speed, never correctness.

## Operating

```bash
# Is the engine reachable from a runner?
_EXPERIMENTAL_DAGGER_RUNNER_HOST=kube-pod://dagger-engine-0?namespace=dagger \
  dagger version

# What is the cache actually holding?
kubectl -n dagger exec dagger-engine-0 -- buildctl du -v | tail -20

# Reclaim space by policy (respects engine.json), or everything:
kubectl -n dagger exec dagger-engine-0 -- \
  dagger core engine local-cache prune --use-default-policy
```

A cache wipe is never a correctness fix — it only costs time. If a build is
wrong, the cause is a cache *key* that is too coarse, not a stale entry.

## Version pin

`registry.dagger.io/engine:v0.21.9`, pinned in `statefulset.yaml`.

**The engine and the `dagger` CLI must be version-compatible.** The CLI version
used by CI lives in `asp/.github/versions.env` as `DAGGER_VERSION`; bump both in
the same change or sessions fail with a protocol mismatch.
