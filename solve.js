// Fast drop-in replacement for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Returns exactly csv-reader's answer {columns, rows, errors} for every input
// {text, header}, following its written broken-row policy byte for byte:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled
//     ("" inside it is one quote, each CRLF or lone CR inside it reads as LF);
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a field's quote_junk
//     when the field ends and a record's short_row or long_row when it ends;
//     line is the 1-based line its record starts on, counting every LF, CRLF
//     and lone CR inside quotes, row its record's index in rows (null for
//     the header).
//
// Speed: csv-reader walks one character at a time and builds every field by
// concatenation. This parser instead jumps with indexOf / a delimiter regex
// and slices whole fields at once. A record whose line holds no quote and no
// stray CR (the large majority) is split in one native call; only records
// that hold a quote or a stray CR take the field-by-field path, and quoted
// fields jump straight to their closing quote with indexOf.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  const delim = /[,\r\n]/g; // the characters that can end an unquoted field
  const crlf = /\r\n?/g; // CRLF or a lone CR inside quotes, each one LF

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The raw slice [start, end) of a quoted field's content, with every CRLF or
  // lone CR in it read as LF. Returns [value, lineBreaks].
  function quotedSegment(start, end) {
    const s = text.slice(start, end);
    if (s.indexOf('\r') === -1) {
      let n = s.indexOf('\n');
      if (n === -1) return [s, 0];
      let breaks = 1;
      while ((n = s.indexOf('\n', n + 1)) !== -1) breaks++;
      return [s, breaks];
    }
    const t = s.replace(crlf, '\n');
    let n = t.indexOf('\n');
    let breaks = 0;
    while (n !== -1) {
      breaks++;
      n = t.indexOf('\n', n + 1);
    }
    return [t, breaks];
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Returns [value, ended, added],
  // `added` counting the characters kept after `value`.
  function readUnquoted(value) {
    let added = 0;
    let start = pos;
    for (;;) {
      delim.lastIndex = pos;
      const m = delim.exec(text);
      if (m === null) {
        if (start < len) {
          const s = text.slice(start);
          value = value ? value + s : s;
          added += s.length;
        }
        pos = len;
        return [value, END, added];
      }
      const i = m.index;
      const c = text.charCodeAt(i);
      if (c === 44) {
        // Comma: the field ends, the record goes on.
        if (start < i) {
          const s = text.slice(start, i);
          value = value ? value + s : s;
          added += s.length;
        }
        pos = i + 1;
        return [value, COMMA, added];
      }
      if (c === 10) {
        // LF: the field ends, the record ends.
        if (start < i) {
          const s = text.slice(start, i);
          value = value ? value + s : s;
          added += s.length;
        }
        pos = i + 1;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      // CR.
      if (i + 1 < len && text.charCodeAt(i + 1) === 10) {
        if (start < i) {
          const s = text.slice(start, i);
          value = value ? value + s : s;
          added += s.length;
        }
        pos = i + 2;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      // A CR not followed by LF is dropped (stray_cr).
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (start < i) {
        const s = text.slice(start, i);
        value = value ? value + s : s;
        added += s.length;
      }
      pos = i + 1;
      start = pos;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let start = pos + 1;
    let lineDelta = 0; // line breaks inside the quotes, applied only once it closes
    for (;;) {
      const q = text.indexOf('"', start);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        const seg = quotedSegment(start, q);
        value = value ? value + seg[0] + '"' : seg[0] + '"';
        lineDelta += seg[1];
        start = q + 2;
        continue;
      }
      // The closing quote.
      const seg = quotedSegment(start, q);
      value = value ? value + seg[0] : seg[0];
      line += lineDelta + seg[1];
      pos = q + 1;
      if (pos >= len) return [value, END, 0];
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return [value, COMMA, 0];
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return [value, LINE_BREAK, 0];
      }
      if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return [value, LINE_BREAK, 0];
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (junk[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields = null;
    let quoted = false;
    // Fast path: the whole line holds no quote and no stray CR, so it is one
    // record of plain fields, split in a single native call.
    const lineEnd = text.indexOf('\n', pos);
    const eol = lineEnd === -1 ? len : lineEnd;
    let segEnd = eol;
    if (lineEnd !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1; // CRLF
    if (segEnd > pos) {
      const q = text.indexOf('"', pos);
      const r = text.indexOf('\r', pos);
      if ((q === -1 || q >= segEnd) && (r === -1 || r >= segEnd)) {
        fields = text.slice(pos, segEnd).split(',');
        pos = lineEnd === -1 ? len : lineEnd + 1;
        if (lineEnd !== -1) line += 1;
      }
    }
    if (fields === null) {
      fields = [];
      let ended;
      do {
        quoted = text.charCodeAt(pos) === 34;
        const f = quoted ? readQuoted() : readUnquoted('');
        fields.push(f[0]);
        ended = f[1];
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
