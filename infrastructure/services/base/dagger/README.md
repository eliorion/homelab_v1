# Dagger Engine

The build engine for the CI pipeline. Runners hold no Docker daemon: they run
`dagger call`, which connects here and executes the whole pipeline as containers
inside this engine.

## Deployed with the upstream Helm chart

| File | What it does |
|---|---|
| `repository.yaml` | `HelmRepository/dagger` in `flux-system`, `type: oci`, `oci://registry.dagger.io`. |
| `release.yaml` | `HelmRelease/dagger` → chart `dagger-helm`, `targetNamespace: dagger`. |
| `kustomization.yaml` | Namespace + RBAC, the Harbor CA ConfigMap, and the replacement that feeds `config/engine.json` into the release. |
| `config/engine.json` | The engine's own config (GC, security, registries). Content, not annotation. |
| `config/harbor-ca.pem` | The LE staging roots `engine.json` pins for Harbor. |

The chart replaced a hand-written StatefulSet (two replicas, headless Service). Its values
keep every property that one had:

- **`engine.kind: StatefulSet` + `persistentVolumeClaim`.** `/var/lib/dagger` holds a
  **`buildkitd.lock`**, so a persistent cache needs one volume per engine, which only
  `volumeClaimTemplates` gives. The chart's default `DaemonSet` would put the cache on a
  node `hostPath` (the Talos EPHEMERAL partition) instead of a sized LINSTOR volume.
- **`hostPath.dataVolume.enabled: false`.** The chart defaults it on even for a
  StatefulSet, and it declares a second `data` volume that shadows the PVC.
- **`fullnameOverride: dagger`.** The chart names the StatefulSet `<fullname>-engine`,
  so the pod stays `dagger-engine-0` — the name in the `DAGGER_RUNNER_HOST` repo
  variable and in `rbac.yaml` `resourceNames`. The release name alone would give
  `dagger-dagger-helm-engine-0` and silently break both.
- **`engine.labels.app: dagger-engine`** keeps the PodMonitor selector matching; the
  chart's own selector label is `name: dagger-engine`.

**One replica.** The chart hardcodes `replicas: 1` for a StatefulSet. That loses nothing
in practice: `DAGGER_RUNNER_HOST` pinned every CI run to `dagger-engine-0`, and
`dagger-engine-1` sat idle. The hash-based client spread
(`IDX=$(( 0x$(printf %s "$SERVICE" | sha1sum | cut -c1-2) % 2 ))`) was never wired.
Getting a second engine back means a `postRenderers` patch on `replicas` plus an
anti-affinity rule and a second `resourceNames` entry.

**Chart version = engine version.** The chart's image defaults to
`registry.dagger.io/engine:v<chart version>`, so `engine.image.ref` is left unset and
there is a single pin. See [Version pin](#version-pin).

### Cutover from the hand-written StatefulSet

The HelmRelease creates a StatefulSet with the **same name** the Kustomization is
pruning. If helm-controller installs before the prune lands, Helm refuses to adopt it
(`invalid ownership metadata`); `install.remediation.retries: 3` retries until the
old object is gone. The selector changed (`app` → `name`), so the new StatefulSet
never adopts the old pods.

The volume claim template is named `data`, not `cache`, so the new engine starts
with an empty cache on `data-dagger-engine-0`. The old claims are **retained** — a
StatefulSet deletion never removes PVCs — and hold 200Gi of `ssd-single` until
deleted by hand:

```bash
kubectl -n dagger delete pvc cache-dagger-engine-0 cache-dagger-engine-1
```

## Connection: kube-pod://, never tcp://

Dagger's own documentation states that `tcp://` sends every query and response
in plaintext with no authentication. `kube-pod://` execs a session helper
through the apiserver instead, so the transport is the apiserver's TLS and the
authorization is Kubernetes RBAC. There is deliberately **no TCP listener**:
`engine.port` stays unset, because the chart turns it into
`--addr tcp://0.0.0.0:<port>`.

The chart does render a ClusterIP Service, `dagger`, because `engine.containerPorts`
is set. It carries only the `metrics` port (see [Metrics](#metrics)), which is
already reachable at the pod IP.

## Security

`rbac.yaml` grants `pods/get` + `pods/exec` on exactly `dagger-engine-0`.

**Exec into a privileged pod is node-root-equivalent.** Anything holding that
Role can run code as root on cp2 or cp3. That is inherent to Dagger on
Kubernetes, and it drives three rules:

1. Dedicated namespace, nothing cluster-wide, `resourceNames`-pinned.
2. `list` is **not** granted — `resourceNames` cannot constrain a list, so it
   would hand over namespace enumeration for no benefit.
3. **Fork pull requests must never run on runners bound to this Role.** Gate on
   `github.event.pull_request.head.repo.full_name == github.repository`.

## Engine config

`config/engine.json` stays a plain JSON file. A kustomize `replacement` copies it into
the release's `engine.configJson` at build time; the carrier ConfigMap is marked
`config.kubernetes.io/local-config` so it never reaches the cluster. The chart then
renders its own `dagger-engine-config` ConfigMap and stamps a `checksum/config`
annotation, so an `engine.json` change rolls the engine.

The rejected alternatives: Flux `valuesFrom` with `targetPath` parses the value with
Helm's `--set` grammar, which splits on commas and mangles any JSON object; inlining
the JSON in `release.yaml` would bury the config inside YAML.

The chart mounts `engine.json` with a **`subPath`**, so the image's own
`/etc/dagger/engine.toml` (empty) stays in place. The old StatefulSet mounted a
ConfigMap over the whole `/etc/dagger` directory, which deleted `engine.toml` and
CrashLooped the engine on its entrypoint's `--config /etc/dagger/engine.toml`:

```
dagger-engine: (1, 1): parsing error: keys cannot contain { character
failed to parse config
```

That trap is why a comment-only `engine.toml` used to be committed. Setting
`engine.config` would bring a TOML file back; nothing needs one.

**No `engine.args`.** `--config` is BuildKit's flag and parses TOML only, so
`--config /etc/dagger/engine.json` appends a second `--config` that wins and aims the
TOML parser at the JSON. `engine.json` needs no flag at all —
`/etc/dagger/engine.json` is a hardcoded path inside the engine binary.

**The Harbor CA ConfigMap has a fixed name** (`disableNameSuffixHash`). It is
referenced from HelmRelease values in `flux-system`, and kustomize's name-reference
rewrite only matches objects in the same namespace, so a hash suffix would never
reach the volume. A `subPath` mount never picks up an update either: after changing
`harbor-ca.pem`, run `kubectl -n dagger rollout restart statefulset dagger-engine`.
The file pins the LE staging roots, so a certificate renewal does not change it.

`security.insecureRootCapabilities: true` in `engine.json` is needed only for
the e2e leg, which runs k3s nested inside a Dagger container. If that approach
is abandoned, set it `false` — the engine is meaningfully safer without it.

## engine.json is mounted twice, on purpose

The chart's `engine.configJson` renders `dagger-engine-config` and mounts it at
`/etc/dagger/engine.json`. **The engine does not read that path.** It auto-loads
`$XDG_CONFIG_HOME/dagger/engine.json`, falling back to `$HOME/.config/dagger/engine.json`, and
the container runs as root with `XDG_CONFIG_HOME` unset — so the file it reads is
`/root/.config/dagger/engine.json`. `/etc/dagger/engine.toml` (the image entrypoint's
`--config`) is the legacy BuildKit format and the chart leaves it empty. Hence the second
mount of the same ConfigMap in `release.yaml`.

Measured 2026-09-16, before that mount existed: `engine.json` was inert in full. The GC
numbers the API reported (`maxUsedSpace` 94GB, `reservedSpace` 10GB, `minFreeSpace` 25GB)
did not move when the file said 150GB or 100GB, nor when the volume went 200Gi → 120Gi —
they are the documented defaults (keep under 75% of the disk, 20% free). A `docker.io` pull
reached Docker Hub directly with nothing in Harbor's access log, so the mirrors were not
applied either. `insecureRootCapabilities: true` was equally inert, which is why it is now
`false` in the file: the engine has been running without it since at least 2026-09-14 with
CI green, and the nested-k3s spike that once needed it is gone (asp retired the k3d e2e
legs).

After changing anything in `config/engine.json`, verify it actually took:

```bash
dagger core engine local-cache max-used-space        # must match the file, not 9.4e+10
kubectl logs -n registry <harbor-nginx-pod> --since=5m | grep <engine pod IP>
```

## Cache sizing

120Gi `ssd-single` (`data-dagger-engine-0`) on **cp1**, with `engine.json` GC set to
`maxUsedSpace: 100GB`, `reservedSpace: 10GB`, `minFreeSpace: 15%`. The GC ceiling is
deliberately well under the volume size: BuildKit measures its own store, not the
filesystem, and a full volume fails builds in confusing ways rather than evicting.

Sized to cp1's pool, not to the cache's appetite. That pool is the cluster's smallest
(`linstor_ssd`, 223.3GiB, ~187GiB free) because node 1's 500GB NVMe is split in half by
`bootstraping/talconfig.yaml`: a 240GB `RawVolumeConfig linstor` beside a 240GB EPHEMERAL
(`/var`, ~35% used). Talos only grows volumes, so rebalancing that split needs the node's
EPHEMERAL wiped — a control-plane reset, not worth it. The pool is LVM-thin and
over-provisioned, and a thin pool that runs out takes down every volume on it, not just
this one: a filesystem on a thin volume reports free space the pool does not have, and
BuildKit's `minFreeSpace` trusts the filesystem. Hence the volume itself is the guard.

History: 100Gi / 70GB → 200Gi / 150GB on cp2-cp3 (2026-09-15, the volume ran 81% full during
full PR pipelines with GC at its ceiling) → 120Gi / 100GB on cp1 (2026-09-16). The move
traded cache room for the two things that are actually scarce here. **Disk**: cp1's pool is
on the NVMe (`nvme0n1p5`), cp2's and cp3's on SATA SSDs (`sdc7`, `sda7`), and the engine
waits on disk up to 45% of the time. **Contention**: cp1 has 16 cores at 16% requested
against cp3's 8 at 54%, which is what a six-leg CI matrix competes for. Measured cache use
before the move was 50GB of 200Gi.

**Resizing.** The chart renders the claim as a StatefulSet `volumeClaimTemplate`, which
Kubernetes refuses to change, so editing `storage` alone fails the Helm upgrade. In order:

```bash
kubectl -n dagger patch pvc data-dagger-engine-0 --type=merge \
  -p '{"spec":{"resources":{"requests":{"storage":"<new size>"}}}}'   # online, keeps the cache
kubectl -n dagger delete statefulset dagger-engine --cascade=orphan  # the pod keeps running
# now merge the storage edit and reconcile infrastructure-services + the HelmRelease
```

Helm then creates the StatefulSet with the new template and adopts the pod. Do not rely on
`flux suspend` to hold the release in between: `infrastructure-services` owns the HelmRelease
and clears a hand-set `spec.suspend` the moment it applies the edit (seen on the 2026-09-15
resize). Keep the orphan delete and the merge close together; if the release reconciles
first, it recreates the old StatefulSet and the upgrade fails — orphan-delete it again.

`ssd-single` is LINSTOR with one replica and node-local placement. Replicating a
build cache over DRBD would pay network cost on the hottest write path in the
pipeline for bytes that are disposable by definition. `hdd` (SeaweedFS) is
disqualified outright: `/var/lib/dagger` holds live container filesystems, and a
network filesystem there is a known performance killer.

**Accepted trade-off:** a node-local volume means that if the node holding
`data-dagger-engine-0` dies, the engine stays `Pending` until it returns, and CI
has no engine — the same outcome as before, since every run was already pinned to
`dagger-engine-0`. Deleting the PVC lets it reschedule onto the other node with a
cold cache. `nodeAffinity` is `required` on cp1 for its cores (see Cache sizing);
`WaitForFirstConsumer` binds the volume wherever the pod first lands.

**Moving it to another node** is a cold move — the volume is node-local, so the cache does
not follow (LINSTOR can replicate it live with `linstor resource create <node> <res>`, then
drop the old replica, if a warm move is ever worth the DRBD sync):

```bash
# nothing running: gh run list --repo <repo> --status in_progress
kubectl -n dagger delete statefulset dagger-engine --cascade=foreground
kubectl -n dagger delete pvc data-dagger-engine-0     # the cache, deliberately
# merge the affinity + storage edit, then reconcile infrastructure-services
```

The first pipeline afterwards is cold: every Dagger function re-runs and every image layer
is re-pulled.

## Pod spec choices

- **`privileged: true` is non-negotiable.** The engine is BuildKit: it creates
  containers, manages snapshots and mounts. The chart hardcodes it, plus
  `capabilities: ALL`, `runAsUser: 0` and `fsGroup: 1001`.
- **`cpu: 2` requested (no limit), memory limit 16Gi, request 4Gi.** A throttled builder makes
  every job slower for no isolation benefit on a dedicated node. The limit was 8Gi until the
  engine was OOMKilled at 8.2GiB RSS during a full PR pipeline (2026-09-15): the kill
  aborts every running CI session and left the cache at 3GB afterwards. The request rose
  2Gi → 4Gi on 2026-09-16, to reserve what the engine actually holds while idle-to-warm.
  CPU stays unbounded on measurement, not taste: over the week to 2026-09-15 the engine
  drew more than one core for 1.25 h in total (p95 0.09 core, peak 4.4), while waiting on
  disk up to 45% of the time. Memory and disk are the constraints; cores are not — the
  `cpu: 2` request (from `500m`, 2026-09-16) is about the SHARE the scheduler and CFS hand
  out under contention, not about a ceiling it was hitting.
- **`terminationGracePeriodSeconds: 30`**, down from the chart's 300. An engine
  restart throws away in-flight builds either way; CI should not wait for a
  graceful shutdown that cannot preserve them.
- **Probes are the chart's** (`dagger core version`), replacing
  `buildctl debug workers`. `dagger core` prints a deprecation notice in 1.0 but
  still answers; re-check the probe after an engine bump.

## Metrics

`_EXPERIMENTAL_DAGGER_METRICS_ADDR=0.0.0.0:9090` makes the engine serve Prometheus
metrics on the `metrics` port: `dagger_connected_clients`,
`dagger_dagql_cache_entries`, `dagger_local_cache_total_disk_size_bytes`,
`dagger_local_cache_entries` and friends. The disk figures refresh every five
minutes. The variable is undocumented and experimental (dagger/dagger#10555), so a
version bump may rename or drop it — check the `dagger-ci` Grafana dashboard after
every engine bump. The PodMonitor and the dashboard live in
[`monitoring/configs/staging/dagger-ci/`](../../../../monitoring/configs/staging/dagger-ci/README.md).

This is a **metrics** listener, not the engine API: it serves read-only
Prometheus text, unauthenticated, to anything that can reach the pod IP. The rule
above — no TCP listener for the engine itself, clients go through `kube-pod://` —
is unchanged.

Traces and step logs do **not** come from the engine. The `dagger` CLI in the
runner pod pulls them over the session and exports them over OTLP; that wiring is
in [`../../staging/arc-runner-set/README.md`](../../staging/arc-runner-set/README.md).

## Registry mirrors

`engine.json` routes base-image pulls through Harbor
(`../harbor/README.md`). The hostname is `registry.eliorion.fr`, **not**
`harbor.registry.svc` — the certificate is issued for the public name, and
Let's Encrypt cannot sign an in-cluster DNS name. Using one name everywhere
keeps TLS valid on every path and avoids any `insecure` escape hatch.
In-cluster resolution goes out to the LAN VIP and back via Cilium; the extra
hop is irrelevant next to a layer pull.

Until 2026-09-15 Harbor served a letsencrypt-STAGING chain, which the
engine's system trust store rejects — measured as
`x509: certificate signed by unknown authority`, then `trying next host`, so every pull
silently fell through to upstream and Harbor was never used. The dedicated
`registry.eliorion.fr` entry pins the two LE staging ROOTS via `ca`, so a renewal needs no
engine change. It is a separate host entry on purpose: an `insecure`/`ca` inside the
`docker.io` block would apply to the UPSTREAM fallback host, weakening the safety net rather
than the mirror.

Harbor now serves a `letsencrypt-prod` chain, and the pin does not get in its way: BuildKit's
`loadTLSConfig` starts from `x509.SystemCertPool()` and *appends* the `ca` files, so the prod
chain verifies through the system roots. The pin is redundant, not harmful. Removing it means
removing the `ca` entry, the mount and the file together — see the warning below.

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

Chart `dagger-helm` `1.0.0-beta.13` in `release.yaml`, which deploys
`registry.dagger.io/engine:v1.0.0-beta.13`.

**The engine and the `dagger` CLI must be version-compatible.** Two CLIs talk to it:

- the local CLI, `http:dagger` in `asp/mise.toml` (1.0 betas are published on
  dl.dagger.io only, never as GitHub releases, so mise's default aqua backend 404s);
- the CI CLI, `DAGGER_VERSION` in `asp/.github/versions.env`, installed by
  `ensure-tool.sh` from GitHub release assets.

Measured 2026-09-14 against a local `engine:v1.0.0-beta.13`: a `0.21.9` CLI and a
`1.0.0-beta.13` CLI both connect and load the asp module (`dagger.json`
`engineVersion: v0.21.9`) with `dagger functions`. A 1.0 CLI suggests
`dagger workspace migrate`; that rewrites the module's config and is a separate
change. Check the `dagger-ci` dashboard after every bump: the metrics variable is
experimental.
