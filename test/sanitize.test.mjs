import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeText,
  sanitizeIdent,
  FORBIDDEN_SVG_TOKENS,
  assertNoActiveContent,
} from '../src/sanitize.mjs';

/*
 * Every non-ASCII or control codepoint used as a test fixture below is built
 * with String.fromCharCode / String.fromCodePoint from a plain hex number,
 * not typed as a literal character or a "\u" escape. That keeps this file
 * pure ASCII and makes every fixture's exact codepoint verifiable by reading
 * the number, rather than by eyeballing an invisible or hard-to-render
 * glyph in an editor.
 */

const ELLIPSIS = String.fromCharCode(0x2026);
const NULL_BYTE = String.fromCharCode(0x0000);
const ZWJ = String.fromCharCode(0x200d);

/** Alternates the case of letters in a token; symbols pass through as-is. */
function mixCase(token) {
  return token
    .split('')
    .map((ch, i) => (i % 2 === 0 ? ch.toUpperCase() : ch.toLowerCase()))
    .join('');
}

/** True if `str` contains an unpaired UTF-16 surrogate anywhere. */
function hasLoneSurrogate(str) {
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (isHigh) {
      const next = str.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1; // skip the low surrogate we just validated
    } else if (isLow) {
      return true; // a low surrogate with no preceding high surrogate
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// sanitizeText: XML escaping, exactly once
// ---------------------------------------------------------------------------

test('sanitizeText escapes each of the five XML special characters', () => {
  assert.equal(sanitizeText('&'), '&amp;');
  assert.equal(sanitizeText('<'), '&lt;');
  assert.equal(sanitizeText('>'), '&gt;');
  assert.equal(sanitizeText('"'), '&quot;');
  assert.equal(sanitizeText("'"), '&apos;');
  assert.equal(sanitizeText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(sanitizeText('Tom & Jerry'), 'Tom &amp; Jerry');
});

test('sanitizeText does not double escape an already-escaped named entity', () => {
  assert.equal(sanitizeText('&amp;'), '&amp;');
  assert.equal(sanitizeText('&lt;'), '&lt;');
  assert.equal(sanitizeText('&gt;'), '&gt;');
  assert.equal(sanitizeText('&quot;'), '&quot;');
  assert.equal(sanitizeText('&apos;'), '&apos;');
  assert.equal(
    sanitizeText('&amp; &lt; &gt; &quot; &apos;'),
    '&amp; &lt; &gt; &quot; &apos;'
  );
});

test('sanitizeText does not double escape an already-escaped numeric entity', () => {
  assert.equal(sanitizeText('&#39;'), '&#39;');
  assert.equal(sanitizeText('&#x27;'), '&#x27;');
  assert.equal(sanitizeText('&#38;'), '&#38;');
});

test('sanitizeText escapes a bare ampersand next to a real entity without touching the entity', () => {
  assert.equal(sanitizeText('Fish & Chips &amp; Co'), 'Fish &amp; Chips &amp; Co');
});

test('sanitizeText escapes a lone "&" that only looks like the start of an entity', () => {
  // No trailing ";" -- this is a literal "&" followed by literal text "amp",
  // not a real entity, so only the "&" itself gets escaped.
  assert.equal(sanitizeText('&amp'), '&amp;amp');
  assert.equal(sanitizeText('&ampersand'), '&amp;ampersand');
  assert.equal(sanitizeText('&#zz;'), '&amp;#zz;');
});

test('sanitizeText escaping repeated back-to-back entities stays idempotent', () => {
  assert.equal(sanitizeText('&amp;&amp;'), '&amp;&amp;');
  assert.equal(sanitizeText('&&'), '&amp;&amp;');
});

test('sanitizeText neutralizes a DOCTYPE, ENTITY declaration and CDATA section by escaping', () => {
  assert.equal(sanitizeText('<!DOCTYPE html>'), '&lt;!DOCTYPE html&gt;');
  assert.equal(sanitizeText('<!ENTITY xxe "boom">'), '&lt;!ENTITY xxe &quot;boom&quot;&gt;');
  assert.equal(sanitizeText('<![CDATA[test]]>'), '&lt;![CDATA[test]]&gt;');
});

// ---------------------------------------------------------------------------
// sanitizeText: control characters
// ---------------------------------------------------------------------------

test('sanitizeText folds tab, newline and carriage return to a single space each', () => {
  assert.equal(sanitizeText('a\tb\nc\rd'), 'a b c d');
});

test('sanitizeText collapses runs of whitespace and trims the result', () => {
  assert.equal(sanitizeText('  \nhello\t  '), 'hello');
  assert.equal(sanitizeText('a\t\t\tb'), 'a b');
  assert.equal(sanitizeText('   '), '');
});

test('sanitizeText strips every other C0 control character entirely, without inserting a space', () => {
  for (let codePoint = 0x00; codePoint <= 0x1f; codePoint += 1) {
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d || codePoint === 0x00) {
      continue; // tab/newline/CR are handled separately; null byte throws
    }
    const input = 'a' + String.fromCharCode(codePoint) + 'b';
    assert.equal(sanitizeText(input), 'ab', `codepoint 0x${codePoint.toString(16)} should be stripped`);
  }
});

test('sanitizeText strips every C1 control character entirely', () => {
  for (let codePoint = 0x7f; codePoint <= 0x9f; codePoint += 1) {
    const input = 'a' + String.fromCharCode(codePoint) + 'b';
    assert.equal(sanitizeText(input), 'ab', `codepoint 0x${codePoint.toString(16)} should be stripped`);
  }
});

// ---------------------------------------------------------------------------
// sanitizeText: Trojan Source (bidi controls + zero-width characters)
// ---------------------------------------------------------------------------

test('sanitizeText strips each bidirectional format and isolate control character', () => {
  // 0x202A-0x202E: LRE, RLE, PDF, LRO, RLO. 0x2066-0x2069: LRI, RLI, FSI, PDI.
  const bidiCodePoints = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
  for (const codePoint of bidiCodePoints) {
    const input = 'a' + String.fromCharCode(codePoint) + 'b';
    assert.equal(sanitizeText(input), 'ab', `bidi codepoint 0x${codePoint.toString(16)} should be stripped`);
  }
});

test('sanitizeText strips each zero-width character, without inserting a space', () => {
  const zeroWidthCodePoints = [0x200b, 0x200c, 0x200d, 0xfeff];
  for (const codePoint of zeroWidthCodePoints) {
    const input = 'a' + String.fromCharCode(codePoint) + 'b';
    assert.equal(sanitizeText(input), 'ab', `zero-width codepoint 0x${codePoint.toString(16)} should be stripped`);
  }
});

test('sanitizeText strips a bidi override attack that would otherwise reorder visible text', () => {
  // RLO ... PDF around "txt.exe" is the classic Trojan Source spoof shape.
  const rlo = String.fromCharCode(0x202e);
  const pdf = String.fromCharCode(0x202c);
  const input = 'invoice' + rlo + 'gpj.exe' + pdf + '.jpg';
  assert.equal(sanitizeText(input), 'invoicegpj.exe.jpg');
});

// ---------------------------------------------------------------------------
// sanitizeText: null byte and type checks
// ---------------------------------------------------------------------------

test('sanitizeText throws TypeError for a null byte instead of silently stripping it', () => {
  assert.throws(() => sanitizeText('a' + NULL_BYTE + 'b'), TypeError);
  assert.throws(() => sanitizeText(NULL_BYTE), TypeError);
});

test('sanitizeText throws TypeError for non-string input', () => {
  assert.throws(() => sanitizeText(42), TypeError);
  assert.throws(() => sanitizeText(true), TypeError);
  assert.throws(() => sanitizeText({}), TypeError);
  assert.throws(() => sanitizeText(['x']), TypeError);
});

test('sanitizeText returns an empty string for null or undefined', () => {
  assert.equal(sanitizeText(null), '');
  assert.equal(sanitizeText(undefined), '');
});

// ---------------------------------------------------------------------------
// sanitizeText: grapheme-aware truncation
// ---------------------------------------------------------------------------

test('sanitizeText truncates plain text by grapheme with a single trailing ellipsis', () => {
  assert.equal(sanitizeText('abcdefghij', { maxGraphemes: 5 }), 'abcd' + ELLIPSIS);
  assert.equal(sanitizeText('abcdefghij', { maxGraphemes: 10 }), 'abcdefghij');
  assert.equal(sanitizeText('abcdefghij', { maxGraphemes: 1 }), ELLIPSIS);
});

test('sanitizeText defaults maxGraphemes to 120', () => {
  const input = 'x'.repeat(130);
  const result = sanitizeText(input);
  assert.equal(result, 'x'.repeat(119) + ELLIPSIS);
  assert.equal(Array.from(result).length, 120);
});

test('sanitizeText with maxGraphemes 0 returns empty rather than a bare ellipsis', () => {
  assert.equal(sanitizeText('hello', { maxGraphemes: 0 }), '');
});

test('sanitizeText truncation never splits a flag emoji (two regional indicator code points)', () => {
  const flag = String.fromCodePoint(0x1f1e9, 0x1f1ea); // regional indicators D + E

  // Cap lands just before the flag would fit: the whole flag is dropped,
  // never emitted as a single lone regional indicator.
  const excluded = sanitizeText('xxxxx' + flag, { maxGraphemes: 5 });
  assert.equal(excluded, 'xxxx' + ELLIPSIS);
  assert.ok(!excluded.includes(String.fromCodePoint(0x1f1e9)));
  assert.ok(!excluded.includes(String.fromCodePoint(0x1f1ea)));
  assert.ok(!hasLoneSurrogate(excluded));

  // Cap lands exactly on the flag: it survives whole, with no truncation.
  const included = sanitizeText('xxxxx' + flag, { maxGraphemes: 6 });
  assert.equal(included, 'xxxxx' + flag);
  assert.ok(!hasLoneSurrogate(included));
});

test('sanitizeText truncation never leaves a dangling surrogate around a ZWJ family emoji', () => {
  // "man ZWJ woman ZWJ girl ZWJ boy" -- a four-codepoint ZWJ sequence.
  // The ZWJ itself is stripped everywhere in sanitizeText (it is on the
  // Trojan Source strip list along with the other zero-width characters),
  // so by the time truncation runs the sequence has already decomposed into
  // four independent single-codepoint emoji. That is expected: the
  // guarantee under test here is that whatever grapheme cluster boundary
  // truncation lands on, it never cuts a UTF-16 surrogate pair in half and
  // never leaves a bare joiner behind.
  const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466);
  const input = 'x'.repeat(8) + family;

  const result = sanitizeText(input, { maxGraphemes: 10 });
  assert.equal(result, 'x'.repeat(8) + String.fromCodePoint(0x1f468) + ELLIPSIS);
  assert.ok(!result.includes(ZWJ), 'zero width joiner must never survive sanitizeText');
  assert.ok(!hasLoneSurrogate(result), 'no half of a surrogate pair may survive truncation');
});

test('sanitizeText truncation does not split a combining character sequence', () => {
  // "e" + combining acute accent (U+0301) is one grapheme cluster.
  const eAcute = 'e' + String.fromCharCode(0x0301);
  const input = 'x'.repeat(5) + eAcute;
  const result = sanitizeText(input, { maxGraphemes: 5 });
  assert.equal(result, 'xxxx' + ELLIPSIS);
  assert.ok(!result.includes(String.fromCharCode(0x0301)), 'a lone combining mark must never survive alone');
});

test('sanitizeText grapheme counting falls back to code points when Intl.Segmenter is unavailable', () => {
  const original = Intl.Segmenter;
  // @ts-expect-error -- deliberately removing it to exercise the documented fallback
  Intl.Segmenter = undefined;
  try {
    const flag = String.fromCodePoint(0x1f1e9, 0x1f1ea);
    const result = sanitizeText('xxxxx' + flag, { maxGraphemes: 5 });
    // Array.from still respects the surrogate pair, so the flag is either
    // whole or absent, never split into one lone regional indicator.
    assert.equal(result, 'xxxx' + ELLIPSIS);
    assert.ok(!hasLoneSurrogate(result));
  } finally {
    Intl.Segmenter = original;
  }
});

// ---------------------------------------------------------------------------
// sanitizeIdent
// ---------------------------------------------------------------------------

test('sanitizeIdent passes through an already-safe identifier unchanged', () => {
  assert.equal(sanitizeIdent('my-repo.name_1'), 'my-repo.name_1');
  assert.equal(sanitizeIdent('OthmanAdi'), 'OthmanAdi');
});

test('sanitizeIdent strips path separators so traversal sequences cannot traverse', () => {
  assert.equal(sanitizeIdent('../../etc'), '....etc');
  assert.ok(!sanitizeIdent('../../etc').includes('/'));
  assert.equal(sanitizeIdent('..\\..\\windows\\system32'), '....windowssystem32');
  assert.ok(!sanitizeIdent('..\\..\\windows\\system32').includes('\\'));
});

test('sanitizeIdent strips quotes and other shell/markup metacharacters', () => {
  assert.equal(sanitizeIdent('foo"bar\'baz'), 'foobarbaz');
});

test('sanitizeIdent strips space, semicolon and shell metacharacters precisely', () => {
  // Spell out the expectation explicitly rather than deriving it, so the
  // assertion documents exactly which characters survive: only
  // [A-Za-z0-9._-] can remain. The hyphen in "-rf" is itself an allowed
  // identifier character, so it survives; everything else in this shell
  // injection attempt (the quote, semicolon, spaces, tilde and hash) does
  // not.
  assert.equal(sanitizeIdent('user"; rm -rf ~ #'), 'userrm-rf');
});

test('sanitizeIdent caps length at 100 characters', () => {
  const result = sanitizeIdent('a'.repeat(150));
  assert.equal(result.length, 100);
  assert.equal(result, 'a'.repeat(100));
});

test('sanitizeIdent returns empty string when nothing survives filtering', () => {
  assert.equal(sanitizeIdent('///???!!!'), '');
  assert.equal(sanitizeIdent('   '), '');
});

test('sanitizeIdent returns empty string for null or undefined', () => {
  assert.equal(sanitizeIdent(null), '');
  assert.equal(sanitizeIdent(undefined), '');
});

test('sanitizeIdent throws TypeError for non-string input', () => {
  assert.throws(() => sanitizeIdent(42), TypeError);
  assert.throws(() => sanitizeIdent({}), TypeError);
});

// ---------------------------------------------------------------------------
// FORBIDDEN_SVG_TOKENS / assertNoActiveContent
// ---------------------------------------------------------------------------

test('FORBIDDEN_SVG_TOKENS matches the required list exactly and is frozen', () => {
  assert.deepEqual(FORBIDDEN_SVG_TOKENS, [
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
  assert.ok(Object.isFrozen(FORBIDDEN_SVG_TOKENS));
});

test('assertNoActiveContent throws naming the token for each forbidden token, in mixed case', () => {
  for (const token of FORBIDDEN_SVG_TOKENS) {
    const hostileSvg = `<svg xmlns="http://www.w3.org/2000/svg">${mixCase(token)}</svg>`;
    assert.throws(
      () => assertNoActiveContent(hostileSvg),
      (err) => err instanceof Error && err.message.includes(token),
      `should catch mixed-case "${token}"`
    );
  }
});

test('assertNoActiveContent is case-insensitive on both ends (upper input, mixed list lookup)', () => {
  assert.throws(() => assertNoActiveContent('<SCRIPT>alert(1)</SCRIPT>'), /forbidden token/);
  assert.throws(() => assertNoActiveContent('<IFRAME src="x">'), /forbidden token/);
  assert.throws(() => assertNoActiveContent('JAVASCRIPT:alert(1)'), /forbidden token/);
  assert.throws(() => assertNoActiveContent('<!doctype html>'), /forbidden token/);
  assert.throws(() => assertNoActiveContent('<![cdata[x]]>'), /forbidden token/);
  assert.throws(() => assertNoActiveContent('HREF="HTTP://evil.example"'), /forbidden token/);
});

test('assertNoActiveContent does not throw for a clean, benign SVG', () => {
  const clean =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60">' +
    '<rect width="400" height="60" fill="#111"/>' +
    '<text x="10" y="30" fill="#eee">now playing: margin</text>' +
    '</svg>';
  assert.doesNotThrow(() => assertNoActiveContent(clean));
});

test('assertNoActiveContent throws TypeError for non-string input', () => {
  assert.throws(() => assertNoActiveContent(42), TypeError);
  assert.throws(() => assertNoActiveContent(null), TypeError);
});

test('assertNoActiveContent allows a same-document fragment href but still rejects an external one', () => {
  // A same-document fragment reference has no "http" after it, so it must
  // NOT trip the guard -- only an external href/xlink:href does.
  const withFragment = '<svg><a href="#section"><text>ok</text></a></svg>';
  assert.doesNotThrow(() => assertNoActiveContent(withFragment));

  const withExternal = '<svg><a href="http://evil.example"><text>bad</text></a></svg>';
  assert.throws(() => assertNoActiveContent(withExternal), /forbidden token/);
});
