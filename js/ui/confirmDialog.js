// Accessible in-app confirmation: a native modal <dialog> (focus trapped, Escape cancels, focus returns to the opener).
// confirmDialog({ title, message, confirmText, cancelText, opener }) -> Promise<boolean>. Falls back to window.confirm when <dialog> is unavailable.
export function confirmDialog({ title = 'Confirm', message = '', confirmText = 'OK', cancelText = 'Cancel', opener = null } = {}) {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || typeof HTMLDialogElement === 'undefined' || typeof doc.createElement('dialog').showModal !== 'function') {
    let ok = false; try { ok = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(`${title}\n${message}`) : false; } catch { ok = false; }
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    const back = opener || doc.activeElement;
    const dlg = doc.createElement('dialog');
    dlg.className = 'confirm-dialog';
    const h = doc.createElement('h2'); h.id = `cd-h-${Math.random().toString(36).slice(2, 7)}`; h.textContent = title;
    const p = doc.createElement('p'); p.id = `${h.id}-m`; p.textContent = message;
    dlg.setAttribute('aria-labelledby', h.id); dlg.setAttribute('aria-describedby', p.id);
    const bar = doc.createElement('div'); bar.className = 'confirm-bar';
    const no = doc.createElement('button'); no.type = 'button'; no.textContent = cancelText;
    const yes = doc.createElement('button'); yes.type = 'button'; yes.textContent = confirmText; yes.className = 'primary';
    bar.append(no, yes); dlg.append(h, p, bar);
    let result = false;
    yes.addEventListener('click', () => { result = true; dlg.close(); });
    no.addEventListener('click', () => { result = false; dlg.close(); });
    dlg.addEventListener('cancel', () => { result = false; }); // Escape
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (back && typeof back.focus === 'function' && back.isConnected !== false) back.focus();
      resolve(result);
    });
    doc.body.append(dlg);
    dlg.showModal();
    no.focus(); // the safe choice first: a stray Enter does not swap
  });
}
