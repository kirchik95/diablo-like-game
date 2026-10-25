// One frame's gameplay events for audio, notices and the HUD; effects keep a short-lived copy
// for the renderer. Types the renderer does not know stay in game.events only as data.
export function emit(game, type, x, y, extra = {}) {
  const event = { type, x, y, ...extra };
  game.events.push(event);
  game.effects.push({ ...event, age: 0, life: type === 'death' ? 1.2 : type === 'damage' ? .7 : .5 });
  return event;
}
