/**
 * Turns a package's README into a small tree that a page can draw safely.
 *
 * A README is written by the package's publisher, so it is untrusted, and
 * Markdown may hold any HTML. This module never passes that HTML on. It reads
 * the Markdown with a parser, and then copies only what it knows into its own
 * tree: headings, paragraphs, lists, quotes, tables, code, emphasis, and links
 * to plain http(s) addresses. Everything else is left behind:
 *
 * - Raw HTML is dropped, tag by tag. The words between two tags stay.
 * - An image is dropped. The Content-Security-Policy would not load it, and a
 *   picture from a publisher's server would tell that server who is reading.
 * - A link that is not a plain http(s) address keeps its words and loses its
 *   address.
 *
 * `src/components/Readme.astro` draws the tree. Astro escapes every string it
 * is given, so a page holds no markup that the publisher wrote.
 */
import { Lexer, type Token, type Tokens } from 'marked';
import { safeUrl } from './npm';

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'break' }
  | { type: 'strong' | 'emphasis' | 'strike'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; level: 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  /** Words that stand in a list item without a paragraph around them. */
  | { type: 'plain'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  /** `head` is empty when the table has no heading row. */
  | { type: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' };

export interface Readme {
  blocks: Block[];
  /** True when the README was longer than the page shows. */
  truncated: boolean;
}

/** The most of a README that is read, in characters. */
const MAX_CHARS = 40_000;
/** The most parts the tree may have. A README made to be huge stops here. */
const MAX_NODES = 5_000;
/** How deep lists and quotes may nest. Deeper content is dropped. */
const MAX_DEPTH = 8;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rarr: '→',
  larr: '←',
};

/** `&amp;` and `&#38;` as the characters they stand for. The result is text. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? whole;
    const code =
      body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    // Leave out control characters and numbers that are not characters.
    if (!Number.isInteger(code) || code < 0x20 || code > 0x10ffff) return '';
    if (code >= 0xd800 && code <= 0xdfff) return '';
    return String.fromCodePoint(code);
  });
}

/** Control characters out, except the tab and the line break that code needs. */
function clean(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

function hasWords(nodes: Inline[]): boolean {
  return nodes.some((node) =>
    node.type === 'text' || node.type === 'code'
      ? node.value.trim() !== ''
      : node.type !== 'break' && hasWords(node.children),
  );
}

class Builder {
  private nodes = 0;
  truncated = false;

  /** Counts one more part. False once the tree is as large as it may be. */
  private room(): boolean {
    if (this.nodes >= MAX_NODES) {
      this.truncated = true;
      return false;
    }
    this.nodes++;
    return true;
  }

  inlines(tokens: Token[] | undefined, depth: number): Inline[] {
    const out: Inline[] = [];
    if (!tokens || depth > MAX_DEPTH) return out;
    for (const token of tokens) {
      if (!this.room()) break;
      switch (token.type) {
        case 'text':
        case 'escape': {
          const nested = (token as Tokens.Text).tokens;
          if (nested?.length) out.push(...this.inlines(nested, depth + 1));
          else out.push({ type: 'text', value: clean(decodeEntities(token.text as string)) });
          break;
        }
        case 'codespan':
          out.push({ type: 'code', value: clean(token.text as string) });
          break;
        case 'br':
          out.push({ type: 'break' });
          break;
        case 'strong':
        case 'em':
        case 'del': {
          const children = this.inlines((token as Tokens.Strong).tokens, depth + 1);
          if (!children.length) break;
          const type = token.type === 'strong' ? 'strong' : token.type === 'em' ? 'emphasis' : 'strike';
          out.push({ type, children });
          break;
        }
        case 'link': {
          const children = this.inlines((token as Tokens.Link).tokens, depth + 1);
          // A link around a picture has no words left once the picture goes.
          if (!hasWords(children)) break;
          const href = safeUrl((token as Tokens.Link).href);
          if (href) out.push({ type: 'link', href, children });
          else out.push(...children);
          break;
        }
        // 'image', 'html', 'checkbox', and anything this does not know: dropped.
        default:
          break;
      }
    }
    return out;
  }

  blocks(tokens: Token[] | undefined, depth: number): Block[] {
    const out: Block[] = [];
    if (!tokens || depth > MAX_DEPTH) return out;
    for (const token of tokens) {
      if (!this.room()) break;
      switch (token.type) {
        case 'heading': {
          const children = this.inlines((token as Tokens.Heading).tokens, depth + 1);
          if (!hasWords(children)) break;
          // The page has its own h1 and h2, so a README's headings start at h3.
          const level = Math.min(6, (token as Tokens.Heading).depth + 2) as 3 | 4 | 5 | 6;
          out.push({ type: 'heading', level, children });
          break;
        }
        case 'paragraph': {
          const children = this.inlines((token as Tokens.Paragraph).tokens, depth + 1);
          if (hasWords(children)) out.push({ type: 'paragraph', children });
          break;
        }
        case 'text': {
          const children = this.inlines([token], depth + 1);
          if (hasWords(children)) out.push({ type: 'plain', children });
          break;
        }
        case 'code':
          out.push({ type: 'code', value: clean((token as Tokens.Code).text) });
          break;
        case 'blockquote': {
          const children = this.blocks((token as Tokens.Blockquote).tokens, depth + 1);
          if (children.length) out.push({ type: 'quote', children });
          break;
        }
        case 'list': {
          const list = token as Tokens.List;
          const items = list.items
            .map((item) => this.blocks(item.tokens, depth + 1))
            .filter((item) => item.length > 0);
          if (!items.length) break;
          const start = typeof list.start === 'number' && list.start >= 0 ? Math.floor(list.start) : 1;
          out.push({ type: 'list', ordered: list.ordered, start, items });
          break;
        }
        case 'table': {
          const table = token as Tokens.Table;
          const cell = (c: Tokens.TableCell) => this.inlines(c.tokens, depth + 1);
          const head = table.header.map(cell);
          // A table whose heading cells are all empty has no heading row.
          out.push({
            type: 'table',
            head: head.some(hasWords) ? head : [],
            rows: table.rows.map((row) => row.map(cell)),
          });
          break;
        }
        case 'hr':
          out.push({ type: 'rule' });
          break;
        // 'html', 'space', 'def', and anything this does not know: dropped.
        default:
          break;
      }
    }
    return out;
  }
}

/** Reads a README. Returns null when there is nothing to show. */
export function parseReadme(source: unknown): Readme | null {
  if (typeof source !== 'string') return null;
  const text = source.trim();
  // What the registry stores for a package that was published without one.
  if (!text || /^ERROR: No README data found!?$/i.test(text)) return null;

  const builder = new Builder();
  let blocks: Block[];
  try {
    blocks = builder.blocks(Lexer.lex(text.slice(0, MAX_CHARS), { gfm: true }), 0);
  } catch {
    // A README the parser cannot read is not worth failing the build for.
    return null;
  }
  if (!blocks.length) return null;
  return { blocks, truncated: builder.truncated || text.length > MAX_CHARS };
}
