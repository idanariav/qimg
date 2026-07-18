# Tech Debt / Future Work

Running log of deferred refactors, follow-ups, and "do it properly later"
items surfaced during work sessions but intentionally **not** scheduled or
executed at the time. This is a reference backlog, not a roadmap — nothing
here should be picked up unless explicitly requested in a future session.

When adding an entry: say what it is, why it wasn't done now, and roughly
how big/risky it is. When an item is finally addressed, delete its entry
(git history keeps the record).

## Test coverage gaps

`parseArgs`/`buildFilters`/`parseDate` (`test/cli.test.ts`) and `collections.ts`
(`test/collections.test.ts`) now have coverage. Still untested: the CLI command
handlers in `src/cli/qimg.ts` (`cmdIndex`, `cmdEmbed`, `cmdCaption`, `cmdOcr`, etc.),
`src/exif.ts`, `src/embed.ts`, `src/caption.ts`, `src/ocr.ts`, `src/mcp/server.ts` —
these need model downloads or real image fixtures to exercise meaningfully, which is
why they were left out here.

