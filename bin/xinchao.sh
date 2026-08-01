#!/bin/bash
# airi-xinchao MCP wrapper
# Airi 通过此脚本调用 stdio MCP 服务

export PATH="/Users/macbook/.local/share/fnm/node-versions/v22.14.0/installation/bin:$PATH"
exec node /Users/macbook/airi-xinchao/src/server.js
