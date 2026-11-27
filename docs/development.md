# Local development

Running the checks and tests from a source checkout.

From a source checkout:

```sh
npm ci --ignore-scripts
npm run lint
npm run format:check
npm run typecheck
npm test
npm pack --dry-run
npm run test:package
npm run release:check
```

`npm run check` runs lint, formatting, typecheck and tests. Tests run with Node's native
`node --test` runner and type stripping; there is no build step. Oxlint checks correctness
rules and warnings fail the lint command. Run `npm run lint:fix` for safe lint fixes and
`npm run format` to apply Oxfmt formatting. Formatting skips the generated lockfile.

Dependencies are pinned to the authoritative registry's Pi 1.6.0 baseline. The SDK
suite uses scripted in-process providers and temporary agent/session directories,
not live models. It retains the original mixed quota→transient regression that
previously dispatched A/A/A/A/B; it now asserts A/A/A/B. Additional cases cover
backup-counter carryover through final exhaustion, success reset, terminal errors,
queued steering/follow-ups, stream/tool safety, scopes/auth/capabilities, cancellation,
branch reset/reload/compaction/resume, concurrent isolation and read-only direct
calls. The image-modality test disables native auto-resize to isolate routing.

`npm run test:package` packs the tarball (or tests one you pass), checks every entry
against a file allowlist, installs it cache-first (`--prefer-offline`) without host SDK
copies, and checks the manifest and packed README links. It then loads the package in the
pinned Pi 1.6.0. With a temporary chain configured, it checks the registered commands, runs
real Pi `install` and `/model` catalogue discovery, and observes A/A/A/B recovery through
the installed package in offline print mode. It prefers the npm cache but may fetch registry
metadata. It changes only temporary settings and cleans them up. The smaller
`test/recovery-probe.ts` is a public-API checkpoint fixture, not shipped runtime.
