// A persistent sibling of the transient HUD notices; never steals focus or game input.
export function createVersionNotice(doc = document) {
  let element, button, hint;
  return update => {
    if (!update) { element?.remove(); element = null; return; }
    if (!element) {
      element = doc.createElement('aside');
      element.id = 'version-update';
      element.className = 'notice show version-update';
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      button = doc.createElement('button');
      button.type = 'button';
      button.textContent = 'Доступна новая версия — обновить';
      hint = doc.createElement('span');
      hint.id = 'version-update-hint';
      button.setAttribute('aria-describedby', hint.id);
      element.append(button, hint);
      doc.body.append(element);
    }
    button.disabled = !update.canReload;
    button.onclick = update.reload;
    hint.textContent = update.canReload ? 'Обновление готово.' : 'После завершения пути. Незавершённый путь не будет прерван.';
  };
}
