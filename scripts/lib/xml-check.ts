/**
 * A deliberately small XML well-formedness checker for the test scripts.
 *
 * The project ships no XML parser (the application only *writes* XML), but a
 * malformed part is exactly the failure that makes Excel or MS Project refuse a
 * file — and "looks fine in a text editor" is not a test. This walks the tags,
 * keeps a stack and reports the first structural problems, so the export suites
 * can assert "this part parses" instead of hoping.
 *
 * Scope: elements, self-closing tags, attributes with quoted `>`, comments,
 * CDATA, processing instructions and doctype. Not scope: namespaces, entity
 * expansion, schema validation. That is enough to catch the realistic bugs
 * (unbalanced or mistyped tags, unescaped `&`, stray `<`).
 */
export interface XmlProblem {
  message: string;
  offset: number;
}

const NAME = /^[A-Za-z_][A-Za-z0-9._:-]*/;

export function checkXml(source: string): XmlProblem[] {
  const problems: XmlProblem[] = [];
  const stack: { name: string; offset: number }[] = [];
  let i = 0;

  const skipTo = (needle: string, from: number): number => {
    const index = source.indexOf(needle, from);
    return index < 0 ? -1 : index + needle.length;
  };

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt < 0) break;

    // Raw text between tags: a bare `&` here would be an invalid entity.
    const text = source.slice(i, lt);
    if (/&(?!(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9._:-]*);)/.test(text)) {
      problems.push({ message: "unescaped '&' in text content", offset: i });
    }

    if (source.startsWith("<?", lt)) {
      const end = skipTo("?>", lt);
      if (end < 0) return [...problems, { message: "unterminated processing instruction", offset: lt }];
      i = end;
      continue;
    }
    if (source.startsWith("<!--", lt)) {
      const end = skipTo("-->", lt);
      if (end < 0) return [...problems, { message: "unterminated comment", offset: lt }];
      i = end;
      continue;
    }
    if (source.startsWith("<![CDATA[", lt)) {
      const end = skipTo("]]>", lt);
      if (end < 0) return [...problems, { message: "unterminated CDATA", offset: lt }];
      i = end;
      continue;
    }
    if (source.startsWith("<!", lt)) {
      const end = skipTo(">", lt);
      if (end < 0) return [...problems, { message: "unterminated declaration", offset: lt }];
      i = end;
      continue;
    }

    // Find the end of the tag, ignoring `>` inside quoted attributes.
    let j = lt + 1;
    let quote: string | null = null;
    while (j < source.length) {
      const char = source[j];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
      j += 1;
    }
    if (j >= source.length) return [...problems, { message: "unterminated tag", offset: lt }];

    const raw = source.slice(lt + 1, j);
    const closing = raw.startsWith("/");
    const body = closing ? raw.slice(1) : raw;
    const nameMatch = NAME.exec(body);
    if (!nameMatch) {
      problems.push({ message: `invalid tag <${raw.slice(0, 24)}>`, offset: lt });
      i = j + 1;
      continue;
    }
    const name = nameMatch[0];
    const selfClosing = !closing && body.trimEnd().endsWith("/");

    if (closing) {
      const top = stack.pop();
      if (!top) {
        problems.push({ message: `closing </${name}> without an opening tag`, offset: lt });
      } else if (top.name !== name) {
        problems.push({ message: `<${top.name}> closed by </${name}>`, offset: lt });
      }
    } else if (!selfClosing) {
      stack.push({ name, offset: lt });
    }

    i = j + 1;
  }

  for (const open of stack) {
    problems.push({ message: `<${open.name}> is never closed`, offset: open.offset });
  }
  return problems;
}

/** Convenience for assertions: `null` when the document is well-formed. */
export function xmlProblemText(source: string): string | null {
  const problems = checkXml(source);
  if (!problems.length) return null;
  return problems.slice(0, 3).map((problem) => `${problem.message} @${problem.offset}`).join("; ");
}
