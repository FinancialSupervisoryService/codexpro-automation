# Oracle 0.18.0 Power picker compatibility

This separately versioned patch supports the September 2026 ChatGPT model list and five-position Power slider. It adds the browser-only `gpt-6-pro` target, selects Latest and maximum Power, and requires both the menu and closed composer to visibly name `6 Pro`. A bare Pro label, GPT-5.6 Pro, or any later model is rejected. The explicit GPT-5.6 Sol model and very-high Power remain independent.

Run `node apply-power-picker.mjs <new-oracle-package-root>` only while preparing a new immutable Oracle 0.18.0 runtime. The manifest checks exact upstream bytes before any write and records exact output hashes. Already-patched bytes are idempotent; unknown bytes and symlink/hardlink targets are rejected. Existing browser profiles and session state are never accessed. This patch does not update the separate 0.16.1 desktop compatibility deployment.

Validation: `node --test tests/oracle-power-picker.test.mjs` from the repository root. Browser model-selection evidence must still be checked during live acceptance; fixture tests are not proof of a submitted GPT-6 Pro run.
