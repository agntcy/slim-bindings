---
tags: [skill-creator]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

agent.py in this folder is our A2A agent, currently served over HTTP with starlette. Switch it to serve over SLIM instead (keep the agent logic as is). Our SLIM node is at slim.internal:46357 and the shared secret will be in SLIM_SHARED_SECRET. Don't start anything, the node isn't reachable from your machine - just make the change and make sure it's sound.

Input files: agent.py, pyproject.toml
