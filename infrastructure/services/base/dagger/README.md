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

## Cache sizing

100Gi `ssd-single` (`data-dagger-engine-0`), with `engine.json` GC set to `maxUsedSpace: 70GB`,
`reservedSpace: 10GB`, `minFreeSpace: 20%`. The GC ceiling is deliberately well
under the volume size: BuildKit measures its own store, not the filesystem, and
a full volume fails builds in confusing ways rather than evicting.

`ssd-single` is LINSTOR with one replica and node-local placement. Replicating a
build cache over DRBD would pay network cost on the hottest write path in the
pipeline for bytes that are disposable by definition. `hdd` (SeaweedFS) is
disqualified outright: `/var/lib/dagger` holds live container filesystems, and a
network filesystem there is a known performance killer.

**Accepted trade-off:** a node-local volume means that if the node holding
`data-dagger-engine-0` dies, the engine stays `Pending` until it returns, and CI
has no engine — the same outcome as before, since every run was already pinned to
`dagger-engine-0`. Deleting the PVC lets it reschedule onto the other node with a
cold cache. `nodeAffinity` is `required` on cp2/cp3 because cp1 has ~210GiB free and
hosts Nexus; `WaitForFirstConsumer` binds the volume wherever the pod first lands.

## Pod spec choices

- **`privileged: true` is non-negotiable.** The engine is BuildKit: it creates
  containers, manages snapshots and mounts. The chart hardcodes it, plus
  `capabilities: ALL`, `runAsUser: 0` and `fsGroup: 1001`.
- **No CPU limit, memory limit 8Gi.** A throttled builder makes every job slower
  for no isolation benefit on a dedicated node pair.
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
