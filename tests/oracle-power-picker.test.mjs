import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { selectPowerPickerInPage } from '../bin/oracle-compat/0.18.0/power-picker.mjs';
import { clickComposerSendInPage } from '../bin/oracle-compat/0.18.0/composer-send.mjs';

test('composer activates one resolved button without stale coordinate clicks and waits for readiness', () => {
  class Element {
    disabled = true; clicks = 0;
    getBoundingClientRect() { return { width: 36, height: 36, x: Math.random() * 1000 }; }
    hasAttribute(name) { return name === 'disabled' && this.disabled; }
    getAttribute() { return null; }
    click() { this.clicks++; }
    scrollIntoView() { throw new Error('coordinate sampling must not scroll the composer'); }
  }
  const button = new Element();
  const matches = [button];
  const context = vm.createContext({ HTMLElement: Element,
    document: { querySelectorAll: () => matches },
    window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', pointerEvents: 'auto' }) },
  });
  const run = () => vm.runInContext(`(${clickComposerSendInPage})(['a','b'])`, context);
  assert.equal(run().status, 'missing'); assert.equal(button.clicks, 0);
  button.disabled = false;
  assert.equal(run().status, 'clicked'); assert.equal(button.clicks, 1);
  const duplicate = new Element(); duplicate.disabled = false; matches.push(duplicate);
  assert.throws(run, /ambiguous/);
  assert.equal(button.clicks, 1); assert.equal(duplicate.clicks, 0);
});

// Observed September picker: a focusable menuitem owns an aria-hidden slider;
// the model list is inert until expanded, and selecting it returns to simple view.
function fixture({ latest = false, value = 2, latestModel = '6', locked = false,
  ignoreKeys = false, max = '4' } = {}) {
  const state = { latest, value, open: false, advanced: false, keys: [] };
  const labels = ['Light', 'Standard', 'High', 'Very high', 'Pro'];
  const currentLabel = () => state.value === 4 ? `${state.latest ? latestModel : '5.6'} Pro` : labels[state.value];
  const node = (attrs = {}, visibility = () => true) => ({
    getAttribute(name) { const v = attrs[name]; return typeof v === 'function' ? v() : v ?? null; },
    hasAttribute(name) { return this.getAttribute(name) !== null; },
    closest() { return visibility() ? null : {}; },
    getBoundingClientRect() { return { width: visibility() ? 100 : 0, height: 30 }; },
    focus() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    dispatchEvent(event) { if (event.type === 'click') this.onClick?.(); },
  });
  const trigger = node({ 'aria-expanded': () => String(state.open), 'aria-controls': 'menu' });
  Object.defineProperty(trigger, 'textContent', { get: () => state.open ? 'Thinking effort' : currentLabel() });
  trigger.dispatchEvent = event => { if (event.type === 'pointerdown') state.open = !state.open; };
  const picker = node({}, () => state.open);
  const toggle = node({ 'aria-expanded': () => String(state.advanced) }, () => state.open);
  Object.defineProperty(toggle, 'textContent', { get: currentLabel });
  toggle.onClick = () => { state.advanced = !state.advanced; };
  const latestRow = node({ 'aria-checked': () => String(state.latest), 'aria-disabled': String(locked) }, () => state.open && state.advanced);
  latestRow.textContent = 'Latest';
  latestRow.onClick = () => { if (!locked) { state.latest = true; state.advanced = false; } };
  const advanced = node(); advanced.querySelectorAll = () => [latestRow];
  const slider = node({ 'aria-valuemin': '0', 'aria-valuemax': max, 'aria-valuenow': () => String(state.value) });
  const power = node({ 'aria-describedby': 'announcement keys' }, () => state.open && !state.advanced);
  power.querySelector = () => slider;
  power.dispatchEvent = event => {
    if (event.type !== 'keydown') return;
    state.keys.push(event.key);
    if (!ignoreKeys) state.value = Math.max(0, Math.min(4, state.value + (event.key === 'ArrowRight' ? 1 : -1)));
  };
  const simple = node(); simple.querySelector = () => power;
  picker.querySelector = selector => {
    if (selector.includes('advanced-view')) return advanced;
    if (selector.includes('simple-view')) return simple;
    if (selector.includes('aria-expanded')) return toggle;
    if (selector.includes('data-model-reasoning-effort-slider')) return slider;
    return null;
  };
  const menu = node(); menu.querySelector = () => picker;
  let now = 0;
  const context = vm.createContext({
    document: {
      querySelectorAll: () => [trigger],
      getElementById(id) {
        if (id === 'menu') return menu;
        if (id === 'announcement') return { textContent: `${labels[state.value]}, ${state.value + 1} of 5.` };
        return { textContent: 'Use Left and Right arrow keys to adjust power.' };
      },
    },
    Date: { now: () => now },
    setTimeout(fn) { now += 100; fn(); },
    window: {},
    KeyboardEvent: class { constructor(type, fields) { Object.assign(this, { type }, fields); } },
    PointerEvent: class { constructor(type, fields) { Object.assign(this, { type }, fields); } },
    MouseEvent: class { constructor(type, fields) { Object.assign(this, { type }, fields); } },
  });
  return { state, run: args => vm.runInContext(`(${selectPowerPickerInPage})(${JSON.stringify({ timeoutMs: 1200, ...args })})`, context) };
}

test('switches explicit Sol to Latest and verifies 6 Pro after closing the picker', async () => {
  const page = fixture(); const result = await page.run({ model: 'GPT-6 Pro', level: 'pro' });
  assert.equal(result.label, '6 Pro'); assert.equal(result.verified, true);
  assert.equal(page.state.latest, true); assert.equal(page.state.open, false);
  assert.deepEqual(page.state.keys, ['ArrowRight', 'ArrowRight']);
});
test('does not accept old Pro or a future model as GPT-6 Pro', async () => {
  for (const latestModel of ['5.6', '7']) {
    await assert.rejects(fixture({ latest: true, value: 4, latestModel }).run({ model: 'GPT-6 Pro' }), /not visibly GPT-6 Pro/);
  }
});
test('keeps explicit Sol for very-high and moves away from Pro', async () => {
  const page = fixture({ value: 4 });
  const result = await page.run({ model: 'GPT-5.6 Sol', level: 'heavy' });
  assert.equal(result.power, 3); assert.equal(page.state.latest, false);
  assert.deepEqual(page.state.keys, ['ArrowLeft']);
});
test('refuses locked Latest, ignored keys, changed range, and contradictory tier', async () => {
  await assert.rejects(fixture({ locked: true }).run({ model: 'GPT-6 Pro' }), /Latest model option/);
  await assert.rejects(fixture({ ignoreKeys: true }).run({ model: 'GPT-6 Pro' }), /did not move/);
  await assert.rejects(fixture({ max: '5' }).run({ model: 'GPT-6 Pro' }), /Unrecognized Power slider/);
  await assert.rejects(fixture().run({ model: 'GPT-6 Pro', level: 'heavy' }), /requires Pro/);
});
