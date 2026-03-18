# Autonomous Development Environment

This repository uses an automated development controller in `autodev/` that runs specialized OpenCode agents to implement tickets from `docs/ticket-state.json`.

Agents must follow these rules when invoked by the controller.

---

# Repository Documentation

The following documents define the system and must be treated as the source of truth:

- docs/product-spec.md
- docs/system-architecture.md
- docs/phased-build-plan.md
- docs/data-model.md
- docs/mcp-tool-schema.md

Agents must consult these documents before implementing features.

---

# Ticket Source

Tickets are stored in:
docs/ticket-state.json

Each ticket has:

- id
- title
- status
- dependencies

Allowed statuses:
todo
in_progress
done
blocked

Agents must **never modify `docs/ticket-state.json`**.

The controller manages ticket updates.

---

# Implementation Rules

Agents implementing tickets must:

1. Follow the architecture described in `system-architecture.md`.
2. Respect module boundaries defined in the architecture docs.
3. Avoid introducing new dependencies unless necessary.
4. Write production-quality code.
5. Ensure the repository builds and tests pass.

Agents must **not commit changes**.

The controller commits changes once review and tests pass.

---

# Review Rules

Review agents must:

- analyze the git diff
- verify implementation matches architecture
- identify missing functionality
- detect regressions
- detect security or reliability issues

Reviewers must return JSON wrapped in markers:
AUTODEV_REVIEW_JSON_START
{ ... }
AUTODEV_REVIEW_JSON_END

The controller parses this JSON.

---

# Git Rules

Agents must **never run:**
git commit
git push
git reset


The controller handles git operations.

---

# Test Requirements

After implementation the controller runs:
npm test

If tests fail, the implementation agent will be asked to fix them.

Agents should ensure tests pass whenever possible.

---

# Code Quality Expectations

Agents should:

- follow existing project patterns
- maintain clear module boundaries
- prefer simple maintainable implementations
- avoid unnecessary complexity
- write readable production-grade code
