// Keep one live history list: docking changes its layout, never its contents.
export function setupHistoryPanel(document, i18n) {
  const panel = document.getElementById('history-panel');
  const handle = document.getElementById('history-handle');
  const button = document.getElementById('history-dock');
  const view = document.defaultView;
  let floating = true;
  let drag = null;

  function position(left, top) {
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(left, view.innerWidth - rect.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(top, view.innerHeight - rect.height - 8))}px`;
    panel.style.right = 'auto';
  }

  button.addEventListener('click', () => {
    floating = !floating;
    drag = null;
    panel.classList.toggle('floating', floating);
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    i18n.label(button, floating ? 'dock' : 'float');
    button.setAttribute('aria-pressed', String(floating));
    if (!floating) panel.scrollIntoView?.({block: 'nearest'});
  });

  handle.addEventListener('pointerdown', event => {
    if (!floating || event.button !== 0 || event.target.closest('button')) return;
    const rect = panel.getBoundingClientRect();
    drag = {id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top};
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) position(event.clientX - drag.x, event.clientY - drag.y);
  });
  const stopDrag = () => { drag = null; };
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
  handle.addEventListener('lostpointercapture', stopDrag);
  view?.addEventListener('resize', () => {
    if (!floating || !panel.style.left) return;
    const rect = panel.getBoundingClientRect();
    position(rect.left, rect.top);
  });
}
