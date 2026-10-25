# OpenBao

[OpenBao](https://openbao.org) is the cluster's secrets manager: the Linux
Foundation, MPL-licensed fork of Vault. Application credentials live in it and
reach pods through the [External Secrets Operator](../../../controllers/base/external-secrets/README.md),
which writes them into ordinary Kubernetes Secrets. SOPS is kept for the secrets
OpenBao itself, cluster recovery and alerting depend on (below).

## How it is wired

| File | What it does |
| --- | --- |
| `namespace.yaml` | Namespace `openbao`, PodSecurity `restricted`. |
| `repository.yaml` | `HelmRepository` `openbao`, `https://openbao.github.io/openbao-helm`. |
| `issuer.yaml` | cert-manager `Issuer` `openbao-ca` (namespaced, type CA) signing with the offline CA in Secret `openbao-ca`. |
| `certificate.yaml` | `Certificate` `openbao-tls`: the server certificate for `openbao.openbao.svc`, the pod name and `127.0.0.1`, two years, ECDSA. |
| `ingress-tailscale.yaml` | `Ingress` `openbao-ui` (device `openbao`): the UI at `https://openbao.tail45b0ca.ts.net/ui/`, tailnet only. Backend is `openbao-active` port `https` (the operator proxies a port named `https` as https+insecure, so the private CA is not needed); it follows the leader via `service_registration`. Needs HTTPS Certificates enabled in Tailscale. |
| `release.yaml` | `HelmRelease` `openbao` (chart `0.30.2`, OpenBao `2.7.1`), release name `openbao`: one replica, Raft storage on a 2Gi `ssd` volume, TLS from `openbao-tls`, static auto-unseal from `openbao-unseal`, declarative audit to stdout, and the self-initialization blocks. |
| `ca.crt` | The public half of the offline CA. Its base64 is inlined in `consumer/secretstore.yaml`. |
| `consumer/` | A Kustomize **Component** a consuming namespace includes: ServiceAccount `openbao-eso` and SecretStore `openbao`. |
| `config/` | The configuration Job and its inputs: `configure.sh`, `eso-policy.hcl`, `eso-namespaces.txt`. |

The overlay `infrastructure/services/staging/openbao/` adds three SOPS Secrets:
`openbao-unseal` (the 32-byte seal key), `openbao-admin` (the first admin
password) and `openbao-ca` (the CA certificate and key).

Flux: the base and overlay ride `infrastructure-services`. `config/` is its own
Kustomization, `infra-openbao-config` (`dependsOn: infrastructure-services`,
`force: true`, `wait: true`, 10 minute timeout), because a Job is immutable and
must be deleted and recreated to re-run.

### What self-initialization creates

On the very first start against an empty volume, OpenBao initializes itself from
the `initialize` blocks in `release.yaml`, then revokes the root token it used:

- the `kv` engine, KV version 2;
- the `kubernetes` auth method, validating ServiceAccount tokens against the API
  server (the chart's `system:auth-delegator` binding is what allows it);
- the `userpass` auth method with user `admin`, policy `admin` (everything), whose
  password is read from `INITIAL_ADMIN_PASSWORD`;
- policy `config` and the Kubernetes role `config`, bound to ServiceAccount
  `openbao-config` in `openbao` — what the config Job logs in as. It can manage
  ACL policies and Kubernetes roles and read the auth mount, and nothing else; it
  cannot read `kv`.

The audit device is declared in the configuration instead (`audit "file"
"stdout"`): OpenBao rejects an audit device created by a self-initialization
request.

### What the config Job maintains

`config/configure.sh` runs on every change to `config/` (and daily, when the Job
is garbage-collected and Flux recreates it). It is idempotent:

- policy `eso`, from `eso-policy.hcl`, granting read on
  `kv/data/<namespace>/*` and list on `kv/metadata/<namespace>/*` where
  `<namespace>` is **the namespace of the ServiceAccount that logged in**. The
  policy is templated on the Kubernetes auth alias metadata
  (`service_account_namespace`); the script substitutes the mount accessor.
- Kubernetes role `eso`, bound to ServiceAccount `openbao-eso` in the namespaces
  listed in `eso-namespaces.txt`, 10 minute tokens.

One role and one policy cover every namespace, and a namespace can only ever read
its own folder: `homepage` reads `kv/homepage/*`, never `kv/n8n/*`.

## Why it is like this

**Why a secrets manager at all** (2026-10-07). SOPS keeps secrets out of git in
plaintext, but every credential is still a static value committed forever,
readable by anyone with the age key, rotated by re-encrypting a file, with no
record of who read what. OpenBao adds an audit log of every read, per-namespace
access enforced by the server, and room for short-lived credentials (Postgres
logins for CNPG, certificates) later. It reverses the "an external secrets
operator" rejection in `documentations/14-design-decisions.md`, which now records
both decisions.

**OpenBao over Infisical.** Infisical is friendlier to use, but needs its own
Postgres and Redis and is weaker on short-lived credentials and integrations.
OpenBao speaks the Vault API, so External Secrets, the CSI driver, the agent
injector and every Vault client work unchanged.

**Static auto-unseal, key from SOPS.** OpenBao starts sealed after every
restart. With Shamir keys a human has to unseal it after each node reboot; the
2026-10-06 rolling reboot would have needed three. The static seal reads a 32-byte
key from a file, and that file comes from a SOPS Secret. OpenBao's documentation
accepts this "when an existing source of trust already exists"; here that is the
age key. The consequence: **anyone holding the age key, or able to read Secrets in
`openbao`, can unseal it**. That is the same blast radius SOPS already has.

**One replica.** Self-initialization runs on a single node only and cannot
bootstrap a multi-node Raft cluster. The volume is `ssd` — two DRBD replicas — so
the pod can restart on another node and unseal itself. While it is down, existing
Kubernetes Secrets written by External Secrets stay as they are; only refreshes
and new secrets wait. Adding Raft peers later is a `bao operator raft join` away.

**An offline CA, not a cert-manager self-signed one.** A namespaced `SecretStore`
can only take its CA from its own namespace or inline. A CA generated inside the
cluster would have to be copied into every consuming namespace; one generated
once, offline, has a public certificate that can sit in git and be inlined into
the shared component. Its key is in SOPS so cert-manager can sign the server
certificate with it. Valid until 2036.

**Namespaced SecretStores, not a ClusterSecretStore.** A ClusterSecretStore
authenticates with one identity, so any namespace that can create an
`ExternalSecret` could read every other namespace's secrets. External Secrets
cannot make a ClusterSecretStore log in as the requesting namespace's
ServiceAccount, so each namespace brings its own `SecretStore` and
ServiceAccount (the `consumer/` component), and the server enforces the folder.
The cluster-scoped kinds are switched off in the External Secrets release.

### What stays in SOPS

Rule: SOPS keeps anything **OpenBao itself depends on**, anything **needed to
rebuild the cluster or restore data**, any **key that makes data readable**, and
anything on the **path that alerts when OpenBao is down**. Everything else is an
application credential and belongs in OpenBao.

| Stays in SOPS | Why |
| --- | --- |
| `bootstraping/talsecret.sops.yaml` | Talos PKI |
| `openbao-unseal`, `openbao-ca`, `openbao-admin` | OpenBao cannot hold its own key, CA or break-glass login |
| `cert-manager/cloudflare-api-token`, `tailscale/operator-oauth` | TLS issuance and the tailnet path backups use |
| `linstor-passphrase` | Encryption key for data; lose it and backups are unreadable |
| `etcd-backup-s3`, every CNPG `r2-`/`garage-backup-credentials` | Disaster recovery must not need OpenBao |
| `telegram-bot-token`, `alertmanager-telegram`, `grafana-admin` | The alerting path must work while OpenBao is down |

## Traps

- **Self-initialization runs once.** Editing an `initialize` block, or
  `openbao-admin`, after the first start changes nothing; change the live
  configuration with the `admin` login (or `config/`) instead. Once on `openbao-db`,
  re-running it means emptying its tables, which deletes every secret; `data-openbao-0`
  is only the Raft way back: never delete it to "reset".
- **The admin password in `openbao-admin` is only the first one.** If it is
  changed in OpenBao, update the SOPS file too, or it stops being a break-glass.
- **There are no recovery keys.** Self-initialization does not generate any. The
  break-glass is the `admin` login; the unseal key alone does not grant access.
- **OpenBao does not reload its certificate.** cert-manager renews `openbao-tls`
  90 days before it expires (two-year certificate), but the running server keeps
  the old one until it restarts. Restart the pod within those 90 days.
- **Rotating the seal key** means a new key id: put the new key in
  `current_key`/`current_key_id` and the old one in `previous_key`/`previous_key_id`,
  both files in `openbao-unseal`. Reusing an id with a different key leaves
  OpenBao unable to unseal.
- **Replacing the CA** means replacing `ca.crt`, the `caBundle` in
  `consumer/secretstore.yaml` and `openbao-ca` together; a mismatch breaks every
  SecretStore at once.
- **Backups: moving from Raft to CNPG (2026-10-23).** Raft has no backup. The chosen
  path is OpenBao's PostgreSQL storage on the CNPG cluster `openbao-db`
  (`../databases/openbao/`), backed up like every other database (Barman → Garage
  `cnpg-staging-openbao`: WAL + daily, 7 days); OpenBao's own docs recommend PostgreSQL
  over Raft to operators new to it. Until the switch-over below has run, losing the
  `data-openbao-0` volume still loses everything in it. A backup holds data encrypted
  by OpenBao's barrier, so restoring also needs the unseal key (`openbao-unseal`,
  SOPS). Neither secret values nor secret names are readable in the database: storage
  keys are mount ids and salted hashes (measured 2026-10-23 on a rehearsal migration).
- **Never point OpenBao at an EMPTY `openbao-db`.** It would self-initialize a new,
  empty vault (the `initialize` blocks). The storage switch in `release.yaml` lands only
  AFTER the data is copied. `bao operator migrate` does NOT check that its destination is
  empty: it upserts into whatever is there, so a destination that ever held data must be
  emptied first (step 4).
- **A namespace not in `eso-namespaces.txt` gets `permission denied`** at login,
  which the SecretStore reports as `InvalidProviderConfig`.

## Switching storage from Raft to `openbao-db` (once, by GitOps)

Rehearsed 2026-10-23 on the real 2.7.1 image (Raft vault → `bao operator migrate` → restart on
PostgreSQL with the same static seal: unsealed by itself, every secret readable; `verify-full`
connects with the right CA and refuses a wrong one). Two merges, no `kubectl` write:

**Why it stays in the chart's Raft mode.** The chart only renders the `data` volume (and keeps the
StatefulSet's immutable `volumeClaimTemplates` unchanged) while `ha.raft.enabled` is true, and it
never reads the HCL. So step B swaps only the `storage` block inside `ha.raft.config`: no
StatefulSet recreation, the Raft volume stays mounted, and REVERTING step B brings OpenBao back on
its Raft data, never on an empty vault. The leftover `BAO_RAFT_NODE_ID` env is ignored by PostgreSQL.

- **Step A** (`switchover/` in the staging overlay, `ha.replicas: 0`, the `PG*` env and `openbao-db-ca`
  mount, which nothing reads while the storage is Raft): OpenBao stops; the Job
  `openbao-migrate-to-postgres` copies Raft into `openbao-db`; a one-off `Backup` proves the Garage
  backup works. The Job cannot read a live vault — the Raft files are locked (1 s timeout) or the
  volume is attached elsewhere — so it retries (`backoffLimit: 8`) until OpenBao is gone.
  OpenBao is down from here to step B; ESO keeps every Secret it already wrote.
  Optional, before merging A: an off-cluster copy, `mise bao operator raft snapshot save
  openbao-raft-final.snap` (read-only). The copy itself only reads `data-openbao-0`.
- **Gate:** `kubectl -n openbao logs job/openbao-migrate-to-postgres` ends with
  `Success! All of the keys have been migrated.` and `kubectl -n openbao get backup
  openbao-db-pre-switchover` is `completed`.
- **Step B**: `storage "postgresql" { ha_enabled = "true" }` replaces the Raft block, `replicas: 1`,
  `switchover/` removed (Flux prunes the Job), a post-switch `Backup`. Check `mise bao status`
  (Storage Type `postgresql`, Sealed `false`), a `mise bao kv get`, all ExternalSecrets Ready.
- **Way back**: revert step B. OpenBao returns on Raft as of step A; anything written since is lost,
  and `openbao-db` keeps it — empty it before a retry (migrate does not check).

## Restoring `openbao-db` (disaster recovery)

What a restore needs: git, the SOPS age key (for `garage-backup-credentials` and the unseal key
`openbao-unseal`), and Garage. Never OpenBao itself. Order matters, because an EMPTY `openbao-db`
makes OpenBao self-initialize a new vault:

1. Keep OpenBao stopped: `flux suspend helmrelease openbao -n flux-system`,
   `kubectl -n openbao scale statefulset openbao --replicas=0`.
2. Recreate the cluster FROM the backup instead of `initdb`: in `../databases/openbao/cluster.yaml`,
   `bootstrap.recovery: {source: openbao-db-backup, database: openbao, owner: openbao}` with
   `externalClusters: [{name: openbao-db-backup, plugin: {name: barman-cloud.cloudnative-pg.io,
   parameters: {barmanObjectName: garage-store, serverName: openbao-db}}}]`, and the archiving plugin's
   `serverName` changed (e.g. `openbao-db-v2`) so the new timeline does not overwrite the old one.
3. Once the cluster is healthy, resume OpenBao: it unseals with the static key from SOPS and
   serves the restored data; the `initialize` blocks do not run (the storage is initialized).
4. Afterwards, return `cluster.yaml` to `initdb` (bootstrap is read only at creation).

Not drilled yet: a throwaway restore (`openbao-db-restore-test`) is the next check.

## Operating it

Onboard a namespace:

1. Add it to `config/eso-namespaces.txt`.
2. In its overlay `kustomization.yaml`, add
   `components: [<relative path>/infrastructure/services/base/openbao/consumer]`.
3. Write the values in OpenBao under `kv/<namespace>/<name>` (below).
4. Add an `ExternalSecret` with `secretStoreRef: {kind: SecretStore, name: openbao}`
   and `dataFrom: [{extract: {key: <namespace>/<name>}}]`; delete the SOPS file in
   the same commit. Restart the workload if it reads its Secret only at start.

Log in and write a secret, from a workstation with cluster access:

```bash
kubectl -n openbao port-forward svc/openbao 8200:8200 &
export BAO_ADDR=https://127.0.0.1:8200
export BAO_CACERT=infrastructure/services/base/openbao/ca.crt
SOPS_AGE_KEY_FILE=clusters/staging/age.agekey sops -d \
  --extract '["stringData"]["INITIAL_ADMIN_PASSWORD"]' \
  infrastructure/services/staging/openbao/openbao-admin.enc.yaml   # the admin password
bao login -method=userpass username=admin
bao kv put kv/homepage/homepage-secrets HOMEPAGE_VAR_CF_ACCOUNT_ID=-   # value on stdin
bao kv get kv/homepage/homepage-secrets
```

The UI is at `https://openbao.tail45b0ca.ts.net/ui/` (tailnet), or the port-forward address in a browser. Health and state:

```bash
kubectl -n openbao exec openbao-0 -- bao status
kubectl -n openbao logs openbao-0 | grep '"type":"response"' | tail   # audit log
kubectl -n openbao logs job/openbao-config                           # last config run
kubectl get secretstore,externalsecret -A
```
