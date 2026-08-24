# k3s cluster for learning

3-node bare-metal **Talos Linux** cluster (`Homelab_staging`:
`staging-controlplane-1/2/3` at `192.168.1.101-103`, API VIP `192.168.1.100`;
Talos `v1.13.4`, k8s `v1.36.1`, all control planes also run workloads) managed
entirely by **Flux GitOps** — never `kubectl apply` resources by hand; change
the YAML, commit, push, let Flux reconcile. (Migrated from a single-node k3s
box — the repo name is historical; see `documentations/06`–`08`.)

## Where the documentation lives

**Read the local `README.md` before editing a directory.** Every component owns
one, and it carries what the manifests no longer say: how the component is
wired, why, and what breaks if you change it. Start at the tier README
(`infrastructure/controllers/`, `infrastructure/services/`, `apps/`,
`monitoring/`, `clusters/`, `scripts/`, `bootstraping/`) and follow it down.

`documentations/` holds the numbered narrative guides — migrations, incidents,
drills — that span more than one component:
`00` bootstrap, `01` architecture, `02` Keycloak, `03` database backups,
`04` CI runners and cache, `05` alerting, `06`/`07` Talos + Longhorn migration
and HA, `08` Cilium CNI and ingress, `09` etcd backup and DR, `10` n8n,
`11`/`13` AzuraCast capacity, `12` Garage object storage,
`14` design decisions, `15` node-1 spare-disk expansion,
`16` USB disk qualification for Ceph,
`17` LINSTOR + SeaweedFS migration.

## Repo layout

- `bootstraping/` — Talos layer: `talconfig.yaml` (talhelper) renders the 3
  node configs to `clusterconfig/`; secrets in `talsecret.sops.yaml`
- `clusters/staging/` — Flux entrypoints pointing at the tiers below
- `infrastructure/controllers/` — operators; `infrastructure/services/` —
  platform workloads; `apps/`, `monitoring/` — application and monitoring tiers
- Each tier uses `base/` + `staging/` (+ `production/`) kustomize overlays.
  No production cluster is deployed; the production tree is scaffolding.

## Documentation convention (applies to every change)

- **Every subcomponent directory owns a `README.md`**, and that file carries the
  explanation: what the component is, how it is wired, why it is wired that way,
  what was rejected, and what breaks if you change it. For a component with
  `base/` + overlays the README lives in `base/<component>/`; an overlay-only
  component keeps it in its own directory, and it covers the overlays too.
- **Manifests carry almost no comments.** A comment survives in a manifest only
  if it is a *trap marker* — a constraint whose violation breaks something
  concrete: a workaround pin, an inverted flag, a value that must match another
  file, a "do not set this", a field the operator silently ignores. One short
  line naming what a non-obvious block does is allowed on top of that. Anything
  longer, and anything explaining *why*, goes to the README.
- **Rationale: context is expensive.** A manifest should be the smallest thing
  that still answers "can I change this line safely". The README answers "why is
  it like this". Prose in YAML is re-read by every agent and every reviewer that
  opens the file, whether or not they needed it.
- When you touch a directory that still carries prose comments, move them to its
  README as part of the change rather than leaving two sources of truth.
- The same rule applies to `scripts/` and any code: file-level and inline
  comments only where a reader would otherwise break something. Two scripts
  print their own header via `sed` (`etcd-restore-drill`, `sops-updatekeys`), so
  there the header *is* the `--help` output — check `scripts/README.md` first.

### Three exceptions, all load-bearing

- **`configMapGenerator` inputs are content, not annotation.** Editing a comment
  in `infrastructure/services/staging/garage-gateway/haproxy.cfg` or in
  `infrastructure/services/base/keycloak/realm/realm-{mcp,master,apps}.yaml`
  changes the generated ConfigMap's hash, which rolls HAProxy and re-runs the
  realm import Job. Leave their comments alone.
- **SOPS files are never edited by hand** for comment cleanup (`*.enc.yaml`,
  `talsecret.sops.yaml`). Their `.example` templates are fair game.
- **Vendored upstream manifests** (anything under an `upstream/` directory) keep
  the vendor's comments verbatim; describe them in the README instead.

## Conventions

- Secrets: SOPS-encrypted (`*.enc.yaml`, age key, see `.sops.yaml`). Never
  commit plaintext secrets. No `.enc.yaml` lives under a `base/` path.
- Chart versions are pinned and Renovate bumps them. Container image tags under
  `apps/` are **not** — `renovate.json` scopes the kubernetes manager to
  `/apps/.+/db-migrations/.+\.yaml$/`, so every other image pin is manual. The
  two ARC charts (`gha-runner-scale-set-controller` and `gha-runner-scale-set`)
  must stay on the same version.
- Node config is **talhelper**-managed: edit `bootstraping/talconfig.yaml`,
  render (`SOPS_AGE_KEY_FILE=clusters/staging/age.agekey talhelper genconfig`),
  `talosctl apply-config`. Never regenerate `talsecret` (new PKI = dead cluster).
- CNI is **Cilium** `1.19.4`, kube-proxy-free, with LB-IPAM (`192.168.1.110-130`)
  + L2 announce and Gateway API — `infrastructure/controllers/base/cilium/README.md`.
- Storage is mid-migration. **Longhorn** still holds every live volume (class
  `longhorn`, the default) —
  `infrastructure/controllers/base/longhorn/README.md`. **Rook/Ceph is gone**,
  removed 2026-08-24. **LINSTOR/DRBD** (Piraeus) is taking the block tier as
  class `ssd` and **SeaweedFS** takes bulk plus S3 as class `hdd`.
  Read `documentations/17-linstor-seaweedfs-migration.md` before touching
  storage: node-2 still has no LINSTOR pool, both fbref volumes sit there at a
  single replica, and the SeaweedFS HelmRelease is deliberately `suspend: true`.
- CI is two ARC scale sets plus a Nexus proxy cache —
  `infrastructure/services/staging/arc-runner-set/README.md`.
- Backups are CNPG → R2 or Garage and etcd → Garage, age-encrypted with an
  **offline** key — `infrastructure/services/base/etcd-backup/README.md`.

## Verify changes

```bash
kubectl kustomize infrastructure/services/staging   # render check before commit
flux get kustomizations
flux get helmreleases -A
```

For Talos node-config changes (`bootstraping/talconfig.yaml`):

```bash
cd bootstraping && SOPS_AGE_KEY_FILE=../clusters/staging/age.agekey talhelper genconfig
talosctl validate --config clusterconfig/Homelab_staging-staging-controlplane-1.yaml --mode metal
```
