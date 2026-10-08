# gvisor

The `gvisor` RuntimeClass. A pod that sets `runtimeClassName: gvisor` runs under
[gVisor](https://gvisor.dev) (`runsc`) instead of `runc`: its system calls are served by
gVisor's user-space kernel (the Sentry), not by the node's Linux kernel. That is the
isolation the agent platform needs for its sandboxes, which run code an LLM wrote and must
not be one kernel bug away from the node (asp repo, `services/agent-platform/`).

This directory holds only the RuntimeClass. The runtime itself is not a Kubernetes object:
it is the `siderolabs/gvisor` Talos system extension, baked into each node's installer image.

## How it is wired

| File | What it does |
|---|---|
| `runtimeclass.yaml` | `RuntimeClass gvisor`, `handler: runsc`, the containerd handler the extension registers. No `scheduling` block: every node carries the extension. No `overhead` yet: the agent platform's Phase 0 measures what a sandbox actually costs under gVisor, and the number goes here then. |
| `kustomization.yaml` | The one resource. |

Flux applies it through its own Kustomization, `infra-gvisor`
(`clusters/staging/infrastructure.yaml`), pointing straight at this base. There is nothing to
wait for: a RuntimeClass has no status.

The node side is in `bootstraping/`:

- the two factory schematics carry `siderolabs/gvisor` (`54a5f422…` for the AMD node,
  `98559b25…` for the two Intel ones);
- the shared machine patch sets `user.max_user_namespaces`;
- the rollout runbook is in [`../../../../bootstraping/README.md`](../../../../bootstraping/README.md)
  ("Adding gVisor").

## Why it is like this

**gVisor rather than Kata.** Kata runs each pod in a micro-VM, which needs nested
virtualisation or bare-metal KVM on every node, plus a guest kernel per pod. That is a lot of
memory on a cluster whose memory requests already sit at 67-85%. gVisor needs neither: it is
one extension, and its per-pod cost is the Sentry process. The price is syscall
compatibility (some software misbehaves) and a slower I/O path. The agent platform's
Phase 0 tests exactly the workloads it will run (Claude Code, OpenCode, Chromium) under it.

**`runsc`, not `runsc-kvm`.** The extension registers two containerd handlers. `runsc` runs
with an empty `runsc_config`, i.e. gVisor's default `systrap` platform, and needs nothing from
the hardware. `runsc-kvm` needs `/dev/kvm`, which is wiring this cluster does not have. Only
`runsc` gets a RuntimeClass.

**The user-namespace sysctl is a deliberate trade.** gVisor creates unprivileged user
namespaces to set up its sandbox. Talos follows KSPP and sets `user.max_user_namespaces` to 0,
because unprivileged user namespaces are a recurring source of kernel privilege-escalation
bugs. The extension's own documentation says to raise it. The trade: any process on the node
can now create a user namespace, not just runsc, so a kernel bug in that area is reachable
from every `runc` pod too. It is accepted because the `RuntimeDefault` seccomp profile, which
the kubelet applies to every pod here (`defaultRuntimeSeccompProfileEnabled`), still refuses
`unshare` and `clone(CLONE_NEWUSER)` to a container without `CAP_SYS_ADMIN`, and PodSecurity
`baseline` refuses that capability. That leaves the exposure to privileged pods, which
already hold the node.

## Traps

- **Removing the sysctl breaks every gVisor pod at sandbox creation**, not at image pull.
  The pod sits in `ContainerCreating` with a runsc error in its events.
- **A node upgraded without the extension silently loses the handler.** A gVisor pod
  scheduled there fails with `no runtime for "runsc" is configured`. Bumping `talosVersion`
  keeps the same schematic IDs, so this only happens if a schematic is replaced by hand.
- **A gVisor pod's memory includes the Sentry.** A limit sized for the workload alone
  OOM-kills sooner than it would under runc.
