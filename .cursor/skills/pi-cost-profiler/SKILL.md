---
name: pi-cost-profiler
description: Maintain Pi Cost Profiler, its local cost ledger, pricing estimates, scoped budgets and dashboard.
---

# Pi Cost Profiler

Use this specialization for work in the Pi Cost Profiler repository. The shared workspace catalog supplies general Harness procedures; this file contains product-specific context.

## Product role

- Account for model/provider usage and estimated or reconciled cost using local ledger records and pricing snapshots.
- The extension is not a provider gateway and does not replace Pi authentication or network controls.
- Unknown prices must be reported as unknown, never treated as free.
- Budgets apply to dispatches this extension can observe before they start; do not claim that it governs calls from other extensions or work already in progress.

## User entry points

- In a Pi TUI, /cost without arguments opens the dashboard; keep direct command forms available in clients without a custom screen.
- Dashboard edits are drafts. Ctrl+S validates and saves (the panel stays open); Esc in a field goes back without applying it, and at the root Esc warns about a draft and a second Esc discards it.
- Preserve the documented commands for current spend, task/project reports, comparison, budget, export, reconcile, local model pricing, enable/disable and help.
- Reconcile imports a user-selected local JSON file only after confirmation. Export is a report, not an invoice.

## Data and privacy

- Ledger files and project configuration are local. Project configuration is trusted-project gated; user-wide configuration is under the Pi Suite profile.
- Do not inspect, copy or mutate user-global config, cost ledgers, billing files or usage records during ordinary repository work.
- Cost exports may reveal provider, model, usage and project details. Do not log real ledgers or attach exports without explicit user selection and review.
- Pi provider traffic is separate from this extension's local accounting.
- Test only with synthetic, isolated ledger/config files and cleanup.

## Safety and verification

- Keep the selected project/session/task scope explicit. Preserve globally locked policy precedence.
- The extension does not assert a design-system dependency. Do not infer adoption from shared Harness skills or license notices.
- Follow the existing save, cancel, error and operation-lifecycle contracts for Pi panels.
- Treat provider access, live billing reconciliation, Pi installation, publication and remote service calls as separately authorized operations.
- Verify only the focused documentation/context paths unless code behavior changes.
