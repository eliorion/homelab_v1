#!/bin/sh
# Filer-side setup that lives in the filer's metadata store, not in any chart
# value: re-running it is how a rebuilt metadata DB gets its configuration back.
set -e

MASTER="seaweedfs-seaweedfs-master-0.seaweedfs-seaweedfs-master.seaweedfs:9333"
FILER="seaweedfs-seaweedfs-filer-client.seaweedfs.svc.cluster.local:8888"

weed shell -master="$MASTER" -filer="$FILER" <<'SHELL'
fs.configure -locationPrefix=/buckets/ -volumeGrowthCount=1 -apply
s3.bucket.create -name nextcloud
SHELL
