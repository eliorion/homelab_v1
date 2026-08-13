# Design decisions and tradeoffs

Every significant choice in this cluster, what was rejected, and what the choice cost.
This is the document to read if you want to know *why* the platform looks the way it does
rather than *what* it contains.

**How to read an entry.** Each one carries four fields. `Why` is the actual driver, not a
retrospective justification. `Rejected` names the alternative that was really on the table.
`Cost` is the price that is still being paid today, stated plainly. `Reference` points at
the file or the deeper document.

A decision with no stated cost is a decision that has not been examined yet. Where an
entry says the cost is currently unmitigated, that is deliberate: an accepted risk that is
written down is manageable, an accepted risk that is invisible is not.

**Contents**

1. [Platform](#1-platform)
2. [Networking and exposure](#2-networking-and-exposure)
3. [Storage](#3-storage)
4. [Data, backups and disaster recovery](#4-data-backups-and-disaster-recovery)
5. [CI and build cache](#5-ci-and-build-cache)
6. [Identity](#6-identity)
7. [Observability](#7-observability)
8. [GitOps and developer workflow](#8-gitops-and-developer-workflow)
9. [Incident index](#9-incident-index)
10. [Open work](#10-open-work)

---

## 1. Platform

### Talos Linux instead of a general purpose distribution

**Why.** Talos has no SSH, no shell and no package manager. The machine config is the only
way to change a node, which means node state becomes as reviewable as application state.
On a general purpose distribution the gap between "what the config says" and "what someone
typed at 2am" is unbounded.

**Rejected.** Debian on Proxmox, which is what this cluster ran on until June 2026.

**Cost.** Every operation is an API call or a config render. There is no escape hatch for
"just look at the file", and debugging means learning the Talos API surface rather than
reusing Linux muscle memory. Node extensions (`iscsi-tools`, `util-linux-tools`, both
required by Longhorn) live in a factory schematic that must be passed explicitly on every
upgrade, which is a trap documented in [section 9](#9-incident-index).

**Reference.** [06-k3s-retirement.md](06-k3s-retirement.md), `bootstraping/talconfig.yaml`

### All three nodes are control planes and all three run workloads

**Why.** The requirement was that any one node can be unplugged. That needs a three member
etcd quorum. With exactly three machines available, there is no way to also dedicate nodes
to the control plane.

**Rejected.** One control plane plus two workers (no quorum survivability). Three control
planes plus separate workers (no hardware for it).

**Cost.** Real and currently unmitigated. etcd, kube-apiserver and every application share
the same three boxes. Six manifests under `apps/` set resource limits, there are no
priority classes protecting control plane components, and there are no eviction guards. A
noisy workload competes with the control plane and nothing stops it.

**Reference.** [07-talos-ha-expansion.md](07-talos-ha-expansion.md)

### The API VIP is a Talos etcd lease, not keepalived

**Why.** All control planes carry `vip.ip` and elect through an etcd lease. The winner adds
`192.168.1.100` to its NIC and sends a gratuitous ARP. When it dies the lease expires
within seconds and another node claims the address; clients see one connection retry. No
extra daemon has to be installed on an immutable OS.

**Rejected.** keepalived. Also rejected: hardcoding the endpoint to a node address, which
was the state before the HA expansion and does not survive that node leaving.

**Cost.** All control planes must share one L2 segment. The VIP depends on etcd, so total
quorum loss takes the VIP with it. The Cilium LB-IPAM pool must be kept clear of
`.100` to `.103` or the two ARP speakers collide, and that separation is a convention
rather than something enforced.

**Reference.** [07-talos-ha-expansion.md](07-talos-ha-expansion.md)

### The Talos API is deliberately not behind the VIP

**Why.** The VIP depends on etcd, and `talosctl` has to keep working when etcd is the
broken thing. Total quorum loss means the VIP is gone and `kubectl` is dead while
`talosctl` is alive. That is the recovery anchor for the whole platform, and it is what
made the 2026-06-12 incident recoverable at all.

**Rejected.** Putting port 50000 behind the same VIP for a single entrypoint, which would
make the recovery tool depend on the thing being recovered.

**Cost.** Every `talosctl` invocation and every runbook step has to name explicit node
addresses, and `talosctl config endpoints` has to be re-edited whenever a node is added,
removed or renumbered.

**Reference.** [07-talos-ha-expansion.md](07-talos-ha-expansion.md)

### One talhelper `talconfig.yaml` renders all three machine configs

**Why.** Per node hardware differences are `nodes[]` fields; everything shared lives in one
block that cannot drift between nodes. The alternative in practice was three near identical
25 KB files kept in sync by hand.

**Rejected.** Copying `controlplane.yaml` per node and editing four fields, which is how
Phase 2 of the HA expansion actually started.

**Cost.** The rendered output is gitignored, so what is actually on the nodes can only be
inferred from the input. Rendering requires the offline age key, so nobody without that key
can produce a node config at all.

**Reference.** `bootstraping/talconfig.yaml`, [08-cilium-cni-ingress-migration.md](08-cilium-cni-ingress-migration.md)

### `talsecret.sops.yaml` was extracted once from the live cluster and must never be regenerated

**Why.** It holds the etcd CA, the machine CA and the Kubernetes CA. Regenerating mints a
new PKI, so existing node certificates stop validating, existing `talosconfig` and
`kubeconfig` stop authenticating, and etcd members cannot re-form. Disaster recovery
depends on the opposite property: rebuilding node configs from the *same* secret keeps
every existing certificate working.

**Rejected.** A clean `talhelper gensecret`. talhelper was retrofitted onto an already
running cluster with `gensecret -f` against the live PKI rather than rebuilding the cluster
to fit the tool.

**Cost.** The cluster PKI is now a single artifact in git that is unrotatable in practice
and protected by one age key. Losing `clusters/staging/age.agekey` means the cluster cannot
be rebuilt, snapshots or not, because etcd snapshots explicitly do not cover the Talos
machine PKI.

**Reference.** [09-etcd-backup-dr.md](09-etcd-backup-dr.md)

---

## 2. Networking and exposure

### Cilium without kube-proxy, swapped on the live cluster

**Why.** Talos has no ServiceLB, so a `type: LoadBalancer` Service sat pending forever with
no external address and there was no L7 path at all. Cilium supplies the datapath, LB-IPAM
and a GatewayClass in one chart, and eBPF service load balancing removes kube-proxy.

**Rejected.** Staying on Flannel plus kube-proxy. A per node rolling swap was rejected as
impossible, because a CNI is a cluster wide datapath and the two do not interoperate.

**Cost.** The pod network degrades cluster wide during the cutover, which is exactly what
happened. Mitigated only by the control plane being host network. See
[section 9](#9-incident-index).

**Nuance worth stating.** "Without kube-proxy" is true of service load balancing and not of
masquerading. `bpf.masquerade` is deliberately `false`, because Talos'
`hostDNS.forwardKubeDNSToHost` is enabled and eBPF masquerade breaks CoreDNS in that
configuration. Masquerading therefore still runs on iptables.

**Reference.** [08-cilium-cni-ingress-migration.md](08-cilium-cni-ingress-migration.md)

### Cilium ships as a Flux HelmRelease, not as a Talos inline manifest

**Why.** It keeps the CNI on the same GitOps substrate as everything else, so Renovate can
bump it and the chart values are reviewable. The inline manifest alternative embeds a
Hubble CA in a roughly 2300 line committed blob.

**Rejected.** Talos `inlineManifest`.

**Cost.** A cold start with all three nodes down needs one manual `cilium install` before
Flux can recover anything. And the ordering is load bearing: pushing the Cilium manifests
before applying the Talos config deadlocked the live cluster.

**Reference.** [08-cilium-cni-ingress-migration.md](08-cilium-cni-ingress-migration.md)

### VXLAN tunnel mode rather than native routing

**Why.** All three nodes share one L2 segment, and tunnel mode was the safe default during
a migration that was already degrading the datapath.

**Rejected.** `routingMode: native` with `autoDirectNodeRoutes`, written up as the post
cutover optimisation.

**Cost.** Encapsulation overhead on a segment where it buys nothing. The optimisation is
documented and has not been applied.

**Reference.** `infrastructure/controllers/base/cilium/release.yaml`

### Gateway API instead of an ingress controller

**Why.** `gatewayAPI.enabled: true` in the Cilium chart provides L7 ingress with no second
controller to own. The CRDs ship at the Talos layer via `extraManifests` so they exist
before the chart creates its GatewayClass.

**Rejected.** Traefik (retired with k3s) and ingress-nginx (never present).

**Cost.** Honest status: the migration is not finished. There is one Gateway with a single
plaintext listener on port 80, one HTTPRoute, and its hostname does not resolve on the LAN
yet. Three objects elsewhere in the repository still name `ingressClassName: traefik`, a
controller this cluster no longer runs.

**Reference.** [08-cilium-cni-ingress-migration.md](08-cilium-cni-ingress-migration.md)

### Public exposure is a Cloudflare Tunnel with routes in the vendor dashboard

**Why.** `cloudflared` dials outward, so no port is forwarded on the home router and the
origin is never directly addressable. The tunnel is token driven, which means it is
remotely managed and its routes live in the Zero Trust dashboard.

**Rejected.** A locally managed tunnel with a `config.yaml` ingress block in git. A port
forward to an LB-IPAM address.

**Cost.** Route configuration is outside git and there is no reconciliation loop that would
notice drift. The compensating control is a hand maintained README, and that control has a
measured failure rate of one: it claimed a hostname carried a web UI only, when the same
route was in fact serving a continuous audio stream. The tunnel token is also a bearer
credential with no rotation procedure written down anywhere.

**Reference.** `infrastructure/services/staging/cloudflare/README.md`,
[11-azuracast-public-relay.md](11-azuracast-public-relay.md)

### The Keycloak public hostname is scoped to four path prefixes with no catch all

**Why.** Keycloak's `hostname-admin` setting does not refuse admin requests arriving on the
public hostname. The vendor's own documentation says to restrict them at the reverse proxy.
The four path rules (`/realms/*`, `/resources/*`, `/js/*`, `/.well-known/*`) are that
restriction, and a WAF rule blocking `/admin*` is a deliberately redundant second layer
that fails independently.

**Rejected.** A whole host route relying on Keycloak's own setting. Relying on the WAF rule
alone.

**Cost.** Four dashboard entries kept in sync by hand. Adding a catch all route would
re-expose the admin console and no pull request in this repository would show it. The
`.well-known/*` entry is easy to miss and its absence breaks only RFC 8414 style clients,
so the failure looks client specific and random.

**Reference.** [02-keycloak.md](02-keycloak.md)

### Admin surfaces are on the tailnet and nowhere else

**Why.** The admin UIs front a control surface with no authentication of its own. The
Longhorn UI can delete volumes, the asp orchestrator has no auth, the fbref BFF queries the
database directly. A LAN LoadBalancer would let anyone on the home network drive them and a
public ingress would be worse. Tailscale authenticates by device identity and never touches
the internet.

**Rejected.** A LAN LoadBalancer from the Cilium pool. A Cloudflare public hostname.

**Cost.** Stated sharply, because the usual framing understates it: Tailscale is a single,
unbacked authentication plane in front of a set of surfaces that have no authorization
behind them at all. One over broad ACL grant, or one compromised device, is full control of
storage and databases. There is no second factor. The documented Kubernetes API server
grant impersonates `system:masters`, so off LAN `kubectl` is cluster admin or nothing.
None of the ACL configuration can be expressed in Flux.

**Reference.** `infrastructure/controllers/staging/tailscale-operator/README.md`

### Two different tailnet publication mechanisms, chosen per workload

**Why.** A Tailscale `Ingress` terminates HTTPS on 443 with a MagicDNS certificate. The
`tailscale.com/expose` annotation is an L3 forward that preserves the Service port. n8n is a
password authenticated dashboard whose session cookie belongs on a secure origin, so it
gets the Ingress. The Icecast stream is a byte stream pulled by another server over an
already encrypted WireGuard hop, so it gets the L3 forward that preserves port 8000.

**Rejected.** Using one mechanism uniformly, in both directions.

**Cost.** The two must never be applied to the same workload: both at once registers two
tailnet devices contending for one hostname and the loser is silently suffixed, which for
an OIDC redirect target is an origin nothing trusts. Every Ingress path also depends on
HTTPS Certificates being enabled by hand in the admin console.

**Reference.** `apps/base/n8n/ingress-tailscale.yaml`

### cert-manager issues one private CA and nothing else

**Why.** The only certificate that matters internally protects the `cloudflared` hop to
Keycloak. A public CA would buy nothing there: the name it protects is not resolvable from
the internet and no browser ever sees it. The Issuer is namespaced rather than a
ClusterIssuer so the CA can sign for `identity` and nothing else.

**Rejected.** ACME with Let's Encrypt. Plaintext HTTP to Keycloak, which would put
credentials on the node network in the clear, since Cilium runs without transparent
encryption.

**Cost.** A dashboard managed tunnel has no way to trust a private CA, so the origin
configuration sets "No TLS Verify". The hop is encrypted but not authenticated, and that is
named as a limitation rather than papered over.

**Reference.** `infrastructure/services/base/keycloak/app/certificate.yaml`

---

## 3. Storage

### Longhorn with three replicas, one per node

**Why.** Longhorn data lives on each node's ephemeral partition, which `talosctl reset`
wipes. Three replicas make one node's death a rebuild rather than a loss.

**Rejected.** One replica, which is what the single node cluster ran. Two replicas was the
documented fallback if the new machines had smaller disks than planned.

**Cost.** Three times the provisioned space on every volume, which is exactly what later
blocked a routine database growth. And the important one: **replicas are resilience, not
backup.** There is no `backupTarget`, so three copies of a deleted file is zero copies, and
a correlated failure across all three nodes loses everything that has no database level
backup of its own.

**Reference.** [07-talos-ha-expansion.md](07-talos-ha-expansion.md)

### Nexus runs at one replica, against the class default of three

**Why.** Everything in that volume is a cache. Proxied artifacts re-download on the next
miss and the hosted build cache is CI output that gets rebuilt. Losing the node costs a
cold cache and one slow CI run, not data. It was also the most expensive volume in the
cluster: 350Gi provisioned, and at three replicas roughly 1TB of about 2.1TB of schedulable
space, which left routine growth elsewhere nowhere to go.

**Rejected.** Keeping the class default. Pointing the PVC at a one replica StorageClass,
which is impossible without deleting the StatefulSet and the volume with it, because both
`storageClassName` and `volumeClaimTemplates` are immutable.

**Cost.** The setting lives outside git as a patch on the Longhorn Volume resource.
Longhorn persists it across restarts and upgrades, but a recreated PVC comes back at the
class default of three, and nothing detects that.

**Reference.** `infrastructure/services/base/nexus/release.yaml`

### The disk reserve was cut from 30% to 15% rather than over provisioning past 100%

**Why.** Longhorn's stock 30% reserve took 299GB out of each 997GB disk and left only 26GB
schedulable, which blocked a routine database growth while real usage was about 537GB.
These are dedicated data partitions that Longhorn owns outright, so nothing else on the
host competes for what the reserve protects. 15% is the right value for that situation.

**Rejected.** Raising `storageOverProvisioningPercentage` above 100%, explicitly. Over
provisioning converts a hard admission webhook denial into a write time outage, and a
volume growing into space that does not exist is exactly how two databases went down.
Failing fast at scheduling time was chosen over failing late at write time.

**Cost.** Less emergency headroom per disk. And the setting only applies to disks Longhorn
adds afterwards, so existing node resources had to be patched by hand, per node and per
disk. The consequence is worth naming: **git and the cluster currently disagree about disk
reserve and nothing detects it.**

**Reference.** [07-talos-ha-expansion.md](07-talos-ha-expansion.md)

### A daily `filesystem-trim` recurring job on the `default` group

**Why.** WAL recycling, table bloat and deleted files free blocks inside the filesystem
that Longhorn otherwise keeps counted in `actualSize`. Trim returns them, so reported usage
tracks real usage. It runs at 04:00, after the 03:00 database backups.

**Rejected.** Per volume recurring job labels. The `default` group applies to every volume
that has no explicit labels, which here is all of them.

**Cost.** Trim I/O on every volume at once, bounded only by a concurrency of 2. The actual
effect has never been quantified before and after.

**Reference.** `infrastructure/controllers/base/longhorn/recurringjob-trim.yaml`

### Off cluster object storage reached through one in cluster HAProxy gateway

**Why.** The Talos nodes are not tailnet members; only the Tailscale operator's proxy pods
are. The gateway is what turns three tailnet devices into one stable ClusterIP with health
checking and failover, so no consumer has to know three addresses.

**Rejected.** Each consumer dialling the three egress Services directly, which means no
failover, no health checking and three endpoints to configure per consumer.

**Cost.** A new hop and a new failure mode on every backup path. The gateway is in cluster
only, so a restore deliberately does not retrace the write path and instead goes direct to
a node's tailnet address. And the probes are TCP connects on the frontend port that do not
gate on backend health, so a gateway pod reports Ready while every storage node is
unreachable. The real signal is on the stats port and in the database alerting, not in pod
status.

**Reference.** [12-garage-object-storage.md](12-garage-object-storage.md)

---

## 4. Data, backups and disaster recovery

### The CNPG barman-cloud plugin instead of the in tree object store

**Why.** Upstream CloudNativePG deprecated the in tree path. The plugin ships an
ObjectStore CRD and an injected sidecar per instance, which decouples backup configuration
from the Cluster spec.

**Rejected.** `spec.backup.barmanObjectStore`, which is not used anywhere in this
repository.

**Cost.** Bigger than the obvious one. The small cost is a hard cert-manager dependency and
a CRD ordering problem. The real cost is that `plugin-barman-cloud` is at `0.6.0` and it
injects a sidecar into the write path of every Postgres instance. Two of the incidents in
[section 9](#9-incident-index) are downstream of that choice. The honest framing is that
taking upstream's deprecation signal seriously meant paying for pre 1.0 bugs, twice, and
documenting both.

**Reference.** [03-backups.md](03-backups.md)

### The plugin gets its own Flux Kustomization gated on cert-manager

**Why.** Flux applies a Kustomization atomically, so a custom resource that shares a
Kustomization with its own CRD deadlocks on `no matches for kind ObjectStore`. Splitting
the plugin out and making everything that declares an ObjectStore depend on it turns a
deadlock into an ordering guarantee.

**Rejected.** Shipping the plugin inside `infrastructure-controllers` next to the operator.

**Cost.** Three extra Flux objects and a longer reconcile chain.

**Reference.** [03-backups.md](03-backups.md), `clusters/staging/infrastructure.yaml`

### Two object storage backends, R2 and self hosted Garage

**Why.** History rather than principle, and worth saying so. R2 came first and gives
server side encryption, bucket versioning and object lock. Garage was added later as
capacity I own, for the large and newer datasets.

**Rejected.** Everything on R2. Everything on Garage.

**Cost.** Garage has no server side encryption, no versioning and no object lock. Anyone
holding a write key can delete every object in its bucket. The mitigation is blast radius
reduction rather than prevention: one bucket and one scoped key per consumer, so a
credential in one namespace cannot rewrite another namespace's archive, which is the
archive you would be restoring from on the day you need both.

**Reference.** [12-garage-object-storage.md](12-garage-object-storage.md)

### `AWS_REGION=garage` on every Garage object store

**Why.** Garage runs with a non standard region and exactly one S3 call enforces it.
`HeadBucket` returns 400 on a mismatch while `GetObject`, `PutObject` and `ListObjectsV2`
all succeed. barman-cloud sets no region, so boto3 signs as `us-east-1`.

**Rejected.** Leaving it unset, which is the state that caused the 2026-08-10 outage.

**Cost.** This is not a tradeoff, it is a fix for a bug, and the honest entry is what it
cost: about two days of gateway downtime and three days of permanently lost WAL. What
remains is a config coupling between YAML in this repository and an off cluster daemon's
region setting, validated by nothing. One staged object store still omits it, which is
tracked in [section 10](#10-open-work).

**Reference.** [12-garage-object-storage.md](12-garage-object-storage.md)

### etcd snapshots authenticate through a scoped Talos API role

**Why.** `kubernetesTalosAPIAccess` issues short lived, auto rotated client certificates to
pods in one namespace, and the `os:etcd:backup` role grants exactly one API method. A
leaked backup credential cannot read machine config, fetch other secrets or reboot a node.

**Rejected.** Generating a long lived `talosconfig` and committing it as an encrypted
Secret, which is a static credential with no rotation.

**Cost.** It opens a Kubernetes to Talos API bridge at all: any workload that can land in
that namespace inherits the ability to dump full etcd, which contains every Secret in the
cluster. It also couples backups to a machine config feature flag, so a node config
regression breaks them silently.

**Reference.** [09-etcd-backup-dr.md](09-etcd-backup-dr.md)

### The etcd age private key is offline and is not in this repository

**Why.** Encrypting it under the same age recipient as everything else would make one loss
take out both. It is also the only real mitigation against Garage having no object lock:
the write key can delete every snapshot, but it cannot read one.

**Rejected.** SOPS encrypting it into the repository.

**Cost.** Every restore needs a human with an offline secret, which is precisely why the
final drill step has never been executed. Three offsite artifacts must survive together:
the SOPS age key, the etcd age key, and access to this repository, which holds the cluster
PKI.

**Reference.** [09-etcd-backup-dr.md](09-etcd-backup-dr.md)

### Alert on the WAL backlog, not on time since the last archive

**Why.** A quiet database legitimately archives nothing for days. The time based rule fired
on a database that was 47 hours past its last archive with nothing pending and nothing
wrong, and it said nothing about whether anything was actually stuck. Every `.ready` file
is a segment Postgres may not recycle, so a sustained backlog *is* the disk filling up.
During the outage the failing instance reported 119 waiting and every other instance
reported 0.

**Rejected.** `seconds_since_last_archival`, which was the first implementation and was
reverted.

**Cost.** A brief non zero reading right after a segment switch is normal, so the rule
needs `for: 15m`. That is up to fifteen minutes of blindness on a genuinely stuck archiver.

**Reference.** `monitoring/configs/staging/cnpg-alerts/prometheusrule.yaml`

### Never archive back into the path you are restoring from

**Why.** A cluster recovered from an archive must write its own WAL somewhere else, or it
overwrites the chain it was restored from. The 2026-06-11 recovery restored from one server
name and archived the recovered cluster to a new one. The restore drill went further and
ran with no backup plugin at all, so the test cluster physically could not archive back
onto the source's chain.

**Rejected.** Reusing the same server name on the recovered cluster.

**Cost.** An orphaned prefix in the bucket that has to be pruned by hand afterwards.

**Reference.** [03-backups.md](03-backups.md)

---

## 5. CI and build cache

### A hand written dind template instead of the chart's `containerMode: dind`

**Why.** The chart's injected sidecar accepts no extra dockerd flags, and the Nexus Docker
connectors are plain HTTP, so dockerd refuses them unless each host and port form is passed
with `--insecure-registry`. Six exact forms are whitelisted, covering both the short
service name and the FQDN.

**Rejected.** `containerMode: dind`, which is zero template maintenance. Terminating TLS on
the Nexus connectors, which was deferred.

**Cost.** The template is hand maintained: an init container, native sidecar semantics,
socket and externals volumes, and the runner's `DOCKER_HOST` all have to be reproduced.
Chart bumps past the current minor will not update that wiring. It also forces a privileged
sidecar, which is why one namespace carries a `privileged` Pod Security label. And because
only `--insecure-registry` is set and never `--registry-mirror`, caching is opt in per
workflow line: any image reference that omits the Nexus prefix silently bypasses the cache.

**Reference.** [04-ci-runners-cache.md](04-ci-runners-cache.md)

### One Nexus repository per port, each with a unique connector port

**Why.** Nexus opens one Docker connector per port. A duplicate port makes the
configuration Job fail with HTTP 400 and the connector never opens, which surfaces in CI as
`connection refused` with the real error only visible in the Job's logs. This happened, and
the fix is a commit.

**Rejected.** A path routed Docker group on a single connector.

**Cost.** Three extra ports to expose across the chart values, the LoadBalancer Service and
the six dockerd flags, and an indirect failure mode.

**Reference.** [04-ci-runners-cache.md](04-ci-runners-cache.md)

### Compaction is provisioned by a CronJob hitting the UI's own API, not by the chart

**Why.** Nexus 3.92 runs on JDK 25 on every published image tag, and the chart provisions
tasks and cleanup policies through the deprecated Groovy scripting API, whose bundled
compiler cannot read JDK 25 class files. Those calls fail with HTTP 500, silently. The
compaction task itself is plain Java and runs fine; only its provisioning was broken. So a
CronJob idempotently ensures the task exists through the UI's own API, and the task then
self schedules.

**Rejected.** Pinning an older image tag (every 3.92.2 tag is JDK 25). Downgrading Nexus,
which is unsafe because the database migrations are one way.

**Cost.** Cleanup policy edits silently no op on this JVM. The existing policies work only
because they were provisioned before the JDK bump, so the YAML and the live configuration
can diverge with nothing detecting it. There are now two schedules to reason about instead
of one.

**Reference.** [04-ci-runners-cache.md](04-ci-runners-cache.md)

### Two cleanup policies keyed on different criteria

**Why.** BuildKit's max mode overwrites the cache tag every build, and the previous manifest
becomes untagged. A policy keyed on last download can never match a manifest that was never
pulled by tag, and that leak reached roughly 215GB. Keying the build cache repository on
last write instead lets the live tag survive, because it is rewritten every build, while
dangling manifests age out.

**Rejected.** A single last download policy across all repositories, which is provably
unable to reap dangling manifests.

**Cost.** Any manifest in that hosted repository that is not rewritten inside the window is
deleted regardless of how often it is pulled.

**Reference.** `infrastructure/services/base/nexus/release.yaml`

### Renovate runs self hosted, in cluster, against this repository only

**Why.** It keeps the dependency loop on the same substrate as everything else, with one
encrypted token and autodiscovery disabled so its blast radius is one repository.

**Rejected.** The hosted GitHub App. Dependabot.

**Cost.** Understated everywhere else, so here it is fully. The updater image is itself
unpinned, in a repository whose stated convention is that versions are pinned. It opens
pull requests that no CI validates. It cannot touch the three add on manifests fetched by
raw URL at the Talos layer, two of which track `main` and `releases/latest`. The highest
risk unpinned dependencies in the system are precisely the ones Renovate does not cover.
The rule that the two runner controller charts must move together is enforced by a comment
and a human, not by a package rule.

**Reference.** `infrastructure/services/base/renovate/`

---

## 6. Identity

### Anonymous dynamic client registration is open on one realm, fenced rather than closed

**Why.** Hosted AI clients mandate OAuth 2.1 with dynamic client registration and will not
accept a pre registered client id, so the registration endpoint has to be public and
unauthenticated. Host matching on the caller's address is switched off deliberately,
because hosted providers register from arbitrary cloud egress addresses, so matching would
reject every real client while providing no security.

**Rejected.** Closing registration and pinning a static client, which is strictly safer and
is explicitly recommended in the document if that client support ever stops mattering.

**Cost.** A public unauthenticated registration endpoint, accepted knowingly. Fenced by a
trusted hosts policy on redirect URIs, a client cap, a protocol mapper allowlist so a self
registered client cannot mint an audience of its own, required consent, and disabled full
scope. Registered clients have to be reviewed periodically, by a human, on a cadence
nothing enforces.

**Reference.** [02-keycloak.md](02-keycloak.md)

### The audience mapper lives on a default scope, not an optional one

**Why.** Keycloak 26 does not implement RFC 8707 resource indicators and ignores the
`resource` parameter, so the audience has to be stamped on by a mapper. The consuming
service requires that audience and refuses a token without it, which stops a token issued
for some future client in the same realm being replayed against the database.

**Rejected.** An optional scope, under which a dynamically registered client that asks for
nothing gets a token with no audience, is refused, and fails with no obvious cause.

**Cost.** Every client in the realm gets the audience whether it needs it or not.

**Reference.** `infrastructure/services/base/keycloak/realm/realm-mcp.yaml`

### Realm membership is the access list, and users are not in git

**Why.** The realm allows no self registration and holds exactly one resource, so an
account existing in it *is* permission to read that database. There is no second gate and
no role to assign, which keeps the model small enough to reason about.

**Rejected.** Declaring users in the realm file.

**Cost.** The access list lives only in the database: no pull request review, no history,
gone if the realm is rebuilt. The backups are what make it recoverable. And the import tool
defaults to full user management, under which the next realm import would delete every user
absent from the file, meaning all of them. One environment variable prevents that, and
removing it is a silent total lockout triggered by an unrelated realm edit.

**Reference.** [02-keycloak.md](02-keycloak.md)

### Two realms rather than one

**Why.** One realm has anonymous registration open to hosted AI providers and membership of
it already grants database read access. Adding another application's operators to it would
silently grant that, and adding that application's browser SSO client would put it in a
realm whose registration surface is public.

**Rejected.** One shared realm. A realm per application, which is more isolation than the
Cloudflare Access model can use, because an identity provider is configured once per
account and reused by every application.

**Cost.** Two realms to keep in sync. The second realm's client secret has to be declared
in the file and substituted from an encrypted Secret rather than generated by Keycloak,
because a regenerated secret breaks the edge side silently with a failed token exchange
nobody sees.

**Reference.** `infrastructure/services/base/keycloak/realm/realm-apps.yaml`

### The Keycloak operator is vendored into this repository

**Why.** The Keycloak project publishes no Helm chart for its operator. The supported
installs are raw release manifests or an operator lifecycle manager this cluster does not
run. A remote kustomize base pointing at a raw URL would make every Flux reconcile depend
on GitHub being reachable, and would let a re-tagged release change what the cluster runs
with no commit.

**Rejected.** A remote base. A community chart. A hand written StatefulSet, which is what
this replaced.

**Cost.** Roughly 950 KB of generated YAML in the repository, bumpable only through a
script. The namespace transformer's role binding rewrite is load bearing: without it the
operator starts with no permissions and reconciles nothing while looking perfectly healthy.

**Reference.** `infrastructure/controllers/base/keycloak-operator/README.md`

---

## 7. Observability

### Two independent Telegram paths for the same class of failure

**Why.** The Flux notification path is instant and carries the actual error text, which is
what you read while debugging. The Alertmanager path arrives after the rule's `for:` window
and is label only, but it brings grouping, silences and history. Neither alone gives both.

**Rejected.** A single path. WhatsApp, which has no native provider on either side and
would need a middleman service.

**Cost.** Duplicate notifications for one incident, and the same bot token stored twice as
two encrypted secrets in two namespaces with nothing keeping them in sync.

**Reference.** [05-alerting.md](05-alerting.md)

### One hand written PodMonitor for the databases instead of the operator's own

**Why.** No database metric existed in Prometheus at all. The monitor the operator would
create carries no `release` label, and the CRD has no field to add one, so Prometheus'
selector would drop it anyway. This was written after the outage where three days of total
archiving failure went unseen.

**Rejected.** Per cluster monitor creation, dropped by the selector. Relaxing the selector,
not done.

**Cost.** A single object scraping every namespace, so the scrape configuration is now
decoupled from the Cluster definitions that own it.

**Reference.** [12-garage-object-storage.md](12-garage-object-storage.md)

### Per workflow automation failures are deliberately not alerted

**Why.** A failing HTTP call, a bad payload or an expired token all appear as a failed
execution in the automation tool's own view. The one thing that view cannot report is the
tool being down, and if it is down every automation is stopped and nothing else would say
so.

**Rejected.** Per workflow error webhooks into Alertmanager.

**Cost.** It requires a human habit: checking the executions view weekly. A workflow that
has been failing every run for six days is invisible until someone looks. The detection
window for real automation breakage is a week, by design.

**Reference.** [10-n8n-automation.md](10-n8n-automation.md)

### The default watchdog alert is routed to a blackhole receiver

**Why.** It is an always firing heartbeat and it was noise.

**Rejected.** Leaving it firing. Using it as a dead man's switch against an external
heartbeat service.

**Cost.** There is now no dead man's switch at all. If Alertmanager or the whole stack
dies, silence looks exactly like health. This is a gap, not a win, and it is listed in
[section 10](#10-open-work).

**Reference.** `monitoring/controllers/base/kube-prometheus-stack/release.yaml`

---

## 8. GitOps and developer workflow

### Many small Kustomizations with explicit dependencies, not one large one

**Why.** CRD before CR is the recurring failure mode, and a custom resource applied against
an unregistered CRD is a reconcile error rather than a wait. Giving each operator its own
Kustomization with `wait: true` and a health check turns that into an ordering guarantee.

**Rejected.** One monolithic infrastructure Kustomization relying on the controller's retry
loop to converge eventually.

**Cost.** Eighteen Kustomizations to reason about, and a bad health check anywhere stalls
an entire downstream branch.

**Reference.** `clusters/staging/infrastructure.yaml`

### `wait: true` on the narrow operator tiers and deliberately not on the wide ones

**Why.** Gating a wide fan out tier on full health would let one sick workload block
everything behind it. The gate belongs on the narrow tiers where readiness is a real
prerequisite.

**Rejected.** `wait: true` everywhere.

**Cost.** A Kustomization that depends on a wide tier waits only for apply success, not for
the services to be healthy. The one place that matters compensates with its own availability
wait inside the Job.

**Reference.** `clusters/staging/infrastructure.yaml`

### Every HelmRelease sets `upgrade.remediation.retries`, because the default is a silent latch

**Why.** `retries` defaults to `0`, and `0` does not mean "retry with the normal reconcile
loop". It means helm-controller marks the release `Stalled=True reason=RetriesExceeded`
after **one** failed upgrade and never attempts it again. The release keeps reporting on its
`interval`, so `flux get helmreleases` shows a row and the Kustomization above it stays
Ready — the only signal is `Ready=False` on that one object.

That is not hypothetical. Nexus latched on a single failed upgrade on 2026-07-27 and sat
`Ready=False` for **sixteen days** with nothing retrying. The same latch caught
`kube-prometheus-stack` on 2026-08-11, minutes after a values change, and needed a manual
`reconcile.fluxcd.io/forceAt` to move. At the time of the sweep **fourteen of nineteen**
releases were unguarded, including `cilium`, `longhorn` and `cnpg` — the CNI, the storage
layer and every database.

There is a second reason beyond the retry. With `retries: 0`, `remediateLastFailure`
defaults to `false`, so a failed upgrade is not remediated **at all**: the release is left
exactly as the failed upgrade left it, which for a partially-applied chart means half the
new version is live and nothing will finish or undo it. Setting `retries: 3` turns that into
rollback-then-retry, so even the case where a rollback is unwelcome is an improvement on the
case where nothing happens.

**Rejected.** Per-release tuning of the retry count. The number is not the interesting part —
the difference that matters is between "never retries" and "retries", and a uniform value is
one less thing to get wrong. Also rejected: leaving the CRD-bearing controllers
(`cilium`, `longhorn`, `cnpg`, `cert-manager`, `keda`) unguarded on the grounds that rolling
a CNI or a storage layer back is risky. It is, but see the paragraph above: the status quo
for those releases was not "stay safely on the old version", it was "stay half-upgraded
forever".

**Cost.** A deterministically-failing upgrade now churns four times instead of once before
stalling, and each cycle rolls the workload. On `cilium` that is CNI pod churn; on `longhorn`
it is manager churn while volumes are attached. The end state is the same `Stalled` as
before — the retries buy self-healing for transient failures (registry blip, a rollout that
crosses `timeout`, a webhook not yet up) at the price of noisier failure for permanent ones.
Helm does not roll CRDs back, so a rollback leaves the newer CRDs in place with the older
controller; that is tolerable because chart CRD changes are additive in practice, but it is
the reason a rollback is not a true return to the previous state.

**Reference.** `infrastructure/services/base/nexus/release.yaml` carries the original
diagnosis inline; every other release points here.

### SOPS with age, encrypting only the values

**Why.** With `encrypted_regex` scoped to the data blocks, manifest structure stays
reviewable in a diff and only the secret values become ciphertext. Encrypted files are
confined to the environment overlays and never appear in `base/`, so a base kustomization
is always plaintext safe and reusable by both environments.

**Rejected.** Sealed Secrets. An external secrets operator. Whole file encryption.

**Cost.** Metadata (secret names, namespaces, key names) is public in git. And the failure
mode is silent: a new encrypted Secret in a path whose Kustomization has no `decryption`
block gets applied with the literal ciphertext string as its value, and nothing errors at
apply time. That has happened, and the diagnosis is commented inline where it bit.

**Reference.** `.sops.yaml`, `clusters/staging/infrastructure.yaml`

### One repository, one branch, many clusters, separated only by path

**Why.** Each cluster reconciles its own path and they cannot conflict.

**Rejected.** A branch per environment. A repository per environment.

**Cost.** No promotion gate of any kind. Production manifests are edited in the same commits
as staging ones and nothing enforces that staging was proven first. In practice the second
environment simply rotted, which is the honest outcome and is recorded in
[the README's limitations](../README.md#known-limitations).

**Reference.** [00-bootstrap-cluster.md](00-bootstrap-cluster.md)

### Toolchain in `mise.toml`, every tool at `latest`

**Why.** A low friction development loop. The versions that actually matter (charts, Talos,
Kubernetes) are pinned in manifests instead.

**Rejected.** Pinned tool versions for a byte reproducible devcontainer.

**Cost.** The development environment is not reproducible over time, and there is live proof:
the installed Flux CLI is ahead of the committed controller manifests, so a bootstrap run
from this devcontainer would silently upgrade the cluster's control plane by a minor
version.

**Reference.** `mise.toml`

---

## 9. Incident index

Each of these has a full write up with commands. They are collected here because the root
causes are the transferable part.

| Date | Incident | Root cause in one line | Where |
|---|---|---|---|
| 2026-06-11 | Migration backup would not restore | Freezing writers meant no WAL segment switch, so the end of backup checkpoint segment was never archived | [06](06-k3s-retirement.md) |
| 2026-06-11 | etcd member stuck as a learner forever | Talos never re-attempts promotion after an interrupted join, and one stuck learner blocks every future join | [07](07-talos-ha-expansion.md) |
| 2026-06-11 | Longhorn faulted on all three nodes | A regenerated disk UUID, not a disk problem; the data was intact the whole time | [07](07-talos-ha-expansion.md) |
| 2026-06-11 | A bare upgrade silently installed vanilla Talos | Without an explicit image, the upgrade ignores the machine config's install image and drops the extensions Longhorn needs | [07](07-talos-ha-expansion.md) |
| 2026-06-12 | The CNI cutover deadlocked the cluster | Manifests pushed before the platform prerequisites; the fix was in a repository Flux could no longer read | [08](08-cilium-cni-ingress-migration.md) |
| 2026-06-12 | A base backup with no WAL chain | Formally unrestorable by the tool's rules; recovered as a data only restore with `pg_resetwal` in a scratch pod | [07](07-talos-ha-expansion.md) |
| 2026-08-10 | AI gateway down for two days | One unset S3 region; only `HeadBucket` enforces it, so the archive failed from minute one while every backup reported success | [12](12-garage-object-storage.md) |
| 2026-08-10 | A published web UI was also publishing an audio stream | The proxy served both on the same port the tunnel already routed; documentation asserted otherwise and a later document reasoned on top of it | [11](11-azuracast-public-relay.md) |
| ongoing | Nexus filled its volume with data it had already deleted | Soft deleted blobs plus a compaction task that could not be provisioned on JDK 25 | [04](04-ci-runners-cache.md) |
| ongoing | `flux reconcile` reported in sync while the fix never applied | The controller compares its release record against desired values, not against a cluster where the object no longer exists | [04](04-ci-runners-cache.md) |
| ongoing | Longhorn refused a routine growth with 460GB per disk unused | A 30% reserve plus a deliberate refusal to over provision; and the new setting only applies to disks added afterwards | [07](07-talos-ha-expansion.md) |

Three recurring themes across that table, which is the reason it exists:

1. **A controller saying "healthy" is a claim about its own record, not about reality.**
   Backups reported success through three days of total archiving failure. A reconcile
   reported in sync while the object it manages did not exist. A storage controller
   reported faulted data that was byte for byte intact.
2. **A setting that is only read on certain code paths is a trap.** The machine config
   asserted the right installer image the entire time and was never wrong; it just was not
   read on that path. The same shape appears in the region check that only runs while an
   archive is empty.
3. **Ordering is load bearing when a controller applies on push.** Either apply the
   prerequisites first, or push with the Kustomization suspended.

---

## 10. Open work

Tracked, not hidden.

| Item | Why it matters | State |
|---|---|---|
| Longhorn `backupTarget` | Volume data has no backup at all; a correlated failure loses every stateful workload without its own database backup | Named as the next piece of work in three documents |
| Complete the etcd restore drill | Tiers 0 and 1 are scripted and proven; the final decrypt of a real stored object with the offline key has never been run, and the destructive rehearsal never attempted | Manual, `mise run etcd-drill` |
| CI on this repository | No render check, no schema validation, no lint, no secret leak check on a pull request that Flux will apply within ten minutes | Not started |
| Backups for the automation database | It is the only copy of every workflow and every stored credential | Unblocked: the Garage key is minted and encrypted, and the object store now sets the region that caused the 2026-08-10 outage. Enabling it is uncommenting four lines in `apps/staging/databases/n8n/kustomization.yaml` and confirming the bucket exists |
| A dead man's switch | The watchdog alert is blackholed, so a dead monitoring stack is indistinguishable from a healthy cluster | Not started |
| Network policy | Cilium is used as a datapath and not as a policy engine; there is no default deny anywhere | Not started |
| Decide the fate of the second environment | It is wired but not deployed, has not been touched since June 2026, and still encodes a bucket layout that staging deliberately moved away from | Undecided |
| Replicate snapshots to a second provider | A second offsite copy of the etcd snapshots, using the object storage account that already exists | Named as a deliberate future step |
