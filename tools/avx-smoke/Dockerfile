# Test image for the AVX smoke test: the image under test plus a static QEMU
# user-mode emulator and the AVX probe. Built by run.sh, never published.
# QEMU comes from Debian trixie (10.x); 8.2 from Ubuntu 24.04 crashes on node.
ARG IMAGE

FROM debian:trixie-slim AS tools
RUN apt-get update \
 && apt-get install -y --no-install-recommends qemu-user-static gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*
COPY avx-probe.c /src/avx-probe.c
RUN gcc -O0 -static -o /avx-probe /src/avx-probe.c

FROM ${IMAGE}
COPY --from=tools /usr/bin/qemu-x86_64-static /opt/avx-smoke/qemu
COPY --from=tools /avx-probe /opt/avx-smoke/avx-probe
ENTRYPOINT ["/opt/avx-smoke/qemu"]
