#!/usr/bin/env python3
"""Launcher for screenshot MCP server from source (avoids package name conflict)."""
import sys
import importlib.util

BASE = "/Users/macbook/airi-xinchao/mcp-services/screenshot"
sys.path.insert(0, BASE)

# Unload any conflicting single-file module
for key in list(sys.modules.keys()):
    if "screenshot_mcp_server" in key and ".server" not in key:
        del sys.modules[key]

spec = importlib.util.spec_from_file_location(
    "screenshot_mcp_server.server.stdio",
    f"{BASE}/screenshot_mcp_server/server/stdio.py",
)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
mod.main()
