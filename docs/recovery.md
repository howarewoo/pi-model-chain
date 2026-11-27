# Recovery and safety boundaries

Which failures move a chain to its next target, how retries are counted, and what the extension does and does not guarantee.

- **Eligible failures:** Pi's public transient provider/transport classifier,
  interrupted connections/streams, and recognized quota/billing/credit-limit
  errors. Error text is provider-dependent; unrecognized failures stop instead
  of guessing. Authentication/permission failures, invalid requests, refusals,
  cancellation and tool failures do not trigger fallback.
- **Exact retry budget:** state tracks failures by physical target, not Pi's
  native retry counter. Each target gets one initial attempt plus two retries
  regardless of `retry.enabled` or `retry.maxRetries`. Before a native retry
  could exceed three attempts, the virtual router advances. Quota failures,
  disabled native retries and remaining-budget recovery use the public
  settlement boundary. This also gives a backup its full two retries when a
  native counter carries over from a primary. If `retry.provider.maxRetries` is
  set above `0`, the extension warns once and reports it in `/chain-status`
  without modifying your settings.
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

The `/chain`, `/chain-status` and `/chain-reset` commands have no model-facing tool
counterpart. Reset rejects while busy. In non-UI modes, status and reset print the same
readable summary as a custom message (with structured `details`); route decisions,
capability warnings and raw errors are available in session entries.
