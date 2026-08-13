# linkding

linkding is a self-hosted bookmark manager. The base runs it as a single
replica in the `linkding` namespace, image `sissbruecker/linkding:1.45.0`,
listening on port `9090`, with one `ReadWriteOnce` PVC for its SQLite database
at `/etc/linkding/data`. The base renders four objects, but **no overlay
currently deploys it** — `apps/staging/linkding/` and
`apps/production/linkding/` both carry `resources: []`. It is scaffolding
carried over from the k3s cluster and never migrated; see
[`documentations/06-k3s-retirement.md`](../../../documentations/06-k3s-retirement.md).

## How it is wired

The Flux `apps` Kustomization (`clusters/staging/apps.yaml`, `path:
./apps/staging`, `prune: true`, `dependsOn: db-migrations`, SOPS decryption)
builds `apps/staging/kustomization.yaml`, which lists `linkding/` explicitly.
That overlay renders nothing today, so Flux applies no linkding object.
`clusters/production/apps.yaml` points a single `apps` Kustomization at
`./apps/production` (`dependsOn: infra-cnpg-plugin`, no `databases` /
`db-migrations` split), but that cluster does not exist and `apps/production/`
has no `kustomization.yaml` of its own — see
[`clusters/production/README.md`](../../../clusters/production/README.md).

Base (`apps/base/linkding/kustomization.yaml` → `namespace.yaml`,
`deployment.yaml`, `storage.yaml`, `service.yaml`):

- `namespace.yaml` — `Namespace` `linkding`. Every other base object also
  hardcodes `namespace: linkding`.
- `deployment.yaml` — `Deployment` `linkding`, `replicas: 1`, image
  `sissbruecker/linkding:1.45.0`, `containerPort: 9090`. Pod
  `securityContext` sets `fsGroup` / `runAsUser` / `runAsGroup` to `33`, the
  `www-data` user inside the image; the container sets
  `allowPrivilegeEscalation: false`. `envFrom` pulls the Secret
  `linkding-adm-user`. The PVC `linkding-data-pvc` mounts at
  `/etc/linkding/data`. A second volume, also named `linkding-adm-user`, is
  declared from `secretName: linkding-secret` and is not mounted by any
  container.
- `service.yaml` — `ClusterIP` Service `linkding`, `port: 9090`, selector
  `app: linkding`. There is no `targetPort`, so the Service port must stay
  equal to the container port.
- `storage.yaml` — PVC `linkding-data-pvc`, `ReadWriteOnce`, `1Gi`, no
  `storageClassName`, so it lands on the cluster default (Longhorn).

## Why it is like this

**Nothing is deployed.** Both overlays hold `resources: []`;
`apps/production/linkding/kustomization.yaml` still carries the real list in
comments, the staging one no longer does. Doc 06 records the state after the
k3s → Talos migration: the `audiobookshelf`/`glpi`/`linkding`/`keycloak`
overlays "render no workloads yet (scaffolding) — same as on k3s, nothing
migrated". The base is kept intact, so enabling linkding means restoring the
resource list, not rewriting the manifests.

**Why uid/gid 33.** The linkding image runs as `www-data`; `fsGroup: 33` is
what makes the Longhorn volume writable for it, and `runAsUser` /
`runAsGroup: 33` keep the process off root. This is the pattern
`audiobookshelf` repeats with its own uid `1000`.

**The Ingress is stale.** `apps/staging/linkding/ingress.yaml` (and its
production twin) names `ingressClassName: traefik`. Traefik was retired with
k3s; the cluster now does L7 ingress with Cilium's Gateway API. Doc 14 counts
this file among the objects "elsewhere in the repository [that] still name
`ingressClassName: traefik`, a controller this cluster no longer runs". It is
harmless only because the overlay does not render it. See
[`documentations/08-cilium-cni-ingress-migration.md`](../../../documentations/08-cilium-cni-ingress-migration.md)
and
[`documentations/14-design-decisions.md`](../../../documentations/14-design-decisions.md).

## Traps

- **The Secret name is inconsistent.** `envFrom` reads a Secret called
  `linkding-adm-user`, which is exactly what `linkding-secret.enc.yaml`
  decrypts to in both overlays — that reference resolves. The volume of the
  same name is built from `secretName: linkding-secret`, and no file in this
  repository creates a Secret by that name. Nothing mounts that volume today,
  but re-enabling linkding means reconciling the two names — or dropping the
  volume — first.
- **`ingressClassName: traefik` names a controller this cluster does not
  run.** Re-enabling `ingress.yaml` as written produces an Ingress nobody
  reconciles; it has to become a Gateway API `HTTPRoute`, or name whatever
  class is live at the time.
- **`host: linkding.eliorion.fr` does not resolve on the LAN today.** The
  Gateway API migration is unfinished (doc 08/14), so publishing linkding is
  not just a matter of uncommenting the Ingress.
- **The Service has no `targetPort`.** `port: 9090` is forwarded to container
  port `9090` by identity; changing one without the other silently breaks the
  route.
- **Default `RollingUpdate` on a `ReadWriteOnce` PVC.** With one replica and
  no `strategy.type: Recreate`, an update starts the new pod before the old
  one releases the volume. Delete the pod to roll it.
- **No backup path.** The PVC holds linkding's whole database and is covered
  by neither CNPG (Postgres only) nor a Longhorn backup target.

## Operating it

Render checks (both are expected to be empty until the overlay is re-enabled):

```bash
kubectl kustomize apps/staging/linkding   # currently renders nothing
kubectl kustomize apps/base/linkding      # 4 objects
flux get kustomizations apps
```

To deploy linkding on staging, put these three entries back into
`apps/staging/linkding/kustomization.yaml` under `resources:`, replacing the
empty list:

```yaml
resources:
  - ../../base/linkding/
  - linkding-secret.enc.yaml
  - ingress.yaml
```

`apps/production/linkding/kustomization.yaml` takes the same three entries.

### Overlays

- `apps/staging/linkding/` — `namespace: linkding`, `resources: []`. Present
  but unreferenced: `linkding-secret.enc.yaml` (SOPS-encrypted Secret whose
  object name is `linkding-adm-user`, not `linkding-secret`) and
  `ingress.yaml` (`Ingress` `linkding`, `ingressClassName: traefik`, host
  `linkding.eliorion.fr`, path `/` `Prefix` → Service `linkding` port `9090`;
  the Ingress carries no namespace of its own and relies on the overlay's
  `namespace:`).
- `apps/production/linkding/` — the same three files with the same empty
  resource list; `ingress.yaml` and `linkding-secret.enc.yaml` are identical to
  staging's, and the two `kustomization.yaml` files differ only in the comments
  they carry. There is no staging/production divergence in this component: both
  point at the same `linkding.eliorion.fr` host.
