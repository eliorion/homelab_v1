FROM mcr.microsoft.com/devcontainers/base:debian-13

# zstd: decompress talos-backup etcd snapshots during a restore (age -> zstd -> etcdutl).
# Not in the mise registry, so install from apt.
RUN apt-get update \
    && apt-get install -y --no-install-recommends zstd \
    && rm -rf /var/lib/apt/lists/*

# etcd client tools for snapshot restore drills (doc 09): etcdutl (status/restore),
# etcdctl, etcd. mise/aqua's etcd package omits etcdutl, so pull the release tarball.
ARG ETCD_VER=v3.7.1
RUN curl -sSLf "https://github.com/etcd-io/etcd/releases/download/${ETCD_VER}/etcd-${ETCD_VER}-linux-amd64.tar.gz" \
      | tar -xz -C /tmp \
    && install -m 0755 /tmp/etcd-${ETCD_VER}-linux-amd64/etcd{,ctl,utl} /usr/local/bin/ \
    && rm -rf /tmp/etcd-${ETCD_VER}-linux-amd64

RUN curl -sSLf https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh && \
    echo 'eval "$(mise activate zsh)"' >> /home/vscode/.zshrc && \
    echo 'eval "$(mise activate bash)"' >> /home/vscode/.bashrc
#FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

#COPY --from=jdxcode/mise /usr/local/bin/mise /usr/local/bin/

# make sure mise is activated in both zsh and bash. Might be overridden by a user's dotfiles.
#RUN echo 'eval "$(mise activate bash)"' >> /home/vscode/.bashrc && \
#echo 'eval "$(mise activate zsh)"' >> /home/vscode/.zshrc
