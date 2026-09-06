# Changelog

## Unreleased

The profile repository now excludes itself. The repository named after your account
renders your profile page rather than being a project, and because this tool commits its
own output into it, it would otherwise be the most recently pushed repository forever and
sit permanently in the now playing slot. The first live install did exactly that and
announced "Config files for my GitHub profile" as the current work. Pin it to opt out.

## 0.1.0

First release.

Seven skins: terminal, splitflap, dotmatrix, winamp, carradio, vumeter, vinyl. Each renders
from the same state, in a light and a dark variant, at 800 by 200.

Two modes. Derived reads your public push events and needs no setup. Broadcast lets an agent
write one line into `commitfm.json` and say what it is doing right now, and expires on its own
so a stale note cannot keep claiming you are working.

Zero runtime dependencies, by policy rather than by accident. Third party actions pinned by
commit SHA. Rendered SVG carries no active content by construction, and every render is
checked at the boundary before it is written.
