# Keycloak operator

The vendor's operator for the `Keycloak` CR in
`infrastructure/services/base/keycloak/app/`.

## Why vendored, and not a HelmRelease

Every other controller here is a HelmRelease. This one cannot be: **the Keycloak
project publishes no Helm chart for the operator.** The supported installs are
raw release manifests or OLM, and this cluster does not run OLM.

The alternative to vendoring was a remote kustomize base pointing at
`raw.githubusercontent.com`. That would make every Flux reconcile depend on
GitHub being reachable, and would let a re-tagged release change what the
cluster runs without a commit. The 950 KB of generated CRD YAML under
`upstream/` is the price of neither being true.

## Bumping

```bash
scripts/fetch-keycloak-operator 26.7.0
```

That is the only supported way to change `upstream/`. Hand-editing a vendored
CRD makes the next bump an unreviewable diff.

The **server** version follows the operator: the Keycloak CR deliberately sets
no `spec.image`, so the operator runs the server it shipped with
(`RELATED_IMAGE_KEYCLOAK` in its Deployment). One version knob, no skew.

Current version is recorded as `# keycloakOperatorVersion:` in
`kustomization.yaml`, which the script rewrites.

## Namespace

The operator is **namespace-scoped**: its Role and RoleBinding are namespaced,
so it reconciles Keycloak CRs only in the namespace it runs in. It runs in
`identity`, beside the Keycloak it manages, and **owns that Namespace object** —
`infrastructure/services/base/keycloak` no longer declares it, so two Flux
Kustomizations never fight over the same resource.

Upstream ships the manifests for a namespace called `keycloak`; the
`NamespaceTransformer` in `kustomization.yaml` retargets them, including the
ClusterRoleBinding subject. That last part is load-bearing — without
`setRoleBindingSubjects`, the binding still points at
`system:serviceaccount:keycloak:keycloak-operator`, the operator starts with no
permissions, and it reconciles nothing while looking perfectly healthy.

The cluster-wide variant (`upstream/cluster-wide/` in the release) exists for a
multi-namespace estate. One Keycloak does not need it, and it would trade a
namespaced Role for cluster-wide write access to every Keycloak CR.

## What it does not do

Realm configuration. The operator's `KeycloakRealmImport` CR is create-oriented,
so realm updates are effectively ignored. The realm is applied by
keycloak-config-cli instead — see
`infrastructure/services/base/keycloak/realm/`. Its CRD is still installed
because the operator registers a controller for it and would error without it.
