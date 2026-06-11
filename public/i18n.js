/**
 * Lightweight i18n module for MeetingTwin (vanilla, no dependencies).
 *
 * Usage:
 *   await i18n.load('en');          // fetch locale dictionary
 *   i18n.apply();                   // translate static [data-i18n] DOM
 *   i18n.t('batch.decoding', { track: 1, total: 3 });
 *   await i18n.setLanguage('it');   // switch language at runtime
 */
const i18n = (() => {
  const SUPPORTED = ['en', 'it'];
  const FALLBACK = 'it';
  const STORAGE_KEY = 'lang';

  let dict = {};
  let lang = FALLBACK;
  let onChange = null; // re-render callback for dynamic content

  /**
   * Detect the initial language: stored choice → browser language → fallback.
   */
  function detect() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;

    const browser = (navigator.language || '').slice(0, 2).toLowerCase();
    if (SUPPORTED.includes(browser)) return browser;

    return FALLBACK;
  }

  /**
   * Fetch and store the dictionary for the given language.
   */
  async function load(nextLang) {
    const target = SUPPORTED.includes(nextLang) ? nextLang : FALLBACK;
    const res = await fetch(`locales/${target}.json`);
    if (!res.ok) throw new Error(`Failed to load locale '${target}': ${res.status}`);
    dict = await res.json();
    lang = target;
  }

  /**
   * Resolve a nested key (e.g. 'batch.decoding') against the dictionary.
   */
  function lookup(key) {
    return key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), dict);
  }

  /**
   * Translate a key, interpolating {placeholder} tokens with params.
   * Returns the key itself when missing, so untranslated strings are visible.
   */
  function t(key, params) {
    const value = lookup(key);
    if (typeof value !== 'string') return key;
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? params[name] : match
    );
  }

  /**
   * Translate all static elements within root:
   *   [data-i18n]              → textContent
   *   [data-i18n-placeholder]  → placeholder attribute
   */
  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.documentElement.lang = lang;
  }

  /**
   * Switch language: load dictionary, re-apply static DOM, persist choice,
   * then invoke the re-render callback for dynamic content.
   */
  async function setLanguage(nextLang) {
    await load(nextLang);
    apply();
    localStorage.setItem(STORAGE_KEY, lang);
    if (typeof onChange === 'function') onChange();
  }

  function current() {
    return lang;
  }

  function supported() {
    return SUPPORTED.slice();
  }

  function setOnChange(fn) {
    onChange = fn;
  }

  return { detect, load, t, apply, setLanguage, current, supported, setOnChange };
})();
