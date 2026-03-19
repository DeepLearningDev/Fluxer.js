# Fluxer.js Agent Instructions

## Purpose
This repository is developed with strict production-quality standards.

Agents must behave like disciplined senior engineers.
Speed is secondary to correctness, clarity, and reliability.

---

## Source of truth

Before making any changes, you MUST read:

1. docs/vault/Resources/Coding Standards.md
2. docs/vault/Projects/Fluxer.js/
3. docs/vault/Learning Logs/ (recent entries)

If conflicts exist:
1. Coding Standards
2. Project docs
3. Learning Logs
4. Brainstorm notes

Do not proceed without context.

---

## Workflow

For every task:

1. Read relevant vault docs
2. Restate task clearly
3. Define:
   - files in scope
   - files out of scope
4. Propose a minimal plan
5. Implement
6. Run all checks
7. Report results honestly
8. Update documentation (Learning Log + Daily Note)

---

## Quality gates (MANDATORY)

Never consider work complete unless all pass:

- npm run lint
- npm run check
- npm test
- npm run build

If available:
- npm run release:check

Rules:
- Do NOT fake results
- Do NOT skip failing checks
- Do NOT weaken rules to pass

If something cannot be verified:
- explicitly state it

---

## Testing rules

- Test meaningful behavior, not trivial implementation
- Prefer real systems over mocks
- Do NOT mock what can be tested for real
- Add tests for any meaningful change
- Fix failing tests immediately

---

## Code standards

- Prefer clarity over cleverness
- Strong typing required
- No silent failures
- Explicit error handling
- No magic values
- No unnecessary abstraction
- Keep functions focused and small

---

## Security rules

- Never hardcode secrets
- Validate external input
- Avoid unsafe execution patterns
- Follow least-privilege thinking

---

## Scope control

Before editing:
- define scope

Do NOT:
- modify unrelated files
- perform large refactors without justification
- introduce hidden behavior changes

---

## Hard blocks

You must NOT:
- push code unless explicitly asked
- claim success without verification
- ignore failing tests
- disable lint/type rules
- make destructive changes without warning

---

## Traceability

Every session must include:

- files changed
- what changed
- why it changed
- checks run + results
- risks or follow-ups

---

## Documentation requirements

At the end of each session:

### Learning Log
Create/update:
docs/vault/Learning Logs/YYYY-MM-DD - Fluxer.js - <topic>.md

Include:
- task
- reasoning
- tradeoffs
- issues
- tests run
- results
- lessons learned
- next steps

### Daily Note
Create/update:
docs/vault/Daily Notes/YYYY-MM-DD.md

Include:
- what was done
- project
- test/build status
- remaining issues
- layman explanation

---

## Output format

Responses should include:

1. Context checked
2. Task understanding
3. Scope
4. Plan
5. Implementation summary
6. Validation results
7. Documentation updates
8. Plain-English explanation

---

## Final rule

Correct, testable, maintainable code is more important than speed.

Do not surprise the user.
