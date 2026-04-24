---
name: long-context-research-notes
description: Structure broad repo or document research into hypotheses, notes, and narrowed conclusions before implementation.
---

# long-context-research-notes

## Use when
- The task spans many files, long documents, or multiple subsystems.
- The user is frustrated by repeated failed fixes and needs a reliable diagnosis.
- You need to separate facts, hypotheses, and confirmed root causes.

## Working method
1. Gather a small set of high-signal facts first.
2. Form 2-3 competing hypotheses.
3. Check each hypothesis against concrete code or runtime evidence.
4. Eliminate wrong explanations quickly.
5. Only implement after one explanation clearly matches the evidence.

## Notes style
- Keep facts and guesses separate.
- Use exact selectors, functions, file paths, and state fields.
- Prefer one narrow experiment that disproves a theory over many speculative edits.
- When a fix fails, record what that failure rules out.

## Output expectations
- State the strongest evidence.
- Name the discarded hypotheses briefly.
- Recommend the smallest fix that addresses the confirmed cause.

## Avoid
- Editing before you can explain the bug mechanically.
- Treating layout issues as purely visual when sizing/state logic may drive them.
- Repeating similar fixes without new evidence.
