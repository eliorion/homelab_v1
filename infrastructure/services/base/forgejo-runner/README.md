# Forgejo runners

Four `forgejo-runner` 13.2.0 daemons (StatefulSet, `capacity: 4`, so 16 jobs at once) with the
**`host` executor**: a job's steps run in the pod's own shell and its real work is a `dagger call`
against the shared engine `tcp://dagger.dagger.svc:1234`. No Docker, no privilege, PodSecurity
`baseline`.

| piece | why |
|---|---|
| image `ghcr.io/actions/actions-runner:2.338.0` | the ARC image, already on every node: bash, git, curl and Node 24 (`/home/runner/externals/node24`), which `actions/checkout` and `ensure-tool.sh` need |
| init container `code.forgejo.org/forgejo/runner:13.2.0` | copies the static `forgejo-runner` binary in. No image of our own to build or release |
| `forgejo-runner-secrets` (reflected from `forgejo`) | pod N connects as `runner-N` with key `runner-N`; the Forgejo bootstrap sidecar registered the same secrets at org scope `eliorion` |
| label `forgejo-host:host` | asp's workflows run `runs-on: ${{ vars.CI_RUNNER }}`; the bootstrap sets that org variable to `forgejo-host`. asp has ONE `.github/workflows/` tree for both forges (no `.forgejo/`) |
| pod label `app.kubernetes.io/part-of: forgejo-runner` | the ONLY admission to the engine's plaintext `:1234` (`../dagger/networkpolicy.yaml`) |

**Security.** Reaching `:1234` is root on cp1, so the control is who can trigger a workflow:
runners are org-scoped (never instance-wide), Forgejo has no local registration, and no PRs exist on
Forgejo (code arrives only by the GitHub mirror push). Keep the CNP selector tight. Mutual TLS on
the engine is the planned replacement for the label fence.

**Engine load.** 16 Forgejo slots plus ARC share one engine sized at 16Gi for about 12 sessions,
which is why ARC's `maxRunners` is 8 (`../../staging/arc-runner-set/release.yaml`). Watch engine
memory on the `dagger-ci` dashboard; traces carry `ci.forge=forgejo`.

**Rollback transport.** `kube-pod://` needs a ServiceAccount token in the pod: the SA is already
bound (`dagger-engine-exec-forgejo`), set `automountServiceAccountToken: true` and point the org
variable `DAGGER_RUNNER_HOST` at `kube-pod://dagger-engine-0?namespace=dagger`.
