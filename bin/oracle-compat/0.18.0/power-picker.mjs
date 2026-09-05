// Compatibility for ChatGPT's model-list + five-position Power picker.
// Only DOM-visible controls are used. The source is serialized into Oracle's page.
export async function selectPowerPickerInPage({ model, level, timeoutMs = 8000 }) {
  const normalizedModel = String(model || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wantsSixPro = /^(?:gpt )?6 pro$/.test(normalizedModel);
  if (!wantsSixPro && !/^(?:gpt )?5 6(?: sol)?$/.test(normalizedModel)) return null;
  const levels = { light: 0, standard: 1, extended: 2, 'extra-high': 3, heavy: 3, pro: 4 };
  if (!wantsSixPro && !Object.hasOwn(levels, level)) return null;
  if (wantsSixPro && level && level !== 'pro') throw new Error('GPT-6 Pro requires Pro power.');
  const target = wantsSixPro ? 4 : levels[level];
  const deadline = Date.now() + timeoutMs;
  const sleep = () => new Promise(resolve => setTimeout(resolve, 100));
  const visible = el => Boolean(el && !el.closest('[inert], [aria-hidden="true"]')
    && el.getBoundingClientRect().width && el.getBoundingClientRect().height);
  const disabled = el => !el || el.disabled || el.getAttribute('aria-disabled') === 'true'
    || el.hasAttribute('data-disabled');
  // Radix opens menu triggers on pointerdown, not HTMLElement.click(). Match
  // Oracle's existing DOM click dispatcher instead of skipping the pointer events.
  const click = el => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const init = { bubbles: true, cancelable: true, view: window };
      const event = type.startsWith('pointer') && typeof PointerEvent !== 'undefined'
        ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse' })
        : new MouseEvent(type, init);
      el.dispatchEvent(event);
    }
  };
  const wait = async read => {
    while (Date.now() < deadline) { const result = read(); if (result) return result; await sleep(); }
    return null;
  };
  const trigger = await wait(() => Array.from(document.querySelectorAll('button.__composer-pill[aria-haspopup="menu"]'))
    .find(el => visible(el) && !disabled(el)));
  if (!trigger) {
    if (wantsSixPro) throw new Error('GPT-6 Pro composer picker is unavailable; refusing to submit.');
    return null;
  }
  if (trigger.getAttribute('aria-expanded') !== 'true') click(trigger);
  const picker = await wait(() => {
    const menu = document.getElementById(trigger.getAttribute('aria-controls'));
    const candidate = menu?.querySelector('[data-testid="composer-intelligence-picker-content"]');
    return visible(candidate) && candidate.querySelector('[data-model-reasoning-effort-slider]') ? candidate : null;
  });
  if (!picker) {
    if (wantsSixPro) throw new Error('GPT-6 Pro Power picker is unavailable; refusing to submit.');
    return null; // Leave older layouts to the upstream selector.
  }
  const advanced = () => picker.querySelector('[data-testid="composer-model-picker-slider-advanced-view"]');
  const toggle = () => picker.querySelector('[role="menuitem"][aria-expanded]');
  const latest = () => Array.from(advanced()?.querySelectorAll('[role="menuitemradio"]') || [])
    .find(el => /^(latest|최신)$/i.test(el.textContent.trim()));
  if (wantsSixPro && latest()?.getAttribute('aria-checked') !== 'true') {
    const control = toggle();
    if (!visible(control) || disabled(control)) throw new Error('Latest model control is unavailable.');
    if (control.getAttribute('aria-expanded') !== 'true') click(control);
    const option = await wait(() => visible(latest()) && !disabled(latest()) ? latest() : null);
    if (!option) throw new Error('Latest model option is unavailable; refusing to submit GPT-6 Pro.');
    click(option);
    if (!await wait(() => latest()?.getAttribute('aria-checked') === 'true')) {
      throw new Error('Latest model selection was not confirmed.');
    }
  }
  // Selecting a model returns to simple view. Collapse an already-open model list.
  if (toggle()?.getAttribute('aria-expanded') === 'true') click(toggle());
  const power = await wait(() => {
    const view = picker.querySelector('[data-testid="composer-model-picker-slider-simple-view"]');
    const el = view?.querySelector('[role="menuitem"][aria-keyshortcuts]');
    return visible(el) && !disabled(el) ? el : null;
  });
  if (!power) throw new Error('Power control is disabled or unavailable; refusing to submit.');
  // The actual ARIA slider is deliberately aria-hidden; its visible owner handles keys.
  const slider = () => power.querySelector('[role="slider"]');
  const value = () => Number(slider()?.getAttribute('aria-valuenow'));
  if (!slider() || slider().getAttribute('aria-valuemin') !== '0'
    || slider().getAttribute('aria-valuemax') !== '4'
    || !/^[0-4]$/.test(slider().getAttribute('aria-valuenow') || '')
    || slider().closest('[data-locked="true"], [aria-disabled="true"]')) {
    throw new Error('Unrecognized Power slider range; refusing to guess the requested tier.');
  }
  for (let step = 0; value() !== target && step < 5; step++) {
    const before = value();
    if (before < 0 || before > 4 || disabled(power)) throw new Error('Invalid Power slider state.');
    power.focus();
    const key = before < target ? 'ArrowRight' : 'ArrowLeft';
    power.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
    power.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true }));
    if (!await wait(() => value() !== before)) throw new Error('Power slider did not move; refusing to submit.');
  }
  const sixPro = label => /^(?:GPT[\s-]*)?6\s*Pro$/i.test(String(label || '').trim());
  const announcement = () => String(power.getAttribute('aria-describedby') || '').split(/\s+/)
    .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
  if (value() !== target) throw new Error('Requested Power position was not confirmed.');
  if (wantsSixPro && !await wait(() => latest()?.getAttribute('aria-checked') === 'true'
    && sixPro(toggle()?.textContent) && /^Pro(?:\s|,|$)/i.test(announcement()))) {
    throw new Error('Latest Pro is not visibly GPT-6 Pro; refusing to submit.');
  }
  if (!wantsSixPro && target === 4 && !/^Pro(?:\s|,|$)/i.test(announcement())) {
    throw new Error('Pro power label was not confirmed; refusing to submit.');
  }
  click(trigger);
  const closed = await wait(() => trigger.getAttribute('aria-expanded') === 'false');
  if (!closed || (wantsSixPro && !await wait(() => sixPro(trigger.textContent)))) {
    throw new Error('Composer did not retain the requested model and power.');
  }
  return { status: 'switched', label: trigger.textContent.trim(), power: target,
    latest: wantsSixPro, verified: true, source: 'chatgpt-power-picker' };
}

export async function ensurePowerPicker(Runtime, model, level) {
  const outcome = await Runtime.evaluate({
    expression: `(${selectPowerPickerInPage.toString()})(${JSON.stringify({ model, level })})`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (outcome.exceptionDetails) {
    const message = outcome.exceptionDetails.exception?.description || outcome.exceptionDetails.text;
    throw new Error(`Power picker verification failed: ${message}`);
  }
  return outcome.result?.value ?? null;
}
