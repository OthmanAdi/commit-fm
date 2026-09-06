# Security

Installing Commit FM grants nobody access they did not already have, adds no
secret, opens no inbound endpoint, and spends no model tokens. The rest of
this document exists to make that sentence checkable, not just stated.

## The token

The render step authenticates with `GITHUB_TOKEN`, the credential GitHub
mints automatically for each workflow run and revokes automatically when the
run ends. There is nothing to generate in your account settings, nothing to
paste into a secrets page, and nothing sitting in the repository for someone
to find later. The workflow you copy into your profile repo asks for exactly
one permission:

```yaml
permissions:
  contents: write
```

Four lines, and they say the whole story: this workflow can commit to the
repository you put it in, and it can do nothing else. No reach into other
repositories, no reach into your account, no network call the tool itself
does not make to GitHub's own API.

## No server

Commit FM has no backend. The banner is a plain SVG file, committed into your
own repository and served by GitHub the same way every other file in that
repository is served. There is no service collecting usage data, no list of
installs anywhere, and no endpoint for anyone to probe, overload, or take
down to break your README.

## The agent lane adds no new permission

An agent can run `commit-fm say "<note>"` to put a short broadcast into
`commitfm.json`. That command touches exactly one local file: it never opens
a network connection, and it never runs git. If the agent already has write
access to the repository (which it needs anyway to be doing useful work
there), writing that one line gives it nothing it could not already do by
editing any other file in the same place. If it does not have that access,
running the command changes nothing on your actual profile, because nobody
commits or pushes the change on the agent's behalf.

Two things follow from that:

- Every broadcast an agent has ever written sits in `git log`, in plain text,
  for good. There is no private channel and no way to make a claim that
  leaves no trace.
- Turning the feature off means deleting `commitfm.json`, or just the
  `broadcast` key inside it. There is no account to close and no token to
  revoke, because none was ever created.

## Zero model calls in the render path

Nothing in Commit FM asks a language model to summarize, rewrite, or invent
anything. Derived mode is a scheduled GitHub Action making a couple of REST
calls and drawing an SVG from what comes back. Broadcast mode is whatever
already wrote the note into `commitfm.json`, at whatever cost that work was
already spending, and nothing more. The tool itself never opens a model
connection, so there is no extra spend and no hallucinated text to check for
downstream.

## Private repositories stay private

Three separate things all have to fail at once before a private repository
name could reach the banner:

1. Derived mode reads only `/users/{user}/events/public`. That endpoint has
   no private activity in it, so the default setup cannot surface a private
   repo name no matter what else is going on.
2. Private work can appear only as a number, using GitHub's own aggregate
   contribution count, which carries no repository name and is nonzero only
   if you already turned on "include private contributions" in your own
   profile settings. Commit FM has no way to switch that on for you.
3. Whatever survives both of the above still passes through your own
   `exclude` list in `commitfm.json`, so a repository can be kept out of the
   banner by name even when it is public.

All three guards would have to fail together for a private name to show up.

## The SVG cannot run anything

The renderer emits a fixed set of SVG elements and nothing outside it, by
construction rather than by review after the fact: no `<script>`, no
`<foreignObject>`, no external `href`, no remote font or image reference.
Repository descriptions and broadcast notes are written by someone other than
you, so every one of those strings is escaped, stripped of control and
invisible formatting characters, and length capped before it becomes part of
the image. The worst a hostile string can do is display as text. It cannot
execute, redirect, or reach another server.

## Reporting a vulnerability

If you find a way around anything described above, please do not open a
public issue for it. Use GitHub's private security advisory feature on this
repository instead (the Security tab, "Report a vulnerability"), so a fix can
go out before the problem is public knowledge. Include the input or
configuration that triggers it and, if you have one, the smallest example
that reproduces it.
