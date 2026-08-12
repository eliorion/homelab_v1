# scripts

Four scripts sit directly in `scripts/`. They are the small amount of imperative
glue a GitOps repo still needs: things that are not a Kubernetes object and
cannot be reconciled — vendoring an upstream release, rewrapping secrets onto
new recipients, proving a backup restores, building the dev environment.

| Script | What it is for | Usual entry point |
|---|---|---|
| [`etcd-restore-drill`](etcd-restore-drill) | Prove the newest etcd snapshot really restores (doc 09, Tiers 0 + 1). | `mise run etcd-drill` |
| [`fetch-keycloak-operator`](fetch-keycloak-operator) | Re-vendor the Keycloak operator release manifests. | `scripts/fetch-keycloak-operator <version>` |
| [`setup`](setup) | Devcontainer `postCreateCommand`: build the toolchain. | DevPod runs it |
| [`sops-updatekeys`](sops-updatekeys) | Rewrap every SOPS file onto the recipients in `.sops.yaml`. | `mise run sops-updatekeys` |

All four are shellchecked together by `mise run lint`
([`../mise.toml`](../mise.toml)), which is the check to run after editing any of
them.

The three subdirectories are self-contained rigs and document themselves:
[`azuracast-embed/`](azuracast-embed/README.md),
[`azuracast-load-test/`](azuracast-load-test/README.md),
[`azuracast-relay/`](azuracast-relay/README.md).

---

## `etcd-restore-drill`

etcd holds the whole control plane, so an unverified snapshot is not a backup —
it is a file that is *probably* a backup. This script closes that gap without
touching the cluster's own etcd: it pulls the newest object the `talos-backup`
CronJob wrote to Garage, decrypts it with the **offline** age private key,
restores it into a throwaway etcd on localhost, and reads real control-plane
state back out of it.

That covers Tier 0 (integrity) and Tier 1 (restorability) of
[`../documentations/09-etcd-backup-dr.md`](../documentations/09-etcd-backup-dr.md).
Tier 2 — the destructive `talosctl reset` / `bootstrap --recover-from`
rehearsal — is deliberately **not** scripted and stays a manual, deliberate act.
The component that produces the snapshots is
[`../infrastructure/services/base/etcd-backup/README.md`](../infrastructure/services/base/etcd-backup/README.md).

```bash
mise run etcd-drill -- --offline-key ~/etcd-backup-age.key
mise run etcd-drill            # omit the flag: paste the key when prompted
mise run etcd-drill -- --keep  # leave the workdir behind (plaintext Secrets!)
```

### What it actually does

1. `cd`s to the repo root (`git rev-parse --show-toplevel`), because the two
   default paths below are repo-relative.
2. Preflights the tool list: `aws age zstd etcdutl etcd etcdctl sops kubectl git
   shred`. The `etcd*` trio is **not** from mise — the devcontainer image builds
   them from the v3.7.1 release tarball, because mise/aqua's `etcd` package ships
   no `etcdutl` (see [`../.devcontainer/Dockerfile`](../.devcontainer/Dockerfile)).
3. Creates a `mktemp -d` workdir and `chmod 700`s it.
4. `kubectl -n garage-gw port-forward svc/garage-s3 $GW_PORT:3900`, then waits up
   to 30 s for `Forwarding from` to appear in the forwarder's log. Garage is
   off-cluster on the tailnet; the in-cluster HAProxy gateway
   ([`../infrastructure/services/base/garage-gateway/`](../infrastructure/services/base/garage-gateway/))
   is the only way to reach it from here.
5. Decrypts `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` out of
   `infrastructure/services/staging/etcd-backup/etcd-backup-s3.enc.yaml` with
   `sops --extract`, and exports them plus `AWS_DEFAULT_REGION=garage`. They live
   in this process's environment only — nothing is written to `~/.aws`.
6. Picks the newest object: `aws s3 ls s3://$BUCKET/$S3_PREFIX/ | sort | awk
   'END{print $NF}'`. `aws s3 ls` prints the modification date as the first
   column, so a plain lexical `sort` is chronological.
7. Decrypts with `age`, then `zstd -d` if the object ends `.zst.age`. Objects are
   named `.snap.zst.age` when `ENABLE_COMPRESSION` is on and `.snap.age` when it
   is off (see
   [`../infrastructure/services/staging/etcd-backup/configmap.yaml`](../infrastructure/services/staging/etcd-backup/configmap.yaml));
   any other suffix is a hard error rather than a guess.
8. **Tier 0** — `etcdutl snapshot status -w table`.
9. **Tier 1** — `etcdutl snapshot restore` into the workdir, then starts `etcd
   --force-new-cluster` bound to `127.0.0.1` and waits up to 20 s for
   `endpoint health`.
10. Counts keys under `/registry` and `/registry/namespaces`, and lists the
    `/registry/secrets/etcd-backup` keys as a spot-check that the objects this
    very system created are in there.

The verdict block prints `PASS` with the object name and the two counts. Note
the ordering: the `PASS` line is printed **before** the sanity check on the key
count, so a snapshot with 100 or fewer `/registry` keys prints `PASS` and *then*
dies with `suspiciously few /registry keys`. Read the exit status, not just the
last few lines.

### Knobs

Everything is an environment override with a working default:

| Variable | Default |
|---|---|
| `SECRET_FILE` | `infrastructure/services/staging/etcd-backup/etcd-backup-s3.enc.yaml` |
| `BUCKET` | `homelab-staging-etcd-backup` |
| `S3_PREFIX` | `staging` |
| `GW_PORT` | `3900` (local end of the port-forward) |
| `ETCD_CLIENT_PORT` | `2379` |
| `ETCD_PEER_PORT` | `2380` |
| `SOPS_AGE_KEY_FILE` | `clusters/staging/age.agekey` |

`BUCKET` and `S3_PREFIX` mirror the `etcd-backup-config` ConfigMap; if that
overlay changes, either pass the new values or the drill looks in the wrong
place and reports "no objects".

### Traps

- **The workdir holds every Kubernetes Secret in plaintext.** The snapshot *is*
  the control plane. The `EXIT` trap `shred -u`s every file and `rm -rf`s the
  directory, on clean exit, on error and on Ctrl-C (`trap 'exit 130' INT TERM`
  exists so the interrupt still runs the `EXIT` trap). Removing or narrowing
  that trap leaves cluster Secrets on a laptop disk.
- **`--keep` disables exactly that.** It prints a shouting warning and leaves the
  plaintext behind. It is for inspecting a failure, and the directory is yours to
  destroy afterwards.
- **A pasted key never touches disk, argv or the environment.** `age_decrypt`
  pipes it to `age -d -i -` over stdin. Rewriting that to a temp file or a
  positional argument would defeat the reason the prompt exists — and `read -rsp`
  is what keeps it off the terminal too. A `--offline-key FILE` is read in place
  by `age -d -i "$OFFLINE_KEY"`; it is never copied into the workdir.
- **The offline age private key is not in this repo and not in the cluster.**
  Only the *public* recipient is committed, in the `etcd-backup-config`
  ConfigMap. Lose the private half and every snapshot ever taken is
  unrecoverable — this script cannot help you then.
- **Local TCP 2379/2380 must be free.** The throwaway etcd binds them on
  loopback; a stray container or a previous failed run holding either port makes
  the drill fail at "etcd never became healthy".
- **`usage()` re-reads the script's own header** (`sed -n '2,30{/^#/!q;…}'`), so
  the header must stay one contiguous `#` block starting at line 2 and ending
  before line 30. It stops at the first non-comment line, so a blank line
  inserted into the header silently truncates `--help`.

---

## `fetch-keycloak-operator`

The Keycloak project ships no Helm chart for its operator, so the release
manifests are vendored into git under
`infrastructure/controllers/base/keycloak-operator/upstream/`. This script is
the only supported way to change them.

```bash
scripts/fetch-keycloak-operator 26.7.0
```

It works from anywhere inside the checkout (it resolves the repo root with `git
-C "$(dirname "$0")" rev-parse --show-toplevel` and uses absolute paths; it never
`cd`s). With no argument it prints a usage line and exits 2.

Step by step: it downloads all five files from
`raw.githubusercontent.com/keycloak/keycloak-k8s-resources/<version>/kubernetes`
into a `mktemp -d`, moves them into `upstream/` renaming `.yml` → `.yaml`,
deletes any leftover `upstream/*.yml`, rewrites the
`# keycloakOperatorVersion:` line in `kustomization.yaml` with `sed`, then prints
the resolved `quay.io/keycloak/keycloak-operator` image line for review.

The component's own documentation —
[`../infrastructure/controllers/base/keycloak-operator/README.md`](../infrastructure/controllers/base/keycloak-operator/README.md)
— is the authority on what the vendored manifests mean and on the kustomize
transformers layered over them.

### Traps

- **Do not hand-edit anything under `upstream/`.** A hand-edited vendored CRD
  turns the next bump into an unreviewable diff, which is the whole reason this
  script exists.
- **The `.yml` filenames in the `FILES` array are upstream's, and there is no
  `.yaml` to fetch — that URL 404s.** They are renamed on the way in so every
  manifest in this repo ends `.yaml`; the content is byte-identical to upstream,
  which is what keeps a bump reviewable. `kustomization.yaml` lists files
  explicitly, so the array and that `resources:` list must name the same set or a
  CRD silently stops being applied.
- **Staging in a temp dir is load-bearing.** A 404 on the fifth file must not
  leave the component half-bumped — a new operator running against old CRDs.
  Downloading straight into `upstream/` would do exactly that.
- **The closing `NOW: bump spec.image …` line is stale — ignore it.** This repo
  deliberately leaves `spec.image` unset on the `Keycloak` CR
  ([`../infrastructure/services/base/keycloak/app/keycloak.yaml`](../infrastructure/services/base/keycloak/app/keycloak.yaml)),
  so the operator runs the server it shipped with. Setting it flips the operator
  into `--optimized` mode and decouples the two versions. The CR's own comment
  and the component README govern; that `echo` does not.
- **`# keycloakOperatorVersion:` in `kustomization.yaml` is machine-read** — it
  is both the Renovate anchor and the line this script rewrites with
  `s|^# keycloakOperatorVersion: .*|…|`. Rewording or reformatting it breaks
  both.

---

## `setup`

The devcontainer's `postCreateCommand`
([`../.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json)).
It runs once when DevPod creates the workspace and turns the image built by
[`../.devcontainer/Dockerfile`](../.devcontainer/Dockerfile) into the working
environment described in
[`../documentations/00-bootstrap-cluster.md`](../documentations/00-bootstrap-cluster.md).

Two halves:

1. `mise trust` + `mise install` — installs the whole declared toolchain
   (`kubectl`, `k9s`, `kubens`, `cloudflared`, `flux2`, `sops`, `age`, `helm`,
   `shellcheck`, `talosctl`, `talhelper`, `aws`, `gh`) from
   [`../mise.toml`](../mise.toml). `mise` itself is not installed here: the
   Dockerfile put it at `/usr/local/bin/mise`, which is the absolute path this
   script calls. Everything else the drills need — `zstd`,
   `etcd`/`etcdctl`/`etcdutl` — is baked into the image by the Dockerfile too,
   not installed here.
2. Three installers piped straight from `curl` into a shell, for the agent
   tooling: Claude Code, RTK (followed by `rtk init -g --auto-patch`), Caveman.
   A commented-out Graphify block sits at the bottom, disabled.

### Traps

- **`$DEVPOD_WORKSPACE_ID` is required and never checked.** The mise path is
  built as `/workspaces/$DEVPOD_WORKSPACE_ID/mise.toml`; DevPod sets the
  variable. Unset, that path is wrong, `mise trust` fails, and the `&&` skips
  `mise install` — so the toolchain is simply absent.
- **There is no `set -e`.** Every later step runs regardless of what failed
  before it, and the script's exit status is only the last installer's. A
  "successful" devcontainer build is therefore not evidence that the toolchain
  installed — `mise ls` is.
- **`rtk init -g --auto-patch` writes outside this repo.** `-g` is global: it
  patches the user's Claude Code configuration with a Bash `PreToolUse` hook.
  Caveman likewise installs `SessionStart` / `UserPromptSubmit` hooks and a
  statusline. Those three lines pipe third-party installers straight into a
  shell — nothing pins a version or verifies a checksum.

---

## `sops-updatekeys`

SOPS only rewraps a file when someone edits it. So adding or rotating a
recipient in [`../.sops.yaml`](../.sops.yaml) changes nothing on disk: the
committed secrets keep their old recipients, and the new key cannot read them.
This script closes that gap by rewrapping every encrypted file in the repo onto
whatever `.sops.yaml` says today.

```bash
mise run sops-updatekeys                 # rewrap everything
mise run sops-updatekeys -- --check      # report only, change nothing
scripts/sops-updatekeys -k path/to/x.enc.yaml
scripts/sops-updatekeys -k path/to/x.enc.yaml --check
```

Output vocabulary, one line per file: `ok` (already on the right recipient),
`STALE` (check mode — prints `want:` and every `have:`), `rewrap` (rewritten),
`SKIP` (no matching `creation_rule`, or no `age1…` string in the file), `FAIL`
(no readable private key for any recipient the file currently carries).

### How it decides

- **Recipients come from `.sops.yaml`, never from this script.** A small `awk`
  pass pairs each `path_regex:` with the `age:` line that follows it and keeps
  file order, so first match wins — the same rule SOPS itself applies. Adding a
  third environment therefore needs no change here.
- **The private key is discovered, not configured.** Every candidate
  (`$SOPS_AGE_KEY_FILE`, then `clusters/*/age.agekey`) is run through
  `age-keygen -y` to derive its public half, and that map is looked up by the
  recipient the file needs. `age.agekey` is the *private* key; `age-keygen -y`
  is the only thing that reads it, and only to compute a public string.
- **The file list is `git ls-files`** filtered to `*.enc.yaml` / `*.enc.yml` and
  `talsecret.sops.yaml` / `.yml`. Untracked secrets are invisible to it.
- **Rewrapping shells out to `sops updatekeys -y`** with `SOPS_AGE_KEY_FILE`
  pointed at the key it just selected.

### Traps

- **`sops updatekeys` decrypts before it re-encrypts**, so the key it needs is
  one of the recipients the file carries *today*, not the one it is being moved
  to. The loop tries each current recipient first and only falls back to the
  target's key (for the case where the file already lists both, and one is being
  removed). "Simplify" that to just the target key and every rotation fails.
- **One recipient per rule, one per file, is assumed.** The `awk` parser reads an
  inline `age: age1…` scalar — a YAML *list* of recipients would parse as
  garbage. And the staleness test compares the sorted set of `age1…` strings
  found in the file against that single expected value, so a legitimately
  multi-recipient file is permanently "stale" and gets rewrapped on every run.
- **The `have` check greps the whole file for `age1…`,** not just the `sops:`
  metadata block. An `.enc.yaml` that carries an age *public* key as ordinary
  cleartext data would be misread as having an extra recipient.
- **Only `--check` sets a failing exit code** (`1` when anything is stale). The
  rewrap path exits 0 even when files were skipped or `FAIL`ed, so a CI gate must
  use `--check` and a human must read the summary line after a real run.
- **`-h` prints lines 2–15 of the script** verbatim. The header block is exactly
  that long on purpose; shorten it and `--help` starts printing code, lengthen it
  and the tail is silently cut off.
