function maskedCharacter(character) {
  return character === "\n" ? "\n" : " ";
}

function maskRange(source, output, start, end) {
  for (let index = start; index < end; index += 1) {
    output.push(maskedCharacter(source[index]));
  }
}

function dollarQuoteTagAt(source, index) {
  const match = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match?.[0] ?? null;
}

function maskSqlNonCode(source) {
  const output = [];
  let index = 0;

  while (index < source.length) {
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index + 2);
      const segmentEnd = end === -1 ? source.length : end;
      maskRange(source, output, index, segmentEnd);
      index = segmentEnd;
      continue;
    }

    if (source.startsWith("/*", index)) {
      const start = index;
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) return { ok: false, reason: "unterminated SQL block comment" };
      maskRange(source, output, start, index);
      continue;
    }

    if (source[index] === "'") {
      const start = index;
      const prefix = source[index - 1] ?? "";
      const beforePrefix = source[index - 2] ?? "";
      const escapeString = /[eE]/.test(prefix) && !/[A-Za-z0-9_$]/.test(beforePrefix);
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          index += 2;
        } else if (escapeString && source[index] === "\\" && index + 1 < source.length) {
          index += 2;
        } else if (source[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) return { ok: false, reason: "unterminated SQL string literal" };
      maskRange(source, output, start, index);
      continue;
    }

    if (source[index] === '"') {
      const start = index;
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          index += 2;
        } else if (source[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) return { ok: false, reason: "unterminated SQL quoted identifier" };
      maskRange(source, output, start, index);
      continue;
    }

    if (source[index] === "$") {
      const tag = dollarQuoteTagAt(source, index);
      if (tag) {
        const start = index;
        const end = source.indexOf(tag, index + tag.length);
        if (end === -1) return { ok: false, reason: "unterminated SQL dollar quote" };
        index = end + tag.length;
        maskRange(source, output, start, index);
        continue;
      }
    }

    output.push(source[index]);
    index += 1;
  }

  return { ok: true, sql: output.join("") };
}

export function analyzeReadOnlySqlEnvelope(sql) {
  const canonical = sql.replace(/\r\n?/g, "\n");
  const masked = maskSqlNonCode(canonical);
  if (!masked.ok) return { ok: false, reason: "invalid-sql-lexing", detail: masked.reason };

  const code = masked.sql.trim();
  const beginning = code.match(/^begin\s+transaction\s+read\s+only\s*;/i);
  const ending = code.match(/(?:commit|rollback)(?:\s+work)?\s*;\s*$/i);
  if (!beginning || !ending) return { ok: false, reason: "missing-read-only-envelope" };

  const body = code.slice(beginning[0].length, code.length - ending[0].length);
  const transactionControl =
    /(?:^|;)\s*(?:begin\b|start\s+transaction\b|commit\b|end\b|rollback(?!\s+to\b)\b|abort\b|prepare\s+transaction\b)/i;
  const readWriteOverride =
    /(?:^|;)\s*set\s+transaction\b[^;]*\bread\s+write\b/i;
  const readOnlySettingOverride =
    /(?:^|;)\s*(?:set(?:\s+(?:local|session))?\s+(?:default_)?transaction_read_only\b|reset\s+(?:all\b|(?:default_)?transaction_read_only\b))/i;
  if (
    transactionControl.test(body) ||
    readWriteOverride.test(body) ||
    readOnlySettingOverride.test(body)
  ) {
    return { ok: false, reason: "transaction-escape" };
  }

  return { ok: true };
}
