#!/bin/bash
export PATH="/Users/macbook/.local/share/pyenv/shims:$PATH"
export PYENV_VERSION=3.11.4
exec python3 -m mcp_ocr.server
