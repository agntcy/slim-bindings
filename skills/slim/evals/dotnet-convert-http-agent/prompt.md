---
tags: [skill-creator]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

ShoutAgent/ is our C# A2A agent, currently served over HTTP with ASP.NET Core. Switch it to serve over SLIM instead (keep ShoutHandler as is). Our SLIM node is at slim.internal:46357 and the shared secret will be in SLIM_SHARED_SECRET. Don't start anything, the node isn't reachable from your machine - just make the change and make sure it builds.

Input files: ShoutAgent/Program.cs, ShoutAgent/ShoutAgent.csproj
