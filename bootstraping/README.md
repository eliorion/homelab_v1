# bootstraping

The Talos layer. Flux does not reconcile any of it: nothing here is applied by a controller,
it is pushed to the nodes by hand with `talosctl`, and only when the machine configuration
itself changes.

One file is the source of truth — **`talconfig.yaml`**, a [talhelper](https://github.com/budimanjojo/talhelper)
config that renders the three machine configs for `staging-controlplane-1/2/3`. Cluster
`Homelab_staging`, Talos `v1.13.4`, Kubernetes `v1.36.1`, API endpoint
`https://192.168.1.100:6443` (the VIP).

> This directory was originally driven by raw `talosctl gen config`, and this README used to
> document that flow. It does not apply anymore: `controlplane.yaml` is no longer hand
> written or hand copied per node. Everything is rendered from `talconfig.yaml`.

The end-to-end runbook — hardware, factory image, the two Secrets Flux does not create, the
manual `cilium install`, `flux bootstrap` — is
[../documentations/00-bootstrap-cluster.md](../documentations/00-bootstrap-cluster.md).
This README covers the input file and the render/validate/apply loop around it.

## What is in this directory

| Path | What it is |
|---|---|
| `talconfig.yaml` | **Committed. The only thing to edit.** talhelper input: cluster-wide settings, a `nodes[]` entry per machine, and two raw `patches`. |
| `talsecret.sops.yaml` | **Committed, SOPS-encrypted.** The cluster PKI (etcd CA, machine CA, Kubernetes CA). Read by talhelper at render time. Never regenerate it. |
| `clusterconfig/` | **Generated, gitignored.** `Homelab_staging-staging-controlplane-{1,2,3}.yaml` plus a `talosconfig`. Overwritten on every render — never hand edit. |
| `talosconfig`, `kubeconfig` | Gitignored credentials for `talosctl` / `kubectl` against this cluster. |
| `controlplane-1/2/3.yaml`, `worker.yaml` | Gitignored leftovers from before talhelper was adopted (June 2026). Not inputs, not outputs — talhelper writes the `Homelab_staging-`-prefixed files under `clusterconfig/` instead. Stale; the `worker.yaml` still names the retired Proxmox VM endpoint. |
| `.envrc` | Local direnv helper, gitignored. Exports `TALOSCONFIG`/`KUBECONFIG` for the shell; talhelper does not read it (its `--env-file` default is `talenv*.yaml`, which this repo does not use). |

## Rendering, validating, applying

```bash
cd bootstraping
SOPS_AGE_KEY_FILE=../clusters/staging/age.agekey talhelper genconfig
```

Without `SOPS_AGE_KEY_FILE` the render fails: `talsecret.sops.yaml` cannot be decrypted.
`--offline-mode` skips the POST to the image factory (it derives the schematic ID locally)
and is what the migration runbooks use. `--dry-run` prints a diff instead of writing —
useful before a change, but the diff carries the same key material the rendered files do,
so do not paste it anywhere.

Validate before applying:

```bash
talosctl validate --config clusterconfig/Homelab_staging-staging-controlplane-1.yaml --mode metal
```

Apply per node. `--insecure` is only for a node still in maintenance mode with no PKI of
its own; a node already in the cluster is applied over the authenticated Talos API:

```bash
talosctl apply-config --insecure -n 192.168.1.101 \
  --file clusterconfig/Homelab_staging-staging-controlplane-1.yaml
```

`talosctl` must address nodes by their real IPs. The Talos API is deliberately not behind
the VIP — the VIP is an etcd lease, and `talosctl` has to keep working when etcd is the
broken thing.

## What `talconfig.yaml` declares

### Cluster-wide

| Field | Value | Note |
|---|---|---|
| `clusterName` | `Homelab_staging` | Also the filename prefix under `clusterconfig/`. |
| `talosVersion` | `v1.13.4` | Appended as the tag to each node's `talosImageURL` at render time. |
| `kubernetesVersion` | `v1.36.1` | Drives the `registry.k8s.io/kube-*` image tags. |
| `endpoint` | `https://192.168.1.100:6443` | The Kubernetes API through the VIP. |
| `allowSchedulingOnControlPlanes` | `true` | All three nodes run workloads; there is no worker. |
| `additionalMachineCertSans` / `additionalApiServerCertSans` | `192.168.1.100` | Without the VIP in both SAN lists, TLS to the VIP fails hostname verification. |
| `clusterPodNets` / `clusterSvcNets` | `10.244.0.0/16` / `10.96.0.0/12` | Cilium reuses the per-node podCIDR Talos allocates out of this range (`ipam.mode: kubernetes`). |
| `cniConfig.name` | `none` | Talos installs no CNI at all. |

### Per node

| Field | node-1 | node-2 | node-3 |
|---|---|---|---|
| `hostname` | `staging-controlplane-1` | `staging-controlplane-2` | `staging-controlplane-3` |
| `ipAddress` | `192.168.1.101` | `192.168.1.102` | `192.168.1.103` |
| `installDisk` | `/dev/nvme0n1` | `/dev/sda` | `/dev/sda` |
| `talosImageURL` schematic | `65cf8364…` (AMD box, amd-ucode) | `36cd6536…` (Intel, intel-ucode) | `36cd6536…` |

Everything else in `networkInterfaces` is identical across the three: `deviceSelector.physical: true`
(match the physical NIC whatever it is called), `dhcp: false` with a static `/24`,
`vip.ip: 192.168.1.100`, nameserver `192.168.1.1`, a default route via `192.168.1.1`, and a
static route for `100.64.0.0/10` via `192.168.1.200`.

Hostnames are hyphenated because Kubernetes rejects underscores in node names.

### The machine patch

| Setting | What it is for |
|---|---|
| `kubelet.defaultRuntimeSeccompProfileEnabled: true` | Pods with no seccomp profile get `RuntimeDefault` instead of unconfined. |
| `kubelet.disableManifestsDirectory: true` | Turns off the static-pod directory, so the only way to run something on a node is through the API. |
| `kubelet.extraArgs.rotate-server-certificates: true` | The kubelet requests its serving certificate from the cluster CA by CSR. Paired with the `kubelet-serving-cert-approver` manifest below. |
| `kubelet.extraMounts` → `/var/lib/longhorn` (`bind`, `rshared`, `rw`) | Longhorn's data path has to be visible inside the kubelet mount namespace with shared propagation. |
| `install.wipe: false` | Applying a config does not wipe the install disk. |
| `install.grubUseUKICmdline: true` | GRUB boots with the kernel command line carried in the UKI. |
| `features.diskQuotaSupport: true` | XFS project quotas for ephemeral storage limits. |
| `features.kubePrism.port: 7445` | Host-network local API load balancer on `localhost:7445`. Cilium's `k8sServicePort` must carry the same number (`../infrastructure/controllers/base/cilium/release.yaml`) — that is how its kube-proxy replacement reaches the API. |
| `features.hostDNS` + `forwardKubeDNSToHost: true` | Host DNS resolver, with kube-dns queries from the host forwarded into the cluster. |
| `features.kubernetesTalosAPIAccess` | Grants the `etcd-backup` namespace the `os:etcd:backup` role on the Talos API. |
| `nodeLabels` → `node.kubernetes.io/exclude-from-external-load-balancers` | Standard control-plane label; kept even though every node is also a workload node. |

### The cluster patch

| Setting | What it is for |
|---|---|
| `proxy.disabled: true` | No kube-proxy. Cilium does service load balancing in eBPF. |
| `discovery.registries.kubernetes.disabled: true`, `service: {}` | Node discovery goes through the Talos discovery service, not through the Kubernetes registry. |
| `extraManifests` → `kubelet-serving-cert-approver` | Approves the kubelet serving CSRs produced by `rotate-server-certificates`. Nothing in core Kubernetes approves them. |
| `extraManifests` → `metrics-server` | The cluster's only metrics-server. It is a Talos manifest, not a Flux HelmRelease — `kubectl top` depends on this layer. |
| `extraManifests` → gateway-api `v1.4.1` `standard-install.yaml` + experimental `tlsroutes.yaml` | The Gateway API CRDs Cilium 1.19 needs. Plain CRDs with no secret material in them, so fetching them by URL at boot is safe. TLSRoute is included only so the Cilium operator stops logging a missing CRD. |

## Why it is like this

**Why talhelper rather than three machine configs.** Per-node hardware differences are
`nodes[]` fields and everything shared lives in one block that cannot drift between nodes.
The alternative, which is how the HA expansion actually started, was three near-identical
25 KB files kept in sync by hand — the stale `controlplane-1/2/3.yaml` in this directory are
what that looked like. The cost is that the rendered output is gitignored, so what is
actually on the nodes can only be inferred from the input, and rendering needs the offline
age key.

**Why `talsecret.sops.yaml` is committed and frozen.** talhelper was retrofitted onto an
already-running cluster: the secret was extracted from the live PKI with `gensecret -f`
rather than rebuilding the cluster to fit the tool. It has to stay because disaster recovery
means rebuilding node configs from the *same* CAs. It is encrypted with the age key in
`clusters/staging/age.agekey`, which is also the only thing that can decrypt it — etcd
snapshots do not cover the Talos machine PKI, so losing that key means the cluster cannot be
rebuilt at all.

**Why the API VIP is a Talos etcd lease.** All three control planes carry `vip.ip` and elect
through etcd; the winner ARPs for `192.168.1.100`. No keepalived to install on an immutable
OS. The price: all three nodes must share one L2 segment, total quorum loss takes the VIP
with it, and the Cilium LB-IPAM pool (`192.168.1.110`–`.130`) has to stay clear of
`.100`–`.103` or two ARP speakers collide.

**Why `cniConfig.name: none` and `proxy.disabled: true`.** Cilium is a Flux HelmRelease
(`../infrastructure/controllers/base/cilium`), not a Talos inline manifest, so it stays
reviewable and Renovate-bumpable and no Hubble CA lands in git. Talos therefore installs no
datapath, and a freshly bootstrapped cluster sits `NotReady` until Cilium arrives. On a
completely cold cluster that means one manual `cilium install` before Flux can reach
anything.

**Why the two nodes have different installer schematics.** Both factory images carry
`siderolabs/iscsi-tools` and `siderolabs/util-linux-tools` for Longhorn; they differ only in
the microcode extension (amd-ucode for the AMD box, intel-ucode for the two Intel ones).
Booting a stock Talos image instead gives a cluster where Longhorn fails with
`failed to execute iscsiadm: No such file or directory`.

**Why `kubernetesTalosAPIAccess` instead of a mounted `talosconfig`.** The etcd-backup
CronJob calls the Talos API for snapshots. Through this feature it gets short-lived,
auto-rotated certificates from a `ServiceAccount` CR instead of a static admin credential in
a Secret, and the `os:etcd:backup` role grants exactly one method,
`/machine.MachineService/EtcdSnapshot`. A leaked backup credential cannot read or reboot
anything.

**Why the `100.64.0.0/10` route via `192.168.1.200` is vestigial.** `100.64.0.0/10` is the
tailnet CGNAT range, and `192.168.1.200` was the Proxmox host that ran the only tailscaled
subnet router (doc 06). Nothing depends on that path now: doc 07 Phase 4 replaced the subnet
router with the Tailscale operator's in-cluster egress proxies — the scraper dials
`tailscale-proxy-*.tailscale.svc`, and Garage is reached through the `garage-s3` HAProxy
gateway — and Phase 5 wiped that host and rebuilt it as bare-metal `192.168.1.101`. Removing
the route block from all three node configs is a Phase 4 step that was never carried out, so
it is still in `talconfig.yaml`.

## Traps

- **Never regenerate `talsecret.sops.yaml`.** It holds the etcd CA, the machine CA and the
  Kubernetes CA. A new secret is a new PKI: node certificates stop validating, `talosconfig`
  and `kubeconfig` stop authenticating, etcd members cannot re-form. There is no undo.
- **Never hand edit anything under `clusterconfig/`.** It is regenerated and overwritten on
  the next `talhelper genconfig`, and it is gitignored, so the edit is invisible in review
  and silently lost.
- **Do not re-add `admissionControl` / `auditPolicy` to the cluster patch.** talhelper emits
  both by default and the defaults already match the live cluster (`enforce: baseline`,
  `audit`/`warn: restricted`, `kube-system` exempt). Adding them here appends a second
  `kube-system` entry to the exemptions list.
- **Do not remove the `kubernetesTalosAPIAccess` block** — it looks unused from inside this
  file, and removing it kills the etcd-backup CronJob
  (`../infrastructure/services/base/etcd-backup`); its pods lose the only credential they
  have for the Talos API.
- **Do not remove the `kubelet-serving-cert-approver` manifest** while
  `rotate-server-certificates` is on, and do not remove `rotate-server-certificates` while
  metrics-server is expected to scrape over verified TLS. The two are a pair.
- **The gateway-api CRDs must stay at `v1.4.1`.** That is what Cilium 1.19 requires; the
  older v1.2 set is wrong. They also have to exist *before* the Cilium chart installs, which
  is why the Talos config is applied before Flux reconciles.
- **Do not enable Cilium's `bpf.masquerade`** while `hostDNS.forwardKubeDNSToHost` is `true`
  here. That combination breaks CoreDNS.
- **Never add a Talos `UserVolumeConfig` for Longhorn** while the `/var/lib/longhorn` kubelet
  bind mount exists — the two mask each other (siderolabs/talos#13069).
- **`/var/lib/longhorn` lives on the EPHEMERAL partition.** There is no separate disk for it
  in this file, so `talosctl reset --system-labels-to-wipe=EPHEMERAL` destroys that node's
  Longhorn replicas. One node is survivable; all three at once is not.
- **Apply the machine config before Flux installs Cilium.** Doing it the other way round
  deadlocked the live cluster on 2026-06-12.
- **Keep the Talos API off the VIP.** Point `talosconfig` endpoints at `192.168.1.101–103`,
  never at `.100`, or the recovery tool depends on the thing being recovered.
- **`talosImageURL` carries no tag on purpose.** talhelper appends `:${talosVersion}`. Bumping
  `talosVersion` therefore changes the installer image on all three nodes at once, and the
  schematic must still carry the Longhorn extensions.

## Verifying

```bash
cd bootstraping
SOPS_AGE_KEY_FILE=../clusters/staging/age.agekey talhelper genconfig
for n in 1 2 3; do
  talosctl validate --config clusterconfig/Homelab_staging-staging-controlplane-$n.yaml --mode metal
done
```

Against the live cluster:

```bash
talosctl -n 192.168.1.101 etcd members     # 3 members, no learners
talosctl -n 192.168.1.101,192.168.1.102,192.168.1.103 version
kubectl get nodes                          # 3 Ready
kubectl top nodes                          # proves the metrics-server extraManifest landed
```

## Related documentation

- [../documentations/00-bootstrap-cluster.md](../documentations/00-bootstrap-cluster.md) — the full bootstrap runbook
- [../documentations/06-k3s-retirement.md](../documentations/06-k3s-retirement.md) — the move off k3s
- [../documentations/07-talos-ha-expansion.md](../documentations/07-talos-ha-expansion.md) — one VM to three bare-metal control planes
- [../documentations/08-cilium-cni-ingress-migration.md](../documentations/08-cilium-cni-ingress-migration.md) — the CNI swap and the 2026-06-12 incident
- [../documentations/09-etcd-backup-dr.md](../documentations/09-etcd-backup-dr.md) — etcd snapshots and disaster recovery
- [../documentations/14-design-decisions.md](../documentations/14-design-decisions.md) — section 1, "Platform"
