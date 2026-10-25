import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVersionNotice } from '../src/version-notice.js';
import { touchLayout } from '../src/touch.js';

// The DOM is the boundary here; positioning and real focus navigation are checked in the browser.
function document() {
  const doc = { createElement: () => ({
    children: [], attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    append(...children) { this.children.push(...children); children.forEach(child => { child.parent = this; }); },
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
  }) };
  doc.body = doc.createElement();
  return doc;
}

test('a passive update notice leaves menu content visible and tappable', () => {
  const doc = document(), show = createVersionNotice(doc);
  const css = readFileSync(new URL('../src/version-notice.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // Evaluate the notice's state-dependent declarations. Real layout and hit tests run in browser QA.
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].includes('#version-update'));
  const state = menu => {
    const button = doc.body.children[0].children[0], style = {};
    for (const [, selector, declarations] of rules) {
      if (selector.includes('body:not(.menu-open)') && menu) continue;
      if (/body\.menu-open/.test(selector) && !menu) continue;
      if (selector.includes(':has(button:disabled)') && !button.disabled) continue;
      for (const declaration of declarations.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon >= 0) style[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
      }
    }
    const visible = style.display !== 'none';
    return { visible, takesTaps: visible && style['pointer-events'] !== 'none' };
  };
  show({ canReload: false, reload() {} });
  assert.deepEqual(state(true), { visible: false, takesTaps: false }, 'passive notice must not cover the monk sheet or pause menu');
  assert.deepEqual(state(false), { visible: true, takesTaps: false }, 'during play the pending update stays visible without taking input');
  show({ canReload: true, reload() {} });
  assert.deepEqual(state(true), { visible: true, takesTaps: true }, 'after a run the update action remains available');
});

test('the passive touch update stays clear of the combat arc at 568x320', () => {
  const css = readFileSync(new URL('../src/version-notice.css', import.meta.url), 'utf8');
  const narrow = css.match(/@media \(width < 648px\) \{\s*html\.touch-ui body:not\(\.menu-open\) #version-update\.notice\.version-update \{([^}]*)\}/)?.[1] ?? '';
  const leftUnits = narrow.match(/left: calc\(var\(--safe-left\) \+ var\(--u\) \* (\d+)\)/)?.[1];
  const reservedUnits = narrow.match(/max-width: calc\(100% - var\(--safe-left\) - var\(--safe-right\) - var\(--u\) \* (\d+)\)/)?.[1];
  // Recorded Chromium text bounds at 568x320: 354.5px wide and 50px high, starting at y104.
  for (const inset of [0, 44]) {
    const layout = touchLayout({ width: 568, height: 320, safe: { left: inset, right: inset } });
    const width = reservedUnits ? Math.min(354.5, 568 - 2 * inset - Number(reservedUnits) * 2) : 354.5;
    const left = leftUnits ? inset + Number(leftUnits) * 2 : (568 - width) / 2;
    for (const button of Object.values(layout.buttons)) {
      const overlapWidth = Math.max(0, Math.min(left + width, button.x + button.size / 2) - Math.max(left, button.x - button.size / 2));
      const overlapHeight = Math.max(0, Math.min(154, button.y + button.size / 2) - Math.max(104, button.y - button.size / 2));
      assert.equal(overlapWidth * overlapHeight, 0, `${button.id}: update notice covers the combat button with ${inset}px insets`);
    }
  }
});

test('result menus reserve a separate bottom strip for an enabled update notice', () => {
  const css = readFileSync(new URL('../src/version-notice.css', import.meta.url), 'utf8');
  const strip = css.match(/html body\.menu-open:has\(#version-update button:not\(:disabled\)\):has\(#run-summary:not\(\[hidden\]\)\) \.overlay \{([^}]*)\}/)?.[1] ?? '';
  const units = Number(strip.match(/padding-bottom: max\(calc\(var\(--u\) \* (\d+)\)/)?.[1] ?? 4);
  // At both short phone sizes the update is50px high and sits4px above the bottom.
  // The result panel may fill the overlay's remaining height, including after scrolling.
  for (const height of [320, 390]) {
    const panelBottom = height - units * 2;
    const noticeTop = height - 4 - 50;
    assert.ok(panelBottom <= noticeTop - 8, `${height}px: result panel must stop above the update strip`);
    assert.ok(height - units * 2 - 8 >= 200, 'the result panel retains usable scroll height');
  }
});

test('a pending unsafe run has one persistent disabled notice that becomes actionable at the end', () => {
  const doc = document();
  const show = createVersionNotice(doc);
  let reloaded = 0;
  const reload = () => { reloaded++; };
  show({ canReload: false, reload });
  const notice = doc.body.children[0], button = notice.children[0];
  assert.equal(notice.id, 'version-update');
  assert.equal(notice.attributes.role, 'status');
  assert.equal(button.disabled, true);
  assert.match(button.textContent, /Доступна новая версия/);
  show({ canReload: true, reload });
  assert.equal(doc.body.children.length, 1);
  assert.equal(button.disabled, false);
  button.onclick();
  assert.equal(reloaded, 1);
  show(null);
  assert.equal(doc.body.children.length, 0);
});
