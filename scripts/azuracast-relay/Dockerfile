# Icecast from Alpine's own package rather than a third-party image: the
# maintained relay images on Docker Hub are either untagged `latest` or frozen
# in 2023, and this host is going to be publicly reachable.
#
# envsubst (gettext) renders the config at start, so every secret and limit
# comes from the environment and icecast.xml holds no credentials.
FROM alpine:3.24

RUN apk add --no-cache icecast gettext curl \
 && mkdir -p /etc/icecast /var/log/icecast \
 && chown -R icecast:icecast /var/log/icecast

COPY icecast.xml.template /etc/icecast/icecast.xml.template
COPY web/ /usr/share/icecast/web/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
USER icecast
ENTRYPOINT ["/entrypoint.sh"]
