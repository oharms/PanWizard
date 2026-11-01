# Seed: focus-batch

A small project under exclusive routing (`instructions.routing: exclusive`) with the guard
enforcing (`hooks.guard: enforce`), one focus batch of two scan items, and one passing `node --test` test, which
`focus open` and `focus close` measure. Exercises
`focus-cycle-registered`: a focus cycle opened by `focus open` is work in flight, so
the installed guard lets a source write through, and once `focus close` has closed it the
same write is denied (spec focus_phase_integration_featureai.md, D2).
