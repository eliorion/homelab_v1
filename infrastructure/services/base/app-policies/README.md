# app-policies

Admission policies that tie what runs in the app namespaces (`asp`, `fbref`, `scraper`,
`advisor`, `lab`) to what asp's release pipeline built. Kyverno CEL types only, the rule set in
[`../../../controllers/base/kyverno/README.md`](../../../controllers/base/kyverno/README.md).
**All four are `Audit`**: they write PolicyReports and block nothing yet.

## How it is wired

| File | What it does |
|---|---|
| `image-signatures.yaml` | `ImageValidatingPolicy/eliorion-images-signed`: every `ghcr.io/eliorion/*` image in a pod (containers and init containers) carries a cosign keyless **signature** and a **CycloneDX SBOM attestation**, both made by asp's `.github/workflows/build-push.yaml` at a release tag (issuer `https://token.actions.githubusercontent.com`, Rekor checked). |
| `image-provenance.yaml` | `ImageValidatingPolicy/eliorion-images-provenance`: the same images carry a **SLSA v1 provenance** attestation from that workflow, whose `buildDefinition.externalParameters.workflow.path` is `.github/workflows/build-push.yaml`. |
| `image-registries.yaml` | `ValidatingPolicy/app-image-registries`: every image comes from `ghcr.io/eliorion/`, Harbor (`registry.eliorion.fr/`), CloudNativePG (`ghcr.io/cloudnative-pg/`), or the three third-party images the charts run (`flaresolverr`, `postgres`, `curlimages/curl` — the helm test pods). |
| `pod-security.yaml` | `ValidatingPolicy/app-pod-security-restricted`: the Pod Security Standard `restricted`, in CEL, for every pod in `asp`, `fbref`, `scraper` and `advisor` **except CloudNativePG's** (`cnpg.io/cluster` label). |
| `kustomization.yaml` | Lists the four. |

Flux applies it as its own Kustomization, `infra-app-policies` (`clusters/staging/infrastructure.yaml`),
which `dependsOn` `infra-kyverno` (the CRDs) and `infra-reflector` (the credential).

Kyverno reads the private GHCR images with `ghcr-pull-secret`, which an ImageValidatingPolicy
can only take from **the kyverno namespace** — reflector mirrors it there
(`../../../controllers/staging/reflector/ghcr-pull-secret-namespaces.yaml`). The admission
controller needs egress to `ghcr.io`, `rekor.sigstore.dev` and Sigstore's TUF CDN; the `kyverno`
namespace has no NetworkPolicy, so it has it.

## Why it is like this

**What it closes.** asp signs every release image and attests its SBOM (and, since the release
workflow started writing it, SLSA provenance), then verifies all three against the workflow's
identity before the chart bump (`asp/.github/scripts/verify-release.sh`). Nothing on this side
checked any of it: a tag pushed to GHCR by any credential with `packages: write` would have
deployed. This is the admission half of that chain, and the identity it checks is the one
`verify-release.sh` proves on every release.

**Two image policies, not one.** Signatures and SBOM attestations exist on every release since
cosign was added; SLSA provenance only on releases cut after `build-push.yaml` started attesting
it. Split, the signature policy can move to `Deny` as soon as its reports are clean, without
waiting for every component to be re-released.

**Audit, `failurePolicy: Ignore`.** The repository rule (`14-design-decisions.md`) keeps `Fail`
to dev-platform-scoped policies: a `Fail` policy turns a Kyverno or Sigstore outage into an
admission outage for everything it matches. `background.enabled: true` reports on pods already
running, so the first reports arrive without a rollout.

**`mutateDigest: false`.** Kyverno's default rewrites every matched image to its digest at
admission. Pinning is right, but not from an audit policy, and not without the charts agreeing:
asp's charts already take an optional `digest`. Revisit it with the move to `Deny`.

**The image list is filtered in CEL** (`startsWith('ghcr.io/eliorion/')`) as well as by
`matchImageReferences`, so a third-party image in the same pod (postgres, curl) is never sent
through a signature check it cannot pass, whatever Kyverno's matching does with it.

**The owner is case-insensitive in the subject.** GitHub's OIDC `job_workflow_ref` carries the
owner as GitHub stores it, and this repository spells it both `Eliorion` and `eliorion`.

**The registry list was taken from the rendered charts**, not written from memory: every
`image:` of `helm template` for the five charts plus the CNPG clusters' `imageName`.

**Pod Security as a policy, not a namespace label.** Talos already applies `warn` and `audit:
restricted` to every unlabelled namespace, so labelling these namespaces so would change nothing;
`enforce: restricted` is what matters, and the repository's rule (`apps/staging/lab/namespace.yaml`)
keeps it off namespaces where a controller mints pods from a template outside git — every one of
these four holds a CNPG cluster, and a database pod refused at 3 a.m. is the failure that rule
exists for. A ValidatingPolicy can do what a namespace label cannot: hold everything else to
`restricted` and leave CNPG's pods out (`matchConditions`). Its checks are the standard's:
host namespaces, hostPath, privileged, `allowPrivilegeEscalation: false`, capabilities `drop: [ALL]`
(add at most `NET_BIND_SERVICE`), non-root, no uid 0, seccomp `RuntimeDefault`/`Localhost`, no
`hostPort`.

Checked with the kyverno CLI v1.19.1: all 48 pod templates of the asp charts (default values,
staging's scraper pools, advisor's role-isolation hooks) pass; a pod with no security context and
a privileged one fail; a CNPG-labelled pod is skipped. The same check against `main`'s charts fails
the 9 fbref helm test pods: asp's charts gave their test hooks a restricted security context in the
same change (asp `k8s/charts/common/templates/_security.tpl`, `common.testPodSecurityContext`),
and **this policy must not go to `Deny` before that chart change is deployed** — a denied test hook
fails `helm test`, and Flux rolls the release back.

## Moving to Deny

```sh
kubectl get policyreports -A -o wide | grep -E 'eliorion-images|app-image-registries'
kubectl get policyreport -n asp -o yaml | yq '.results[] | select(.result != "pass")'
```

When a policy's reports have been clean for a week: `validationActions: ["Deny"]`, then — only
if an admission outage while Sigstore is unreachable is acceptable — `failurePolicy: Fail`.
Signature first, provenance once every deployed tag is a release cut after the provenance step.
`app-pod-security-restricted` once the asp charts with restricted test hooks are deployed in all
four namespaces (`kubectl get pods -A -l 'helm.sh/hook'` is empty between tests, so read the reports).

## Traps

- **A non-release image fails the signature policy by design.** Harbor `e2e` images (the dev
  platform lane) are unsigned, and a hand-pushed tag has no attestation. Neither belongs in
  these namespaces; the dev platform runs in `dev-platform`, which these policies do not match.
- **Renaming `build-push.yaml`, or releasing from another workflow, changes the certificate
  subject.** Update `subjectRegExp` in both image policies in the same change, or every new
  release reports as unsigned.
- **A new third-party image in a chart needs a line in `image-registries.yaml`** before the
  policy moves to `Deny`, or the release that adds it is refused.
- **Credentials only in the kyverno namespace.** `credentials.secrets` names a Secret there;
  removing `kyverno` from the reflector list turns every verification into a GHCR 401.
