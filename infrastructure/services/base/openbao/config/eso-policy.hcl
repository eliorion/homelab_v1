# External Secrets Operator: each namespace reads kv/<that namespace>/* and nothing else.
# KUBERNETES_ACCESSOR is replaced by configure.sh with the kubernetes auth mount accessor.
path "kv/data/{{identity.entity.aliases.KUBERNETES_ACCESSOR.metadata.service_account_namespace}}/*" {
  capabilities = ["read"]
}

path "kv/metadata/{{identity.entity.aliases.KUBERNETES_ACCESSOR.metadata.service_account_namespace}}/*" {
  capabilities = ["read", "list"]
}
