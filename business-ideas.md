# Business Ideas — Trevor's running list

JARVIS researches every idea in this file once a week. Reports land in
`reports/business-ideas/YYYY-MM-DD-<slug>.md`. Phone notification fires
when the cycle completes.

## How to use this file

1. Add an idea as a top-level `## Heading`. The heading text becomes the
   idea title. The slug (used in report filenames) is auto-derived.
2. Optional first line under the heading: `Tags: a, b, c` and/or
   `Status: exploring|backlog|active|shelved|killed`. Status defaults to
   `exploring`. Killed ideas are skipped.
3. Everything below those metadata lines is free-form description —
   write as much or as little as you want. JARVIS uses the description
   to seed the research queries, so being specific helps.
4. Save the file. Next weekly cycle picks up new entries automatically.
5. To trigger an immediate research run for one idea (without waiting
   a week): `businessIdeas.runOne` tRPC endpoint. To run the whole
   list: `businessIdeas.runAll`.

## What "research" actually does per idea

- 4-6 web searches: market signal, competitor scan, recent news, adjacent
  patterns, regulatory blockers (when relevant)
- Multi-hop retrieval against your own knowledge graph for related
  context you've already scraped
- LLM synthesis (smartChat, "self_evaluate" intent) into a structured
  report: market signal, competitors found, recent news, feasibility
  for *your* skill set + capital, recommended next 1-2 steps
- Comparison against last week's report: what changed?

---

<!--
  REMOVE THE EXAMPLE BELOW AND ADD YOUR REAL IDEAS BENEATH THIS LINE.
  The example is here so the parser has something to test against on
  first run — it's harmless if left, but research cycles will spend
  3 min on it every week.
-->

## Example: AI for indie game devs
Tags: gaming, b2b, ai
Status: backlog

A tool that takes a Unity / Unreal project and auto-generates marketing
assets — trailers, screenshots, social posts — by reading the project's
source assets. Indie devs hate marketing; an "I'll do the trailer for
you" tool that actually understands their game would have pull.

Concrete-ish next moves: see if Unity's package manager exposes enough
metadata to drive this; talk to 5 indie devs at the next IGDA meetup.
