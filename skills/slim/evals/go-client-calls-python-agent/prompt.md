---
tags: [skill-creator]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

agent.py in this folder is our Python summarizer agent; it serves A2A over SLIM (run it with `uv run agent.py`, it needs SLIM_SHARED_SECRET). Our other services are written in Go. Write a small Go client in this folder that sends the agent a piece of text and prints its reply, and show me it works against my local node.

Input files: agent.py, pyproject.toml
