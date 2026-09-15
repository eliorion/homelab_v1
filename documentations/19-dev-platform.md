# 19 — The dev platform

The asp monorepo ships three stacks — asp, fbref and the scraper platform — as three Helm
charts released independently. Their end-to-end tests used to run in a k3d cluster built inside
Docker-in-Docker on an XL runner, which needed `insecureRootCapabilities` on the Dagger engine
and proved something narrower than what matters: every image built from the PR, on flannel,
local-path storage and plain Postgres, freshly installed.

Staging runs something else. It runs one stack's new version beside the others' current ones,
upgrades it over existing data, enforces its NetworkPolicies with Cilium, stores its data in
CloudNativePG on LINSTOR, and scales its workers with KEDA. The dev platform exists to test
against that.

## Shape

```
host namespace dev-platform   (Flux: infrastructure/services/dev/dev-platform)
├─ vcluster pod               Kubernetes 1.36 control plane, SQLite on ssd-single
├─ Cilium deny boundary       no world, no host API, no other namespace — in or out
├─ Kyverno                    no host access, ssd-single only, run pods at priority dev,
│                             host pull secrets injected
└─ synced pods                everything below, as plain pods

inside the vcluster
  keda, cnpg-system           same charts, same versions, same bases as staging
  e2e-system                  staging's CNPG Cluster specs (from Git), the reaper
  e2e-<pr>-asp / -fbref / -scraper   one set per running PR, created and deleted by the pipeline
```

One platform, not one vcluster per PR: operators stay warm, nothing on the host is created or
deleted per run, and CI never holds a host credential that can create namespaces. The platform
itself is ordinary GitOps; only the run namespaces come and go.

## A run

1. The PR's CI job, on the e2e runner scale set (two runners, so at most two runs), reads
   `vc-e2e-runner` and hands the kubeconfig to Dagger.
2. Preflight: KEDA and CNPG are Available, the vcluster's Kubernetes minor matches staging's,
   main's image tags exist. A failure here is reported as the platform's, not the PR's.
3. Leftover `e2e-<pr>-*` namespaces are deleted; new ones are created, and the runner binds
   itself `admin` inside them.
4. Databases: one CNPG Cluster per stack, built from `e2e-db-templates` — staging's spec minus
   backups, 2Gi `ssd-single`.
5. **Baseline**: main's charts and main's released tags, as staging runs them. Helm tests, then
   seed data.
6. **Upgrade** the stacks the PR changed: PR-built images by digest from Harbor `e2e`, main's
   tags for everything else. A scraper change deploys and checks all three stacks, because asp
   and fbref are its clients.
7. Checks on every deployed stack, and verification that the seeded data survived.
8. On failure, diagnostics (events, logs, Helm history, CNPG status) become a CI artifact. The
   namespaces are deleted either way; the reaper deletes any a cancelled run left behind.

## What it proves, and what it does not

It proves that a chart, its images and its migrations deploy and upgrade on the platform as it
runs; that the new version of one stack works against the released version of the others; that
chart NetworkPolicies allow what the stacks need; that KEDA scaling and CNPG roles behave.

It does not prove scraping against real sites (the platform has no internet egress, and the
harness seeds results), behaviour on staging-sized data, or Flux's own rollback of a
HelmRelease.

## Decisions and evidence

- The platform was proven on a throwaway vcluster before any of it was committed; the checks and
  results are in the directory README, as are the network rules, the identity model and its one
  compromise — a long-lived, narrowly scoped runner token, because the host API refuses the
  anonymous discovery a JWT authenticator would need.
- [`14-design-decisions.md`](14-design-decisions.md) §1 and §8 record why one platform and why
  the pipeline, not Flux, owns runs.

**Reference.** [`infrastructure/services/dev/dev-platform/README.md`](../infrastructure/services/dev/dev-platform/README.md)
