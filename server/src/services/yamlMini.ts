/**
 * Minimal YAML-subset parser for skill markdown frontmatter.
 *
 * Why not js-yaml: avoiding a new dep for a known-small input shape. We parse
 * exactly what the skill templates use:
 *   - scalars: string, number, boolean, null
 *   - arrays: `- item` (one per line) OR `[a, b, c]` inline
 *   - nested maps via indentation (2 spaces)
 *   - quoted strings: "..." or '...'
 *   - comments: `# ...` after a value or on its own line (ignored)
 *
 * NOT supported: anchors, references, multi-line block scalars (| / >),
 * complex flow mappings. If a skill needs those, swap in js-yaml later.
 */

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const m = content.match(FRONTMATTER_RE);
  if (!m) {
    return { frontmatter: {}, body: content };
  }
  const fmText = m[1];
  const body = content.slice(m[0].length);
  return { frontmatter: parseYamlMini(fmText), body };
}

export function parseYamlMini(text: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const root: Record<string, unknown> = {};
  parseBlock(lines, 0, 0, root);
  return root;
}

interface Frame {
  indent: number;
  container: Record<string, unknown> | unknown[];
  pendingKey?: string;
}

/**
 * Iteratively parse YAML lines starting at `startLine` into `rootContainer`,
 * advancing only as long as line indent >= `baseIndent`. Returns the next
 * line index to process.
 */
function parseBlock(
  lines: string[],
  startLine: number,
  baseIndent: number,
  rootContainer: Record<string, unknown> | unknown[]
): number {
  let i = startLine;
  const stack: Frame[] = [{ indent: baseIndent, container: rootContainer }];

  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      i += 1;
      continue;
    }
    const indent = countIndent(raw);
    if (indent < baseIndent) return i;

    // Pop frames whose indent is deeper than current line.
    while (stack.length > 1 && indent < stack[stack.length - 1].indent) {
      stack.pop();
    }

    // If line is more indented than the deepest known frame, it belongs to
    // a child container of the pending key.
    let top = stack[stack.length - 1];
    if (indent > top.indent) {
      const parent = top.container;
      if (top.pendingKey === undefined) {
        // Shouldn't happen for well-formed YAML; skip.
        i += 1;
        continue;
      }
      // The previous key needs a child container. Decide map vs array based
      // on whether the line starts with "- ".
      const trimmed = raw.trim();
      const child: Record<string, unknown> | unknown[] =
        trimmed.startsWith('- ') || trimmed === '-' ? [] : {};
      if (isPlainObject(parent)) {
        parent[top.pendingKey] = child;
      }
      stack.push({ indent, container: child });
      top = stack[stack.length - 1];
      top.pendingKey = undefined;
    }

    const trimmed = raw.trim();

    // Array item
    if (trimmed.startsWith('- ') || trimmed === '-') {
      if (!Array.isArray(top.container)) {
        // Convert pendingKey's value into an array if needed (best-effort).
        i += 1;
        continue;
      }
      const itemText = trimmed === '-' ? '' : trimmed.slice(2).trim();
      // Could be `- key: value` (object in array) — handle simply:
      const kv = parseKeyValue(itemText);
      if (kv && kv.value !== undefined) {
        const obj: Record<string, unknown> = {};
        obj[kv.key] = kv.value;
        top.container.push(obj);
      } else if (itemText.length > 0) {
        top.container.push(parseScalar(itemText));
      } else {
        // Empty `-` means object/array item starts on next line at deeper indent.
        const placeholder: Record<string, unknown> = {};
        top.container.push(placeholder);
        stack.push({ indent: indent + 2, container: placeholder });
      }
      i += 1;
      continue;
    }

    // Key: value
    const kv = parseKeyValue(trimmed);
    if (!kv) {
      i += 1;
      continue;
    }

    if (!isPlainObject(top.container)) {
      i += 1;
      continue;
    }

    if (kv.value === undefined) {
      // Key with empty value → next indented lines form a child container.
      top.container[kv.key] = {};
      // Tentatively assume map; will be replaced by [] on next iteration if
      // child line begins with "- ".
      top.pendingKey = kv.key;
    } else {
      top.container[kv.key] = kv.value;
      top.pendingKey = undefined;
    }

    i += 1;
  }
  return i;
}

function countIndent(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n += 1;
    else break;
  }
  return n;
}

interface KeyValue {
  key: string;
  value: unknown | undefined; // undefined = key with no inline value
}

function parseKeyValue(line: string): KeyValue | null {
  // Strip trailing comment
  const noComment = stripComment(line);
  const colonIdx = findColonOutsideQuotes(noComment);
  if (colonIdx === -1) return null;
  const key = noComment.slice(0, colonIdx).trim();
  if (key.length === 0) return null;
  const after = noComment.slice(colonIdx + 1).trim();
  if (after === '') return { key, value: undefined };

  // Inline flow array: [a, b, c]
  if (after.startsWith('[') && after.endsWith(']')) {
    const inside = after.slice(1, -1).trim();
    if (inside === '') return { key, value: [] };
    const items = splitFlowList(inside).map((it) => parseScalar(it.trim()));
    return { key, value: items };
  }
  return { key, value: parseScalar(after) };
}

function stripComment(line: string): string {
  // A `#` inside quotes shouldn't be treated as comment.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function findColonOutsideQuotes(s: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === ':' && !inSingle && !inDouble) return i;
  }
  return -1;
}

function splitFlowList(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  for (const ch of s) {
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth += 1;
      else if (ch === ']' || ch === '}') depth -= 1;
      else if (ch === ',' && depth === 0) {
        parts.push(buf);
        buf = '';
        continue;
      }
    }
    buf += ch;
  }
  if (buf.length > 0) parts.push(buf);
  return parts;
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  // Quoted strings — strip quotes
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
