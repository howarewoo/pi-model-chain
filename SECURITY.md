# Security policy

## Reporting a vulnerability

Please report suspected security vulnerabilities privately through
[GitHub's vulnerability reporting form](https://github.com/howarewoo/pi-model-chain/security/advisories/new).
Do not disclose vulnerabilities, credentials, or sensitive reproduction details in public
issues or pull requests.

Include the affected version, reproduction steps, and potential impact. Remove API keys,
tokens, personal data, and private repository content from logs and examples.

## Supported versions

Security fixes target the latest published release. Please upgrade to the latest release
before reporting a problem, when possible.

## Trust boundaries

This extension runs inside Pi with Pi's operating-system permissions and routes the main
session's model requests. Review the source before installing it, and only run it with
configuration you control. It reads `model-chain.json` from the Pi agent directory only;
project files cannot add or reorder destinations. Do not put credentials in that file:
unknown fields, including secret-like fields, are rejected, and authentication stays with
Pi's native provider configuration.

## Chain destinations

Listing a provider in a chain explicitly authorizes sending the conversation, including
tool results, to that provider. Cross-provider routing is never inferred from credentials
or the model catalogue, and session model/effort scopes are checked for every chain target
before dispatch. Review every destination for the sensitivity of your work.

Retries and failed requests can incur provider charges. Failed streamed drafts stay in raw
session history for audit, while context edits omit them from future model context.
Completed tool results are not replayed, but no exactly-once external-effect guarantee is
made. Session files contain the conversation, raw provider errors and routing state; protect
them like other Pi session storage. `/chain-status` never prints prompts or keys, and
`/chain-reset` is an idle operator command with no model-facing tool counterpart.
