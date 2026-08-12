FROM alpine:3.22

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
