---
tags: [skill-creator]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

running my slima2a client I get this and I have no idea why:

slim_bindings._slim_bindings.slim_rpc.RpcError.Rpc: code=<RpcCode.UNAVAILABLE: 14>, message='Session handshake failed: failed to add participant to session: message send retries exhausted for id=1139086134', details=None

the slim node is up, I can see the client connect in its logs. what's wrong?
