---
description: Research a topic using multiple subagents in parallel for comprehensive coverage
allowed-tools: Task, WebSearch, WebFetch, Read, Grep, Glob
---

# Research: $ARGUMENTS

Conduct thorough research on the following topic:

> **$ARGUMENTS**

## Instructions

Launch parallel subagents to gather information from different angles:

### Agent 1: Official Documentation & Theory
Use the **researcher** subagent to:
- Search official documentation, specs, and whitepapers
- Find authoritative explanations of the concept
- Identify best practices and recommended approaches

### Agent 2: Real-World Implementations
Use the **implementation-scout** subagent to:
- Find working implementations on GitHub
- Search Reddit (r/algotrading, r/ethdev, r/cryptocurrency) for practical experiences
- Look for blog posts and tutorials with code examples
- Note common pitfalls others have encountered

### Agent 3: Codebase Context
Use the **codebase-explorer** subagent to:
- Check if we already have related code in the current project
- Find patterns we're already using that might apply
- Identify files that would be affected by this topic

## Synthesis

After all agents report back, combine the findings into:
1. **Summary**: What is this and why does it matter for our project?
2. **Key Insights**: The most important things to know
3. **Existing Code**: What we already have that's relevant
4. **Recommended Approach**: Based on all findings, what should we do?
5. **Resources**: Top 5 links for further reading
6. **Open Questions**: Things that need more investigation
