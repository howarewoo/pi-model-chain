# Release guide

Prepare deliberate releases of `@howarewoo/pi-model-fallback` from
`howarewoo/pi-model-fallback`. These maintainer procedures are not authorization to
publish. Ordinary main pushes do not publish. Local checks do not establish GitHub
protection, npm ownership, OIDC provenance or a consumer release.

## One-time owner setup

`@howarewoo/pi-model-fallback` has **not been published to npm yet**. A repository owner and
an npm package owner must complete these steps before the first release. They are not
performed by this repository's files, CI or local scripts.

1. **Confirm npm scope rights.** Your npm account must be able to publish
   `@howarewoo/pi-model-fallback` in the `@howarewoo` scope, with two-factor authentication.
2. **Protect GitHub.** Independently verify the external controls:
   - Protect `main`: PR required, zero approving reviews, dismiss stale approvals, resolve
     conversations, enforce for admins, and require the GitHub Actions checks
     `check (22.19.0)` and `check (24)` (app ID `15368`, not strict/up-to-date). Establish
     a real passing run of each check first. PR-title validation is not an additional
     required check.
   - Restrict creation, update and deletion of `refs/tags/v*` with an active tag ruleset;
     only `howarewoo` (User `25625745`) bypasses, in `always` mode.
   - Environment `npm` must require `howarewoo` approval, allow self-review and admin
     bypass, and allow deployments only from tags matching `v*`, not branches. The YAML
     environment declaration alone does not create approval protection: GitHub can
     create an unprotected environment when a job references a new name.
   - Preserve read-only default Actions permissions and disabled PR-review approval.

   Recheck actual settings before every release rather than treating repository files or
   a prior setup report as proof that controls remain enabled.

3. **Bootstrap the package with the first manual publish** described in
   [First npm publish only](#first-npm-publish-only). A trusted publisher is normally
   configured from an existing package's settings, so do not assume the first
   tag-triggered run can create a new npm package.
4. **Configure npm Trusted Publishing.** In **`@howarewoo/pi-model-fallback` → Settings →
   Trusted publishing**, add GitHub Actions with:

   | Field                | Value               |
   | -------------------- | ------------------- |
   | Organization or user | `howarewoo`         |
   | Repository           | `pi-model-fallback` |
   | Workflow filename    | `release.yml`       |
   | Environment name     | `npm`               |

   Permit direct `npm publish` if npm presents an allowed-actions selector. The workflow
   uses GitHub-hosted runners and `id-token: write`; no `NPM_TOKEN` secret is needed and
   no token fallback is provided. Use npm 11.5.1 or newer for OIDC publishing (the
   release runner uses Node 24).

5. Follow npm's current validation/expiry rules when creating the trusted publisher; create
   it near the next release. After successful OIDC publication, restrict traditional
   token-based publishing and revoke unused automation tokens. Public GitHub/OIDC
   publication supplies npm provenance automatically.

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for
current account requirements and troubleshooting. Do not use `npm whoami` to test OIDC: it
does not validate trusted publishing permissions. The manual bootstrap is not workflow
OIDC/provenance proof.

## Contributor titles and compatibility

Use `type(optional-scope)!: description` for PR titles. Accepted types are `feat`,
`fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`, `style`.
For example:

```sh
PR_TITLE='fix: preserve fallback status' npm run pr-title:check
```

Ordinary PRs need not edit the changelog. Describe user-facing changes and migration
in the PR body. Maintainers should confirm the final squash commit's conventional
title and meaningful body; the title workflow cannot guarantee final merge metadata.
Retain `!` and `BREAKING CHANGE:` (or `BREAKING-CHANGE:`) guidance. The generator uses
first-parent history, so a merge commit replaces its branch commits in the notes.

The maintainer chooses the next stable version and reviews compatibility and migration
guidance before release. Stable versions only publish to npm `latest`; prereleases
need a separately agreed channel policy.

Node >=22.19.0 and Pi **1.6.0** are the tested baseline. CI runs every check on Node
22.19.0 and Node 24 with pinned Pi 1.6.0 development packages, not an implied matrix of
all Pi versions. Wildcard host peers are not proof of compatibility with other Pi
versions. Keep the root extension entrypoint `./index.ts`, which re-exports `src/index.ts`.
Do not add a runtime dependency on pi-subagents. `@howarewoo/pi-subagents` is a test-only
devDependency: `test/coexistence.test.ts` runs in `npm test` and CI against it and asserts
that both extensions' fallback chains stay independent. `PI_SUBAGENTS_CHECKOUT` selects a
local checkout instead. Keep that devDependency pinned, and review the coexistence result
when it is bumped.

## Prepare and validate notes

The initial `0.1.0` notes are curated in `CHANGELOG.md`; they do not claim a publication.
No previous target release tag is established. Do not invent one for this release.

For later releases, fetch full history and tags and start from reviewed main on a
release-preparation branch. For example, **only after a real `v0.1.0` exists as an
ancestor**, preparing `0.1.1` would use:

```sh
npm version 0.1.1 --no-git-tag-version
npm run changelog:generate -- --from v0.1.0 --dry-run
npm run changelog:generate -- --from v0.1.0
```

The preview writes nothing. Generation inserts a section without changing historical
bytes. Nonempty `## [Unreleased]` notes are copied into **Previously curated notes**;
review duplicates and clear/move Unreleased only deliberately in the release PR.
Features, fixes/performance and other changes retain oldest-first ordering within each
group. Nonconventional subjects remain with warnings. Breaking markers and footers
are carried into **Breaking changes**, but migration guidance still needs human review.

Missing/nonancestor tags, shallow history, empty ranges, unstable versions and existing
target headings fail before writing. Fetch history or fix inputs; never move tags or
delete reviewed notes just to regenerate. Review compatibility and README examples.

Run from the repository root on Node 22.19.0 or newer:

```sh
npm ci --ignore-scripts
npm run check
npm run release:check
npm run test:package
```

`check` runs lint, formatting, typechecking and deterministic config/SDK/release/helper
tests. `release:check` checks stable tag/manifest/lockfile agreement (name, version, engines and
dependency fields), the MIT license field, public publish access and one exact nonempty
version heading. `test:package` packs and installs into a disposable
clean consumer without bundled host peers or install scripts, loads with real Pi 1.6.0,
and exercises controlled fallback recovery. No live provider calls are made.

To verify an already-packed artifact without repacking:

```sh
release_dir="$(mktemp -d)"
npm pack --pack-destination "$release_dir"
npm run test:package -- "$release_dir/howarewoo-pi-model-fallback-0.1.0.tgz"
```

Replace the version for subsequent releases. Retain reviewed bytes until verification
is complete. Submit version/notes as a reviewed release PR; local commands do not merge,
tag or publish anything.

## First npm publish only

One-time bootstrap for `0.1.0`, the first release. Do not repeat it for later versions;
use the tag-triggered workflow after verifying the owner setup above. Run it only with
explicit release authorization.

After the release commit is merged, check out its exact clean commit and run the local
gates above. Use an npm account with publishing rights and two-factor authentication:

```sh
npm login
release_dir="$(mktemp -d)"
npm pack --pack-destination "$release_dir"
npm run test:package -- "$release_dir/howarewoo-pi-model-fallback-0.1.0.tgz"
npm publish "$release_dir/howarewoo-pi-model-fallback-0.1.0.tgz" --access public --ignore-scripts
```

Inspect the result with `npm view @howarewoo/pi-model-fallback@0.1.0 version dist.integrity`.
Keep the tarball until verified, then remove the temporary directory. This interactive
bootstrap is separate from GitHub OIDC and does not claim GitHub provenance. Configure the
trusted publisher before pushing the release tag. The workflow accepts an already-published
version only when its registry SHA-512 integrity matches the newly verified tarball byte for
byte. A later `v0.1.0` tag run continues only if its rebuilt tarball is byte-identical;
otherwise it stops without republishing, and the next version uses the workflow.

## Separately authorized tag and publication

Only after the owner setup and explicit release authorization, create an immutable
`vX.Y.Z` tag on the exact merged release commit. Never move a release tag. The workflow
accepts `v*` tag pushes or manual dispatch on an existing release tag; branch dispatch
cannot publish. It serializes releases without canceling active publication.

1. **validation** (`contents: read`, no OIDC/environment, 30 minutes) verifies main
   ancestry and release metadata, installs with scripts disabled, runs checks, packs
   once and tests that exact tarball. It uploads package/metadata and separate notes as
   immutable artifacts retained seven days, with a SHA-512 output.
2. **publish** (protected `npm` environment, `contents: read`, `id-token: write`,
   10 minutes) downloads the current run's selected package artifact by ID. The helper
   checked out from the release commit—not executable artifact code—requires regular
   files and validates fixed package name, stable version, tag, commit, tarball path and
   SHA-512 against validation outputs **before registry access**. No dependency install,
   archive extraction, tests or repack occurs here. OIDC publication is public, with
   lifecycle scripts disabled; there is no stored npm token.
3. **github-release** (after npm success, `contents: write`, no OIDC, 10 minutes)
   downloads selected notes only and creates a missing GitHub release. An existing
   release is left unchanged.

Review the commit and approval evidence: job separation does not prove bytes from a
compromised validation job are trustworthy. Verify npm version/integrity, OIDC provenance
and the matching GitHub release after publication. Then test a clean Pi user installation,
`/fallback-status`, and the update path before announcing a consumer release. Local smoke
tests are not proof that publication or that installed-user walkthrough occurred.

## Recover failures

- **Before npm publication:** resolve the failure or owner setup step, then rerun the
  same immutable tag. A code fix needs a new release commit/version, not a moved tag.
- **npm succeeded, GitHub release failed:** rerun failed jobs or dispatch the same existing
  tag. The helper skips republishing only for identical registry SHA-512. Registry errors
  or different bytes fail closed. Rebuilds on the same commit are not assumed byte-identical;
  never bypass the digest gate. Existing GitHub releases remain unchanged.
- **Expired artifacts:** rerun validation and downstream jobs on that tag; never substitute
  another run's artifacts.
- **Bad published contents:** release a corrected new version and consider an explanatory
  deprecation. Do not overwrite a version or unpublish as normal rollback.
- **Consumer rollback:** stop active work, install an actually published known-good version
  (for example `pi install npm:@howarewoo/pi-model-fallback@<known-good-version>`), then
  restart Pi. Pinning code does not undo configuration/session changes; follow the release's
  migration instructions and preserve user data.
