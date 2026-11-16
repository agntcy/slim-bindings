---
tags: [skill-creator]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I have a small protobuf service (calculator.proto in this folder, one unary Add rpc). I want to expose it over SLIM using slimrpc rather than grpc, python server and client. Generate the stubs, implement it and run a call to show it works.

Input files: calculator.proto
