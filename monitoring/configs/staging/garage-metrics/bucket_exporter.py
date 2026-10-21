"""Per-bucket Garage statistics for Prometheus.

Polls the Garage admin API every POLL_INTERVAL_S (ListBucketsInfo, or ListBuckets + GetBucketInfo
on a Garage without it, plus GetClusterStatistics) and serves the last answer on /metrics, so a
Prometheus scrape never calls Garage. Read-only: it only calls those endpoints.
"""
import http.server
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ADMIN = os.environ["GARAGE_ADMIN_URL"].rstrip("/")
TOKEN = os.environ["GARAGE_ADMIN_TOKEN"]
INTERVAL = int(os.environ.get("POLL_INTERVAL_S", "300"))
PORT = int(os.environ.get("PORT", "9101"))

BUCKET_FIELDS = [
    ("bytes", "garage_bucket_bytes", "Bytes stored in the bucket (logical, before replication)"),
    ("objects", "garage_bucket_objects", "Objects in the bucket"),
    ("unfinishedUploads", "garage_bucket_unfinished_uploads", "Uploads started and not finished"),
    ("unfinishedMultipartUploads", "garage_bucket_unfinished_multipart_uploads", "Multipart uploads not completed"),
    ("unfinishedMultipartUploadParts", "garage_bucket_unfinished_multipart_upload_parts", "Parts of unfinished multipart uploads"),
    ("unfinishedMultipartUploadBytes", "garage_bucket_unfinished_multipart_bytes", "Bytes held by unfinished multipart uploads"),
]
CLUSTER_FIELDS = [
    ("totalObjectBytes", "garage_cluster_object_bytes", "Bytes of all objects (logical, before replication)"),
    ("totalObjectCount", "garage_cluster_objects", "Objects in the cluster"),
    ("bucketCount", "garage_cluster_buckets", "Buckets in the cluster"),
    ("dataAvail", "garage_cluster_data_avail_bytes", "Space available for object data"),
    ("metadataAvail", "garage_cluster_metadata_avail_bytes", "Space available for metadata"),
]

state = {"body": "", "lock": threading.Lock()}


def call(path):
    req = urllib.request.Request(ADMIN + path, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def buckets_info():
    try:
        return call("/v2/ListBucketsInfo")
    except urllib.error.HTTPError as err:
        if err.code not in (400, 404):
            raise
    # Garage without ListBucketsInfo: one GetBucketInfo per bucket.
    return [call("/v2/GetBucketInfo?id=" + urllib.parse.quote(b["id"])) for b in call("/v2/ListBuckets")]


def esc(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def render(buckets, stats, ok, duration):
    out = []

    def family(name, help_text, samples):
        out.append(f"# HELP {name} {help_text}")
        out.append(f"# TYPE {name} gauge")
        out.extend(samples)

    rows = []
    for b in buckets:
        name = (b.get("globalAliases") or [b["id"]])[0]
        rows.append((f'bucket="{esc(name)}",bucket_id="{esc(b["id"])}"', b))
    for field, metric, help_text in BUCKET_FIELDS:
        family(metric, help_text, [f"{metric}{{{labels}}} {b[field]}" for labels, b in rows if b.get(field) is not None])
    family("garage_bucket_keys", "Access keys with a permission on the bucket",
           [f"garage_bucket_keys{{{labels}}} {len(b.get('keys') or [])}" for labels, b in rows])
    quota_bytes = [(labels, (b.get("quotas") or {}).get("maxSize")) for labels, b in rows]
    family("garage_bucket_quota_max_bytes", "Bucket size quota, when set",
           [f"garage_bucket_quota_max_bytes{{{labels}}} {v}" for labels, v in quota_bytes if v is not None])
    quota_objects = [(labels, (b.get("quotas") or {}).get("maxObjects")) for labels, b in rows]
    family("garage_bucket_quota_max_objects", "Bucket object-count quota, when set",
           [f"garage_bucket_quota_max_objects{{{labels}}} {v}" for labels, v in quota_objects if v is not None])
    for field, metric, help_text in CLUSTER_FIELDS:
        if stats.get(field) is not None:
            family(metric, help_text, [f"{metric} {stats[field]}"])
    if stats.get("incompleteAvailInfo") is not None:
        family("garage_cluster_stats_incomplete", "1 when Garage could not reach every node for its statistics",
               [f"garage_cluster_stats_incomplete {int(bool(stats['incompleteAvailInfo']))}"])
    family("garage_bucket_exporter_up", "1 when the last poll of the Garage admin API succeeded",
           [f"garage_bucket_exporter_up {int(ok)}"])
    family("garage_bucket_exporter_last_success_timestamp_seconds", "Unix time of the last successful poll",
           [f"garage_bucket_exporter_last_success_timestamp_seconds {state.get('last_ok', 0)}"])
    family("garage_bucket_exporter_poll_duration_seconds", "Duration of the last poll",
           [f"garage_bucket_exporter_poll_duration_seconds {duration:.3f}"])
    return "\n".join(out) + "\n"


def poll_forever():
    buckets, stats = [], {}
    while True:
        start = time.monotonic()
        try:
            buckets, stats = buckets_info(), call("/v2/GetClusterStatistics")
            ok = True
            state["last_ok"] = int(time.time())
        except Exception as err:  # keep serving the last good values, flagged by exporter_up=0
            ok = False
            print(f"poll failed: {type(err).__name__}: {err}", flush=True)
        body = render(buckets, stats, ok, time.monotonic() - start)
        with state["lock"]:
            state["body"] = body
        time.sleep(INTERVAL)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/metrics", "/healthz"):
            self.send_response(404)
            self.end_headers()
            return
        with state["lock"]:
            body = (state["body"] if self.path == "/metrics" else "ok\n").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    threading.Thread(target=poll_forever, daemon=True).start()
    http.server.ThreadingHTTPServer(("", PORT), Handler).serve_forever()
