# Starknet Agentic Code Review Rules

## Architecture
- Monorepo: Cairo contracts (`contracts/`), TypeScript packages (`packages/`), agent skills (`skills/`), CLI commands (`commands/`), evals (`evals/`), docs, website.
- Uses pnpm workspaces. All packages must respect workspace boundaries.
- Cross-repo dependencies: starkclaw and SISNA. Changes to session-account or packages must declare cross-repo impact.

## Cairo Contracts
- All external functions must have explicit access control guards.
- No unchecked felt252 arithmetic; use bounds-checked operations.
- ERC-8004 compliance is mandatory for identity contracts.
- Session-account changes are wallet-grade security; require security rationale.
- No private key material in logs, errors, or serialized state.
- Flag any delegate call without target whitelist validation.
- Storage variables must have initialization guards.

## TypeScript Packages
- Strict typing required; no `any` types in public APIs.
- All public APIs must validate inputs at boundaries.
- No floating promises; all async operations must be awaited or explicitly handled.
- No side-effects in constructors or module scope.
- Semver compliance required; breaking changes need migration notes.

## Skills
- Each skill must export a valid interface with matching metadata.
- Skills must be deterministic with graceful error handling.
- No unscoped network calls or state stored without cleanup.
- Must include at least one test or example.

## Security
- No secrets or credentials in code; use environment variables.
- Workflows must pin action versions to full SHA, never mutable tags.
- Least-privilege permissions on all CI workflows.
- All security policy changes are critical and require thorough review.

## General
- Prefer correctness and production safety over style.
- Flag any `unwrap()` equivalent or panic-path in production code.
- PRs touching contracts and packages must verify API contract consistency.
