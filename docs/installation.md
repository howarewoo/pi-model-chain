# Installation and updates

How to install the extension, which hosts it is tested on, and how to update, pin or roll back a version.

## Install

Requires **Node 22.19+** and **Pi 1.6.0**, the tested host. Other Pi versions are not
established as compatible by these tests. Wildcard host peer dependencies follow Pi's
package format, not a compatibility promise.

Install from npm:

```sh
pi install npm:@howarewoo/pi-model-chain
```

You can also install from Git with
`pi install git:github.com/howarewoo/pi-model-chain`, or from a local checkout with
`pi install /absolute/path/to/pi-model-chain`. Use only one source: when switching
between npm, Git or a local checkout, remove the previously registered source first so
Pi does not load the extension twice.

Pi supplies the SDK dependencies; an operator installation does not need this
repository's development dependencies. Extensions execute with Pi's operating-system
permissions: review the source before installing.

## Updates and rollback

Let Pi finish its current turn before updating, then restart Pi or run `/reload`.
Routing state is stored per session branch and survives the restart. There is no
extension-owned auto-updater.

```sh
# Update an unpinned npm installation
pi update npm:@howarewoo/pi-model-chain

# Or update all installed extension packages
pi update --extensions
```

Plain `pi update` updates Pi itself, not installed extension packages. For a Git installation,
use `pi update git:github.com/howarewoo/pi-model-chain`, matching the source you registered.
An unpinned Git source tracks the repository's default branch, including unreleased commits.

For a reproducible npm installation or rollback, select an exact published version:

```sh
pi install npm:@howarewoo/pi-model-chain@0.1.0
```

For Git, select a published tag, for example
`pi install git:github.com/howarewoo/pi-model-chain@v0.1.0`.
Exact npm versions and Git tags stay pinned; updating does not advance them to the next release.
Install a different version explicitly to change the pin.

[CHANGELOG.md](../CHANGELOG.md) lists user-facing changes and migrations. Pi shows new package
changelog entries on the next fresh launch after a version increase. See the
[maintainer release guide](releases.md) for publishing and recovery.
