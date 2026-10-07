#!/bin/sh
# Idempotent: re-applied from git on every run. Inputs are the files next to it.
set -eu

export BAO_ADDR=https://openbao.openbao.svc:8200
export BAO_CACERT=/openbao/tls/ca.crt

BAO_TOKEN=$(bao write -field=token auth/kubernetes/login role=config \
  jwt=@/var/run/secrets/kubernetes.io/serviceaccount/token)
export BAO_TOKEN

# The ESO policy is templated on the kubernetes auth mount accessor.
accessor=$(bao read -field=accessor sys/auth/kubernetes)
sed "s/KUBERNETES_ACCESSOR/${accessor}/g" /config/eso-policy.hcl | bao policy write eso -

namespaces=$(grep -v -e '^#' -e '^[[:space:]]*$' /config/eso-namespaces.txt | tr '\n' ',' | sed 's/,$//')
bao write auth/kubernetes/role/eso \
  bound_service_account_names=openbao-eso \
  bound_service_account_namespaces="${namespaces}" \
  token_policies=eso \
  token_ttl=10m \
  token_max_ttl=30m

echo "eso role bound to namespaces: ${namespaces}"
