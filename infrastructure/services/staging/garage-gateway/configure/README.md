# garage-config

Git is the source of truth for Garage's buckets and keys. This Job reads `buckets.txt` and, for
each line, makes Garage match it: the bucket exists, the consumer's key is imported, and that key
has read+write on that bucket. It is additive only — it never deletes a bucket, a key or a grant,
so removing a line changes nothing on Garage.

| File | What it holds |
| --- | --- |
| `buckets.txt` | One line per bucket: bucket, consumer namespace, Secret, and the two field names holding the key id and secret. |
| `configure.py` | The Job's script (stdlib Python): `ListBuckets`, `ListKeys`, then per line `CreateBucket` if missing, `ImportKey` if missing, `AllowBucketKey`. Never prints a key secret. |
| `job.yaml` | Job `garage-config` in `garage-gw`, `python:3.13-alpine`, non-root, read-only root. |
| `rbac.yaml` | ServiceAccount `garage-config`, and in each consumer namespace a Role allowing `get` on exactly one Secret. |

Applied by Flux Kustomization `infra-garage-config` (`force: true`): a change to the script or the
list renames the hashed ConfigMap, which changes the Job, which Flux deletes and recreates.

## Why the keys are imported, not created

The key is generated in git (`GK` + 24 hex, 64-hex secret) and committed sops-encrypted in the
consumer's own Secret, then imported. Restoring after losing the cluster therefore needs git and
the age key only, never OpenBao and never a Garage node.

## The token

`garage-bucket-manager`, from OpenBao `kv/garage-gw/bucket-manager` (`token`), through the
namespace's ExternalSecret. Create it on a Garage node with only what the script calls:

```bash
garage admin-token create --scope ListBuckets,ListKeys,CreateBucket,ImportKey,AllowBucketKey bucket-manager-staging
mise bao kv put kv/garage-gw/bucket-manager token=-   # paste the secret on stdin, Ctrl-D
```

No `DeleteBucket`, `DeleteKey`, `GetKeyInfo` (it can reveal secrets), layout or node scopes. Garage
scopes a token by endpoint, not by bucket, so this token can still grant any key on any bucket:
only this Job holds it.

## Adding a bucket

1. Generate the key into the consumer's Secret and encrypt it (same layout as the others).
2. Add the line to `buckets.txt`.
3. Add the namespace's Role + RoleBinding to `rbac.yaml`.
4. Merge. Flux re-runs the Job; `kubectl -n garage-gw logs job/garage-config` shows each bucket.

## Traps

- **The admin API calls are Garage v2** (`/v2/...`). On a v1 cluster every call is 404.
- **A missing token Secret leaves the pod in `CreateContainerConfigError`**, not failed: seed
  OpenBao before merging, or the Job waits until it is.
- **The Job is not a reconcile loop.** It runs when its inputs change (and again after a Flux
  force-recreate); a key deleted by hand on Garage comes back only on the next run.
