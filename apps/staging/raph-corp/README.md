# raph-corp

Towing quote-request web app for Raph Corp (Node.js front end + API, PostgreSQL). Same shape as
[`../asp`](../asp/README.md): a single `HelmRelease` pointing at `k8s/charts/raph-corp` in the
asp repository, through GitRepository `raph-corp` in `flux-system`
([`../../../clusters/staging/sources.yaml`](../../../clusters/staging/sources.yaml)).

| File | What it does |
|---|---|
| `kustomization.yaml` | sets `namespace: raph-corp` and lists `release.yaml` |
| `release.yaml` | `HelmRelease` `raph-corp`, environment overrides only |
| `raph-corp-secrets.enc.yaml.exemple` | plaintext template for the optional API-key Secret |

- **Database:** `raph-corp-db`, owned by the databases tier
  ([`../../base/databases/raph-corp`](../../base/databases/raph-corp/README.md)); the chart's
  own `cnpg.enabled` stays `false`.
- **Image pull:** `ghcr-pull-secret` is mirrored into `raph-corp` by reflector.
- **Public exposure:** no Ingress. A Cloudflare tunnel public hostname routes to
  `http://raph-corp.raph-corp.svc.cluster.local:8080`, see
  [`../../../infrastructure/services/staging/cloudflare/README.md`](../../../infrastructure/services/staging/cloudflare/README.md).
  The chart's NetworkPolicy is egress-only, so cloudflared reaches the pod without an
  ingress rule, as for fbref-mcp.

## Traps

- Never set image tags in `release.yaml`; the asp CI bumps them in the chart.
- `reconcileStrategy: Revision` is load-bearing while `Chart.yaml` keeps a static version.
- The route is public and the form has no login: do not publish it with real customer data
  before rate limiting / Cloudflare protections are decided.

```sh
kubectl kustomize apps/staging/raph-corp
flux get helmreleases -n raph-corp
kubectl -n raph-corp get pods,svc
```
