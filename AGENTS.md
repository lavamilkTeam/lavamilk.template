# Repository instructions

For every task that writes, modifies, fixes, refactors, tests, reviews, scaffolds, or designs code, invoke and follow `$code-boundary-standards` before making code changes.

See [docs/architecture.md](docs/architecture.md) for entry points, dependency rules, runtime exceptions and verification commands. Run `npm run check`; for routing, persistence or HTTP changes also run the relevant browser and MySQL integration tests. `npm run check:all` runs the full suite.
