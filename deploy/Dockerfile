# syntax=docker/dockerfile:1.7
# Backend-only image (T001). Bundles pinned native ffprobe/FFmpeg per ADR-0028.
# Built/tested platform: linux/amd64 only. Other platforms are NOT supported.

ARG GO_VERSION=1.26
ARG DEBIAN_RELEASE=bookworm

# ---- pinned FFmpeg (BtbN autobuild, LGPL static, linux64) -------------------
FROM debian:${DEBIAN_RELEASE}-slim AS ffmpeg
ARG FFMPEG_TAG=autobuild-2026-11-12-15-40
ARG FFMPEG_ARCHIVE=ffmpeg-n8.1.3-35-gf1acb0a266-linux64-lgpl-8.1
ARG FFMPEG_SHA256=125c492893bf41fa7093c8294f59750a375d00336270847f073760ff6c54ba30
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /tmp/ffmpeg
RUN curl -fsSL -o ff.tar.xz \
      "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/${FFMPEG_TAG}/${FFMPEG_ARCHIVE}.tar.xz" \
 && echo "${FFMPEG_SHA256}  ff.tar.xz" | sha256sum -c - \
 && tar -xJf ff.tar.xz --strip-components=1 \
 && mkdir -p /out/bin /out/licenses \
 && cp bin/ffmpeg bin/ffprobe /out/bin/ \
 && test -s LICENSE.txt \
 && cp LICENSE.txt /out/licenses/ \
 && { echo "source: https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/${FFMPEG_TAG}"; \
      echo "archive: ${FFMPEG_ARCHIVE}.tar.xz"; echo "sha256: ${FFMPEG_SHA256}"; \
      /out/bin/ffmpeg -hide_banner -version; } > /out/BUILDINFO.txt \
 && /out/bin/ffprobe -hide_banner -version | head -1

# ---- Go build ---------------------------------------------------------------
FROM golang:${GO_VERSION}-${DEBIAN_RELEASE} AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/server ./cmd/server \
 && CGO_ENABLED=0 go build -trimpath -o /out/ctl ./cmd/ctl

# ---- runtime ----------------------------------------------------------------
FROM debian:${DEBIAN_RELEASE}-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --no-create-home litara
COPY --from=ffmpeg /out/bin/ffmpeg /out/bin/ffprobe /opt/litara/bin/
COPY --from=ffmpeg /out/BUILDINFO.txt /opt/litara/ffmpeg-BUILDINFO.txt
COPY --from=ffmpeg /out/licenses/ /usr/share/doc/litara/ffmpeg/
COPY --from=build /out/server /out/ctl /usr/local/bin/
# Writable managed-library mount point (T004); index libraries mount media read-only elsewhere.
RUN mkdir -p /library && chown litara /library
ENV LITARA_FFPROBE_PATH=/opt/litara/bin/ffprobe \
    LITARA_FFMPEG_PATH=/opt/litara/bin/ffmpeg \
    LITARA_HTTP_ADDR=0.0.0.0:8080
USER litara
EXPOSE 8080
ENTRYPOINT ["server"]
