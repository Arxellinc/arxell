# Success Metrics and Expected Outcomes

## Launch-Week Success Metrics

### Stability
- Crash-free session rate >= 99% across smoke matrix.
- Flow run completion rate >= 90% for bundled templates.
- Voice recovery success after transient STT failure >= 95%.

### Loop quality
- Median end-to-end template run time within expected SLA per template.
- Retry-resolved failures >= 50% of transient failures.
- Duplicate side-effect incidents = 0 for idempotent nodes.

### Developer adoption
- Time for new contributor to run and pass baseline checks <= 30 minutes.
- At least 5 external PRs merged in first two weeks (target).

## Expected Outcomes by Task Type (Initial)

### Coding loops
- High success for structured bug-fix tasks with tests.
- Lower success for large refactors without tight constraints.
- Expectation: 70-85% useful completions on bounded tasks.

### Business analysis loops
- Good synthesis quality when source constraints are clear.
- Risk: hallucination without citation gates.
- Expectation: 60-80% useful first drafts, high value with review.

### Diligence loops
- Strong for checklist and evidence aggregation.
- Risk: source freshness and coverage gaps.
- Expectation: 65-80% useful pre-review packages.

### Personal assistant loops
- High utility for routine planning and reminders.
- Risk: over-automation without confirmation gates.
- Expectation: 80-90% utility for bounded daily workflows.

## Go/No-Go Recommendation
- Go public this week only with:
  - curated template set,
  - explicit unsupported-node handling,
  - clear known limitations,
  - cross-platform smoke evidence attached.
- Defer broad connector claims until runtime parity and reliability are proven.
