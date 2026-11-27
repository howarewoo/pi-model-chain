# Troubleshooting

Common symptoms and what to check.

| Symptom                                 | Check and recovery                                                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `chain/…` entries or commands        | Create a chain in `/chain`, or check the hand-edited config's JSON/version/field names, then `/reload`. An invalid config stops the extension from loading; check Pi's extension-load errors. |
| Provider retry warning                  | Set `retry.provider.maxRetries` to `0` (Pi's default) if you want exact per-target retry budgets; the extension never modifies your settings.                                                 |
| Unauthorized scoped target              | Correct the explicit physical model/effort scopes; adding credentials alone does not authorize a destination.                                                                                 |
| Unsupported effort or virtual target    | Use exact supported physical selections. These errors are never availability skips.                                                                                                           |
| Skipped targets / no available target   | Check catalogue IDs, native provider authentication and image support; then reset when appropriate. A runtime 401/403 is terminal, not an availability skip.                                  |
| Chain changed or exhausted              | Review `/chain-status`; reset the selected idle branch explicitly. Reset does not test provider health.                                                                                       |
| Unexpected provider text stops recovery | Keep the raw error for diagnosis. Do not recategorize an auth/permission/request failure as transient merely to get another model call.                                                       |
