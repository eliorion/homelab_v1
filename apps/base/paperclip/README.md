# paperclip

[Paperclip](https://github.com/paperclipai/paperclip) is the cluster's agent
control plane: one board that orchestrates coding agents (Claude Code, Codex,
OpenCode) as a "company" with an org chart, issues, heartbeats, approvals and
shared skills. It runs as a single replica in the `paperclip` namespace, stores
its state in the CloudNativePG cluster `paperclip-db`, and is published on the
tailnet only, at `https://paperclip.tail45b0ca.ts.net`, behind Paperclip's own
login.

In this first phase agents run **inside the Paperclip pod**: the upstream image
ships the `claude`, `codex`, `opencode` and `gemini` CLIs. Remote execution
targets (DevPod workspaces over SSH, Kubernetes sandboxes), company skills and
model routing are later phases.

Like n8n, **companies, agents, issues and runs live in Postgres, not git**, and
the `paperclip-db` Garage backup is written but still commented out of
[`apps/staging/databases/paperclip/kustomization.yaml`](../../staging/databases/paperclip/kustomization.yaml).

## How it is wired

Base (`apps/base/paperclip/`):

- `storage.yaml` — PVC `paperclip-data-pvc`, `ReadWriteOnce`, `10Gi` on `ssd`.
  Mounted at `/paperclip`, which the image uses as both `PAPERCLIP_HOME` and
  `HOME`: instance config, uploaded assets, agent workspaces (repo checkouts)
  and the agent CLIs' own config directories all land here.
- `deployment.yaml` — `Deployment` `paperclip`, `replicas: 1`, `Recreate`,
  image `ghcr.io/paperclipai/paperclip:2026.916.1` (pinned by hand — Renovate
  does not watch `apps/` images), port `3100` named `http`. `DATABASE_URL`
  comes from the `uri` key of the CNPG-generated `paperclip-db-app` Secret;
  `envFrom` pulls the `paperclip-auth` and `paperclip-claude` Secrets and the
  `paperclip-config` ConfigMap from the staging overlay. All three probes hit `/api/health`. Requests `500m` / `1Gi`, memory
  limit `4Gi` — agent runs are child processes of this pod. Runs as uid/gid
  `1000` (the image's `node` user) with `fsGroup: 1000`, seccomp
  `RuntimeDefault`, all capabilities dropped. `/tmp` is an `emptyDir`.
- `service.yaml` — `ClusterIP` `paperclip`, port `3100`.
- `ingress-tailscale.yaml` — Tailscale `Ingress`, device name `paperclip`,
  MagicDNS certificate.

Staging (`apps/staging/paperclip/`):

- `configmap.yaml` — `PAPERCLIP_PUBLIC_URL`, deployment mode
  `authenticated` / exposure `private`, `PAPERCLIP_BIND=lan`, `TZ`.
- `paperclip-auth.enc.yaml` — `BETTER_AUTH_SECRET` (SOPS).
- `paperclip-claude.enc.yaml` — `CLAUDE_CODE_OAUTH_TOKEN` (SOPS).
- Each has a plaintext `.exemple` template next to it.

## Why it is like this

**Tailscale Ingress, not `tailscale.com/expose`.** `expose` is an L3 forward
that would publish plain http on `:3100`; Paperclip's session cookie belongs on
an HTTPS origin, and the Ingress gets one from MagicDNS with no cert-manager or
DNS record. Same call as n8n and keycloak.

**`authenticated` + `private` pinned in the ConfigMap** even though they are the
image defaults, so an upstream default change cannot silently drop the login.
Tailnet reachability is the outer gate; the Paperclip session is the inner one.

**Single replica on an RWO volume.** Upstream runs one task per instance (ECS
guide) and its plugin installer needs a persistent writable filesystem; nothing
in Paperclip coordinates multiple servers.

**Agents in-pod for now.** It is the only execution mode that works with zero
extra infrastructure. The cost is that every agent shares this pod's CPU,
memory and filesystem; move heavy or untrusted work to remote targets later.

**One Secret per credential.** Each value is replaced wholesale from its
`.exemple` template and encrypted with `sops -e -i`, which needs only the
**public** age recipient in `.sops.yaml` — rotating the Claude token never
requires the staging private key. Only editing an existing value in place
(`sops <file>`) needs to decrypt.

**Subscription token, not an API key.** `CLAUDE_CODE_OAUTH_TOKEN` (from
`claude setup-token`) runs Claude agents on the Claude subscription. All Claude
agents then share that subscription's rate limits — keep heartbeat intervals
conservative.

## Traps

- `PAPERCLIP_PUBLIC_URL` must equal `https://<ingress tls host>.tail45b0ca.ts.net`.
  Its hostname is the only one Paperclip adds to `allowedHostnames`; any other
  hostname gives a login/redirect loop.
- **Never add `ANTHROPIC_API_KEY`** to any Paperclip Secret: it takes precedence
  over `CLAUDE_CODE_OAUTH_TOKEN` and silently bills the API.
- Keep `readOnlyRootFilesystem: false`: the agent CLIs and npm write caches
  outside `/paperclip`.
- The pod must run as uid `1000`. Started non-root, the image entrypoint skips
  its `usermod`/`chown`/`gosu` step, so a different uid cannot write the PVC.
- The first account created on a fresh instance becomes the board admin.
  Create yours immediately after the first deploy.

## Operating it

```bash
curl https://paperclip.tail45b0ca.ts.net/api/health      # {"status":"ok"} from any tailnet device
kubectl -n paperclip logs deploy/paperclip
```

Set or rotate a secret — public key only, then push; restart the pod
(`kubectl -n paperclip rollout restart deploy/paperclip`) since `envFrom` is
read at start:

```bash
cd apps/staging/paperclip
claude setup-token                                   # ≈1 year validity
cp paperclip-claude.enc.yaml.exemple paperclip-claude.enc.yaml
# replace REPLACE_WITH_CLAUDE_SETUP_TOKEN with the token
sops -e -i paperclip-claude.enc.yaml
grep -q 'ENC\[' paperclip-claude.enc.yaml && echo SAFE || echo PLAINTEXT
```

- `paperclip-claude` — ships as a placeholder; the board works without it,
  Claude agent runs do not.
- `paperclip-auth` — same procedure with `openssl rand -hex 32`; rotating it
  logs everyone out, no data loss.
- Future credentials (Codex `OPENAI_API_KEY`, OpenCode provider keys) each get
  their own Secret + `.exemple`, added to the Deployment's `envFrom`.

Upgrade: bump the image tag in `deployment.yaml` to a stable
`paperclipai/paperclip` release (`vYYYY.MDD.N` → tag `YYYY.MDD.N`). Migrations
run on boot; the startup probe allows 5 minutes.

### Overlays

Staging only (`apps/staging/paperclip/`), wired into
`apps/staging/kustomization.yaml`. The database lives in
[`../databases/paperclip/README.md`](../databases/paperclip/README.md).
