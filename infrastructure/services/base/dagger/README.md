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

`engine.json` routes base-image pulls through zot. Note the hostname is
`registry.eliorion.fr:<port>`, **not** `zot.registry.svc` — the certificate is
issued for the public name, and Let's Encrypt cannot sign an in-cluster DNS
name. Using one name everywhere keeps TLS valid on every path and avoids any
`insecure` escape hatch. In-cluster resolution goes out to the LAN VIP and back
via Cilium; the extra hop is irrelevant next to a layer pull.

BuildKit falls through to the canonical registry when a mirror fails, so zot
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
