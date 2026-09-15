# cert-manager

The certificate controller for the cluster, installed from the upstream Jetstack
chart as a Flux `HelmRelease`. It has three consumers: the private CA and server
certificate that protect the `cloudflared` hop to Keycloak in the `identity`
namespace, the TLS certificate the CNPG barman-cloud plugin presents on its gRPC
endpoint to the CNPG operator, and the publicly-trusted Let's Encrypt
certificate Harbor serves on `registry.eliorion.fr`. The ACME `ClusterIssuers`
for the last one live in
[`../../staging/cert-manager-issuers/`](../../staging/cert-manager-issuers/README.md).
This directory contains only the controller install; the `Issuer`,
`ClusterIssuer` and `Certificate` objects live with the workloads that need them.

Deep detail lives in
[`../../../../documentations/03-backups.md`](../../../../documentations/03-backups.md)
(the plugin dependency and the Flux ordering chain),
[`../../../../documentations/02-keycloak.md`](../../../../documentations/02-keycloak.md)
(the private CA and what it protects) and
[`../../../../documentations/14-design-decisions.md`](../../../../documentations/14-design-decisions.md)
("cert-manager issues one private CA and nothing else").

## How it is wired

| File | What it is |
|---|---|
| `kustomization.yaml` | Lists the three resources below, in order: `namespace.yaml`, `repository.yaml`, `release.yaml`. |
| `namespace.yaml` | The `cert-manager` Namespace object. |
| `repository.yaml` | `HelmRepository` `jetstack` in `flux-system`, `https://charts.jetstack.io`, polled every `24h`. |
| `release.yaml` | `HelmRelease` `cert-manager` in `flux-system`, `targetNamespace: cert-manager`, chart `cert-manager` pinned to `v1.21.2`, reconcile `interval: 30m`, chart revision check `interval: 12h`, `install.createNamespace: true`, `values.crds.enabled: true`. |

Flux applies this directory through its own Kustomization, `infra-certmanager`,
declared in `clusters/staging/infrastructure.yaml`:
`path: ./infrastructure/controllers/base/cert-manager`, `interval: 1h`,
`retryInterval: 1m`, `timeout: 5m`, `prune: true`, `wait: true`, and two health
checks — the `cert-manager` and `cert-manager-webhook` Deployments in namespace
`cert-manager`. It is one of the "hard gate" Kustomizations described in
[`../../../../documentations/01-architecture.md`](../../../../documentations/01-architecture.md):
`wait: true` plus health checks mean nothing downstream is applied until the
controller and its admission webhook are genuinely Ready.

Consumers:

- `infra-cnpg-plugin` declares `dependsOn: infra-certmanager`. The barman-cloud
  plugin is a hard dependant: cert-manager mints the TLS certificate the plugin
  uses for its gRPC endpoint to the CNPG operator. Everything that declares an
  `ObjectStore` sits behind that edge, so the whole Postgres backup chain is
  downstream of this component (doc 03).
- `infrastructure/services/base/keycloak/app/certificate.yaml` declares a
  self-signed `Issuer`, a 10-year CA `Certificate` (`keycloak-ca`), a CA
  `Issuer` built from it, and the 90-day server certificate `keycloak-tls`
  consumed by the `Keycloak` CR as `spec.http.tlsSecret`. All namespaced to
  `identity` (doc 02).
- `infrastructure/controllers/staging/cert-manager-issuers/` declares the
  `letsencrypt-staging` and `letsencrypt-prod` ACME `ClusterIssuers` (DNS-01 via
  Cloudflare), and `infrastructure/services/base/harbor/certificate.yaml`
  requests `registry-tls` from the prod one. Both are applied by Kustomizations
  downstream of `infra-certmanager`.

### Overlays

There is no `staging/` overlay for cert-manager, and
`infrastructure/controllers/staging/kustomization.yaml` does not reference it. The
`infra-certmanager` Kustomization points straight at this base directory.

## Why it is like this

**A private CA for Keycloak, not ACME.** The only certificate that matters internally
protects the `cloudflared` hop to Keycloak. A public CA would buy nothing: the
name it protects (`keycloak-service.identity.svc`) is not resolvable from the
internet and no browser ever sees it. The alternative considered and rejected
was ACME with Let's Encrypt; the alternative actually avoided is plaintext HTTP
to Keycloak, which would put credentials on the node network in the clear
because Cilium runs without transparent encryption. The accepted cost is that a
dashboard-managed Cloudflare tunnel cannot be taught to trust a private CA, so
the origin configuration sets "No TLS Verify" — the hop is encrypted but not
authenticated, and that is named rather than papered over (doc 14, doc 02).
ACME came later, and only for names that clients outside the cluster's control
must trust — the Harbor registry.

**A namespaced Issuer for the private CA.** The Keycloak CA is an `Issuer` so it
can sign for `identity` and nothing else. The only `ClusterIssuers` are the two
ACME ones, which can sign only names in the `eliorion.fr` zone they prove over
DNS-01. This directory installs the controller and stops there.

**`crds.enabled: true`.** The chart installs and upgrades cert-manager's CRDs,
so the CRD version always tracks the controller version in the same
`HelmRelease` and a chart bump is a single reviewable change.

**Its own gated Kustomization.** Flux applies a Kustomization atomically, so a
custom resource that shares a Kustomization with its own CRD deadlocks on
`no matches for kind`. Narrow Kustomizations with `wait: true` plus a health
check, and `dependsOn` on everything that needs them, turn that deadlock into an
ordering guarantee — the same pattern used for `infra-cnpg-plugin` (doc 01,
doc 03).

**Stateless by design.** cert-manager holds no state that has to be migrated;
during the k3s to Talos migration it was step 1 and was *copied* to the new
cluster rather than moved (doc 06).

**Pinned version, Renovate-managed.** The chart version is pinned in
`release.yaml` and bumped by Renovate, which reads Flux `HelmRelease` charts
natively — no annotation comment is required in the file.

**Kubernetes support gates the version.** cert-manager `1.21` supports
Kubernetes `1.33`–`1.36`. The cluster sat on `1.16` (supports up to `1.32`) while
running Kubernetes `1.36.1` until 2026-09-15, when it jumped straight to
`v1.21.2`. Upstream recommends one minor at a time; the jump was taken because
none of the breaking changes from `1.17` to `1.21` touch this cluster (below).
Check the supported-releases table before a Kubernetes bump past `1.36`.

## Defaults that changed under this install (1.16 → 1.21)

These change behaviour without any edit to a manifest here:

- **`Certificate.spec.privateKey.rotationPolicy` defaults to `Always`** (1.18,
  GA and non-disableable since 1.20). Every Certificate here already set
  `Always` except `keycloak-ca`, which now rotates its CA key at its next
  renewal (2036).
- **`Certificate.spec.revisionHistoryLimit` defaults to `1`** (1.18). Only the
  latest `CertificateRequest` per Certificate is kept; older ones are garbage
  collected, so issuance history lives in events and logs, not in old CRs.
- **Controller metrics port renamed to `http-metrics`**, and the
  `prometheus.servicemonitor.targetPort`/`path` and `prometheus.podmonitor.path`
  values are gone (1.21) — the chart's values schema rejects them. Nothing
  scrapes cert-manager today.
- **No default `serviceaccounts/token` RBAC for the controller** (1.21). Only an
  issuer using `serviceAccountRef` to the controller's own ServiceAccount would
  need it; none does.
- **Containers run as UID/GID `65532`** (1.20), previously `1000`/`0`.

## Traps

- **`prune: true` plus `crds.enabled: true` means deleting this directory
  deletes the CRDs.** Removing the path from a cluster's Flux configuration
  prunes cert-manager's CRDs, and with them every `Issuer` and `Certificate` in
  the cluster — including the barman-cloud plugin's certificates. This is why
  the migration checklist says to copy cert-manager to the new cluster and
  explicitly *not* to remove it from the old one while workloads there still
  depend on it (doc 06).
- **Anything that declares a `cert-manager.io` resource must be downstream of
  `infra-certmanager`.** Applying a `Certificate` or `Issuer` in a Kustomization
  that does not (transitively) `dependsOn` it fails with `no matches for kind`
  when the CRDs are not registered yet.
- **The chart version string carries a leading `v` (`"v1.21.2"`).** The Jetstack
  chart uses v-prefixed versions; dropping the prefix does not resolve.
- **Never pin a `1.19` below `v1.19.1`.** `v1.19.0` re-issues certificates
  unnecessarily; against `letsencrypt-prod` that burns the 5-per-week duplicate
  limit.
- **Never go below `v1.16.4` while an issuer solves DNS-01 on Cloudflare.**
  Cloudflare removed `zone_id` from its DNS-record API responses
  (cert-manager/cert-manager#7540). Older controllers still issue, but challenge
  cleanup sends `DELETE /zones//dns_records/<id>`, logs `CleanUpError`, and
  leaves the `_acme-challenge` TXT record in the zone. Seen on `v1.16.2` on
  2026-09-15; the leftovers were deleted by hand.
- **The `keycloak-ca` `Issuer` cannot sign outside `identity`.** A new private
  certificate needs its own namespaced `Issuer`. A public name in `eliorion.fr`
  uses the ACME `ClusterIssuers` — staging first, see
  `../../staging/cert-manager-issuers/README.md`.
- **The webhook is health-checked on purpose.** `cert-manager-webhook` validates
  every `cert-manager.io` object, so a Ready controller alone is not enough for
  downstream Kustomizations. Both Deployments stay in the `healthChecks` list.
- **The `HelmRelease` lives in `flux-system` and targets `cert-manager`.** The
  Namespace is declared twice over — by `namespace.yaml` and by
  `install.createNamespace: true`. Both produce the same object, so applying it
  twice is harmless: the namespace exists whether Flux applies `namespace.yaml`
  first or Helm gets there first.

## Operating it

Render check before committing, then watch the reconcile:

```bash
kubectl kustomize infrastructure/controllers/base/cert-manager
flux get kustomizations infra-certmanager
flux get helmreleases -A
kubectl -n cert-manager get deploy
```

When a dependant is stuck, check this gate first — `infra-cnpg-plugin` and
everything behind it stay unapplied until both cert-manager Deployments report
Ready. To inspect what the CA actually issued:

```bash
kubectl get certificates -A
kubectl -n identity describe certificate keycloak-tls
```
