# Changelog

## [Unreleased]

## [0.2.0]

Chains now work with Pi's default retry settings, so you no longer need to change
`settings.json` before using them. Requires Node 22.19+; tested host is Pi 1.6.0. No
configuration or saved-state migration is needed: existing `model-chain.json` files and
session state keep working.

### Features

- The `/chain` model picker has a Providers column. Pick a provider to see only its
  models; left/right arrows move between columns and up/down move within one. Narrow
  terminals show a one-line provider row instead. Tab no longer switches providers.
  (#20, d8c3bed36d43)
- The footer shows the active provider, model, chain name and effort, plus any retry or
  failover in progress. (#14, 4601b8f95352)

### Fixes

- The extension no longer refuses to start with Pi's default retry settings. Each model
  still gets one attempt and two retries before the chain moves on. If
  `retry.provider.maxRetries` is above `0`, you get a one-time warning, because those
  provider retries run before the chain can fail over. (#14, 4601b8f95352)
- Prompt cache warming keeps working in compacted sessions. The extension now only hooks
  into turns while a `chain/*` model is selected, so sessions on a single model are
  untouched. (#16, be4e71773a9a)
- The `/chain` model picker lists the same models as Pi's `/model` picker. When you have
  set a model scope, models and efforts outside it are hidden, and a model that has left
  the scope or lost its login can't be picked. (#19, d4a128ce6009)

### Other changes

- The README is now a short landing page; the full guides moved to `docs/`. (#22,
  4d897bb6ee9f)
- Development-only updates that don't change the installed package: removed the Pullfrog
  review workflow (#13, 547517f0373b) and bumped typebox to 1.4.7 (#8, 2d59923aa631),
  oxfmt to 0.79.0 (#9, caad51bb1a9e) and oxlint to 1.94.0 (#10, 8631e5246620).

## [0.1.0]

First release. Requires Node 22.19+; tested host is Pi 1.6.0. Host peer dependencies are
wildcards by Pi's package format, not a compatibility promise.

- Add standalone named `chain/<name>` virtual selections with explicit
  operator-owned provider/model/effort chains and native Pi authentication.
- Enforce two same-target retries across quota/transient mixtures, sticky backups,
  terminal stops and a manual-reset exhaustion latch.
- Persist routing/reset state per session branch; provide idle-only
  `/chain-reset` and `/chain-status` without model-facing reset tools.
- Preserve raw failed drafts, omit them from future model projection and cancel
  recovery backoff through public Pi APIs. No subagent dependency or shared policy.
- Validate deterministic SDK and installed-package behavior on Pi 1.6.0 with
  Node.js 22.19.0 and 24. No live provider test, npm publication or
  compatibility claim beyond that baseline.
