# Coexistence with pi-subagents

How this extension and pi-subagents behave when both are installed.

This extension and [`@howarewoo/pi-subagents`](https://github.com/howarewoo/pi-subagents)
can be installed together, and neither changes the other's chain behavior:

- **Separate scopes.** This extension routes only the session it is loaded into, the main
  Pi session. Subagent children run in their own SDK sessions, which load no installed
  extensions and never route through virtual models. This extension therefore never
  retries, switches or records state for a child, and a child's failures never count
  against the parent chain's budget or position.
- **Separate configuration, state and commands.** This extension reads only
  `model-chain.json`, stores only `model-chain.*` session entries, registers only the
  `chain/<name>` virtual models and the `/chain`, `/chain-status` and `/chain-reset`
  commands, and registers no tools. Child profile chains come from pi-subagents'
  `delegation.json` and belong to pi-subagents. Neither extension uses global state or the
  other's event-bus channels. This extension never switches models while routing; it calls
  `setModel` only on the main session, and only when you select a chain in `/chain`.
- **Separate resets.** `/chain-reset` never changes a child's chain, and pi-subagents'
  `delegate_coordinate reset_fallback` never changes the parent chain. Neither sends a
  model request.

While the parent has `chain/<name>` selected, pi-subagents rejects a child that would
inherit the parent's model, because it does not route virtual parent models. Give that
profile its own `model` or `fallback` chain.

`test/coexistence.test.ts` runs in `npm test` and CI. It loads the real pi-subagents
extension, pinned as a test-only devDependency (the package itself has no dependency on
it), through Pi's public extension loader. It runs each extension alone and then both
together with the same controlled providers, and asserts that:

- The parent's A/A/A/B recovery is identical.
- The child's C/C/C/D profile-chain switches and its fallback snapshot are identical.
- The child transcript contains no `model-chain` state.
- Each reset affects only its own chain.

To test a local pi-subagents checkout (with its dependencies installed) instead, run
`PI_SUBAGENTS_CHECKOUT=/absolute/path/to/pi-subagents npm run test:coexistence`. This
was verified against pi-subagents `main` at `13d8151`. Provider streams are controlled,
not paid calls.
