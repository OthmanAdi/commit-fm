/**
 * sanitize.mjs
 *
 * The single choke point where attacker-influenced text becomes SVG text content.
 * GitHub repo descriptions and agent-written broadcast notes are both untrusted:
 * a repo owner controls the former, and anyone able to write `commitfm.json` (a
 * human, or an agent acting unsupervised) controls the latter. That text ends up
 * inside an SVG that GitHub's own image proxy will fetch and render on someone's
 * profile README, so every function here exists to make one class of attack
 * structurally impossible rather than merely filtered in the common case:
 *
 *  - Markup injection (script / foreignObject / image / external href) is
 *    handled by strict, idempotent XML escaping in sanitizeText, and
 *    independently re-checked at the render boundary by
 *    assertNoActiveContent as defense in depth against a style module that
 *    builds markup incorrectly.
 *  - Trojan Source (bidi override or zero-width steganography: text that
 *    renders in a different order, or hides a different payload, than the
 *    bytes on disk show) is stripped unconditionally. A commit banner never
 *    has a legitimate reason to reorder or hide its own text.
 *  - XML entity expansion and DOCTYPE/CDATA smuggling are made moot by the
 *    same escaping: a literal "<" never survives into the output, so
 *    "<!ENTITY", "<!DOCTYPE" and "<![CDATA[" can never open a construct an
 *    XML parser would honor.
 *  - Grapheme-splitting truncation bugs are avoided by measuring length the
 *    way a human reading the banner would, not by UTF-16 code unit count.
 *
 * A note on how this file is written: every non-ASCII or control codepoint
 * below is built from a plain hex number via String.fromCharCode /
 * String.fromCodePoint rather than typed as a literal character or a
 * "\u" escape. That is a deliberate, verifiable-by-inspection choice, not
 * style preference: the exact codepoints being stripped are security
 * relevant, so they are spelled out as numbers anyone can look up, and the
 * source file itself stays plain ASCII with nothing invisible hiding in it.
 *
 * Zero runtime dependencies, by design: this module ships inside a GitHub
 * Action with write access to a stranger's repository, so every import would
 * be a supply chain risk taken on their behalf without their consent.
 */

/**
 * Builds a string of the code points from `start` to `end` inclusive, all of
 * which are within the Basic Multilingual Plane for every call site in this
 * file, so plain `String.fromCharCode` (one code unit per code point) is
 * exact and no surrogate-pair handling is needed.
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
function bmpRange(start, end) {
  let out = '';
  for (let codePoint = start; codePoint <= end; codePoint += 1) {
    out += String.fromCharCode(codePoint);
  }
  return out;
}

/** U+0000 NULL. Rejected outright by sanitizeText rather than stripped. */
const NULL_BYTE = String.fromCharCode(0x0000);

/** U+2026 HORIZONTAL ELLIPSIS, the single truncation marker. */
const ELLIPSIS = String.fromCharCode(0x2026);

/**
 * Bidirectional format controls (0x202A-0x202E: LRE, RLE, PDF, LRO, RLO) and
 * bidirectional isolates (0x2066-0x2069: LRI, RLI, FSI, PDI), plus the four
 * zero-width characters (0x200B-0x200D: ZWSP, ZWNJ, ZWJ; and 0xFEFF: BOM /
 * zero width no-break space). This is the "Trojan Source" codepoint set:
 * text that a human reviewing a diff, or a viewer reading a rendered banner,
 * sees in one order while the underlying bytes -- and anything that indexes,
 * greps, or screen-reads them -- sees a different order, or an extra payload
 * hidden between visible characters. A commit banner has no legitimate use
 * for reordering or hiding its own text, so these are removed
 * unconditionally rather than escaped: escaping would leave them present as
 * literal codepoints in the SVG's text content, and a downstream consumer
 * that reads the text (rather than rendering it visually) would still see
 * the reordered or hidden payload even though the SVG itself rendered fine.
 */
const BIDI_AND_ZERO_WIDTH = new RegExp(
  '[' + bmpRange(0x202a, 0x202e) + bmpRange(0x2066, 0x2069) + bmpRange(0x200b, 0x200d) + String.fromCharCode(0xfeff) + ']',
  'g'
);

/**
 * C0 controls (0x00-0x1F) and C1 controls (0x7F-0x9F). The null byte is
 * excepted in practice because sanitizeText rejects it outright before this
 * ever runs. Tab, newline and carriage return are handled separately (folded
 * to a single space, not removed) because they occur in legitimate free text
 * such as a multi-line repo description and deserve a readable fallback; the
 * rest of the C0/C1 range has no legitimate representation inside a
 * single-line SVG `<text>` element and is simply discarded.
 */
const OTHER_CONTROL_CHARS = new RegExp('[' + bmpRange(0x00, 0x1f) + bmpRange(0x7f, 0x9f) + ']', 'g');

/**
 * Matches either a complete, already-valid XML character reference (named:
 * amp/lt/gt/quot/apos, or numeric: decimal/hex) OR one bare special
 * character, in a single alternation. This is what makes escaping idempotent
 * in one pass: when the first branch matches, the substring is already a
 * well-formed reference and is left untouched; when only the second branch
 * matches, the lone character gets escaped. A naive
 * `.replace(/&/g,'&amp;').replace(/</g,'&lt;')` chain would re-escape the "&"
 * inside an already-correct "&amp;", corrupting it into "&amp;amp;" -- and
 * because this tool re-renders the same repo state on a cron, that bug would
 * compound visibly, once per run, for as long as the description stayed the
 * same.
 */
const XML_SPECIAL_OR_ENTITY = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);|[&<>"']/g;

const XML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/**
 * Escapes the five XML special characters exactly once. Must run LAST in the
 * sanitize pipeline, after truncation: escaping first would let a run of
 * plain "&" characters balloon into "&amp;" (five times the code units)
 * before the grapheme cap is applied, silently shrinking how much real
 * content survives truncation and decoupling the advertised `maxGraphemes`
 * from what a viewer actually sees.
 * @param {string} str already-cleaned, already-truncated text
 * @returns {string} text with every unescaped `&`, `<`, `>`, `"`, `'` turned
 *   into its named entity, and every already-valid entity left byte-for-byte
 *   alone
 */
function escapeXmlOnce(str) {
  return str.replace(XML_SPECIAL_OR_ENTITY, (match) => {
    if (match.length > 1) {
      // A multi-character match is already a well-formed entity reference
      // (e.g. "&amp;", "&#39;", "&#x27;") -- pass it through unchanged so it
      // is never escaped a second time.
      return match;
    }
    return XML_ESCAPE_MAP[match];
  });
}

/**
 * Splits a string into grapheme clusters, preferring `Intl.Segmenter`
 * because it is the only correct way to count "characters" the way a human
 * would: an emoji flag (two regional-indicator code points), a ZWJ emoji
 * sequence, or a base letter plus combining accents must each count as one
 * unit, or a length cap can slice a surrogate pair or a combining mark in
 * half and hand the SVG renderer a dangling, malformed code unit.
 *
 * Fallback (documented, as required when `Intl.Segmenter` is unavailable in
 * the runtime): `Array.from(str)`, which iterates by Unicode code point and
 * therefore still respects surrogate pairs -- it cannot split an astral
 * emoji or a flag in half the way `String.prototype.slice` can. What it does
 * NOT do is merge a base character with trailing combining marks into one
 * unit, so under the fallback a base letter plus a combining accent counts
 * as two units instead of one. That is a strictly smaller defect than
 * code-unit slicing: the fallback can only ever cut *between* whole code
 * points, never inside one, so the worst case is a slightly-off count, never
 * a corrupted character.
 * @param {string} str
 * @returns {string[]} the grapheme clusters (or, under the fallback, the
 *   code points) of `str`, in order
 */
function toGraphemes(str) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(str), (entry) => entry.segment);
  }
  return Array.from(str);
}

/**
 * Sanitizes free text -- a GitHub repo description, an agent's broadcast
 * note -- for safe embedding as SVG text content. This is the only function
 * in the codebase that untrusted text is allowed to pass through before it
 * reaches a style module; every style module trusts that any string flowing
 * through it already came from here (see the `State`/`Repo` typedefs in
 * BUILD-SPEC.md).
 *
 * The steps run in a deliberate order, not the order the requirements happen
 * to be numbered in:
 *   1. reject a null byte or a non-string outright, before touching the
 *      content -- you cannot safely clean a value whose very shape indicates
 *      something upstream already went wrong (a truncated buffer, a
 *      decoding bug, or a deliberate probe);
 *   2. strip bidi and zero-width Trojan Source characters;
 *   3. fold control characters to spaces or remove them, then collapse
 *      whitespace and trim;
 *   4. truncate by grapheme cluster;
 *   5. XML-escape, last, so escaping can never distort the grapheme count
 *      the cap was measured against, and so truncated content can never
 *      accidentally complete a multi-character entity it was cut out of.
 *
 * @param {unknown} input the raw value, typically `repo.description` or
 *   `broadcast.note`. Both are attacker-influenced: a repo owner controls
 *   the former; anyone who can write `commitfm.json` controls the latter.
 * @param {{ maxGraphemes?: number }} [options]
 * @param {number} [options.maxGraphemes=120] maximum number of grapheme
 *   clusters in the returned string, the truncation ellipsis included.
 * @returns {string} text safe to place inside an SVG `<text>` node: no
 *   unescaped XML special character, no bidi or zero-width control, no
 *   stray control character, and a length bounded by human-perceived
 *   characters rather than UTF-16 code units. Returns `""` for `null` or
 *   `undefined` input.
 * @throws {TypeError} if `input` is neither a string nor `null`/`undefined`,
 *   or if it contains a null byte (U+0000). A null byte is rejected rather
 *   than stripped because its presence means the input is not well-formed
 *   text, and silently cleaning it would hide that signal instead of
 *   surfacing the upstream bug.
 */
export function sanitizeText(input, { maxGraphemes = 120 } = {}) {
  if (input === null || input === undefined) {
    return '';
  }
  if (typeof input !== 'string') {
    throw new TypeError('sanitizeText: input must be a string, null, or undefined');
  }
  if (input.includes(NULL_BYTE)) {
    throw new TypeError('sanitizeText: input contains a null byte');
  }

  let cleaned = input.replace(BIDI_AND_ZERO_WIDTH, '');
  cleaned = cleaned.replace(/[\t\n\r]/g, ' ');
  cleaned = cleaned.replace(OTHER_CONTROL_CHARS, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Defang active URL schemes even though this text can only ever become inert
  // SVG text content. The point is not that an escaped "javascript:" could run,
  // it cannot; the point is that `assertNoActiveContent` gets to stay a blunt
  // substring check that never has to reason about whether an occurrence sits
  // in an attribute or in a text node. A guard that simple is a guard nobody
  // weakens later by mistake. The colon becomes a lookalike so the word still
  // reads normally to a human.
  cleaned = cleaned.replace(/\b(javascript|vbscript|data)\s*:/gi, '$1 :');

  const graphemes = toGraphemes(cleaned);
  let capped = cleaned;
  if (graphemes.length > maxGraphemes) {
    capped = maxGraphemes > 0 ? graphemes.slice(0, maxGraphemes - 1).join('') + ELLIPSIS : '';
  }

  return escapeXmlOnce(capped);
}

/**
 * Sanitizes a value that must behave as a filesystem-safe, URL-path-safe
 * identifier: a GitHub username, a repo name, or a style id. Unlike
 * sanitizeText this is a strict allow-list, not an escaper -- identifiers
 * are never displayed as prose, they get used to build things like file
 * paths (`examples/<style>.svg`) and API URLs (`/repos/{owner}/{repo}`), so
 * the only safe rule is "a character that was never on the allow-list does
 * not exist in the output" rather than "characters are transformed so a
 * parser reads them literally". That is what stops a value like
 * `"../../etc/passwd"` or `'user"; rm -rf ~ #'` from ever reaching a path or
 * a shell in a meaningful form: after filtering, no `/`, `\`, quote, space or
 * `;` remains, so there is nothing left to traverse or inject with --
 * whatever survives is an inert run of `[A-Za-z0-9._-]`.
 *
 * @param {unknown} input
 * @returns {string} `input` with every character outside
 *   `[A-Za-z0-9._-]` removed, capped at 100 characters. Returns `""` for
 *   `null`, `undefined`, or a string with nothing left after filtering.
 * @throws {TypeError} if `input` is neither a string nor `null`/`undefined`.
 *   Identifiers come from structured config/API fields the spec types as
 *   `string` (see `State`/`Repo` in BUILD-SPEC.md); a non-string here is a
 *   caller bug, not attacker-controlled free text, so it fails loudly
 *   instead of being silently coerced into something that merely looks
 *   plausible.
 */
export function sanitizeIdent(input) {
  if (input === null || input === undefined) {
    return '';
  }
  if (typeof input !== 'string') {
    throw new TypeError('sanitizeIdent: input must be a string, null, or undefined');
  }
  return input.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 100);
}

/**
 * Substrings that must never appear anywhere in a rendered SVG banner,
 * matched case-insensitively by assertNoActiveContent. This is the
 * render-boundary guard, not the sanitizer: sanitizeText should already make
 * every one of these impossible by escaping `<` and `"`, but a style module
 * could in principle build markup out of an unsanitized literal (a
 * hardcoded template mistake, not attacker input), and a regression like
 * that should never ship silently. The array is frozen so no style module
 * can quietly mutate the list it is being checked against.
 *
 * In order, the tokens cover: script execution, an element that can host
 * arbitrary HTML, an embedded browsing context, a `javascript:` URL, a DTD
 * entity declaration (the mechanism behind XXE and entity-expansion
 * attacks), a DOCTYPE (which is what makes an entity declaration possible in
 * the first place), a CDATA section (a classic way to smuggle unescaped
 * markup past a naive filter), an `xlink:href`/`href` pointing at a remote
 * `http(s)` resource (GitHub's own camo proxy refuses such an SVG, but
 * failing this check first gives a clear local error instead of a silently
 * blank banner in production), and an `<image>` element, the one standard
 * SVG element that fetches an external resource by URL.
 */
export const FORBIDDEN_SVG_TOKENS = Object.freeze([
  '<script',
  '<foreignObject',
  '<iframe',
  'javascript:',
  '<!ENTITY',
  '<!DOCTYPE',
  '<![CDATA[',
  'xlink:href="http',
  'href="http',
  '<image',
]);

/**
 * The last line of defense before a rendered SVG string is written to disk
 * or committed: scans the fully rendered output for every token in
 * FORBIDDEN_SVG_TOKENS, case-insensitively, and throws immediately if one is
 * found. Meant to run in the render path itself, and in the test suite
 * against a deliberately hostile `State`, so a regression in a style module
 * -- which authors its own SVG structure and only routes *text* through
 * sanitizeText, not markup -- is caught before the output ever reaches a
 * commit, rather than relying solely on GitHub's image proxy to refuse it
 * after the fact on someone else's profile.
 *
 * @param {string} svg the fully rendered SVG document
 * @returns {void}
 * @throws {TypeError} if `svg` is not a string.
 * @throws {Error} naming the exact offending token, if any forbidden
 *   substring is present in `svg`.
 */
export function assertNoActiveContent(svg) {
  if (typeof svg !== 'string') {
    throw new TypeError('assertNoActiveContent: svg must be a string');
  }
  const haystack = svg.toLowerCase();
  for (const token of FORBIDDEN_SVG_TOKENS) {
    if (haystack.includes(token.toLowerCase())) {
      throw new Error(`assertNoActiveContent: forbidden token present in rendered SVG: ${token}`);
    }
  }
}
