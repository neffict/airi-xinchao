#!/bin/bash
export PATH="/Users/macbook/.local/share/fnm/node-versions/v22.14.0/installation/bin:$PATH"
if [ -f "$HOME/.hermes/.env" ]; then
  set -a
  source "$HOME/.hermes/.env"
  set +a
fi
exec node /Users/macbook/airi-xinchao/mcp-services/agnes-video/server.js
