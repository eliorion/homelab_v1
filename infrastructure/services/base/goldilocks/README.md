# goldilocks

[Goldilocks](https://github.com/FairwindsOps/goldilocks) creates a
`VerticalPodAutoscaler` (update mode `Off`) for every workload and shows the
recommendations in a dashboard. It is the reading side of the `vpa` recommender; the
review process and the "do not apply" list are in
`infrastructure/controllers/base/vpa/README.md`.

## How it is wired

| File | What it does |
| --- | --- |
| `namespace.yaml` | Namespace `goldilocks`, PodSecurity `restricted`. |
| `release.yaml` | `HelmRelease` `goldilocks`, chart `11.2.0`. Controller plus dashboard, one replica each. Chart sources come from the `fairwinds` HelmRepository defined in the `vpa` tree. |

Applied by `infrastructure-services` through `infrastructure/services/staging/goldilocks`
(depends on `infra-vpa` for the CRD).

## Why it is like this

- **`on-by-default: "true"`**: every namespace is observed without labelling it.
- **`ignore-controller-kind: "Job,CronJob"`**: run pods (Dagster, family-counts, the
  descheduler) are short-lived; a VPA per Job is churn and its numbers mean nothing.
- **`vpa.enabled: false`**: the recommender is installed by `infra-vpa`, not here.
- **Dashboard** is exposed on the tailnet only, as `goldilocks`
  (`tailscale.com/expose`). It has no login; never put it on a public route.
