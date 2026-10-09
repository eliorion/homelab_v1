#!/usr/bin/env bash
# Renders clusterconfig/ (gitignored) from patches/ with talosctl. See README.md.
set -euo pipefail
cd "$(dirname "$0")"

CLUSTER=Homelab_staging
ENDPOINT=https://192.168.1.100:6443
TALOS_VERSION=v1.14.2
# Config contract, not the OS version: v1.13 keeps the v1alpha1 layout patches/ targets.
CONFIG_CONTRACT=v1.13
KUBERNETES_VERSION=1.36.1
SCHEMATIC_AMD=54a5f422871af4c35624f58a6fea87b3c58d7859fd6754bde6732348f5a6a7ec
SCHEMATIC_INTEL=98559b2575b328fe44684928c8faf3e592391568fe12ee6fb1bed2a8154e2789

# hostname  ip  install-disk  schematic
NODES=(
  "staging-controlplane-1 192.168.1.101 /dev/nvme0n1 $SCHEMATIC_AMD"
  "staging-controlplane-2 192.168.1.102 /dev/sda $SCHEMATIC_INTEL"
  "staging-controlplane-3 192.168.1.103 /dev/sda $SCHEMATIC_INTEL"
)

: "${SOPS_AGE_KEY_FILE:=../clusters/staging/age.agekey}"
export SOPS_AGE_KEY_FILE

umask 077
secrets=$(mktemp)
trap 'rm -f "$secrets"' EXIT
# Never regenerate this file: a new PKI is a dead cluster.
sops -d talsecret.sops.yaml >"$secrets"

mkdir -p clusterconfig
gen() {
  talosctl gen config "$CLUSTER" "$ENDPOINT" \
    --with-secrets "$secrets" \
    --talos-version "$CONFIG_CONTRACT" \
    --kubernetes-version "$KUBERNETES_VERSION" \
    --with-docs=false --with-examples=false --force "$@"
}

ips=()
for node in "${NODES[@]}"; do
  read -r host ip disk schematic <<<"$node"
  ips+=("$ip")
  gen --output-types controlplane \
    --install-disk "$disk" \
    --install-image "factory.talos.dev/installer/$schematic:$TALOS_VERSION" \
    --config-patch @patches/common.yaml \
    --config-patch @patches/registry-mirrors.yaml \
    --config-patch "@patches/$host.yaml" \
    -o "clusterconfig/${CLUSTER}-${host}.yaml"
  talosctl validate --mode metal --config "clusterconfig/${CLUSTER}-${host}.yaml" >/dev/null
  echo "rendered clusterconfig/${CLUSTER}-${host}.yaml"
done

# Endpoints are the node IPs, never the VIP: the recovery tool must not depend on it.
gen --output-types talosconfig -o clusterconfig/talosconfig
talosctl --talosconfig clusterconfig/talosconfig config endpoint "${ips[@]}"
talosctl --talosconfig clusterconfig/talosconfig config node "${ips[@]}"
echo "rendered clusterconfig/talosconfig"
