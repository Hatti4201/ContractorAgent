import type { CdpTab } from "@/services/cdp";
import { pause } from "@/services/cdp";
import type { JobCard } from "@/services/exposure-rules";

// Page-side scripts for the exposure channel. They are plain strings rather than serialized functions
// so no bundler helper can leak into code that runs inside Dice's page.

export type PageElement = {
  id: number;
  kind: string;
  label: string;
  question: string | null;
  value: string | null;
  checked: boolean | null;
  required: boolean;
  options: string[] | null;
};

export type PageSnapshot = {
  url: string;
  title: string;
  text: string;
  frameSources: string[];
  elements: PageElement[];
};

// Walks open shadow roots too, and tags each visible control with data-exposure-id for later clicks.
const SNAPSHOT = String.raw`(() => {
  const found = [];
  const selector = 'a[href],button,input,select,textarea,[role=button],[role=radio],[role=checkbox],[role=combobox],[role=option],[role=switch],[contenteditable=true]';
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const clean = (v) => (v || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const labelOf = (el) => clean(el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('placeholder') || el.innerText || el.value || el.getAttribute('name') || el.getAttribute('title'));
  const questionOf = (el) => {
    const group = el.closest('fieldset,[role=radiogroup],[role=group]');
    const legend = group && (group.querySelector('legend') || (group.getAttribute('aria-labelledby') && document.getElementById(group.getAttribute('aria-labelledby'))));
    const described = el.getAttribute('aria-describedby') && document.getElementById(el.getAttribute('aria-describedby'));
    return clean((legend && legend.innerText) || (group && group.getAttribute('aria-label')) || (described && described.innerText)) || null;
  };
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot);
      if (!el.matches(selector) || !visible(el) || el.disabled || el.type === 'hidden') continue;
      if (found.length >= 90) return;
      el.setAttribute('data-exposure-id', String(found.length));
      const tag = el.tagName.toLowerCase();
      const kind = el.getAttribute('role') || (tag === 'input' ? 'input:' + (el.type || 'text') : tag);
      const checkable = el.type === 'checkbox' || el.type === 'radio' || el.getAttribute('aria-checked') !== null;
      found.push({
        id: found.length,
        kind,
        label: labelOf(el),
        question: questionOf(el),
        value: tag === 'select' ? clean(el.selectedOptions[0] && el.selectedOptions[0].text) : ('value' in el && !checkable ? clean(el.value) || null : null),
        checked: checkable ? Boolean(el.checked || el.getAttribute('aria-checked') === 'true') : null,
        required: Boolean(el.required || el.getAttribute('aria-required') === 'true'),
        options: tag === 'select' ? [...el.options].slice(0, 20).map((o) => clean(o.text)) : null,
      });
    }
  };
  for (const old of document.querySelectorAll('[data-exposure-id]')) old.removeAttribute('data-exposure-id');
  walk(document);
  const main = document.querySelector('main') || document.body;
  return {
    url: location.href,
    title: document.title,
    text: (main.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 3500),
    frameSources: [...document.querySelectorAll('iframe')].map((f) => f.src || ''),
    elements: found,
  };
})()`;

const FIND = (id: number) => String.raw`(() => {
  const find = (root) => {
    const hit = root.querySelector('[data-exposure-id="${id}"]');
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const inner = find(el.shadowRoot); if (inner) return inner; } }
    return null;
  };
  return find(document);
})()`;

export function snapshot(tab: CdpTab) {
  return tab.evaluate<PageSnapshot>(SNAPSHOT);
}

/** Waits for client rendering: polls until `selector` exists, or gives up and lets the caller look. */
export async function waitFor(tab: CdpTab, selector: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tab.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true;
    await pause(500);
  }
  return false;
}

export function readCards(tab: CdpTab) {
  return tab.evaluate<{ cards: JobCard[]; pageLabel: string | null }>(String.raw`(() => ({
    cards: [...document.querySelectorAll('[data-testid="job-card"]')].map((card) => ({
      guid: card.getAttribute('data-job-guid') || '',
      lines: card.innerText.split('\n').map((line) => line.trim()).filter(Boolean),
    })).filter((card) => card.guid),
    pageLabel: document.querySelector('[aria-label^="Page "]')?.getAttribute('aria-label') ?? null,
  }))()`);
}

/** The job page's apply control: its link says whether this is Easy Apply or an outside site. */
export function readApplyButton(tab: CdpTab) {
  return tab.evaluate<{ text: string; href: string | null } | null>(String.raw`(() => {
    const button = document.querySelector('[data-testid="apply-button"]');
    if (!button) return null;
    return { text: button.innerText.replace(/\s+/g, ' ').trim(), href: button.getAttribute('href') };
  })()`);
}

async function centerOf(tab: CdpTab, finder: string) {
  const box = await tab.evaluate<{ x: number; y: number } | null>(`(() => {
    const el = ${finder};
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) throw new Error("The element to click is no longer on the page.");
  return box;
}

export async function clickElement(tab: CdpTab, id: number) {
  const { x, y } = await centerOf(tab, FIND(id));
  await tab.clickAt(x, y);
}

/** Replaces a field's text by focusing it, selecting what is there and typing over it. */
export async function fillElement(tab: CdpTab, id: number, value: string) {
  await clickElement(tab, id);
  await tab.evaluate(`(() => { const el = ${FIND(id)}; if (el && el.select) el.select(); else if (el) document.execCommand('selectAll'); })()`);
  await tab.insertText(value);
}

/** Native <select> only; custom dropdowns are opened and picked with clicks instead. */
export async function selectOption(tab: CdpTab, id: number, optionText: string) {
  const chosen = await tab.evaluate<boolean>(`(() => {
    const el = ${FIND(id)};
    if (!el || el.tagName !== 'SELECT') return false;
    const option = [...el.options].find((o) => o.text.trim().toLowerCase() === ${JSON.stringify(optionText.trim().toLowerCase())});
    if (!option) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, option.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!chosen) throw new Error(`No option "${optionText}" in that dropdown.`);
}
