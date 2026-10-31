/**
 * The office's own tooltip, in place of the browser's grey one. Mounted once,
 * it serves every element with a `title`: on hover or keyboard focus it lifts
 * the title off (so the native tooltip never shows), shows it in a themed
 * bubble, and puts it back on leave. Code keeps setting `title` as before.
 * `data-tip-align="end"` on the element, or on a box round it, lines the
 * bubble up with its right edge instead of centring it; `"left"` puts it
 * beside the element, to its left, and `"up-left"` up and to its left.
 */

const SHOW_DELAY_MS = 400;
const GAP = 8;
const EDGE = 8;

type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;
type TipAlign = 'centre' | 'end' | 'left' | 'up-left';
const ALIGNS: readonly string[] = ['end', 'left', 'up-left'];

/**
 * Where the bubble goes: below the anchor, above it when there is no room
 * below, and kept inside the viewport either way. It is centred on the anchor,
 * or at `end` lined up with its right edge, so it keeps clear of a neighbour
 * to the right. At `left` it goes beside the anchor instead, level with it,
 * for a column of buttons at the right edge with neighbours above and below;
 * at `up-left` it sits up off the anchor's row, for when that row has
 * neighbours to the left as well.
 */
export function placeTooltip(
  anchor: Box,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  align: TipAlign = 'centre',
): { left: number; top: number; above: boolean } {
  if (align === 'left' || align === 'up-left') {
    const wanted = align === 'left' ? anchor.top + anchor.height / 2 - tip.height / 2 : anchor.top - GAP / 2 - tip.height;
    const top = Math.max(EDGE, Math.min(wanted, viewport.height - EDGE - tip.height));
    return { left: Math.round(Math.max(EDGE, anchor.left - GAP - tip.width)), top: Math.round(top), above: false };
  }
  const above = anchor.bottom + GAP + tip.height > viewport.height - EDGE && anchor.top - GAP - tip.height >= EDGE;
  const top = above ? anchor.top - GAP - tip.height : anchor.bottom + GAP;
  const wanted = align === 'end' ? anchor.right - tip.width : anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.max(EDGE, Math.min(wanted, viewport.width - EDGE - tip.width));
  return { left: Math.round(left), top: Math.round(top), above };
}

/** How an element asked for its bubble to be placed, read off `data-tip-align`. */
export function tipAlign(asked: string | null | undefined): TipAlign {
  return asked && ALIGNS.includes(asked) ? (asked as TipAlign) : 'centre';
}

/**
 * Whether the title is all a screen reader has to name the element by, so it
 * has to stand in as `aria-label` while it is lifted off: no label of its own,
 * and text that is only a symbol, like "×", or none at all, as for an icon.
 */
export function titleIsOnlyName(el: { ariaLabel: string | null; ariaLabelledby: string | null; text: string }): boolean {
  return !el.ariaLabel?.trim() && !el.ariaLabelledby?.trim() && !/[\p{L}\p{N}]/u.test(el.text);
}

/**
 * Whether a scroll moved the anchor: the page itself, or a box with the anchor
 * inside it. A chat streaming in beside a hovered button scrolls only itself.
 */
export function scrollMovesAnchor(scrolled: { contains?: (other: Node) => boolean } | null, anchor: Node): boolean {
  return scrolled?.contains?.(anchor) ?? false;
}

export function mountTooltips(root: Document = document): void {
  const bubble = root.createElement('div');
  bubble.className = 'tip';
  bubble.id = 'appTooltip';
  bubble.setAttribute('role', 'tooltip');
  bubble.hidden = true;
  root.body.appendChild(bubble);

  let anchor: HTMLElement | null = null;
  let text = '';
  let timer: number | undefined;
  // What the anchor had before we lent it a label and a description, to put back.
  let labelled = false;
  let describedBy: string | null = null;
  // Render code may set a new title while the bubble is up ("See Sam" after a
  // step); take it straight off again and show it.
  const watch = new MutationObserver(() => {
    if (!anchor?.hasAttribute('title')) return;
    text = anchor.getAttribute('title') ?? '';
    anchor.removeAttribute('title');
    if (labelled && text) anchor.setAttribute('aria-label', text);
    if (!text) hide();
    else if (!bubble.hidden) show();
  });

  const show = () => {
    if (!anchor || !anchor.isConnected) return hide();
    bubble.textContent = text;
    // Measure at the origin: left where it was, near an edge, it would wrap.
    bubble.style.left = bubble.style.top = '0px';
    bubble.hidden = false;
    const spot = placeTooltip(
      anchor.getBoundingClientRect(),
      bubble.getBoundingClientRect(),
      { width: root.documentElement.clientWidth, height: root.documentElement.clientHeight },
      tipAlign(anchor.closest('[data-tip-align]')?.getAttribute('data-tip-align')),
    );
    bubble.style.left = `${spot.left}px`;
    bubble.style.top = `${spot.top}px`;
    bubble.classList.toggle('above', spot.above);
  };

  function hide(): void {
    window.clearTimeout(timer);
    bubble.hidden = true;
    watch.disconnect();
    if (anchor) {
      if (text && !anchor.hasAttribute('title')) anchor.setAttribute('title', text);
      if (labelled) anchor.removeAttribute('aria-label');
      if (describedBy === null) anchor.removeAttribute('aria-describedby');
      else anchor.setAttribute('aria-describedby', describedBy);
    }
    anchor = null;
    text = '';
    labelled = false;
    describedBy = null;
  }

  const arm = (target: EventTarget | null, delay: number) => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[title]') : null;
    if (!el || el === anchor) return;
    hide();
    text = el.getAttribute('title') ?? '';
    if (!text.trim()) return;
    anchor = el;
    labelled = titleIsOnlyName({
      ariaLabel: el.getAttribute('aria-label'),
      ariaLabelledby: el.getAttribute('aria-labelledby'),
      text: el.textContent ?? '',
    });
    describedBy = el.getAttribute('aria-describedby');
    el.removeAttribute('title');
    if (labelled) el.setAttribute('aria-label', text);
    el.setAttribute('aria-describedby', describedBy ? `${describedBy} ${bubble.id}` : bubble.id);
    watch.observe(el, { attributes: true, attributeFilter: ['title'] });
    timer = window.setTimeout(show, delay);
  };

  root.addEventListener('pointerover', (e) => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    arm(e.target, SHOW_DELAY_MS);
  });
  root.addEventListener('pointerout', (e) => {
    if (anchor && !anchor.contains((e as PointerEvent).relatedTarget as Node | null)) hide();
  });
  root.addEventListener('focusin', (e) => {
    if ((e.target as Element).matches?.(':focus-visible')) arm(e.target, SHOW_DELAY_MS);
  });
  root.addEventListener('focusout', (e) => {
    if (e.target === anchor) hide();
  });
  // A click or Escape puts the bubble away but keeps the title lifted until
  // the pointer leaves, so the native one can't creep in behind it.
  const dismiss = () => {
    window.clearTimeout(timer);
    bubble.hidden = true;
  };
  root.addEventListener('pointerdown', dismiss, true);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismiss();
  });
  // Put it away when the anchor moves, but keep the title lifted: the pointer
  // may still be on it, and nothing would re-arm the bubble to take it off again.
  root.addEventListener(
    'scroll',
    (e) => {
      if (anchor && scrollMovesAnchor(e.target as Node | null, anchor)) dismiss();
    },
    true,
  );
}
