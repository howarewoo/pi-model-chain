# Using model chains

The full setup walkthrough, the retry settings that matter, and how status and reset work. The [README](../README.md#quick-start) has the short version.

1. Configure native provider authentication with Pi's `/login` or existing provider
   configuration. This extension does not provision accounts, copy credentials,
   discover new destinations, or read project-local chain configuration.
2. Run **`/chain`**, press `^N`, name the chain and add steps from the model picker
   (see [Manage chains](chain-manager.md)). Or create
   **`~/.pi/agent/model-chain.json`** yourself (or `model-chain.json` in the agent
   directory selected by `PI_CODING_AGENT_DIR`), replacing these illustrative IDs with
   exact physical model IDs from your Pi catalogue:

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

3. Select **`chain/work`** in `/chain` or `/model` (after `/reload` if you edited the
   file by hand). In print mode, use `pi --model chain/work -p 'your request'`.
   No `settings.json` changes are required: chains work with Pi's default retry settings
   and any `retry.enabled` or `retry.maxRetries` configuration. `retry.baseDelayMs` and
   `retry.maxAgentDelayMs` control backoff timing (defaults are 2-second exponential
   backoff and a 60-second cap). Keep `retry.provider.maxRetries` at `0` (Pi's default)
   so provider-level retries do not run before chain failover; the extension warns if it
   is non-zero and never modifies your settings.
4. Use `/chain-status` to see each step marked active, failed over, skipped or
   exhausted, the retry budget used, and any diagnostics or warnings. In interactive
   mode, the footer status also tracks the active model live as
   `<provider>/<model> Chain-<name> <effort>` (with retry, step, exhausted or
   changed state when applicable) and clears when a physical model is selected.
   If a backup takes over, subsequent successful turns continue using that backup.
5. When Pi is idle, run `/chain-reset` to return **only the selected chain on
   the current branch** to its first available authorized target. Reset does not
   send a model request, clear conversation history or reset other sessions.

Hand edits to the config file take effect on reload; `/chain` saves take effect
immediately. If an existing chain changes, its persisted fingerprint prevents silently
reinterpreting an old index: the chain shows `changed · reset required` until you
reset it after reviewing the new destinations.
