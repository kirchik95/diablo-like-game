// Game keys are physical keys (KeyboardEvent.code), so WASD works in any layout.
// Some browser and OS combinations send an empty or non-standard code for letters
// in a non-Latin layout; then the key is recovered from the typed letter or keyCode.
const RUSSIAN_JCUKEN = {
  'й': 'KeyQ', 'ц': 'KeyW', 'у': 'KeyE', 'к': 'KeyR', 'е': 'KeyT', 'н': 'KeyY', 'г': 'KeyU', 'ш': 'KeyI', 'щ': 'KeyO', 'з': 'KeyP',
  'ф': 'KeyA', 'ы': 'KeyS', 'в': 'KeyD', 'а': 'KeyF', 'п': 'KeyG', 'р': 'KeyH', 'о': 'KeyJ', 'л': 'KeyK', 'д': 'KeyL',
  'я': 'KeyZ', 'ч': 'KeyX', 'с': 'KeyC', 'м': 'KeyV', 'и': 'KeyB', 'т': 'KeyN', 'ь': 'KeyM',
};
const KEY_NAMES = { ' ': 'Space', Escape: 'Escape', Tab: 'Tab', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
const STANDARD_CODE = /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Escape|Tab|Enter|Shift(Left|Right))$/;

export function physicalCode(event) {
  if (STANDARD_CODE.test(event.code ?? '')) return event.code;
  const key = typeof event.key === 'string' ? event.key : '';
  const lower = key.toLowerCase();
  if (/^[a-z]$/.test(lower)) return `Key${lower.toUpperCase()}`;
  if (RUSSIAN_JCUKEN[lower]) return RUSSIAN_JCUKEN[lower];
  if (KEY_NAMES[key]) return KEY_NAMES[key];
  const keyCode = event.keyCode ?? event.which;
  if (keyCode >= 65 && keyCode <= 90) return `Key${String.fromCharCode(keyCode)}`;
  if (keyCode === 32) return 'Space';
  return event.code ?? '';
}
