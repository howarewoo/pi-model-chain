# Changelog

## [Unreleased]

## [0.1.0]

First release. Requires Node 22.19+; tested host is Pi 1.6.0. Host peer dependencies are
wildcards by Pi's package format, not a compatibility promise.

- Add standalone named `fallback/<chain>` virtual selections with explicit
  operator-owned provider/model/effort chains and native Pi authentication.
- Enforce two same-target retries across quota/transient mixtures, sticky backups,
  terminal stops and a manual-reset exhaustion latch.
- Persist routing/reset state per session branch; provide idle-only
  `/fallback-reset` and `/fallback-status` without model-facing reset tools.
- Preserve raw failed drafts, omit them from future model projection and cancel
  recovery backoff through public Pi APIs. No subagent dependency or shared policy.
- Validate deterministic SDK and installed-package behavior on Pi 1.6.0 with
  Node.js 22.19.0 and 24. No live provider test, npm publication or
  compatibility claim beyond that baseline.
