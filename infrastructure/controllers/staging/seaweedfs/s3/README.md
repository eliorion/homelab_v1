# SeaweedFS S3 identities: one sops Secret per bucket

Part of `../` (`infrastructure/controllers/staging/seaweedfs/`), alongside `cluster/` (the SeaweedFS
Helm release) and `configure/` (the bucket-create Job).

```
buckets/<bucket>.enc.yaml           Secret s3-<bucket> (flux-system): <BUCKET>_S3_ACCESS_KEY / <BUCKET>_S3_SECRET_KEY
buckets/<bucket>.enc.yaml.exemple   its PLAINTEXT template — copy this, never an existing .enc.yaml
config/seaweedfs-s3-config.yaml
                                    the gateway's static identity file, plaintext, every credential a ${VAR}
```

Two Flux Kustomizations (`clusters/staging/infrastructure.yaml`): `infra-seaweedfs-s3-buckets` decrypts
the bucket Secrets; `infra-seaweedfs-s3-config` depends on it and renders the identity file with
`postBuild.substituteFrom`, one entry per bucket Secret. No script: SeaweedFS 4.44 reads ONE static file,
and this is how that one file is assembled from separate secrets.

Two rules the gateway imposes:
- it reads the file at STARTUP only, so a change needs
  `kubectl -n seaweedfs rollout restart deployment seaweedfs-seaweedfs-s3` (2 replicas, rolling);
- it turns authentication OFF when it starts with no identity at all: never empty the file.

## Add a bucket `<b>` (consumer namespace `<ns>`)

1. Copy `buckets/advisor-corpus.enc.yaml.exemple` (never an existing `.enc.yaml` — its own key pair
   would come along) to `buckets/<b>.enc.yaml`, set keys `<B>_S3_ACCESS_KEY` / `<B>_S3_SECRET_KEY`
   (`<B>` = the bucket name upper-cased, `-` -> `_`), values `openssl rand -hex 12` /
   `openssl rand -hex 32` (hex only: the value is pasted into JSON), reflector annotations set to `<ns>`,
   then `sops -e -i`. Add it to `buckets/kustomization.yaml`.
2. `config/seaweedfs-s3-config.yaml`: an identity named `<b>` with `${<B>_S3_ACCESS_KEY}` /
   `${<B>_S3_SECRET_KEY}` and actions scoped to `<b>` only.
3. `clusters/staging/infrastructure.yaml`: `- {kind: Secret, name: s3-<b>}` under the config unit's
   `substituteFrom`.
4. `../configure/configure.sh`: `s3.bucket.create -name <b>`.
5. After Flux applied it: restart the gateway (above).

Removing a bucket is the same steps backwards; its data stays until `s3.bucket.delete -name <b>`.

The consumer reads the reflected Secret by its own key names (the advisor chart: `objectStore.accessKeyKey`
/ `secretKeyKey`). Nextcloud still reads its credential from its own app Secret, unchanged.
