// Clique no ícone da extensão alterna o painel fixo injetado na página,
// em vez de abrir um popup transitório (que fechava e perdia os prompts
// digitados sempre que o usuário clicava na página).
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
  } catch (e) {
    console.warn('[FlowBatch] Não foi possível falar com a aba — recarregue a página do Flow.');
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FlowBatch] Extensão instalada.');
});

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

// Executa o clique no "MAIN world" da página. Isso evita alguns problemas do
// isolamento do content script em sites React/Next.
async function clickCreateInMainWorld(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      function normalizeText(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
      }
      function isVisible(el) {
        const r = el?.getBoundingClientRect?.();
        if (!r || r.width <= 0 || r.height <= 0) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none';
      }
      function isEnabled(btn) {
        return btn && !btn.disabled && btn.getAttribute('disabled') === null && btn.getAttribute('aria-disabled') !== 'true';
      }
      function score(btn) {
        const text = normalizeText(btn.textContent);
        const spanText = normalizeText([...btn.querySelectorAll('span')].map(s => s.textContent).join(' '));
        const iconText = normalizeText(btn.querySelector('i.google-symbols, i')?.textContent);
        const ariaLabel = normalizeText(btn.getAttribute('aria-label'));
        const title = normalizeText(btn.getAttribute('title'));
        let score = 0;
        if (spanText === 'Criar') score += 140;
        if (text === 'Criar' || text === 'arrow_forward Criar' || text === 'arrow_forwardCriar') score += 120;
        if (/\bCriar\b|\bCreate\b/i.test(text)) score += 90;
        if (/\bCriar\b|\bCreate\b/i.test(`${ariaLabel} ${title}`)) score += 80;
        if (iconText === 'arrow_forward') score += 70;
        if (btn.className && String(btn.className).includes('sc-26b30722-5')) score += 45;
        if (btn.getAttribute('aria-disabled') === 'false') score += 35;
        if (!isVisible(btn)) score -= 120;
        if (!isEnabled(btn)) score -= 150;
        return score;
      }
      const candidates = [...document.querySelectorAll('button')]
        .map(btn => ({ btn, score: score(btn) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);
      const best = candidates[0]?.btn;
      if (!best) return { ok: false, reason: 'not_found', count: candidates.length };
      if (!isEnabled(best)) return { ok: false, reason: 'disabled', text: normalizeText(best.textContent), ariaDisabled: best.getAttribute('aria-disabled') };
      best.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      best.focus?.({ preventScroll: true });
      const r = best.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
      try {
        if (typeof PointerEvent !== 'undefined') {
          best.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          best.dispatchEvent(new PointerEvent('pointermove', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          best.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        }
        best.dispatchEvent(new MouseEvent('mouseover', opts));
        best.dispatchEvent(new MouseEvent('mousemove', opts));
        best.dispatchEvent(new MouseEvent('mousedown', opts));
        if (typeof PointerEvent !== 'undefined') {
          best.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        }
        best.dispatchEvent(new MouseEvent('mouseup', opts));
        best.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }));
        HTMLButtonElement.prototype.click.call(best);
      } catch (err) {
        return { ok: false, reason: 'exception', error: String(err) };
      }
      return { ok: true, text: normalizeText(best.textContent), x, y, score: candidates[0].score };
    }
  });
  return result?.result || { ok: false, reason: 'no_result' };
}

async function dispatchDebuggerClick(tabId, x, y) {
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
  } catch (e) {
    // Se já estiver anexado por esta extensão, seguimos mesmo assim.
    if (!String(e?.message || e).includes('Another debugger is already attached')) {
      throw e;
    }
  }

  const base = { x, y, button: 'left', clickCount: 1, pointerType: 'mouse' };
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' });
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });

  if (attached) {
    try { await chrome.debugger.detach(target); } catch (e) {}
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender?.tab?.id;

  if (msg?.type === 'CLICK_CREATE_MAIN_WORLD') {
    if (!tabId) {
      sendResponse({ ok: false, reason: 'missing_tab_id' });
      return false;
    }
    clickCreateInMainWorld(tabId)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, reason: 'exception', error: String(err?.message || err) }));
    return true;
  }

  if (msg?.type === 'DEBUGGER_CLICK') {
    if (!tabId) {
      sendResponse({ ok: false, reason: 'missing_tab_id' });
      return false;
    }
    dispatchDebuggerClick(tabId, Math.round(msg.x), Math.round(msg.y))
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, reason: 'exception', error: String(err?.message || err) }));
    return true;
  }

  return false;
});
