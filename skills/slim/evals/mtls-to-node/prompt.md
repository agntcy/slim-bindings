---
tags: [skill-creator]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

our python A2A agents connect to our SLIM node over plain http right now (setup_slim_client with slim_url). Security says the agent<->node connection has to be mutual TLS. What do I need to change on the node and in the agent code?
