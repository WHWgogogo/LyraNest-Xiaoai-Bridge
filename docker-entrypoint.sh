#!/bin/sh
set -eu

# Docker is deliberately a plain TCP deployment. Only the FPK launcher enables FlyOS gateway sockets.
unset BRIDGE_GATEWAY_SOCKET
unset BRIDGE_GATEWAY_PREFIX
export BRIDGE_RUNTIME=docker

exec node dist/index.js
