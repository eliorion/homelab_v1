"""Ensure every bucket in buckets.txt exists on Garage with its key imported and granted.

Idempotent and additive: it creates what is missing and never deletes or revokes anything.
"""
import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

ADMIN = os.environ["GARAGE_ADMIN_URL"].rstrip("/")
TOKEN = os.environ["GARAGE_ADMIN_TOKEN"]
SA = "/var/run/secrets/kubernetes.io/serviceaccount"
K8S = "https://kubernetes.default.svc"


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


def entries(path):
    with open(path) as f:
        for line in f:
            line = line.split("#", 1)[0].split()
            if line:
                yield line


def main():
    status, buckets = garage("GET", "/v2/ListBuckets")
    if status != 200:
        sys.exit(f"ListBuckets failed: {status} {buckets}")
    bucket_ids = {alias: b["id"] for b in buckets for alias in b.get("globalAliases", [])}
    status, keys = garage("GET", "/v2/ListKeys")
    if status != 200:
        sys.exit(f"ListKeys failed: {status} {keys}")
    key_ids = {k["id"] for k in keys}

    failed = 0
    for bucket, namespace, secret, id_field, secret_field in entries("/config/buckets.txt"):
        try:
            if bucket not in bucket_ids:
                status, body = garage("POST", "/v2/CreateBucket", {"globalAlias": bucket})
                if status != 200:
                    raise RuntimeError(f"CreateBucket: {status} {body}")
                bucket_ids[bucket] = body["id"]
                print(f"{bucket}: created")

            key_id, key_secret = consumer_key(namespace, secret, id_field, secret_field)
            if key_id not in key_ids:
                status, _ = garage("POST", "/v2/ImportKey", {
                    "accessKeyId": key_id, "secretAccessKey": key_secret, "name": bucket})
                if status != 200:
                    raise RuntimeError(f"ImportKey: {status}")  # body not printed: it may echo the key
                key_ids.add(key_id)
                print(f"{bucket}: key {key_id} imported")

            status, body = garage("POST", "/v2/AllowBucketKey", {
                "bucketId": bucket_ids[bucket], "accessKeyId": key_id,
                "permissions": {"read": True, "write": True, "owner": False}})
            if status != 200:
                raise RuntimeError(f"AllowBucketKey: {status} {body}")
            print(f"{bucket}: key {key_id} read+write ok")
        except Exception as err:  # one bucket's failure must not stop the others
            failed += 1
            print(f"{bucket}: FAILED {err}", file=sys.stderr)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
