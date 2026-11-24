---
tags: [skill-creator]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I need a Node/TypeScript orchestrator that sends the same question to three A2A agents over SLIM - agntcy/demo/agent_a, agntcy/demo/agent_b and agntcy/demo/agent_c - and prints every answer. agent_c is flaky and often down; when one agent is down I still want the answers from the others, quickly. Build the orchestrator and three tiny stand-in agents in this empty folder, and show me it working while agent_c is stopped.
