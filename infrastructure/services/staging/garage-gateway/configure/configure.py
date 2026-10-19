"""Ensure every bucket in buckets.txt exists on Garage with its key imported and granted.

Idempotent and additive: it creates what is missing and never deletes or revokes anything.
"""
import base64
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

ADMIN = os.environ["GARAGE_ADMIN_URL"].rstrip("/")
TOKEN = os.environ["GARAGE_ADMIN_TOKEN"]
SA = "/var/run/secrets/kubernetes.io/serviceaccount"
K8S = "https://kubernetes.default.svc"
# Garage's nodes converge in seconds, so a node can still answer for a bucket or key another node
# just created: missing from its list (then 409 on create/import) or "not found" on a grant.
LAG_TRIES = 6


def garage(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(ADMIN + path, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode(errors="replace")[:300]


def consumer_key(namespace, name, id_field, secret_field):
    ctx = ssl.create_default_context(cafile=f"{SA}/ca.crt")
    with open(f"{SA}/token") as f:
        token = f.read()
    req = urllib.request.Request(f"{K8S}/api/v1/namespaces/{namespace}/secrets/{name}",
                                 headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
        data = json.load(resp)["data"]
    return (base64.b64decode(data[id_field]).decode().strip(),
            base64.b64decode(data[secret_field]).decode().strip())


def list_buckets():
    status, buckets = garage("GET", "/v2/ListBuckets")
    if status != 200:
        raise RuntimeError(f"ListBuckets: {status} {buckets}")
    return {alias: b["id"] for b in buckets for alias in b.get("globalAliases", [])}


def converged(call, done):
    """call() until done(status, body), waiting longer each time; the last answer otherwise."""
    for attempt in range(LAG_TRIES):
        status, body = call()
        if done(status, body) or attempt == LAG_TRIES - 1:
            return status, body
        time.sleep(attempt + 1)


def bucket_id(bucket, known):
    if bucket in known:
        return known[bucket]
    status, body = garage("POST", "/v2/CreateBucket", {"globalAlias": bucket})
    if status == 200:
        print(f"{bucket}: created")
        return body["id"]
    if status != 409:
        raise RuntimeError(f"CreateBucket: {status} {body}")
    # created by an earlier run, not yet in the list this node gave: list again until it is
    _, ids = converged(lambda: (200, list_buckets()), lambda _, ids: bucket in ids)
    if bucket not in ids:
        raise RuntimeError("CreateBucket: 409 but the bucket never appeared in ListBuckets")
    return ids[bucket]


def entries(path):
    with open(path) as f:
        for line in f:
            line = line.split("#", 1)[0].split()
            if line:
                yield line


def main():
    try:
        bucket_ids = list_buckets()
    except RuntimeError as err:
        sys.exit(str(err))
    status, keys = garage("GET", "/v2/ListKeys")
    if status != 200:
        sys.exit(f"ListKeys failed: {status} {keys}")
    key_ids = {k["id"] for k in keys}

    failed = 0
    for bucket, namespace, secret, id_field, secret_field in entries("/config/buckets.txt"):
        try:
            bucket_ids[bucket] = bucket_id(bucket, bucket_ids)

            key_id, key_secret = consumer_key(namespace, secret, id_field, secret_field)
            if key_id not in key_ids:
                status, _ = garage("POST", "/v2/ImportKey", {
                    "accessKeyId": key_id, "secretAccessKey": key_secret, "name": bucket})
                if status not in (200, 409):  # 409: imported by an earlier run, not yet listed here
                    raise RuntimeError(f"ImportKey: {status}")  # body not printed: it may echo the key
                key_ids.add(key_id)
                print(f"{bucket}: key {key_id} {'imported' if status == 200 else 'already imported'}")

            status, body = converged(
                lambda: garage("POST", "/v2/AllowBucketKey", {
                    "bucketId": bucket_ids[bucket], "accessKeyId": key_id,
                    "permissions": {"read": True, "write": True, "owner": False}}),
                lambda status, _: status != 404)
            if status != 200:
                raise RuntimeError(f"AllowBucketKey: {status} {body}")
            print(f"{bucket}: key {key_id} read+write ok")
        except Exception as err:  # one bucket's failure must not stop the others
            failed += 1
            print(f"{bucket}: FAILED {err}", file=sys.stderr)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
