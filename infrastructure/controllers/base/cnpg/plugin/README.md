# Barman Cloud Plugin (CNPG-I)

Standalone Flux unit. Installed via its **own** Flux Kustomization
(`infra-cnpg-plugin`, defined in `clusters/<env>/infrastructure.yaml`), separate
from the CNPG operator. This is deliberate: the plugin installs the
`ObjectStore` **CRD**, and the `ObjectStore` **CRs** (keycloak/asp backups) live
in the `infrastructure-controllers` and `apps` Kustomizations. Those consumers
`dependsOn: infra-cnpg-plugin`, so the CRD always exists before any CR is
applied — avoiding the Flux atomic-apply deadlock ("no matches for kind
ObjectStore").

- Chart `plugin-barman-cloud` pinned to `0.6.0` (appVersion v0.12.0), pulled from
  the OCI registry `oci://ghcr.io/cloudnative-pg/charts` via its own
  `cnpg-plugin` HelmRepository, so it shares nothing with the operator's `cnpg`
  HelmRepository. Renovate keeps the pinned version current.
- Requires cert-manager → `infra-cnpg-plugin` `dependsOn: infra-certmanager`.
- Deployed into `cnpg-system`.

Files here: `kustomization.yaml` (aggregates the two below), `repository.yaml`
(`HelmRepository/cnpg-plugin`, `type: oci`, 24h interval) and `release.yaml`
(`HelmRelease/plugin-barman-cloud` in `flux-system`, `targetNamespace:
cnpg-system`). There is no staging or production overlay — both clusters apply
this base path directly.

The operator that consumes this plugin, and the backup traps that come with it,
are described in [../README.md](../README.md).
