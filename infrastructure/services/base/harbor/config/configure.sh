#!/bin/sh
# Declares the Harbor objects the dev platform needs, through the Harbor API. Idempotent:
# every run converges the project, its quota and retention, and both robots (permissions AND
# secret) to what this file and the Secrets say. README.md, "Harbor objects as code".
# busybox ash has pipefail; without it a failed curl inside a pipeline passes silently.
# shellcheck disable=SC3040
set -euo pipefail

API=${HARBOR_API:-http://harbor-core.registry.svc/api/v2.0}
PROJECT=${PROJECT:-e2e}
REGISTRY_HOST=${REGISTRY_HOST:-registry.eliorion.fr}
STORAGE_LIMIT=$((50 * 1024 * 1024 * 1024))

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

api() {
  method=$1
  path=$2
  shift 2
  curl -sS --fail-with-body -u "admin:${HARBOR_ADMIN_PASSWORD}" -X "$method" \
    -H 'Content-Type: application/json' "$API$path" "$@"
}

# Harbor refuses a robot secret outside 8-128 characters without an upper, a lower and a digit.
valid_secret() {
  printf '%s' "$1" | grep -Eq '^.{8,128}$' &&
    printf '%s' "$1" | grep -q '[A-Z]' &&
    printf '%s' "$1" | grep -q '[a-z]' &&
    printf '%s' "$1" | grep -q '[0-9]'
}

PULL_USER=$(printf '%s' "$E2E_PULL_DOCKERCONFIG" | jq -er --arg h "$REGISTRY_HOST" '.auths[$h].username')
PULL_SECRET=$(printf '%s' "$E2E_PULL_DOCKERCONFIG" | jq -er --arg h "$REGISTRY_HOST" '.auths[$h].password')
[ "$PULL_USER" = "robot\$${PROJECT}+pull" ] || {
  log "harbor-e2e-pull username is '$PULL_USER', expected 'robot\$${PROJECT}+pull'"
  exit 1
}
for s in "$E2E_CI_SECRET" "$PULL_SECRET"; do
  valid_secret "$s" || {
    log "a robot secret is not 8-128 chars with an upper, a lower and a digit"
    exit 1
  }
done

log "waiting for $API"
i=0
until curl -sf "$API/ping" >/dev/null; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || {
    log "Harbor API never answered"
    exit 1
  }
  sleep 5
done

# ── project ───────────────────────────────────────────────────────────────────
project_id() {
  api GET "/projects?name=$PROJECT&page_size=100" | jq -r --arg n "$PROJECT" '.[] | select(.name == $n) | .project_id'
}
pid=$(project_id)
if [ -z "$pid" ]; then
  api POST /projects -d "{\"project_name\":\"$PROJECT\",\"public\":false,\"storage_limit\":$STORAGE_LIMIT}"
  pid=$(project_id)
  log "created project $PROJECT ($pid)"
fi
api PUT "/projects/$pid" -d '{"metadata":{"public":"false"}}'
qid=$(api GET "/quotas?reference=project&reference_id=$pid" | jq -r '.[0].id')
api PUT "/quotas/$qid" -d "{\"hard\":{\"storage\":$STORAGE_LIMIT}}"
log "project $PROJECT: private, quota $STORAGE_LIMIT bytes"

# ── retention: keep what was pushed in the last 7 days OR the 5 newest, per repository ───
policy=$(jq -n --argjson pid "$pid" '
  def rule(t; p): {disabled: false, action: "retain", template: t, params: p,
    tag_selectors: [{kind: "doublestar", decoration: "matches", pattern: "**"}],
    scope_selectors: {repository: [{kind: "doublestar", decoration: "repoMatches", pattern: "**"}]}};
  {algorithm: "or",
   rules: [rule("nDaysSinceLastPush"; {nDaysSinceLastPush: 7}), rule("latestPushedK"; {latestPushedK: 5})],
   trigger: {kind: "Schedule", settings: {cron: "0 0 3 * * *"}},
   scope: {level: "project", ref: $pid}}')
rid=$(api GET "/projects/$pid" | jq -r '.metadata.retention_id // empty')
if [ -n "$rid" ]; then
  api PUT "/retentions/$rid" -d "$(printf '%s' "$policy" | jq --argjson id "$rid" '. + {id: $id}')"
else
  api POST /retentions -d "$policy"
fi
log "retention: 7 days or 5 newest, daily at 03:00"

# ── garbage collection: retention only untags; GC frees the disk. Never overrides a schedule ─
# No schedule yet answers an empty body, which jq turns into an empty string.
gc_type=$(api GET /system/gc/schedule | jq -r '.schedule.type // empty')
if [ -z "$gc_type" ] || [ "$gc_type" = "None" ]; then
  api POST /system/gc/schedule \
    -d '{"schedule":{"type":"Custom","cron":"0 0 4 * * 0"},"parameters":{"delete_untagged":true,"workers":1}}'
  log "GC scheduled weekly (Sunday 04:00)"
else
  log "GC already scheduled ($gc_type), left alone"
fi

# ── robots ────────────────────────────────────────────────────────────────────
ensure_robot() {
  name=$1
  secret=$2
  access=$3
  full="robot\$${PROJECT}+${name}"
  perms=$(jq -n --arg ns "$PROJECT" --argjson a "$access" '[{kind: "project", namespace: $ns, access: $a}]')
  existing=$(api GET "/robots?q=Level%3Dproject%2CProjectID%3D${pid}&page_size=100" |
    jq -c --arg f "$full" '.[] | select(.name == $f)')
  if [ -z "$existing" ]; then
    api POST /robots -d "$(jq -n --arg n "$name" --arg s "$secret" --argjson p "$perms" \
      '{name: $n, level: "project", duration: -1, disable: false, secret: $s, permissions: $p}')" >/dev/null
    log "created $full"
  else
    id=$(printf '%s' "$existing" | jq -r .id)
    api PUT "/robots/$id" -d "$(printf '%s' "$existing" |
      jq --argjson p "$perms" '. + {permissions: $p, disable: false, duration: -1}')"
    # The secret in Git wins: rotating a robot is an edit of the sops file.
    api PATCH "/robots/$id" -d "$(jq -n --arg s "$secret" '{secret: $s}')" >/dev/null
    log "updated $full (permissions and secret)"
  fi
}

ensure_robot ci "$E2E_CI_SECRET" \
  '[{"resource":"repository","action":"push"},{"resource":"repository","action":"pull"}]'
ensure_robot pull "$PULL_SECRET" '[{"resource":"repository","action":"pull"}]'

log "done"
