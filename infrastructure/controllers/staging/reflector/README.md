# Central GHCR pull secret (kubernetes-reflector)

One SOPS-encrypted `ghcr-pull-secret` lives here, in the `reflector` namespace,
and **kubernetes-reflector mirrors it into every consuming namespace** (asp,
fbref, lab, scraper, and any future project). Replaces the per-namespace copies
that used to live under `apps/staging/databases/{asp,fbref}/`.

## Why reflector runs first

`databases` (and therefore `db-migrations` → `apps`, plus `lab`) now
`dependsOn: infra-reflector` (`clusters/staging/apps.yaml`). With `wait: true` on
infra-reflector, **no application reconciles until the reflector operator is
Ready and this secret is applied** — so the reflected `ghcr-pull-secret` exists
before anything tries to pull a private image. This makes reflector critical-path
for all private pulls (running pods keep their cached image if it ever blips).

## One-time setup (you — needs the staging age key)

This dir ships only `ghcr-pull-secret.enc.yaml.example`. Until you create the real
`ghcr-pull-secret.enc.yaml`, the `infra-reflector` Kustomization fails its build →
stays NotReady → `databases` (and the rest) safely **stall** (nothing pruned, no
outage). Create it:

```bash
cd infrastructure/controllers/staging/reflector
cp ghcr-pull-secret.enc.yaml.example ghcr-pull-secret.enc.yaml
#   put the REAL dockerconfigjson in .dockerconfigjson (same creds the per-project
#   secrets had — see the .example header for the kubectl one-liner)
sops --encrypt --in-place ghcr-pull-secret.enc.yaml   # staging recipient, by path
git add ghcr-pull-secret.enc.yaml && git commit && <merge>
```

On merge: reflector mirrors `ghcr-pull-secret` into asp/fbref/lab/scraper, the
per-project copies are pruned (same name → consumers unaffected), apps roll.

## Add a project

Append its namespace to **both** `reflection-allowed-namespaces` and
`reflection-auto-namespaces` in the secret (then re-encrypt with `sops`). One
secret, one edit — no new file to encrypt or maintain.

## Verify

```bash
flux get kustomizations | grep -E 'infra-reflector|databases'   # reflector Ready BEFORE databases
for ns in asp fbref lab scraper; do kubectl get secret ghcr-pull-secret -n $ns; done  # present in each
kubectl -n reflector logs deploy/reflector | grep ghcr          # mirror events
```
