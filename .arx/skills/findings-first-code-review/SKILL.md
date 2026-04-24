---
name: findings-first-code-review
description: Perform broad code review sweeps with emphasis on bug finding, coverage, and clear findings ordered by severity.
---

# findings-first-code-review

## Use when
- The user asks for a review, audit, bug sweep, or regression check.
- A change looks correct on the surface but may hide behavior regressions.
- You need strong coverage instead of over-filtering low-confidence issues away.

## Review posture
- Optimize for coverage first, then rank findings by severity and confidence.
- Prefer reporting a plausible issue with a confidence note over silently dropping it.
- Focus on incorrect behavior, regressions, missing guards, stale assumptions, and missing tests.

## Findings format
1. Severity and confidence.
2. File and line reference.
3. Why it is risky.
4. What behavior may break.

## Sweep checklist
- Check control flow changes, especially new early returns and skipped branches.
- Check state transitions and persistence paths.
- Check UI labels against actual save/delete behavior.
- Check edit/create flows separately.
- Check hidden dependencies on naming, file paths, and implicit defaults.
- Check whether tests or manual verification cover the changed path.

## Avoid
- Leading with summary before findings.
- Reporting style-only nits as primary findings.
- Assuming a green build means the behavior is correct.
