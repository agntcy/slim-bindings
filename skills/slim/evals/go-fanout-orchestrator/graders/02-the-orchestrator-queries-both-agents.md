---
type: llm
focus: trace
weight: 1
---

The orchestrator queries both agents concurrently (e.g. one client per agent in goroutines or errgroup) and does not call a multicast API that slim-a2a-go does not provide
