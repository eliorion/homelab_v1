#!/bin/sh
# Mounted into /docker-entrypoint-hooks.d/before-starting/ and run by the image
# entrypoint on EVERY container start, before apache. Every command below is
# idempotent for that reason.
#
# The image's run_path() invokes hooks through run_as, so this ALREADY runs as
# www-data from /var/www/html. Do not add an su/id -u dance: it drops the
# privilege that is already dropped and mangles the argv.
set -u

log() { echo "user_oidc-hook: $*"; }

if ! php occ app:install user_oidc; then
  php occ app:enable user_oidc || log "WARNING: user_oidc neither installed nor enabled"
fi

# Re-running with the same identifier UPDATES the provider in place and clears
# the JWKS cache; it does not create a second one.
php occ user_oidc:provider "${OIDC_PROVIDER_ID}" \
  --clientid="${OIDC_CLIENT_ID}" \
  --clientsecret="${OIDC_CLIENT_SECRET}" \
  --discoveryuri="${OIDC_DISCOVERY_URI}" \
  --scope="openid email profile" \
  --unique-uid=0 \
  --mapping-uid=preferred_username \
  --mapping-display-name=name \
  --mapping-email=email \
  --mapping-groups=groups \
  --group-provisioning=1 \
  --group-whitelist-regex='^nextcloud-' \
  --group-restrict-login-to-whitelist=1 \
  --check-bearer=0 \
  --send-id-token-hint=1 \
  || log "WARNING: provider config failed — starting anyway, OIDC login may be broken"

# NEVER abort startup. The entrypoint treats a non-zero hook as fatal, and a
# broken IdP configuration must not take the file server down with it.
exit 0
