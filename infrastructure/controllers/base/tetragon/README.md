# tetragon

Cilium Tetragon: eBPF process and kernel-call observability on every node. Deployed for one
job: seeing what PR code does where it runs — the ARC runners (`arc-runners`, `arc-dagger`)
and the privileged Dagger engine (`dagger`). Detection only; no policy here kills or blocks.

## How it is wired

| File | What it does |
|---|---|
| `namespace.yaml` | Namespace `tetragon`, PSA `enforce: privileged` (the agent loads eBPF programs with host PID and network). |
| `release.yaml` | `HelmRelease/tetragon` → chart `tetragon` `1.7.1` from the existing `HelmRepository/cilium`. DaemonSet agent + `export-stdout` sidecar, the operator, CRDs from the chart (`crds.installMethod: helm`). |
| `policies/pod-kernel-module-load.yaml` | `TracingPolicy/pod-kernel-module-load` (cluster-wide): an explicit kernel module load from any process outside the host PID namespace. |

Two Flux Kustomizations (`clusters/staging/infrastructure.yaml`): `infra-tetragon` for the release,
`infra-tetragon-policies` (`dependsOn` it, `wait`) for the TracingPolicies, because a TracingPolicy
cannot be applied before the release has installed its CRD.

Events leave through the `export-stdout` sidecar, so `alloy-node` ships them like any pod log:
`{namespace="tetragon", container="export-stdout"}`. Two Loki alerts read them
(`monitoring/controllers/base/loki/rules/fake/log-alerts.yaml`, group `runtime-security.log-rules`):
`CIAttackToolExecuted` and `PodKernelModuleLoad`, both critical.

## Why it is like this

**Export is an allowlist, not "everything".** Tetragon sees every exec on every node; a CI run
alone execs tens of thousands of processes (every compiler, every test). Shipping that to Loki
would cost more than the cluster's whole log budget and bury the signal. Export is default-deny
once `exportAllowList` exists, and it allows exactly two things:

1. `PROCESS_EXEC` in `arc-runners`, `arc-dagger` and `dagger` whose binary is a network scanner,
   a tunnel, a miner or a namespace/kernel-escape tool (`nc`, `ncat`, `netcat`, `socat`, `nmap`,
   `masscan`, `zmap`, `xmrig`, `nsenter`, `insmod`, `modprobe`). Nothing in asp's pipeline
   runs any of them (checked across the repository), so every exported line is an alert.
2. `PROCESS_KPROBE` from `pod-kernel-module-load`.

`exportDenyList` drops health-check probes and the host and system namespaces (`""`,
`kube-system`, `cilium`, `piraeus-datastore`), which legitimately touch kernel modules.

**Module loads, monitor-only.** The policy is upstream's `examples/tracingpolicy/modules-nohost.yaml`
without its `Override`/`Sigkill` actions: the two hooks that see an *explicit* load
(`security_kernel_read_file` and `security_kernel_load_data` with `READING_MODULE`). The automatic
`security_kernel_module_request` hook is left out — the dind sidecar's dockerd triggers it when it
sets up iptables and bridges, which would page on every runner start. Enforcement (killing the
process) is a later step once a quiet month says no workload needs it.

**Resources carry limits.** Talos' OOM controller never picks a cgroup that has a memory limit
(`documentations/20-cluster-health-2026-10.md`), and node-1 is short of memory: a limitless
DaemonSet would be the first thing killed there, and the storage stack the second.

## Traps

- **The engine's nested containers may not be attributed to `dagger`.** BuildKit runs build steps
  in its own runc containers; whether Tetragon resolves those processes to the engine pod depends
  on the cgroup layout inside the privileged pod. Runner job steps are attributed normally. Verify
  with a deliberate `nc` in a throwaway Dagger function before relying on engine coverage.
- **The allowlist is also the alert definition.** Adding a binary to `binary_regex` makes it alert
  as critical the next time it runs in a CI namespace; check nothing in CI uses it first.
- **`exportAllowList` filters the JSON export only.** `tetra getevents` over gRPC still shows
  everything — the right tool for an investigation.
- **Talos needs nothing extra**: its kernel ships BTF, which Tetragon requires. If the agent
  CrashLoops after a Talos upgrade, check `/sys/kernel/btf/vmlinux` on the node first.

## Operating it

```sh
flux get kustomizations infra-tetragon infra-tetragon-policies
kubectl -n tetragon get pods
kubectl get tracingpolicies
# Live, unfiltered (gRPC), for one CI namespace:
kubectl -n tetragon exec ds/tetragon -c tetragon -- tetra getevents -o compact --namespaces arc-dagger
```
