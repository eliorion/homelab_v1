# cert-manager ClusterIssuers

The cluster's **first** ACME issuers. Before this, cert-manager was deployed but
had no ClusterIssuer at all — the only issuers were namespaced self-signed ones
(`identity/keycloak-ca`, `identity/keycloak-selfsigned`,
`cnpg-system/...-barman-cloud-selfsigned-issuer`).

## Why this exists

The Dagger CI migration needs a self-hosted OCI registry that is usable from
anywhere with **no `--insecure-registry`, no CA distribution, no
`insecure_skip_verify`**. That requires a publicly-trusted certificate, which
requires ACME, which requires a ClusterIssuer.

It is shared infrastructure, not registry-specific: Forgejo needs it too (git
over HTTPS, runner registration and the package registry all refuse a bad
chain), and any future service can reference it by name.

## Why DNS-01 and not HTTP-01

Issuance must **not** require inbound reachability. The registry answers on an
RFC1918 address behind Cilium LB-IPAM; HTTP-01 would force it to be publicly
reachable purely so a certificate could be renewed. DNS-01 proves control of the
zone over the Cloudflare API instead, so a LAN-only or tailnet-only service can
still hold a genuine public cert.

DNS layout that makes this work: a Cloudflare `A` record
`<service>.eliorion.fr` → `192.168.1.11x` with the **proxy off (grey cloud)**.
An RFC1918 address in public DNS is publicly *resolvable* but not publicly
*reachable* — which is exactly the goal. Do not orange-cloud these records: the
Cloudflare proxy caps request bodies at 100 MB on the free tier, and `docker
push` of any larger layer returns 413.

## The Cloudflare API token

`cloudflare-api-token.enc.yaml` ships with an encrypted **placeholder**. Replace
it before requesting the first Certificate.

### Create the token

`https://dash.cloudflare.com/profile/api-tokens` — under **My Profile**, not
Account settings. That is where most people look first and do not find it.

- **Create Token** → use the **"Edit zone DNS"** template (offered by name), or
  Custom Token with a permission row of `Zone` / `DNS` / `Edit`.
- Then, in the **separate** *Zone Resources* box: `Include` → `Specific zone` →
  `eliorion.fr`.

The permission and the zone are two different selectors — there is no single
setting called "DNS Edit eliorion.fr". If the zone is not in the dropdown, you
are in a different Cloudflare account than the one holding it.

Nothing wider than one zone: this token can rewrite all of `eliorion.fr`.

### Filling in the token

`cloudflare-api-token.template.yaml` is a plaintext template. It is **not** in
`kustomization.yaml`, so it is never applied.

Encrypt straight to the final path so the plaintext never exists inside the
repo:

```bash
cd infrastructure/controllers/staging/cert-manager-issuers

# 1. copy the template somewhere outside the repo and paste the token in
cp cloudflare-api-token.template.yaml /tmp/cf-token.yaml
${EDITOR:-vi} /tmp/cf-token.yaml          # replace PASTE_CLOUDFLARE_TOKEN_HERE

# 2. encrypt to the repo path. --filename-override is what makes sops pick the
#    STAGING age recipient: creation_rules in .sops.yaml match on the output
#    path, and /tmp/... matches nothing, which would silently produce a file
#    with no recipients.
sops --encrypt \
     --filename-override cloudflare-api-token.enc.yaml \
     /tmp/cf-token.yaml > cloudflare-api-token.enc.yaml

# 3. destroy the plaintext
shred -u /tmp/cf-token.yaml 2>/dev/null || rm -f /tmp/cf-token.yaml

# 4. verify: encrypted, correct recipient, no cleartext token
grep -c 'ENC\[' cloudflare-api-token.enc.yaml          # >= 1
grep -c 'PASTE_CLOUDFLARE_TOKEN_HERE' cloudflare-api-token.enc.yaml   # 0
grep recipient cloudflare-api-token.enc.yaml            # age137z0k38...
```

Encryption needs only the **public** age recipient from `.sops.yaml`, so this
works without the private staging key. (Editing the existing file in place with
`sops edit` would need the private key — that is why the template exists.)

`homelab_v1` has no pre-commit secret scanning, so nothing will catch a
plaintext token that reaches a commit. Run step 4 before `git add`.

The Secret lives in namespace **`cert-manager`**, not beside its consumer. A
ClusterIssuer resolves solver secrets from `--cluster-resource-namespace`, which
defaults to the cert-manager namespace; putting it next to the registry looks
right and silently fails to solve.

## Staging before prod, always

`letsencrypt-staging` issues an untrusted chain with effectively no rate limits.
`letsencrypt-prod` allows **5 duplicate certificates per week**. Point every new
Certificate at staging first, confirm issuance *and* one forced renewal
(`cmctl renew <cert>`), then switch `issuerRef` to prod. A solver typo caught on
prod costs a seven-day outage for that name.

## Ordering

No new Flux Kustomization is needed. These manifests live under
`infrastructure/controllers/staging/`, which is applied by the
`infrastructure-controllers` Kustomization — that already `dependsOn`
`infra-cnpg-plugin` → `infra-certmanager`, and `infra-certmanager` has
`wait: true` with health checks on the cert-manager and cert-manager-webhook
Deployments. So the CRDs are established and the webhook is serving before a
ClusterIssuer is ever applied. `infrastructure-controllers` also carries the
sops decryption provider, which is what decrypts the token.

Both issuers are declared in `base/`-free fashion (staging overlay only),
because the SOPS convention forbids `*.enc.yaml` under `base/` and the issuer is
useless without its token.

## Troubleshooting

- **Cert stuck `Pending`, challenge stuck `pending`** — cert-manager's DNS-01
  self-check queries authoritative nameservers and can be defeated by
  split-horizon DNS inside the cluster. Check with
  `kubectl describe challenge -A`. If the self-check is the problem, set
  `--dns01-recursive-nameservers=1.1.1.1:53,8.8.8.8:53` and
  `--dns01-recursive-nameservers-only` on the cert-manager controller.
- **`unauthorized` from Cloudflare** — the token is still the placeholder, or
  its zone scope does not include `eliorion.fr`.
- **Renewal did not reload the consumer** — cert-manager rewrites the Secret in
  place; a pod that read the cert at start-up keeps the old one. Verify each
  consumer picks up a `cmctl renew` without a manual restart, and add a reloader
  annotation where it does not.
