# dev — the dev tier

The `dev` tier holds what the cluster runs for development rather than for staging traffic.
Today that is one thing: [`dev-platform/`](dev-platform/README.md), the long-lived vcluster
every asp e2e run deploys onto, reconciled by the Flux Kustomization `dev-platform` in
`clusters/staging/dev.yaml`.

The per-PR preview tier that used to live here (a vcluster per pull request in
`preview-pr-<n>` namespaces, Kyverno-generated guardrails, a driver ServiceAccount and a host
reaper) was replaced by the dev platform and deleted. The decision record is in
[`documentations/14-design-decisions.md`](../../../documentations/14-design-decisions.md#one-long-lived-dev-platform-vcluster-not-a-vcluster-per-pr).
