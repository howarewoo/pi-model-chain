# Configuration reference

The fields of `model-chain.json` and how session model scopes apply to chain targets.

| Field               | Contract                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | Required, exactly `1`.                                                                                                            |
| `chains`            | Nonempty object of named, nonempty, ordered target arrays.                                                                        |
| Chain name          | Starts with an ASCII letter/digit, followed by letters/digits, `_` or `-`. Appears as `chain/<name>`.                             |
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
