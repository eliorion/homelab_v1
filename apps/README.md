# apps

The application tier: the workloads this cluster exists to run, as opposed to the operators and
platform services under `infrastructure/`. It follows the same `base/` plus overlay pattern as
every other tier — `base/` holds what does not change between environments, `staging/` holds the
differences plus everything encrypted — but only `staging/` is reconciled today. Several
components have no `base/` at all, because they are little more than a `HelmRelease` wrapping a
chart that lives in another repository.

## How it is wired

Two Flux Kustomizations in
[`../clusters/staging/apps.yaml`](../clusters/staging/apps.yaml) drive this tier, in order:

| Kustomization | Path | Notes |
|---|---|---|
| `databases` | `./apps/staging/databases` | `dependsOn` `infra-cnpg-plugin` and `infra-reflector`, `wait: true` — Ready only when the CNPG Cluster is Ready |
| `apps` | `./apps/staging` | `dependsOn` `databases`, `prune: true`, SOPS decryption |

A third Kustomization, `lab`
([`../clusters/staging/lab.yaml`](../clusters/staging/lab.yaml)), reconciles `./apps/staging/lab`
and depends on `databases` and `infra-reflector`.

`apps/staging/kustomization.yaml` is the only tier-level kustomization in this directory tree. It
lists its components explicitly:

```
asp/  audiobookshelf/  azuracast/  fbref/  glpi/  linkding/  monica/  n8n/  nextcloud/  scraper/
```

`databases/` and `lab/` are deliberately absent from that list: each is applied by its own Flux
Kustomization, and listing them here would make the `apps` Kustomization fight those.

Four of the components are thin wrappers around Helm charts kept in the private `asp`
repository: `asp`, `fbref`, `scraper` and `lab`. Each has its own GitRepository object in
[`../clusters/staging/sources.yaml`](../clusters/staging/sources.yaml), all four sharing the
read-only `asp-deploy-key` Secret, and each is narrowed by an `ignore` allowlist down to a single
chart path — because those HelmReleases use `reconcileStrategy: Revision`, so any new artifact
revision triggers an upgrade and the artifact must only change on chart and tag commits, never on
application-code churn.

Component documentation lives with the component, in `apps/base/<app>/README.md` where that
component has a base overlay and in its own directory otherwise:

| Component | README |
|---|---|
| asp | [`staging/asp/README.md`](staging/asp/README.md) — staging-only |
| fbref | [`staging/fbref/README.md`](staging/fbref/README.md) — staging-only |
| scraper | [`staging/scraper/README.md`](staging/scraper/README.md) — staging-only |
| lab | [`staging/lab/README.md`](staging/lab/README.md) — staging-only, own Flux Kustomization |
| databases | one README per cluster under `base/databases/<project>/` |
| azuracast | [`base/azuracast/README.md`](base/azuracast/README.md) |
| monica | [`base/monica/README.md`](base/monica/README.md) — official chart, tailnet-only, CalDAV/CardDAV |
| n8n | [`base/n8n/README.md`](base/n8n/README.md) |
| audiobookshelf, glpi, linkding | see each component's own directory |

## Why it is like this

**The resource list in `apps/staging/kustomization.yaml` is explicit rather than a directory
scan.** The `apps` Kustomization would otherwise pick up `databases/` and `lab/`, which are owned
by their own Flux Kustomizations with their own ordering and `wait` semantics. Two Kustomizations
applying the same objects is drift by construction.

**The chain is `databases` → `apps`.** `wait: true` on `databases` means no app reconciles
against a CNPG cluster that is not Ready. Schema migrations are not a Flux tier: the asp, fbref
and scraper charts each run Flyway as a Helm `pre-install,pre-upgrade` hook, so the migration runs while the
old pods are still serving and a failed migration fails that release's upgrade instead of
shipping code against an unmigrated database.

**Some components have no `base/`.** A component that exists in exactly one environment and is
little more than a single `HelmRelease` gains nothing from a base plus a one-line overlay.
`asp`, `fbref`, `scraper` and `lab` are all in that position — `lab` adds a `Namespace` object,
the other three are the release alone — so their whole definition is the staging directory.
Because encrypted files never live in `base/`, anything that carries a SOPS secret ends up in an
overlay regardless.

**There is no `production/` overlay.** The unused production tree (never reconciled, no
tier-level `kustomization.yaml`) was deleted on 2026-09-15. See the open-work section of
[`../documentations/14-design-decisions.md`](../documentations/14-design-decisions.md).

## Traps

- **Do not add `databases/` or `lab/` to `apps/staging/kustomization.yaml`.** They belong to their
  own Flux Kustomizations; the explicit resource list is what keeps them out.
- **A new component under `apps/staging/` is invisible until it is listed** in that same file.
- **`apps/base/` has no tier-level `kustomization.yaml`.** Only
  `apps/staging/` does. Do not assume a base aggregate exists.
- **Encrypted files never live in `base/`**, so a base kustomization always renders without an age
  key.
- **The four external charts are pinned by GitRepository `ignore` allowlists.** Widening one makes
  every unrelated commit in the `asp` repository re-reconcile that release, because the
  HelmReleases upgrade on artifact revision.

## Operating it

```sh
kubectl kustomize apps/staging               # render check before commit
flux get kustomizations | grep -E 'databases|apps|lab'
flux get helmreleases -A
```
