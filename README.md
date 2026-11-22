# @howarewoo/pi-model-fallback — Pi extension for named model fallback chains

[![npm version](https://img.shields.io/npm/v/@howarewoo/pi-model-fallback)](https://www.npmjs.com/package/@howarewoo/pi-model-fallback)
[![npm downloads](https://img.shields.io/npm/dm/@howarewoo/pi-model-fallback)](https://www.npmjs.com/package/@howarewoo/pi-model-fallback)

Select a named fallback chain in the [Pi coding agent](https://pi.dev)'s `/model` picker.
Each physical target gets an initial attempt and **two retries** for eligible provider
failures, including quota/credit exhaustion. If all three fail, Pi tries the next explicitly
configured target. A working backup stays selected for later turns until you manually reset.

This is a standalone main-session extension: it neither imports nor reads the configuration
or state of a subagent extension. Physical model selections keep normal Pi behavior.

[Install](#installation) · [Quick start](#quick-start) · [Configuration](#configuration-reference) · [Safety](#recovery-and-safety-boundaries) · [Documentation](#documentation)

## Installation

Requires **Node 22.19+** and **Pi 1.6.0**, the tested host. Other Pi versions are not
established as compatible by these tests. Wildcard host peer dependencies follow Pi's
package format, not a compatibility promise.

Install from npm:

```sh
pi install npm:@howarewoo/pi-model-fallback
```

The first npm release is still pending. Until it is published, install from Git with
`pi install git:github.com/howarewoo/pi-model-fallback`, or from a local checkout with
`pi install /absolute/path/to/pi-model-fallback`. Use only one source: when switching
between npm, Git or a local checkout, remove the previously registered source first so
Pi does not load the extension twice.

Pi supplies the SDK dependencies; an operator installation does not need this
repository's development dependencies. Extensions execute with Pi's operating-system
permissions: review the source before installing.

## Quick start

1. Configure native provider authentication with Pi's `/login` or existing provider
   configuration. This extension does not provision accounts, copy credentials,
   discover new destinations, or read project-local fallback configuration.
2. Create **`~/.pi/agent/model-fallback.json`** (or `model-fallback.json` in the agent
   directory selected by `PI_CODING_AGENT_DIR`). Replace these illustrative IDs
   with exact physical model IDs from your Pi catalogue:

   ```json
   {
     "version": 1,
     "chains": {
       "work": [
         { "provider": "anthropic", "model": "claude-sonnet-4-5", "effort": "high" },
         { "provider": "openai", "model": "gpt-4.1", "effort": "off" }
       ]
     }
   }
   ```

   **Listing a provider authorizes sending the conversation to it.** Cross-provider
   routing is never inferred from your credentials or catalogue. Choose only
   destinations you permit to receive that data.

3. Merge the following prerequisite into your existing Pi `settings.json`; do not
   replace unrelated settings:

   ```json
   {
     "retry": {
       "enabled": true,
       "maxRetries": 2,
       "provider": { "maxRetries": 0 }
     }
   }
   ```

   Native agent retries and provider-level retries are different. The extension
   checks effective settings, including runtime retry toggles, before ordinary
   dispatch and after its backoff. It stops with a diagnostic instead of changing
   your settings. `baseDelayMs` and `maxAgentDelayMs` remain Pi's retry settings;
   defaults are 2-second exponential backoff and a 60-second cap.

4. Start Pi or use `/reload`, open `/model`, and select **`fallback/work`**. In
   print mode, use `pi --model fallback/work -p 'your request'`.
5. Use `/fallback-status` to see the active target, consecutive eligible failure
   count, skipped targets/reasons, exhaustion and setup diagnostics. If a backup
   takes over, subsequent successful turns continue using that backup.
6. When Pi is idle, run `/fallback-reset` to return **only the selected chain on
   the current branch** to its first available authorized target. Reset does not
   send a model request, clear conversation history or reset other sessions.

Configuration changes take effect on reload. If an existing chain changes, its
persisted fingerprint prevents silently reinterpreting an old index. Select that
chain and explicitly reset it after reviewing the new destinations.

## Configuration reference

| Field               | Contract                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | Required, exactly `1`.                                                                                                            |
| `chains`            | Nonempty object of named, nonempty, ordered target arrays.                                                                        |
| Chain name          | Starts with an ASCII letter/digit, followed by letters/digits, `_` or `-`. Appears as `fallback/<name>`.                          |
| `provider`, `model` | Required exact catalogue IDs. Whitespace and glob-pattern characters are rejected. No automatic discovery of backups.             |
| `effort`            | Required: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`; must be supported by that physical model without clamping. |

Unknown fields (including secrets), duplicate exact provider/model/effort targets,
virtual targets and unsupported efforts are errors. Missing catalogue entries and
absent configured authentication are availability skips, **not** new permissions.
The complete chain is checked against session model/effort scopes before dispatch,
even if an earlier target is missing. If you use `--models` or `enabledModels`,
include every chain target with its allowed effort; scoping only the virtual model
does not authorize its physical targets. A revoked scope stops recovery rather
than skipping to another provider.

## Recovery and safety boundaries

- **Eligible failures:** Pi's public transient provider/transport classifier,
  interrupted connections/streams, and recognized quota/billing/credit-limit
  errors. Error text is provider-dependent; unrecognized failures stop instead
  of guessing. Authentication/permission failures, invalid requests, refusals,
  cancellation and tool failures do not trigger fallback.
- **Exact retry budget:** state tracks failures by physical target, not Pi's
  native retry counter. Native transient retries remain enabled. Before a native
  retry could exceed three attempts, the virtual router advances. Quota and
  remaining-budget recovery use the public settlement boundary. This also gives
  a backup its full two retries when a native counter carries over from a primary.
- **Backoff and cancellation:** boundary recovery defers backoff to the next router
  invocation, where Pi provides a live abort signal. Escape/abort cancels that
  wait; it cannot dispatch another provider request or automatically resume it.
- **Stream/tool safety:** failed drafts remain in raw session history but supported
  `context_edit` entries omit them from future model projection. Incomplete calls
  in a failed draft do not execute; earlier completed tool/result pairs remain and
  their SDK invocations are not replayed. A model may independently request a
  similar action later: this is not an exactly-once external-side-effect guarantee.
- **Capabilities:** unsupported image targets are skipped rather than receiving
  fallback-generated placeholders. A warning records differing context/image
  capabilities. Pi still owns native image preparation and context compaction;
  the extension does not truncate messages to force a fallback to fit. Context
  overflow remains Pi's native recovery, not a fallback-eligible failure.
- **Persistence:** branch-local custom entries store target identity, a chain
  fingerprint, failure count, skips and the exhaustion latch. State survives
  reload, resume, compaction and tree navigation. Sessions and chains do not share
  a health cache. Selecting a physical model suspends this controller.
- **Exhaustion:** no wraparound or provider calls on later requests until manual
  reset. Status retains the final attempted target and failure count.
- **Direct requests:** compaction/summary and third-party direct registry calls use
  the active target read-only. They do not retry/advance the chain, initialize its
  state, or modify its counters. An unavailable active target stops a direct call.
- **Cost and attribution:** retries may incur charges. Native assistant messages
  retain physical provider/model/effort and known usage. Missing failed-attempt
  usage is unknown, not measured zero cost. Status never dumps prompts or keys;
  normal Pi transcript storage still contains the conversation and raw failures.

Status/reset commands have no model-facing tool counterpart. Reset rejects while
busy. In non-UI modes, status/reset responses are structured custom messages;
route decisions, capability warnings and raw errors are available in session
entries. No custom visual dashboard is required.

## Troubleshooting

| Symptom                                 | Check and recovery                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `fallback/…` entries or commands     | Create the agent-directory config, check JSON/version/field names, then `/reload`. No file means the extension registers nothing. Check Pi's extension-load errors. |
| Retry prerequisite diagnostic           | Set native retries to two, provider retries to zero and enable the retry toggle; the extension never makes these changes for you.                                   |
| Unauthorized scoped target              | Correct the explicit physical model/effort scopes; adding credentials alone does not authorize a destination.                                                       |
| Unsupported effort or virtual target    | Use exact supported physical selections. These errors are never availability skips.                                                                                 |
| Skipped targets / no available target   | Check catalogue IDs, native provider authentication and image support; then reset when appropriate. A runtime 401/403 is terminal, not an availability skip.        |
| Chain changed or exhausted              | Review `/fallback-status`; reset the selected idle branch explicitly. Reset does not test provider health.                                                          |
| Unexpected provider text stops recovery | Keep the raw error for diagnosis. Do not recategorize an auth/permission/request failure as transient merely to get another model call.                             |

## Updates and rollback

Let Pi finish its current turn before updating, then restart Pi or run `/reload`.
Routing state is stored per session branch and survives the restart. There is no
extension-owned auto-updater.

```sh
# Update an unpinned npm installation
pi update npm:@howarewoo/pi-model-fallback

# Or update all installed extension packages
pi update --extensions
```

Plain `pi update` updates Pi itself, not installed extension packages. For a Git installation,
use `pi update git:github.com/howarewoo/pi-model-fallback`, matching the source you registered.
An unpinned Git source tracks the repository's default branch, including unreleased commits.

For a reproducible npm installation or rollback, select an exact published version:

```sh
pi install npm:@howarewoo/pi-model-fallback@0.1.0
```

For Git, select a published tag, for example
`pi install git:github.com/howarewoo/pi-model-fallback@v0.1.0`.
Exact npm versions and Git tags stay pinned; updating does not advance them to the next release.
Install a different version explicitly to change the pin. These examples work once `0.1.0`
is actually published.

[CHANGELOG.md](CHANGELOG.md) lists user-facing changes and migrations. Pi shows new package
changelog entries on the next fresh launch after a version increase. See the
[maintainer release guide](docs/releases.md) for publishing and recovery.

## Documentation

- [Release guide](docs/releases.md): release preparation, owner setup, publication and recovery.
- [Changelog](CHANGELOG.md): user-facing changes and migrations.
- [Security policy](SECURITY.md): vulnerability reporting and trust boundaries.
- [Contribution rules](https://github.com/howarewoo/pi-model-fallback/blob/main/AGENTS.md): PR titles and changelog policy.

## Local development

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
`npm run format` to apply Oxfmt formatting. Formatting skips the generated lockfile and the
managed Pullfrog workflow.

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

## Coexistence with pi-subagents

This extension and [`@howarewoo/pi-subagents`](https://github.com/howarewoo/pi-subagents)
can be installed together, and neither changes the other's fallback-chain behavior:

- **Separate scopes.** This extension routes only the session it is loaded into, the main
  Pi session. Subagent children run in their own SDK sessions, which load no installed
  extensions and never route through virtual models. This extension therefore never
  retries, switches or records state for a child, and a child's failures never count
  against the parent chain's budget or position.
- **Separate configuration, state and commands.** This extension reads only
  `model-fallback.json`, stores only `model-fallback.*` session entries, registers only the
  `fallback/<chain>` virtual models and the `/fallback-status` and `/fallback-reset`
  commands, and registers no tools. Child profile chains come from pi-subagents'
  `delegation.json` and belong to pi-subagents. Neither extension uses global state or the
  other's event-bus channels, and this extension never calls `setModel`.
- **Separate resets.** `/fallback-reset` never changes a child's chain, and pi-subagents'
  `delegate_coordinate reset_fallback` never changes the parent chain. Neither sends a
  model request.

While the parent has `fallback/<chain>` selected, pi-subagents rejects a child that would
inherit the parent's model, because it does not route virtual parent models. Give that
profile its own `model` or `fallback` chain.

`test/coexistence.test.ts` runs in `npm test` and CI. It loads the real pi-subagents
extension, pinned as a test-only devDependency (the package itself has no dependency on
it), through Pi's public extension loader. It runs each extension alone and then both
together with the same controlled providers, and asserts that:

- The parent's A/A/A/B recovery is identical.
- The child's C/C/C/D profile-chain switches and its fallback snapshot are identical.
- The child transcript contains no `model-fallback` state.
- Each reset affects only its own chain.

To test a local pi-subagents checkout (with its dependencies installed) instead, run
`PI_SUBAGENTS_CHECKOUT=/absolute/path/to/pi-subagents npm run test:coexistence`. This
was verified against pi-subagents `main` at `13d8151`. Provider streams are controlled,
not paid calls.

## License

MIT. See [LICENSE](LICENSE).
