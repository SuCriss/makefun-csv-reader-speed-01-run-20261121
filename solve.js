// A dependency-free, deterministic drop-in for csv-reader 1.0.0.
// The scanner works on JavaScript string indices. It keeps the reference
// program's broken-row policy while avoiding character-by-character += work.

const QUOTE = 34;   // "
const COMMA = 44;   // ,
const CR = 13;      // \r
const LF = 10;      // \n
const BOM = 0xfeff;

const END_COMMA = 0;
const END_LINE = 1;
const END_TEXT = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  let pos = text.charCodeAt(0) === BOM ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  function emit(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Fast scan of an unquoted tail. `initial` is the already-read quoted value
  // when junk follows a closing quote, or the literal opening quote after an
  // unterminated quoted field. `added` counts only characters kept in this
  // tail, so quote_junk is emitted only when junk really contributed text.
  function unquoted(initial) {
    const parts = initial === '' ? [] : [initial];
    let added = 0;
    let runStart = pos;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === COMMA) {
        if (pos > runStart) {
          parts.push(text.slice(runStart, pos));
          added += pos - runStart;
        }
        pos += 1;
        return { value: parts.join(''), ended: END_COMMA, added };
      }
      if (c === LF) {
        if (pos > runStart) {
          parts.push(text.slice(runStart, pos));
          added += pos - runStart;
        }
        pos += 1;
        line += 1;
        return { value: parts.join(''), ended: END_LINE, added };
      }
      if (c === CR) {
        if (pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
          if (pos > runStart) {
            parts.push(text.slice(runStart, pos));
            added += pos - runStart;
          }
          pos += 2;
          line += 1;
          return { value: parts.join(''), ended: END_LINE, added };
        }
        // A stray CR is dropped. Flush the ordinary run before it, emit the
        // error at the current record position, and continue after the CR.
        if (pos > runStart) {
          parts.push(text.slice(runStart, pos));
          added += pos - runStart;
        }
        emit('stray_cr');
        pos += 1;
        runStart = pos;
        continue;
      }
      pos += 1;
    }
    if (pos > runStart) {
      parts.push(text.slice(runStart, pos));
      added += pos - runStart;
    }
    return { value: parts.join(''), ended: END_TEXT, added };
  }

  // Scan a quoted field from the opening quote at pos. Return the field value
  // and its ending. Unterminated quotes restart as unquoted text beginning
  // with a single literal quote, exactly as csv-reader 1.0.0 does.
  function quoted() {
    const open = pos;
    const openLine = line;
    const parts = [];
    pos += 1;
    let runStart = pos;
    let closed = false;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === QUOTE) {
        if (pos > runStart) parts.push(text.slice(runStart, pos));
        if (pos + 1 < n && text.charCodeAt(pos + 1) === QUOTE) {
          parts.push('"');
          pos += 2;
          runStart = pos;
          continue;
        }
        pos += 1;
        closed = true;
        break;
      }
      if (c === CR) {
        if (pos > runStart) parts.push(text.slice(runStart, pos));
        parts.push('\n');
        line += 1;
        pos += pos + 1 < n && text.charCodeAt(pos + 1) === LF ? 2 : 1;
        runStart = pos;
        continue;
      }
      if (c === LF) {
        if (pos > runStart) parts.push(text.slice(runStart, pos));
        parts.push('\n');
        line += 1;
        pos += 1;
        runStart = pos;
        continue;
      }
      pos += 1;
    }
    if (!closed) {
      if (pos > runStart) parts.push(text.slice(runStart, pos));
      pos = open + 1;
      line = openLine;
      emit('unterminated_quote');
      return unquoted('"');
    }
    const value = parts.join('');
    if (pos >= n) return { value, ended: END_TEXT, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      pos += 1;
      return { value, ended: END_COMMA, added: 0 };
    }
    if (c === LF) {
      pos += 1;
      line += 1;
      return { value, ended: END_LINE, added: 0 };
    }
    if (c === CR && pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      return { value, ended: END_LINE, added: 0 };
    }
    const junk = unquoted(value);
    if (junk.added > 0) emit('quote_junk');
    return junk;
  }

  while (true) {
    // A line with no characters is no record. CRLF and LF both advance the
    // line counter; a lone CR is handled inside a field, not here.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
        continue;
      }
      if (c === CR && pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
        continue;
      }
      break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let field;
    do {
      lastQuoted = text.charCodeAt(pos) === QUOTE;
      field = lastQuoted ? quoted() : unquoted('');
      fields.push(field.value);
    } while (field.ended === END_COMMA);

    // A blank line made only of stray CRs keeps its errors but adds no row.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      const extra = fields.splice(width);
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
