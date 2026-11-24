---
tags: [skill-creator]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

echo_server.py and echo_client.py in this folder talk A2A over SLIM using a shared secret. Before we go to production every agent needs its own identity, so switch both of them to JWT-based identity instead of the shared secret. Self-signed keys are fine for now; put any keys you generate in keys/. Show me it still works against my local node.

Input files: echo_server.py, echo_client.py, pyproject.toml
