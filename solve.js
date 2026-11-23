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
// concatenation. This parser jumps with indexOf and slices whole fields at
// once. A record whose line holds no quote and no stray CR (checked on the
// line's own slice, so the check never scans past the line) is split in one
// native call. Other records are read field by field: unquoted fields jump
// between delimiters with indexOf, quoted fields jump straight to their
// closing quote, and field results pass through closure variables instead of
// a fresh result array per field.

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

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, how many characters the
  // last unquoted read kept (quote_junk fires only when it kept some).
  let fv = '';
  let fe = END;
  let fa = 0;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Sets fv, fe, fa.
  function readUnquoted(value) {
    fa = 0;
    // Cheap lane: the field's raw text up to the next comma or LF holds no
    // CR but for the CR of a closing CRLF, so it is kept whole.
    {
      const ci = text.indexOf(',', pos);
      const ni = text.indexOf('\n', pos);
      let end, term;
      if (ci === -1 && ni === -1) { end = len; term = END; }
      else if (ni === -1 || (ci !== -1 && ci < ni)) { end = ci; term = COMMA; }
      else { end = ni; term = LINE_BREAK; }
      const seg = text.slice(pos, end);
      const ri = seg.indexOf('\r');
      if (ri === -1) {
        fv = value ? value + seg : seg;
        fa = seg.length;
        pos = term === END ? len : end + 1;
        if (term === LINE_BREAK) line += 1;
        fe = term;
        return;
      }
      if (term === LINE_BREAK && ri === seg.length - 1) {
        const s = seg.slice(0, -1);
        fv = value ? value + s : s;
        fa = s.length;
        pos = end + 1;
        line += 1;
        fe = LINE_BREAK;
        return;
      }
    }
    let start = pos;
    for (;;) {
      // The nearest of comma, LF, CR from pos.
      let i = text.indexOf(',', pos);
      let c = 44;
      const n = text.indexOf('\n', pos);
      if (n !== -1 && (i === -1 || n < i)) { i = n; c = 10; }
      const r = text.indexOf('\r', pos);
      if (r !== -1 && (i === -1 || r < i)) { i = r; c = 13; }
      if (i === -1) {
        if (start < len) {
          const s = text.slice(start);
          value = value ? value + s : s;
          fa += len - start;
        }
        pos = len;
        fv = value; fe = END;
        return;
      }
      if (c === 44) {
        if (start < i) {
          const s = text.slice(start, i);
          value = value ? value + s : s;
          fa += i - start;
        }
        pos = i + 1;
        fv = value; fe = COMMA;
        return;
      }
      if (c === 10) {
        if (start < i) {
          const s = text.slice(start, i);
          value = value ? value + s : s;
          fa += i - start;
        }
        pos = i + 1;
        line += 1;
        fv = value; fe = LINE_BREAK;
        return;
      }
      // CR.
      if (i + 1 < len && text.charCodeAt(i + 1) === 10) {
        if (start < i) {
          const s = text.slice(start, i);
          value = value ? value + s : s;
          fa += i - start;
        }
        pos = i + 2;
        line += 1;
        fv = value; fe = LINE_BREAK;
        return;
      }
      // A CR not followed by LF is dropped (stray_cr).
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (start < i) {
        const s = text.slice(start, i);
        value = value ? value + s : s;
        fa += i - start;
      }
      pos = i + 1;
      start = pos;
    }
  }

  // The raw slice [start, end) of a quoted field's content, with every CRLF
  // or lone CR in it read as LF. Sets fv (the read text) and fa (its count
  // of line breaks).
  function quotedSegment(start, end) {
    const s = text.slice(start, end);
    if (s.indexOf('\r') === -1) {
      let n = s.indexOf('\n');
      if (n === -1) { fv = s; fa = 0; return; }
      let breaks = 1;
      while ((n = s.indexOf('\n', n + 1)) !== -1) breaks++;
      fv = s; fa = breaks;
      return;
    }
    const t = s.replace(/\r\n?/g, '\n');
    let n = t.indexOf('\n');
    let breaks = 0;
    while (n !== -1) {
      breaks++;
      n = t.indexOf('\n', n + 1);
    }
    fv = t; fa = breaks;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fv and fe.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let start = pos + 1;
    let lineDelta = 0; // line breaks inside the quotes, applied only once it closes
    for (;;) {
      const q = text.indexOf('"', start);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        quotedSegment(start, q);
        value = value ? value + fv + '"' : fv + '"';
        lineDelta += fa;
        start = q + 2;
        continue;
      }
      // The closing quote.
      quotedSegment(start, q);
      value = value ? value + fv : fv;
      line += lineDelta + fa;
      pos = q + 1;
      if (pos >= len) { fv = value; fe = END; return; }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fv = value; fe = COMMA;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fv = value; fe = LINE_BREAK;
        return;
      }
      if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fv = value; fe = LINE_BREAK;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      readUnquoted(value);
      if (fa > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return;
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
    // record of plain fields, split in a single native call. The slice is
    // the line itself, so the quote/CR check never scans past the line.
    const lineEnd = text.indexOf('\n', pos);
    const eol = lineEnd === -1 ? len : lineEnd;
    let segEnd = eol;
    if (lineEnd !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1; // CRLF
    if (segEnd > pos) {
      const seg = text.slice(pos, segEnd);
      if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
        fields = seg.split(',');
        pos = lineEnd === -1 ? len : lineEnd + 1;
        if (lineEnd !== -1) line += 1;
      }
    }
    if (fields === null) {
      fields = [];
      do {
        quoted = text.charCodeAt(pos) === 34;
        if (quoted) readQuoted(); else readUnquoted('');
        fields.push(fv);
      } while (fe === COMMA);
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
