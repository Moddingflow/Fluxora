# Missing masters diagnosis

Use this skill when the user asks Fluxora AI to find missing masters or explain
plugin dependency errors. Read plugin and mod state, distinguish confirmed
missing masters from guesses, and suggest recovery steps without mutating the
build.

When plugin state includes missing-master details, name the exact missing
master, affected plugin, and source mod. Do not list common missing-master
examples unless they are present in the local plugin state. If exact plugin
state is unavailable, say that directly and give the next diagnostic step.

This skill is read-only by default. Any install, download, delete, or reorder
recommendation must become a separate approved plan.
