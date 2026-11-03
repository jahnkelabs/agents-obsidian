# agents-obsidian

`inbox` lets an agent session put a question to you as a markdown file, wait for your answer, and read it back. The Obsidian plugin and the CLI share one item format, defined in `src/schema.ts`.

An item lives in `<docs>/maps/<map>/inbox/<id>.md` when it belongs to a map, and in `<docs>/inbox/<id>.md` otherwise. `<docs>` is `~/Code/agent-docs`, or `INBOX_DOCS_DIR` when set. The first answer wins: a second answer exits 3 and prints the first.

```sh
npm install && npm run build

id=$(printf '**Deciding — Frontmatter library**\n' |
  node dist/inbox.js ask --kind decide --from "plan · s1" --option yaml --option gray-matter --recommended yaml)

node dist/inbox.js wait "$id" --timeout 3600
# {"answer":"yaml","note":null,"answered_by":"chat"}
```

Answer from a terminal with `node dist/inbox.js answer "$id" --option yaml --note "keep it simple"`.

Exit codes: 0 success, 2 error, 3 another answer already won, 4 `wait` timed out.
