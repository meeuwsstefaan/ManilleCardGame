import en from './locales/en.mjs';
import nl from './locales/nl.mjs';
import fr from './locales/fr.mjs';

export const LANGUAGE_STORAGE_KEY = 'manille.language';
export const LANGUAGES = ['nl', 'en', 'fr', 'both'];
const dictionaries = {en, nl, fr};

export function formatMessage(key, params = {}, language = 'en') {
  const dictionary = dictionaries[language] || en;
  if (!(key in dictionary)) throw new Error(`Missing translation: ${key}`);
  const values = Object.fromEntries(Object.entries(params).map(([name, value]) =>
    [name, value && typeof value === 'object' && 'key' in value
      ? formatMessage(value.key, value.params, language) : value]));
  return typeof dictionary[key] === 'function' ? dictionary[key](values) : dictionary[key];
}

// Translate presentation only: switching languages never restarts or renders a deal.
export function createI18n(document, storage) {
  let language = 'both';
  try {
    const saved = storage?.getItem(LANGUAGE_STORAGE_KEY);
    if (LANGUAGES.includes(saved)) language = saved;
  } catch { /* Storage may be disabled; the selector still works. */ }

  function text(key, params = {}) {
    if (Object.values(dictionaries).some(dictionary => !(key in dictionary))) throw new Error(`Missing translation: ${key}`);
    if (language !== 'both') return formatMessage(key, params, language);
    const english = formatMessage(key, params, 'en');
    const dutch = formatMessage(key, params, 'nl');
    return dutch === english ? dutch : `${dutch} / ${english}`;
  }

  function label(element, key, params = {}) {
    element.setAttribute('data-i18n', key);
    element.setAttribute('data-i18n-values', JSON.stringify(params));
    const value = text(key, params);
    if (language !== 'both' || element.tagName === 'OPTION' || formatMessage(key, params, 'nl') === formatMessage(key, params, 'en')) {
      element.textContent = value;
      element.setAttribute('lang', language === 'both' ? 'nl' : language);
      return;
    }
    const primary = document.createElement('span');
    primary.className = 'i18n-primary'; primary.lang = 'nl'; primary.textContent = formatMessage(key, params, 'nl');
    const secondary = document.createElement('span');
    secondary.className = 'i18n-secondary'; secondary.lang = 'en'; secondary.textContent = formatMessage(key, params, 'en');
    element.replaceChildren(primary, secondary);
  }

  function aria(element, key, params = {}) {
    element.setAttribute('data-i18n-aria', key);
    element.setAttribute('data-i18n-aria-values', JSON.stringify(params));
    element.setAttribute('aria-label', text(key, params));
  }

  function compact(element, key, params = {}) {
    element.setAttribute('data-i18n-compact', key);
    element.setAttribute('data-i18n-compact-values', JSON.stringify(params));
    element.textContent = text(key, params).replace(' / ', '/');
  }

  function title(element, key, params = {}) {
    element.setAttribute('data-i18n-title', key);
    element.setAttribute('data-i18n-title-values', JSON.stringify(params));
    element.setAttribute('title', text(key, params));
  }

  function refresh() {
    document.documentElement.lang = language === 'both' ? 'nl' : language;
    document.documentElement.dataset.language = language;
    document.title = `Manille · ${text('subtitle')}`;
    for (const [attribute, update, values] of [
      ['data-i18n', label, 'data-i18n-values'], ['data-i18n-aria', aria, 'data-i18n-aria-values'],
      ['data-i18n-compact', compact, 'data-i18n-compact-values'], ['data-i18n-title', title, 'data-i18n-title-values'],
    ]) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        update(element, element.getAttribute(attribute), JSON.parse(element.getAttribute(values) || '{}'));
      }
    }
    document.getElementById('language').value = language;
  }

  function setLanguage(value) {
    if (!LANGUAGES.includes(value)) return;
    language = value;
    try { storage?.setItem(LANGUAGE_STORAGE_KEY, value); } catch { /* Optional persistence. */ }
    refresh();
  }

  document.getElementById('language').addEventListener('change', event => setLanguage(event.target.value));
  refresh();
  return {text, label, aria, compact, title, setLanguage, get language() { return language; }};
}
