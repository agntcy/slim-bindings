---
tags: [skill-creator]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Building a trip planner: I have (well, will have) a flights agent and a hotels agent, both A2A, and an orchestrator that needs to ask both the same question at once and collect both answers. We want to run it over SLIM instead of http. Write it in python - stub agents that return canned answers are fine - and run it so I can see both replies come back.
