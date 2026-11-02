---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.
---

# Test-Driven Development

> Adapted for Vela from Matt Pocock's `tdd` skill (MIT). The changes are listed in PROVENANCE.md.

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

When exploring the codebase, respect the ADRs in `architecture/decisions.md` for the area you're touching, and the test rules in `architecture/03-code-design.md` §2, so test names and interface vocabulary match the project's domain language.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification: "user can checkout with valid cart" tells you exactly what capability exists, and it survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at chosen seams.** Before writing any test, write down the seams under test, in the plan or the PR description, with a one-line note on what each catches and what it misses. You can't test everything, so choosing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case. The founder is not technical: choose the seams yourself, and ask only when a seam hides a product decision.

## Vela specifics

- Vitest, colocated `*.test.ts`, deterministic: fixed clocks, fake adapters, fake AI, PGlite for the database.
- Test names state behaviour ("sends no quiet notice when delivery failed").
- A new write that two connections could race needs a test in `packages/services/postgres-tests`, seen failing with the guard removed before it is trusted. That suite runs in CI (PostgreSQL 18), not in `pnpm check`.
- A bug fix starts with a test that reproduces the bug and fails for the right reason.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological**: the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth: a known-good literal, a worked example, the spec.
- **Horizontal slicing**: writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead: one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage (`/code-review` and `/simplify`), not the red → green implementation cycle.
- **Never delete work you did not write.** Another agent may share the checkout; a test written after the code is still worth keeping.
