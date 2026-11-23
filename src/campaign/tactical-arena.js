// Mount the existing M1.2 page in its own document. The parent owns campaign writes.
export function openTacticalArena({ document, window, i18n, request, onReady, onPrepare, onFinish, onExit }) {
  const frame = document.createElement('iframe');
  frame.id = 'campaign-tactical-arena';
  frame.title = i18n.t('map.tactical.title');
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:1000;visibility:hidden';
  const timer = window.setTimeout(() => exit('loadFailed'), 15000);
  let closed = false, cleanup;
  function dispose() {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    try { cleanup?.(); } catch { /* The arena document may already be inaccessible. */ }
    frame.remove();
  }
  function exit(reason) {
    if (closed) return;
    dispose();
    onExit(reason);
  }
  frame.sentinelCampaignArena = Object.freeze({
    request: structuredClone(request), i18n,
    ready(release) {
      if (closed) return;
      window.clearTimeout(timer);
      cleanup = release;
      onReady();
      frame.style.visibility = 'visible';
      frame.focus();
    },
    prepare: placement => closed ? null : onPrepare(structuredClone(placement)),
    finish: result => closed ? false : onFinish(structuredClone(result)),
    cancel: () => exit(null),
    fail: () => exit('loadFailed'),
  });
  frame.addEventListener('error', () => exit('loadFailed'));
  frame.src = new URL('../../tactical-proto.html', import.meta.url).href;
  document.body.append(frame);
  return { dispose };
}
