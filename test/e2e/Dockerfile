# test/e2e/Dockerfile — one image for the whole e2e scenario suite.
# Build arg WITHCLI=1 also installs the real claude CLI so the marketplace
# step is exercised; default (0) proves graceful skip when claude isn't on PATH.
FROM ubuntu:24.04

ARG WITHCLI=0
ENV DEBIAN_FRONTEND=noninteractive

# node + git always; npm only when we also want the claude CLI / npx online tier.
RUN apt-get update -qq \
 && apt-get install -y -qq nodejs git ca-certificates curl \
 && if [ "$WITHCLI" = "1" ]; then apt-get install -y -qq npm; fi \
 && rm -rf /var/lib/apt/lists/*

RUN if [ "$WITHCLI" = "1" ]; then npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || echo "claude CLI install failed (non-fatal)"; fi

COPY . /work
WORKDIR /work

# Default: run the offline scenario suite. run.sh overrides the command for the
# online tier.
ENTRYPOINT ["bash", "/work/test/e2e/scenarios.sh"]
