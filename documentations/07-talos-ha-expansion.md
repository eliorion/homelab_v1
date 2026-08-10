# Talos HA expansion: 1 VM node → 3 bare-metal nodes

Goal: grow the single-node Talos cluster (`staging-controlplane-1`,
VM 700 on the Proxmox host `192.168.1.200`) to **three bare-metal
control-plane nodes**, then wipe the Proxmox host itself and rebuild it as
the third bare-metal node. Longhorn moves from 1 replica to 3 so any single
node can leave the cluster without data loss.

Topology is forced: to unplug node 1 (the only control plane today), the
remaining nodes must hold etcd quorum, so **all three nodes are control
planes** (`allowSchedulingOnControlPlanes: true` already set — they all run
workloads too). A 3-member etcd survives one node down.

Work top to bottom. Phase 4 (proxy path) MUST be done before Phase 5
(Proxmox wipe) — the Proxmox host runs the only tailscaled subnet router and
the scrapers die with it otherwise.

All commands assume the repo root as working directory and:

```bash
export TALOSCONFIG=bootstraping/talosconfig
export KUBECONFIG=bootstraping/kubeconfig
```

## Addressing

| What | Value |
|---|---|
| VIP (cluster endpoint) | `192.168.1.100` |
| staging-controlplane-1 | `192.168.1.41` while still the VM; reborn bare-metal as `192.168.1.101` (Phase 5) |
| staging-controlplane-2 (new bare metal) | `192.168.1.102` |
| staging-controlplane-3 (new bare metal) | `192.168.1.103` |
| Proxmox host (until Phase 5) | `192.168.1.200` (unchanged) |

Confirm `.100`–`.103` are unused and outside the DHCP pool before starting.
Machine configs use `dhcp: true` — pin `.102`/`.103` (and later `.101`) as
DHCP reservations on the router; the VIP `.100` is never DHCP-assigned to
anything.

Node 1 deliberately keeps `.41` until its rebuild: live-renumbering the only
etcd member is high-risk (etcd persists peer URLs on the old IP, Talos has
no member-update command), and the node is wiped in Phase 5 anyway — it
picks up `.101` for free at rebirth.

### How the VIP works (Talos built-in, no keepalived)

All control planes carry `vip.ip` in their config and run an election
through an etcd lease; the single winner adds `.100` as a second IP on its
NIC and broadcasts a gratuitous ARP. If it dies, the lease expires within
seconds, another node wins, claims the IP, re-ARPs — clients see one
connection retry. Consequences: all CPs must share one L2 segment (true
here); only kube-apiserver `:6443` rides the VIP — the Talos API `:50000`
does not (the VIP depends on etcd, and talosctl must keep working when etcd
is down), so talosconfig endpoints always stay on real node IPs; total
quorum loss = VIP gone, kubectl dead, talosctl alive — by design.

## Phase 0 — prerequisites

- [ ] Two bare-metal machines, amd64, install disk **≥150–200 Gi** each.
      Longhorn replicas live on the EPHEMERAL partition of the install disk;
      currently ~100 Gi provisioned (4×5 Gi + 80 Gi nexus) and every node
      holds a full copy at 3 replicas. Smaller disks → drop to 2 replicas in
      Phase 3 (degraded window during Phase 5, but works).
- [ ] New factory schematic at <https://factory.talos.dev>: keep
      `siderolabs/iscsi-tools` + `siderolabs/util-linux-tools` (Longhorn
      requirements), add `siderolabs/intel-ucode` or `siderolabs/amd-ucode`
      to match the CPUs. Download the **bare-metal ISO** for Talos
      **v1.13.4** — same version as node 1, do not mix. Note the new
      schematic ID; the installer image becomes
      `factory.talos.dev/installer/<new-schematic-id>:v1.13.4`.
- [ ] DHCP reservations for `.102`/`.103`.

## Phase 1 — VIP (while still single node)

The cluster endpoint is hard-coded to `https://192.168.1.41:6443` (node 1's
IP). It must survive node 1 leaving.

- [ ] Edit `bootstraping/controlplane.yaml`:

      ```yaml
      machine:
        certSANs:
          - 192.168.1.100           # was []
        network:
          interfaces:
            - interface: ens18
              dhcp: true
              vip:
                ip: 192.168.1.100   # new block
              routes:               # unchanged
                - network: 100.64.0.0/10
                  gateway: 192.168.1.200
      cluster:
        controlPlane:
          endpoint: https://192.168.1.100:6443   # was https://192.168.1.41:6443
      ```

- [ ] Apply and regenerate the kubeconfig (must now point at the VIP):

      ```bash
      talosctl apply-config -n 192.168.1.41 --file bootstraping/controlplane.yaml
      talosctl -n 192.168.1.41 kubeconfig bootstraping/kubeconfig --force
      grep server: bootstraping/kubeconfig   # expect https://192.168.1.100:6443
      kubectl get nodes                      # through the VIP
      ```

## Phase 2 — join the two new nodes

Per-node configs are **copies of `controlplane.yaml`** (it already carries
the cluster secrets, the Longhorn kubelet bind, and the tailnet route) with
four fields changed: hostname, interface selector, install disk, installer
image.

- [ ] Create the per-node configs:

      ```bash
      cp bootstraping/controlplane.yaml bootstraping/controlplane-2.yaml
      cp bootstraping/controlplane.yaml bootstraping/controlplane-3.yaml
      ```

      In each, edit (shown for node 2):

      ```yaml
      machine:
        network:
          hostname: staging-controlplane-2   # -3 in the other file
          interfaces:
            - deviceSelector:                # replaces `interface: ens18` —
                physical: true               # bare-metal NIC names differ
              dhcp: true
              vip:
                ip: 192.168.1.100
              routes:
                - network: 100.64.0.0/10
                  gateway: 192.168.1.200
        install:
          disk: /dev/nvme0n1                 # set from `talosctl get disks` below
          image: factory.talos.dev/installer/<new-schematic-id>:v1.13.4
      ```

      ```bash
      talosctl validate --config bootstraping/controlplane-2.yaml --mode metal
      talosctl validate --config bootstraping/controlplane-3.yaml --mode metal
      ```

- [ ] Boot node 2 from the Phase 0 ISO (it sits in maintenance mode), check
      hardware, fix `install.disk` if needed:

      ```bash
      talosctl get disks --insecure -n 192.168.1.102
      talosctl get links --insecure -n 192.168.1.102   # sanity: one physical NIC up
      ```

- [ ] Apply — the node installs, reboots, joins:

      ```bash
      talosctl apply-config --insecure -n 192.168.1.102 --file bootstraping/controlplane-2.yaml
      ```

- [ ] ⚠️ **Gate before node 3** — the 1→2 member step is the fragile one
      (quorum becomes 2/2), don't rush it:

      ```bash
      talosctl -n 192.168.1.41 etcd members   # expect 2 members
      talosctl -n 192.168.1.41 health
      kubectl get nodes                       # staging-controlplane-2 Ready
      ```

- [ ] Same for node 3:

      ```bash
      talosctl get disks --insecure -n 192.168.1.103
      talosctl apply-config --insecure -n 192.168.1.103 --file bootstraping/controlplane-3.yaml
      talosctl -n 192.168.1.41 etcd members   # expect 3 members
      talosctl -n 192.168.1.41 health
      ```

- [ ] **No `talosctl bootstrap`** — the cluster is already bootstrapped.
      Running it against a new node is destructive.
- [ ] Add the new nodes to the talosconfig:

      ```bash
      talosctl config endpoints 192.168.1.41 192.168.1.102 192.168.1.103
      ```

- [ ] Longhorn picked the nodes up:

      ```bash
      kubectl -n longhorn-system get pods -o wide | grep longhorn-manager  # 3 pods, 3 nodes
      kubectl -n longhorn-system get nodes.longhorn.io                     # 3 nodes, Ready/Schedulable
      ```

## Phase 3 — Longhorn: 1 replica → 3

- [x] Repo change (Flux) ✅ 2026-06-11: in
      `infrastructure/controllers/base/longhorn/release.yaml` set
      `defaultSettings.defaultReplicaCount: 3` and
      `persistence.defaultClassReplicaCount: 3`. Then:

      ```bash
      kubectl kustomize infrastructure/controllers/staging >/dev/null  # render check
      git add -A && git commit && git push
      flux reconcile kustomization infrastructure-controllers --with-source
      flux get helmreleases -A   # longhorn Ready, new revision
      ```

- [x] Defaults only affect NEW volumes ✅ 2026-06-11. Patch the existing ones:

      ```bash
      kubectl -n longhorn-system get volumes.longhorn.io -o name |
        xargs -I{} kubectl -n longhorn-system patch {} --type merge \
          -p '{"spec":{"numberOfReplicas":3}}'
      ```

- [ ] **Gate** — every volume 3 replicas, robustness `healthy` (rebuild of
      the 80 Gi nexus volume takes a while):

      ```bash
      kubectl -n longhorn-system get volumes.longhorn.io \
        -o custom-columns=NAME:.metadata.name,REPLICAS:.spec.numberOfReplicas,ROBUSTNESS:.status.robustness
      kubectl -n longhorn-system get replicas.longhorn.io \
        -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeID,STATE:.status.currentState
      ```

- [ ] Verify the Longhorn `backupTarget` → R2 is actually configured and a
      backup completes (doc 06 prerequisite that was never ticked):

      ```bash
      kubectl -n longhorn-system get backuptargets.longhorn.io default \
        -o custom-columns=URL:.spec.backupTargetURL,AVAILABLE:.status.available
      ```

      Replicas protect against node loss; backups remain the only protection
      against "all nodes" mistakes.

## Phase 4 — proxy path: tailscale operator replaces the subnet router

Today the scraper proxy lane (doc 06) is: asp pods → Talos static route
`100.64.0.0/10` via `192.168.1.200` (Proxmox host, the only tailscaled,
advertises `192.168.1.0/24`) → tinyproxy on rbp-asp (`100.100.98.5:8888`).
The Proxmox wipe kills the subnet router. Replacement: **tailscale
Kubernetes operator with an egress Service** — traffic to rbp-asp originates
from a tailnet IP inside the cluster, so no subnet router, no static route,
no `accept-routes` needed anywhere.

- [ ] Tailscale admin console prep:
      - ACLs — add tag owners (operator silently fails without them):

        ```jsonc
        "tagOwners": {
          "tag:k8s-operator": [],
          "tag:k8s":          ["tag:k8s-operator"]
        }
        ```

      - Create an OAuth client (Settings → OAuth clients) with **Devices
        Core: write** and **Auth Keys: write** scopes, tag
        `tag:k8s-operator`. Note client id + secret.

- [ ] SOPS-encrypt the OAuth credentials (Secret lands in `flux-system`, the
      HelmRelease's namespace, for `valuesFrom`):

      ```bash
      cat > infrastructure/controllers/staging/tailscale-oauth.enc.yaml <<'EOF'
      apiVersion: v1
      kind: Secret
      metadata:
        name: tailscale-oauth
        namespace: flux-system
      stringData:
        client_id: tskey-client-XXXX
        client_secret: tskey-XXXX
      EOF
      sops --encrypt --in-place infrastructure/controllers/staging/tailscale-oauth.enc.yaml
      ```

- [ ] Operator via Flux — `infrastructure/controllers/base/tailscale/` with
      the usual four files, wired into base + staging kustomizations:
      - `namespace.yaml` — namespace `tailscale` **with the privileged PSA
        labels** (same trio as longhorn-system: the proxy pods create a tun
        device).
      - `repository.yaml` — HelmRepository
        `https://pkgs.tailscale.com/helmcharts`.
      - `release.yaml`:

        ```yaml
        apiVersion: helm.toolkit.fluxcd.io/v2
        kind: HelmRelease
        metadata:
          name: tailscale-operator
          namespace: flux-system
        spec:
          targetNamespace: tailscale
          interval: 30m
          chart:
            spec:
              chart: tailscale-operator
              version: "x.y.z"   # pin latest at merge time; Renovate bumps
              sourceRef:
                kind: HelmRepository
                name: tailscale
                namespace: flux-system
              interval: 12h
          install:
            createNamespace: false   # namespace.yaml carries the PSA labels
          valuesFrom:
            - kind: Secret
              name: tailscale-oauth
              valuesKey: client_id
              targetPath: oauth.clientId
            - kind: Secret
              name: tailscale-oauth
              valuesKey: client_secret
              targetPath: oauth.clientSecret
        ```

      ```bash
      kubectl kustomize infrastructure/controllers/staging >/dev/null
      git add -A && git commit && git push
      flux reconcile kustomization infrastructure-controllers --with-source
      kubectl -n tailscale get pods   # operator Running
      # admin console: an "operator" machine appears, tagged tag:k8s-operator
      ```

- [ ] Egress Service — `apps/staging/asp/proxy-egress.yaml` (kustomization
      namespace puts it in `asp`), added to
      `apps/staging/asp/kustomization.yaml`:

      ```yaml
      apiVersion: v1
      kind: Service
      metadata:
        name: rbp-asp-proxy
        annotations:
          tailscale.com/tailnet-ip: "100.100.98.5"
      spec:
        externalName: placeholder   # operator rewrites this
        type: ExternalName
      ```

- [ ] Point the proxy lane at it — `apps/staging/asp/release.yaml`:

      ```yaml
      proxies:
        - name: tailscale
          url: "http://rbp-asp-proxy.asp.svc.cluster.local:8888"
          sites: [leboncoin]
      ```

- [ ] ⚠️ tinyproxy on rbp-asp only has `Allow 192.168.1.0/24`. Egress
      traffic now arrives from a tailnet address. On rbp-asp:

      ```bash
      echo 'Allow 100.64.0.0/10' | sudo tee -a /etc/tinyproxy/tinyproxy.conf
      sudo systemctl restart tinyproxy \
        || { sudo pkill tinyproxy; sudo systemctl start tinyproxy; }
      systemctl status tinyproxy   # doc 06 gotcha: failed restart leaves the
                                   # old process holding the port (status=71)
      ```

- [ ] **Gate** — the lane works end to end:

      ```bash
      kubectl -n asp run proxy-test --rm -it --image=curlimages/curl --restart=Never -- \
        curl -sx http://rbp-asp-proxy.asp.svc.cluster.local:8888 \
        -o /dev/null -w '%{http_code}\n' https://www.leboncoin.fr
      # any HTTP code = path works; 000/timeout = routing, 403 = tinyproxy Allow
      ```

      Then push the release.yaml change, wait a scrape cycle, confirm
      leboncoin listings still being written (no `Page.goto: Timeout`).

- [ ] Remove the `100.64.0.0/10` route block from all three machine config
      files, then:

      ```bash
      talosctl apply-config -n 192.168.1.41  --file bootstraping/controlplane.yaml
      talosctl apply-config -n 192.168.1.102 --file bootstraping/controlplane-2.yaml
      talosctl apply-config -n 192.168.1.103 --file bootstraping/controlplane-3.yaml
      ```

      rbp-asp's `--accept-routes` becomes unnecessary (harmless to keep).

## Phase 5 — convert the Proxmox box to bare metal

Node 1 dies as `192.168.1.41` (the VM) and is reborn bare-metal as
`192.168.1.101`.

Pre-flight gates — all must pass before touching anything:

```bash
talosctl -n 192.168.1.102 etcd members    # 3 members
talosctl -n 192.168.1.102 health
kubectl -n longhorn-system get volumes.longhorn.io \
  -o custom-columns=NAME:.metadata.name,REPLICAS:.spec.numberOfReplicas,ROBUSTNESS:.status.robustness
                                          # all 3 / healthy
talosctl -n 192.168.1.102 etcd snapshot bootstraping/etcd-pre-phase5.snapshot
kubectl get backups.postgresql.cnpg.io -A   # fresh barman backup (trigger per doc 03)
```

Plus: Phase 4 done — nothing depends on `192.168.1.200` anymore.

- [ ] Prepare the reborn node's config now (the VM's `controlplane.yaml` is
      VM-flavored — `ens18`, `/dev/sda`, old schematic):

      ```bash
      cp bootstraping/controlplane-2.yaml bootstraping/controlplane-1.yaml
      # edit: hostname staging-controlplane-1; install.disk per that machine
      talosctl validate --config bootstraping/controlplane-1.yaml --mode metal
      ```

- [ ] Evacuate node 1:

      ```bash
      kubectl -n longhorn-system patch nodes.longhorn.io staging-controlplane-1 \
        --type merge -p '{"spec":{"allowScheduling":false}}'
      kubectl cordon staging-controlplane-1
      kubectl drain staging-controlplane-1 --ignore-daemonsets \
        --delete-emptydir-data --timeout=10m
      ```

- [ ] Remove it from the cluster (reset leaves etcd cleanly, then wipes):

      ```bash
      talosctl -n 192.168.1.41 reset --graceful
      kubectl delete node staging-controlplane-1
      talosctl -n 192.168.1.102 etcd members   # expect 2
      talosctl config endpoints 192.168.1.102 192.168.1.103   # drop node 1 while gone
      ```

      Cluster now runs on 2 nodes; API stays up via the VIP; volumes show
      degraded 2/3 — expected.

- [ ] Power off the Proxmox host (its tailscaled dies with it — Phase 4
      already replaced that path). Create the `.101` DHCP reservation for
      the bare-metal NIC's MAC (the old `.41` reservation dies with the VM).
- [ ] Install Talos bare-metal on that hardware from the Phase 0 ISO, then:

      ```bash
      talosctl get disks --insecure -n 192.168.1.101   # confirm install.disk
      talosctl apply-config --insecure -n 192.168.1.101 --file bootstraping/controlplane-1.yaml
      talosctl config endpoints 192.168.1.101 192.168.1.102 192.168.1.103
      talosctl -n 192.168.1.101 etcd members           # back to 3
      ```

      Longhorn rebuilds third replicas onto it automatically (desired 3 >
      actual 2). No bootstrap, as always.

- [ ] **Final gate**:

      ```bash
      talosctl -n 192.168.1.101 health
      kubectl get nodes -o wide        # 3 Ready bare-metal nodes
      kubectl -n longhorn-system get volumes.longhorn.io \
        -o custom-columns=NAME:.metadata.name,REPLICAS:.spec.numberOfReplicas,ROBUSTNESS:.status.robustness
      kubectl -n longhorn-system patch nodes.longhorn.io staging-controlplane-1 \
        --type merge -p '{"spec":{"allowScheduling":true}}'   # if not auto-restored
      ```

      Scrapers writing, a CI run on `self-hosted-arc` goes green.

- [ ] The VM-era `controlplane.yaml` is now obsolete — replace it with
      `controlplane-1.yaml` or note in `bootstraping/README.md` which file
      owns which node.

## Cleanup

- [ ] Tailscale admin console: remove the dead Proxmox-host machine and its
      `192.168.1.0/24` route approval.
- [ ] Prune the dead k3s `asp-db` barman path from R2 when confident
      (last doc 06 leftover).
- [ ] Update `bootstraping/README.md` for the multi-node procedure.

## Troubleshooting (hit during Phases 1–3, 2026-06-11)

- **Bare `talosctl upgrade` installs VANILLA Talos.** Without `--image` it
  pulls the default `ghcr.io/siderolabs/installer` and ignores the config's
  `install.image` — extensions silently vanish, Longhorn dies with
  `failed to execute iscsiadm: No such file or directory`. Every upgrade
  must carry `--image factory.talos.dev/installer/<schematic>:<version>`.
  (`install.image` is only read at maintenance-mode install or upgrade —
  `apply-config` never reinstalls the OS.)
- **etcd member stuck as learner forever.** If a node's join flow is
  interrupted (e.g. another node reboots mid-join), Talos never re-attempts
  the promotion — `etcd status` shows `LEARNER true` with matching raft
  indexes, logs show zero promote attempts, and every other join is blocked
  by etcd's one-learner-at-a-time rule (`too many learner members in
  cluster`). Reboot does NOT fix it. Fix: mint a client cert from
  `cluster.etcd.ca` (it's in the machine config) and promote via the etcd
  HTTP gateway:
  ```bash
  # extract CA, mint a 1-day client cert (openssl), then:
  curl --cacert etcd-ca.crt --cert client.crt --key client.key \
    -X POST https://<voting-member>:2379/v3/cluster/member/promote \
    -d '{"ID":"<member-id-decimal>"}'
  ```
- **Longhorn disk UUID mismatch after node reinstall.** Hit on ALL THREE
  nodes (every reinstall/reset triggers it — the Longhorn node CR and its
  recorded diskUUID survive even k8s node deletion). Symptoms: volumes
  `detached/faulted`, node CR condition `DiskFilesystemChanged` ("record
  diskUUID doesn't match the one on the disk"), manager logs "Bringing up 0
  replicas for auto-salvage". A storm boot regenerated
  `/var/lib/longhorn/longhorn-disk.cfg` with a fresh UUID while the node CR
  record + all replica CRs still hold the old one. Data is intact. Fix:
  rewrite the cfg with the ORIGINAL UUID (privileged pod with a hostPath
  mount, namespace already has the PSA labels), wait ~30 s for the disk to
  re-validate; auto-salvage then revives the replicas.
- **Salvaging a CNPG base backup with a broken WAL chain** (done 2026-06-12,
  recovered 29.7k listings + price history): when the begin_wal is gone the
  clean restore is impossible, but the base backup tar still holds the data.
  In a scratch pod (CNPG postgresql image, emptyDir, R2 creds from the
  backup secret): `barman-cloud-restore` the backup → `rm backup_label` →
  `mkdir -p pg_wal/archive_status pg_wal/summaries` (barman leaves pg_wal
  bare) → `pg_resetwal -f -l <segment beyond any page LSN>` (without `-l`,
  pg_dump dies with "xlog flush request … not satisfied") → start postgres
  with `-c ssl=off -c logging_collector=off` (CNPG conf references
  /controller/* mounts that don't exist) + local socket only → `pg_dump`.
  Then on the live cluster: suspend the app HelmRelease (drift detection
  undoes scaling), scale writers to 0, TRUNCATE app tables, `pg_restore
  --data-only` excluding flyway_schema_history, verify counts, resume.
- **Drain order for reset**: `drain → reset --graceful → kubectl delete
  node`. Deleting the node object first breaks graceful reset (its first
  task cordons the now-missing node). Fallback: `reset --graceful=false`
  then `talosctl etcd remove-member <id>` by hand.
- **Renumbering a live etcd member** (node IP change via apply-config)
  leaves the etcd peer URL on the old IP. Avoid; if it happens, the clean
  fix is reset + rejoin (fresh member, correct peer URL).

## Growing a volume, and the storage reserve

Expanding a CNPG volume is a `storage.size` bump in git — CNPG patches the PVC
and Longhorn expands online, no pod restart. Two things stop that silently:

**CNPG will not reconcile PVCs while the cluster is in `Not enough disk space`.**
That is a deadlock: Postgres needs free space to start, and the operator will not
grant it until the instance is healthy. Break it by patching the PVC directly to
the size already in git — CNPG then agrees and rolls the pod:

```bash
kubectl -n <ns> patch pvc <cluster>-<n> \
  -p '{"spec":{"resources":{"requests":{"storage":"20Gi"}}}}'
```

**Longhorn refuses expansions that exceed its schedulable space**, which is
`disk_max - reserved`, capped by `storage-over-provisioning-percentage` (100%
here — Longhorn never schedules more than the disk physically holds, and that
guarantee is deliberate):

```
admission webhook "validator.longhorn.io" denied the request:
cannot schedule 53687091200 more bytes to disk ...
```

Longhorn's stock 30% reserve took 299GB of each 997GB disk and left 26GB
schedulable, blocking a routine fbref-db growth while real usage was ~537GB.
`storageReservedPercentageForDefaultDisk: 15` in the HelmRelease is the fix —
these disks are dedicated Talos data partitions, so nothing else competes for
what the reserve protects.

**That setting only applies to disks Longhorn adds afterwards.** Existing disks
keep the reserve they were created with and must be patched per node:

```bash
kubectl -n longhorn-system get nodes.longhorn.io -o custom-columns=\
NAME:.metadata.name,RESERVED:.spec.disks.*.storageReserved
# then per node, per disk key:
kubectl -n longhorn-system patch nodes.longhorn.io <node> --type=merge \
  -p '{"spec":{"disks":{"<disk-key>":{"storageReserved":149611031347}}}}'
```

Check headroom before promising a size — every replica of a volume needs the
space on its own node:

```bash
kubectl -n longhorn-system get nodes.longhorn.io -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .status.diskStatus.*}max={.storageMaximum} avail={.storageAvailable} sched={.storageScheduled}{end}{"\n"}{end}'
```

## Gotchas carried forward

- Never add a Talos `UserVolumeConfig` while the `/var/lib/longhorn` kubelet
  bind exists (mount masking, siderolabs/talos#13069) — applies to the new
  nodes too.
- Longhorn data still lives on EPHEMERAL: it survives reboots/upgrades but
  dies per-node on `talosctl reset`. With 3 replicas that is the design —
  one node's death is a rebuild, not a loss.
- StatefulSet `volumeClaimTemplates` remain immutable; resizing still means
  delete-and-recreate (doc 04), Longhorn or not.
- The two ARC charts must stay version-locked (repo convention) — unrelated
  to this work, but Renovate PRs land during it; don't merge blindly
  mid-migration.
