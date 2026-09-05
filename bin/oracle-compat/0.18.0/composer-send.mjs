// Resolve and activate the same enabled DOM button in one page operation.
// This avoids a coordinate sample becoming stale when the composer expands.
export function clickComposerSendInPage(selectors) {
  const candidates = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))];
  const buttons = candidates.filter(node => {
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none'
      && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true'
      && !node.hasAttribute('data-disabled');
  });
  if (!buttons.length) return { status: 'missing' };
  if (buttons.length !== 1) throw new Error('Send button is ambiguous; prompt was not submitted.');
  buttons[0].click();
  return { status: 'clicked' };
}
