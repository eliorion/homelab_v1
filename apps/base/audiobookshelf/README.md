# audiobookshelf

Audiobookshelf is a self-hosted audiobook and podcast server. The base runs it
as a single replica in the `audiobookshelf` namespace, image
`advplyr/audiobookshelf:2.31.0`, with three separate `ReadWriteOnce` PVCs —
configuration, scraped metadata and the media library itself. The base renders
seven objects, but **no overlay currently deploys it** —
`apps/staging/audiobookshelf/` and `apps/production/audiobookshelf/` both carry
`resources: []`. It is scaffolding carried over from the k3s cluster and never
migrated; see
[`documentations/06-k3s-retirement.md`](../../../documentations/06-k3s-retirement.md).

## How it is wired

The Flux `apps` Kustomization (`clusters/staging/apps.yaml`, `path:
./apps/staging`, `prune: true`, `dependsOn: db-migrations`, SOPS decryption)
builds `apps/staging/kustomization.yaml`, which lists `audiobookshelf/`
explicitly. That overlay renders nothing today, so Flux applies no
audiobookshelf object. The production cluster is wired the same way through
`clusters/production/apps.yaml` (`path: ./apps/production`).

Base (`apps/base/audiobookshelf/kustomization.yaml` → `namespace.yaml`,
`deployment.yaml`, `storage.yaml`, `service.yaml`, `configmap.yaml`):

- `namespace.yaml` — `Namespace` `audiobookshelf`. Unlike `glpi` and
  `linkding`, none of the other base objects hardcode a namespace: they get it
  from the overlay's `namespace: audiobookshelf`.
- `deployment.yaml` — `Deployment` `audiobookshelf`, `replicas: 1`, image
  `advplyr/audiobookshelf:2.31.0`, `containerPort: 80`,
  `restartPolicy: Always`. Pod `securityContext` sets `fsGroup` / `runAsUser`
  / `runAsGroup` to `1000`, the `node` user inside the image; the container
  sets `allowPrivilegeEscalation: false`. `envFrom` pulls the whole
  `audiobookshelf-configmap` ConfigMap. Three volumes mount the three PVCs at
  `/config`, `/metadata` and `/books`.
- `service.yaml` — `ClusterIP` Service `audiobookshelf`, `port: 3005` →
  `targetPort: 80`, selector `app: audiobookshelf`.
- `storage.yaml` — three PVCs in one file, all `ReadWriteOnce` with no
  `storageClassName` (so the cluster default, Longhorn):
  `audiobookshelf-config-pvc` `100Mi`, `audiobookshelf-metadata-pvc` `1Gi`,
  `audiobookshelf-books-pvc` `1Gi`.
- `configmap.yaml` — ConfigMap `audiobookshelf-configmap` with a single key,
  `TZ: America/Toronto`. Nothing else is configured through it — no port, no
  credentials.

## Why it is like this

**Nothing is deployed.** Both overlays hold `resources: []` with the base
reference commented out. Doc 06 records the state after the k3s → Talos
migration: the `audiobookshelf`/`glpi`/`linkding`/`keycloak` overlays "render
no workloads yet (scaffolding) — same as on k3s, nothing migrated". The base
is kept intact so that enabling it is an uncomment, not a rewrite.

**Three PVCs instead of one.** Configuration, generated metadata and the media
library have different sizes and different rebuild costs: `/config` is small
(`100Mi`) and precious, `/metadata` is regenerable from scans, `/books` is the
bulk data. Splitting them lets each be resized or restored on its own.

**Why uid/gid 1000.** The audiobookshelf image runs as the `node` user;
`fsGroup: 1000` makes the Longhorn volumes writable for it and `runAsUser` /
`runAsGroup: 1000` keep the process off root. This mirrors what `linkding`
does with `www-data` (uid `33`).

**No namespace in the base objects.** Only `namespace.yaml` names the
namespace; the rest rely on the overlay setting `namespace: audiobookshelf`.
Building `apps/base/audiobookshelf/` on its own therefore produces objects with
no namespace — always build through an overlay.

## Traps

- **The `1Gi` books PVC is placeholder-sized.** An audiobook library will not
  fit. Longhorn supports expansion, but the volume has to be detached, so plan
  the size before the first real import.
- **Volume names and PVC names are two separate lists.** The `volumes` entries
  in `deployment.yaml` (`audiobookshelf-config`, `audiobookshelf-metadata`,
  `audiobookshelf-books`) carry `claimName`s that must exactly match the three
  PVC `metadata.name`s in `storage.yaml` (`…-config-pvc`, `…-metadata-pvc`,
  `…-books-pvc`). The two sets differ by the `-pvc` suffix, which makes a
  copy-paste mismatch easy and silent until the pod stays `Pending`.
- **`port: 3005` and `targetPort: 80` are not the same number.** The container
  listens on `80`; `3005` is only the Service-side port. Reach it in-cluster as
  `audiobookshelf.audiobookshelf.svc:3005`.
- **`containerPort: 80` under `runAsUser: 1000`.** Port 80 is privileged and
  the pod drops privilege escalation. Nothing in this repository overrides the
  application's listening port, so this combination has never actually been
  exercised — verify it before assuming it starts.
- **Default `RollingUpdate` on `ReadWriteOnce` PVCs.** With one replica and no
  `strategy.type: Recreate`, an update starts the new pod before the old one
  releases the three volumes. Delete the pod to roll it.
- **`TZ: America/Toronto`** is the only content of the ConfigMap and does not
  match the cluster's usual `Europe/Paris`. It is what the timestamps in the
  UI will use.
- **No backup path.** None of the three PVCs is covered by CNPG (Postgres
  only) or by a Longhorn backup target.

## Operating it

Render checks (the overlay is expected to be empty until it is re-enabled):

```bash
kubectl kustomize apps/staging/audiobookshelf   # currently renders nothing
kubectl kustomize apps/base/audiobookshelf      # 7 objects, no namespace set
flux get kustomizations apps
```

To deploy audiobookshelf on staging, put the base back into
`apps/staging/audiobookshelf/kustomization.yaml` under `resources:`, replacing
the empty list:

```yaml
resources:
  - ../../base/audiobookshelf/
```

`apps/production/audiobookshelf/kustomization.yaml` takes the same entry.

### Overlays

- `apps/staging/audiobookshelf/kustomization.yaml` — `namespace:
  audiobookshelf`, `resources: []`. No secret, no ingress, no patch: the
  overlay's only job is the namespace.
- `apps/production/audiobookshelf/kustomization.yaml` — byte-for-byte
  identical to the staging one. There is no staging/production divergence in
  this component.
