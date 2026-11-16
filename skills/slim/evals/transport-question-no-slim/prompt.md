---
tags: [skill-creator]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

We have ~30 LLM agents spread over two k8s clusters and a couple of on-prem boxes behind NAT. They need request/response between each other but also broadcast to groups of agents, and compliance wants messages end-to-end encrypted even through whatever routers sit in the middle. What transport/protocol setup would you recommend? We already use A2A for agent cards and task semantics.
