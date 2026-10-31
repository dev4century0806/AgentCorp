/**
 * Sanitizes the HTML body of an admin message (issue #247) for the inbox.
 *
 * The HTML is parsed into an inert document (no scripts run, nothing loads),
 * then copied element by element into fresh nodes, keeping only an allowlist
 * of tags and attributes. The result is DOM nodes, never a string that is
 * parsed again, so nothing can change meaning on the way back in.
 *
 * Kept: p, br, a, strong, em, b, i, ul, ol, li, h1–h3, img, blockquote,
 * code, pre, and plain div, span and hr. Unknown tags are unwrapped (their
 * text stays); script, style, iframe, form, svg and the like are dropped with
 * everything inside. No attribute survives but a link's http(s)/mailto href
 * and title, and an image's http(s) src, alt, title, width and height. Links
 * open outside the app (target=_blank, which the desktop app hands to the
 * system browser).
 *
 * packages/admin/src/lib/sanitize.ts is a byte-identical copy, so the admin's
 * preview shows exactly what the inbox will; a test fails if they drift.
 */

const HTML_NS = 'http://www.w3.org/1999/xhtml';

const KEEP = new Set([
  'p', 'br', 'a', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'h1', 'h2', 'h3',
  'img', 'blockquote', 'code', 'pre', 'div', 'span', 'hr',
]);

/** Removed along with their content. */
const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'param',
  'form', 'input', 'button', 'select', 'option', 'textarea', 'template', 'noscript',
  'svg', 'math', 'link', 'meta', 'base', 'head', 'title', 'audio', 'video', 'source',
  'track', 'canvas', 'dialog', 'portal', 'xmp', 'noembed', 'noframes', 'plaintext',
]);

const ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
};

/** Deeper nesting than this is flattened to text, so a hostile body can't exhaust the stack. */
const MAX_DEPTH = 64;

/** An absolute http(s) URL (or mailto: for links), or null. Relative URLs are refused. */
export function safeUrl(value: string, kind: 'link' | 'image'): string | null {
  // Browsers ignore control characters and whitespace inside schemes ("java\tscript:").
  const cleaned = value.replace(/[\u0000- \u007f-\u009f]/g, '');
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  const allowed = kind === 'link' ? ['http:', 'https:', 'mailto:'] : ['http:', 'https:'];
  return allowed.includes(url.protocol) ? url.href : null;
}

function copyChildren(from: Node, to: Node, doc: Document, depth: number): void {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === 3) {
      to.appendChild(doc.createTextNode(child.nodeValue ?? ''));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const source = child as Element;
    const tag = source.localName.toLowerCase();
    if (source.namespaceURI !== HTML_NS || DROP.has(tag)) continue;
    if (depth >= MAX_DEPTH) {
      to.appendChild(doc.createTextNode(source.textContent ?? ''));
      continue;
    }
    if (!KEEP.has(tag)) {
      copyChildren(source, to, doc, depth + 1);
      continue;
    }

    const made = doc.createElement(tag);
    for (const name of ATTRIBUTES[tag] ?? []) {
      const value = source.getAttribute(name);
      if (value === null) continue;
      if (name === 'href' || name === 'src') {
        const url = safeUrl(value, name === 'href' ? 'link' : 'image');
        if (url) made.setAttribute(name, url);
      } else if (name === 'width' || name === 'height') {
        if (/^\d{1,4}$/.test(value.trim())) made.setAttribute(name, value.trim());
      } else {
        made.setAttribute(name, value);
      }
    }
    if (tag === 'img' && !made.hasAttribute('src')) continue;
    if (tag === 'a') {
      if (!made.hasAttribute('href')) {
        copyChildren(source, to, doc, depth + 1);
        continue;
      }
      made.setAttribute('target', '_blank');
      made.setAttribute('rel', 'noopener noreferrer');
    }
    copyChildren(source, made, doc, depth + 1);
    to.appendChild(made);
  }
}

/** The safe nodes for an HTML message body, made in `doc`. */
export function sanitizeHtml(html: string, doc: Document = document): DocumentFragment {
  // A document made this way has no browsing context: parsing it runs no
  // script and fetches no image, even for <img onerror>.
  const inert = doc.implementation.createHTMLDocument('');
  inert.body.innerHTML = html;
  const out = doc.createDocumentFragment();
  copyChildren(inert.body, out, doc, 0);
  return out;
}

/** The text of an HTML body, for one-line previews shown with textContent. */
export function htmlText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    // Block tags separate words; inline ones (<strong>, <a>) don't.
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|blockquote|pre|br|hr|img|tr|td|th|table)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}
