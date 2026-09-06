# Contributing

Thanks for looking at Commit FM. A few rules keep it small and keep it safe for a
stranger to install.

## Zero dependencies is a hard rule

This project ships no runtime dependencies and no devDependencies. That is not
a style preference: this is a tool people install into a GitHub Actions
workflow with write access to their own repository, and every dependency
added to that path is a supply chain risk taken on their behalf, not just
yours. A pull request that adds anything to `package.json`'s `dependencies` or
`devDependencies` will not be merged, no matter how small the package looks.

In practice this means:

- Tests use Node's built-in `node:test` and `node:assert/strict`, nothing else.
- Argument parsing uses `node:util`'s `parseArgs` or hand written code.
- Plain JavaScript with JSDoc types where a type helps. No TypeScript, no
  build step, no bundler. What you commit is what runs.

## Running tests

```
node --test test/
```

That is the whole command, on Node 20 or newer, with no install step first.

To regenerate the sample banners under `examples/`, run:

```
node scripts/render-examples.mjs
```

## Style modules must be pure

Every module under `src/styles/` has the shape `(state) => string`. No network
calls, no reading the clock, no randomness, nothing that could make the same
state render to two different outputs. The GitHub Action commits whatever the
renderer produces and skips that commit only when the new file is byte
identical to the old one. A style that is not deterministic turns a quiet week
into a commit on every scheduled run instead of zero.

Any change to a style module has to keep passing the existing tests,
including the hostile-input ones, and a new style needs the same coverage
added for it: safe output on ordinary state, and safe output when every string
field is adversarial.

## Prose in this repository

Pull request descriptions, issue text, commit messages, and documentation
files use no dash as a pause. Use a comma, a colon, parentheses, or rewrite
the sentence instead. Compound words such as "one-keystroke" or "well-tested"
keep their hyphen: that is a different character doing a different job. Code
blocks and command line flags are exempt.
