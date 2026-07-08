// ============================================================
// Flow Batch Video Generator — content.js
// ============================================================
console.log('[FlowBatch] content.js carregado — versão v1.9.17-one-by-one-selected: envia um prompt marcado por vez e re-lê a lista');


function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Ritmo anti-bug para o Flow: envia 3 prompts, pausa 40s, envia mais 3.
const FBG_BATCH_SIZE = 3;
const FBG_BATCH_PAUSE_MS = 40000;
const FBG_BETWEEN_ITEMS_MS = 1500;
const FBG_IMAGE_BETWEEN_ITEMS_MS = 2000;

// Retry rígido: se um prompt falhar, não avança para o próximo.
// Ele repete o mesmo item até o Flow aceitar o envio.
const FBG_RETRY_DELAY_MS = 10000;
const FBG_RETRY_LONG_PAUSE_EVERY = 5;
const FBG_RETRY_LONG_PAUSE_MS = 30000;
let fbgStopRequested = false;

// Presets pedidos: vídeo com Frames, 9:16, x4, Veo 3.1 Lite Lower Priority, 8s.
// Para imagem em lote: Imagem, 9:16 e x4.
const FBG_PRESETS = {
  video: {
    flowTab: 'Vídeo',
    subTab: 'Frames',
    aspectRatio: '9:16',
    multiplier: 'x4',
    model: 'Veo 3.1 - Lite [Lower Priority]',
    duration: '8s',
    label: 'Vídeo · Frames · 9:16 · x4 · Veo 3.1 Lite · 8s',
  },
  image: {
    flowTab: 'Imagem',
    aspectRatio: '9:16',
    multiplier: 'x4',
    label: 'Imagem · 9:16 · x4',
  },
};


function showToast(msg, duration = 3000) {
  const el = document.createElement('div');
  el.className = 'fbg-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ------------------------------------------------------------
// Painel flutuante fixo (não fecha quando o usuário clica na página,
// diferente do popup da extensão que fecha sozinho ao perder foco)
// ------------------------------------------------------------

let panelEl = null;
let panelLogEl = null;
let restoreChipEl = null;
let videoPromptsTextareaEl = null;
let imagePromptsTextareaEl = null;
let videoPromptListEl = null;
let imagePromptListEl = null;
let promptState = { video: [], image: [] };
let promptIdCounter = 1;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getPromptTextarea(mode) {
  return mode === 'image' ? imagePromptsTextareaEl : videoPromptsTextareaEl;
}

function getPromptListEl(mode) {
  return mode === 'image' ? imagePromptListEl : videoPromptListEl;
}

function getPromptItems(mode) {
  return promptState[mode] || [];
}

function ensurePanel() {
  if (panelEl) return panelEl;

  panelEl = document.createElement('div');
  panelEl.id = 'fbg-panel';
  panelEl.innerHTML = `
    <div class="fbg-panel-header">
      <span>Flow Batch</span>
      <button class="fbg-panel-close" title="Ocultar painel">Ocultar</button>
    </div>
    <div class="fbg-panel-body">
      <div class="fbg-panel-row">
        <button class="fbg-btn" id="fbg-btn-select">Ativar seleção</button>
        <button class="fbg-btn" id="fbg-btn-clear">Limpar</button>
        <button class="fbg-btn" id="fbg-btn-force-create">Forçar Criar</button>
        <button class="fbg-btn" id="fbg-btn-stop">Parar fila</button>
      </div>
      <div class="fbg-panel-count" id="fbg-selected-count">0 imagem(ns) selecionada(s)</div>

      <label class="fbg-panel-label">Modo de geração</label>
      <select class="fbg-panel-select" id="fbg-mode">
        <option value="video" selected>Vídeo em lote — 1 imagem por prompt</option>
        <option value="image">Imagem em lote — inclui todas as imagens selecionadas</option>
      </select>
      <div class="fbg-panel-hint fbg-preset-hint" id="fbg-preset-hint">Preset: Vídeo · Frames · 9:16 · x4 · Veo 3.1 Lite · 8s</div>

      <div class="fbg-panel-hint">No modo Vídeo: selecione as imagens na ordem e ligue cada prompt à imagem de mesmo número. No modo Imagem: selecione as referências uma vez; elas serão anexadas uma vez e depois os prompts podem ser reenviados sem reanexar.</div>
      <div class="fbg-panel-hint fbg-panel-batch-hint">Modo seguro: envia só o primeiro prompt marcado. Quando dá certo, desmarca esse prompt, re-lê a lista e entra no próximo marcado. Assim não pula número.</div>

      <div class="fbg-prompt-section fbg-mode-active" id="fbg-video-section" data-mode="video">
        <div class="fbg-prompt-section-header">
          <span>Prompts de vídeo</span>
          <div class="fbg-prompt-tools">
            <button class="fbg-mini-btn" id="fbg-video-load">Atualizar lista</button>
            <button class="fbg-mini-btn" id="fbg-video-select-all">Marcar todos</button>
            <button class="fbg-mini-btn" id="fbg-video-unselect-all">Desmarcar</button>
          </div>
        </div>
        <textarea class="fbg-panel-textarea fbg-prompt-textarea" id="fbg-video-prompts" placeholder="Cole aqui os prompts de vídeo."></textarea>
        <div class="fbg-prompt-list" id="fbg-video-list"></div>
      </div>

      <div class="fbg-prompt-section" id="fbg-image-section" data-mode="image">
        <div class="fbg-prompt-section-header">
          <span>Prompts de imagem</span>
          <div class="fbg-prompt-tools">
            <button class="fbg-mini-btn" id="fbg-image-load">Atualizar lista</button>
            <button class="fbg-mini-btn" id="fbg-image-select-all">Marcar todos</button>
            <button class="fbg-mini-btn" id="fbg-image-unselect-all">Desmarcar</button>
          </div>
        </div>
        <textarea class="fbg-panel-textarea fbg-prompt-textarea" id="fbg-image-prompts" placeholder="Cole aqui os prompts de imagem."></textarea>
        <div class="fbg-prompt-list" id="fbg-image-list"></div>
      </div>

      <button class="fbg-btn fbg-btn-primary" id="fbg-btn-run">Enviar selecionados do modo atual</button>
    </div>
    <div class="fbg-panel-progress"></div>
    <div class="fbg-panel-log"></div>
  `;
  document.body.appendChild(panelEl);

  restoreChipEl = document.createElement('button');
  restoreChipEl.id = 'fbg-restore-chip';
  restoreChipEl.textContent = 'Flow Batch';
  restoreChipEl.style.display = 'none';
  restoreChipEl.addEventListener('click', () => {
    panelEl.style.display = 'flex';
    restoreChipEl.style.display = 'none';
  });
  document.body.appendChild(restoreChipEl);

  panelEl.querySelector('.fbg-panel-close').addEventListener('click', () => {
    panelEl.style.display = 'none';
    restoreChipEl.style.display = 'block';
  });

  panelLogEl = panelEl.querySelector('.fbg-panel-log');
  videoPromptsTextareaEl = panelEl.querySelector('#fbg-video-prompts');
  imagePromptsTextareaEl = panelEl.querySelector('#fbg-image-prompts');
  videoPromptListEl = panelEl.querySelector('#fbg-video-list');
  imagePromptListEl = panelEl.querySelector('#fbg-image-list');

  panelEl.querySelector('#fbg-mode').addEventListener('change', () => {
    updateModeUI();
  });

  panelEl.querySelector('#fbg-btn-select').addEventListener('click', () => {
    enableSelectionMode();
  });

  panelEl.querySelector('#fbg-btn-clear').addEventListener('click', () => {
    clearSelection();
  });

  panelEl.querySelector('#fbg-btn-run').addEventListener('click', () => {
    handleRunClick();
  });

  panelEl.querySelector('#fbg-btn-force-create').addEventListener('click', async () => {
    logToPanel('Teste manual: forçando clique no botão "Criar"...');
    const ok = await clickCreate();
    logToPanel(ok ? 'Teste manual concluído.' : 'Teste manual falhou.', ok ? 'success' : 'error');
  });

  panelEl.querySelector('#fbg-btn-stop').addEventListener('click', () => {
    fbgStopRequested = true;
    logToPanel('Parada solicitada. Vou terminar a tentativa atual e não avançar mais.', 'error');
  });

  panelEl.querySelector('#fbg-video-load').addEventListener('click', () => syncPromptLibraryFromTextarea('video'));
  panelEl.querySelector('#fbg-image-load').addEventListener('click', () => syncPromptLibraryFromTextarea('image'));
  panelEl.querySelector('#fbg-video-select-all').addEventListener('click', () => setAllPromptSelections('video', true));
  panelEl.querySelector('#fbg-image-select-all').addEventListener('click', () => setAllPromptSelections('image', true));
  panelEl.querySelector('#fbg-video-unselect-all').addEventListener('click', () => setAllPromptSelections('video', false));
  panelEl.querySelector('#fbg-image-unselect-all').addEventListener('click', () => setAllPromptSelections('image', false));

  panelEl.querySelector('#fbg-video-list').addEventListener('click', handlePromptListClick);
  panelEl.querySelector('#fbg-image-list').addEventListener('click', handlePromptListClick);
  panelEl.querySelector('#fbg-video-list').addEventListener('change', handlePromptListChange);
  panelEl.querySelector('#fbg-image-list').addEventListener('change', handlePromptListChange);

  renderAllPromptLists();
  updateModeUI();
  return panelEl;
}

function getSelectedMode() {
  const value = panelEl?.querySelector('#fbg-mode')?.value;
  return value === 'image' ? 'image' : 'video';
}

function updateModeUI() {
  ensurePanel();
  const mode = getSelectedMode();
  const hint = panelEl.querySelector('#fbg-preset-hint');
  const videoSection = panelEl.querySelector('#fbg-video-section');
  const imageSection = panelEl.querySelector('#fbg-image-section');

  if (hint) hint.textContent = `Preset: ${FBG_PRESETS[mode].label}`;

  if (videoSection) {
    videoSection.classList.toggle('fbg-mode-active', mode === 'video');
    videoSection.style.display = mode === 'video' ? 'block' : 'none';
  }
  if (imageSection) {
    imageSection.classList.toggle('fbg-mode-active', mode === 'image');
    imageSection.style.display = mode === 'image' ? 'block' : 'none';
  }

  syncGridSelectionVisuals();
  updateSelectedCountUI();
}

function updateSelectedCountUI() {
  ensurePanel();
  const el = panelEl.querySelector('#fbg-selected-count');
  if (!el) return;
  const mode = getSelectedMode();
  if (mode === 'image') {
    const selectedText = `${getSelectionQueue('image').length} imagem(ns) de referência selecionada(s)`;
    const attachedText = hasAttachedImageReferences()
      ? ` · ${imageReferenceState.mediaIds.length} já anexada(s)`
      : ' · 0 já anexada(s)';
    el.textContent = `${selectedText}${attachedText}`;
  } else {
    el.textContent = `${getSelectionQueue('video').length} imagem(ns) selecionada(s) para vídeo`;
  }
}

function parsePrompts(raw) {
  const text = (raw || '').trim();
  if (!text) return [];
  const hasBlankLine = /\n\s*\n/.test(text);
  const parts = hasBlankLine ? text.split(/\n\s*\n+/) : text.split('\n');
  return parts.map(p => p.trim()).filter(Boolean);
}

function buildPromptEntries(mode, prompts) {
  return prompts.map((prompt, i) => ({
    id: `${mode}-${promptIdCounter++}`,
    mode,
    order: i + 1,
    text: prompt,
    selected: true,
    sent: false,
    sendCount: 0,
    lastResult: null,
  }));
}

function syncPromptLibraryFromTextarea(mode, { silent = false } = {}) {
  ensurePanel();
  const textarea = getPromptTextarea(mode);
  const prompts = parsePrompts(textarea?.value || '');
  promptState[mode] = buildPromptEntries(mode, prompts);
  renderPromptList(mode);
  if (!silent) {
    logToPanel(prompts.length > 0
      ? `Lista de prompts de ${mode === 'video' ? 'vídeo' : 'imagem'} atualizada: ${prompts.length} item(ns).`
      : `Lista de prompts de ${mode === 'video' ? 'vídeo' : 'imagem'} vazia.`);
  }
}

function renderAllPromptLists() {
  renderPromptList('video');
  renderPromptList('image');
}

function renderPromptList(mode) {
  ensurePanel();
  const listEl = getPromptListEl(mode);
  if (!listEl) return;
  const entries = getPromptItems(mode);
  if (entries.length === 0) {
    listEl.innerHTML = `<div class="fbg-prompt-empty">Nenhum prompt carregado ainda.</div>`;
    return;
  }

  listEl.innerHTML = entries.map(entry => {
    const snippet = entry.text.length > 110 ? `${entry.text.slice(0, 110)}…` : entry.text;
    const statusText = entry.lastResult === 'failed' ? '✗' : (entry.lastResult === 'retrying' ? '↻' : (entry.sent ? '✓' : '•'));
    const statusClass = entry.lastResult === 'failed'
      ? 'fbg-status-failed'
      : (entry.sent ? 'fbg-status-sent' : 'fbg-status-pending');
    const sentInfo = entry.sendCount > 0 ? ` title="Enviado ${entry.sendCount}x"` : '';
    return `
      <div class="fbg-prompt-item ${entry.selected ? 'fbg-prompt-item-selected' : ''} ${entry.sent ? 'fbg-prompt-item-sent' : ''}" data-mode="${mode}" data-id="${entry.id}">
        <input type="checkbox" class="fbg-prompt-checkbox" data-role="select" data-mode="${mode}" data-id="${entry.id}" ${entry.selected ? 'checked' : ''}>
        <span class="fbg-prompt-order">${entry.order}</span>
        <div class="fbg-prompt-text" title="${escapeHtml(entry.text)}">${escapeHtml(snippet)}</div>
        <span class="fbg-prompt-status ${statusClass}"${sentInfo}>${statusText}</span>
        <button type="button" class="fbg-prompt-retry" data-role="retry" data-mode="${mode}" data-id="${entry.id}" title="Marcar para reenviar">↻</button>
      </div>`;
  }).join('');
}

function findPromptEntry(mode, id) {
  return getPromptItems(mode).find(entry => entry.id === id) || null;
}

function handlePromptListChange(e) {
  const checkbox = e.target.closest('.fbg-prompt-checkbox');
  if (!checkbox) return;
  const mode = checkbox.dataset.mode;
  const id = checkbox.dataset.id;
  const entry = findPromptEntry(mode, id);
  if (!entry) return;
  entry.selected = !!checkbox.checked;
  renderPromptList(mode);
}

function handlePromptListClick(e) {
  const retryBtn = e.target.closest('[data-role="retry"]');
  if (!retryBtn) return;
  const mode = retryBtn.dataset.mode;
  const id = retryBtn.dataset.id;
  const entry = findPromptEntry(mode, id);
  if (!entry) return;
  entry.selected = true;
  entry.lastResult = entry.sent ? 'sent' : null;
  renderPromptList(mode);
  logToPanel(`Prompt ${entry.order} de ${mode === 'video' ? 'vídeo' : 'imagem'} marcado para reenvio.`);
}

function setAllPromptSelections(mode, value) {
  const entries = getPromptItems(mode);
  entries.forEach(entry => {
    entry.selected = value;
  });
  renderPromptList(mode);
}

function markPromptEntryResult(entry, ok) {
  if (!entry) return;
  if (ok) {
    entry.sent = true;
    entry.lastResult = 'sent';
    entry.sendCount = (entry.sendCount || 0) + 1;
    entry.selected = false;
  } else {
    entry.lastResult = 'failed';
    entry.selected = true;
  }
  renderPromptList(entry.mode);
}

function markPromptEntryRetrying(entry) {
  if (!entry) return;
  entry.lastResult = 'retrying';
  entry.selected = true;
  renderPromptList(entry.mode);
}

async function handleRunClick() {
  const runBtn = panelEl.querySelector('#fbg-btn-run');
  const mode = getSelectedMode();

  if (getPromptItems(mode).length === 0 && parsePrompts(getPromptTextarea(mode)?.value || '').length > 0) {
    syncPromptLibraryFromTextarea(mode, { silent: true });
  }

  const selectedPromptEntries = getPromptItems(mode).filter(entry => entry.selected && String(entry.text || '').trim());
  if (selectedPromptEntries.length === 0) {
    logToPanel(`Marque pelo menos um prompt de ${mode === 'video' ? 'vídeo' : 'imagem'} para enviar.`, 'error');
    return;
  }

  if (mode === 'video') {
    const videoSelection = getSelectionQueue('video');
    if (videoSelection.length === 0) {
      logToPanel('Modo Vídeo: selecione pelo menos uma imagem primeiro.', 'error');
      return;
    }
    const firstMissing = selectedPromptEntries.find(entry => !videoSelection[entry.order - 1]);
    if (firstMissing) {
      logToPanel(`Prompt ${firstMissing.order} de vídeo não tem imagem correspondente na seleção atual. Se quer enviar até ele, selecione a imagem número ${firstMissing.order}.`, 'error');
      return;
    }
  } else {
    const selectedMediaIds = getSelectionQueue('image').map(entry => entry.mediaId);
    if (selectedMediaIds.length === 0 && !hasAttachedImageReferences()) {
      logToPanel('Modo Imagem: sem referências já anexadas. Selecione pelo menos uma imagem de referência.', 'error');
      return;
    }
  }

  fbgStopRequested = false;
  runBtn.disabled = true;
  try {
    await runSelectedOneByOne(mode);
  } finally {
    runBtn.disabled = false;
  }
}

function getSelectedPromptEntriesOrdered(mode) {
  return getPromptItems(mode)
    .filter(entry => entry.selected && String(entry.text || '').trim())
    .sort((a, b) => a.order - b.order);
}

function getNextSelectedPromptEntry(mode) {
  return getSelectedPromptEntriesOrdered(mode)[0] || null;
}

function hasMoreSelectedPrompts(mode) {
  return getSelectedPromptEntriesOrdered(mode).length > 0;
}

async function runSelectedOneByOne(mode = 'video') {
  showPanel();
  const isImageMode = mode === 'image';
  const modeLabel = isImageMode ? 'imagens' : 'vídeos';
  const totalStart = getSelectedPromptEntriesOrdered(mode).length;

  logToPanel(`Iniciando modo seguro um por um: ${totalStart} prompt(s) marcado(s).`);
  logToPanel('Regra nova: envia o primeiro marcado, desmarca quando dá certo, re-lê a lista e só então pega o próximo. Sem pular número.', 'success');

  await applyPreset(mode);

  let sharedMediaIds = [];
  if (isImageMode) {
    const selectedMediaIds = getSelectionQueue('image').map(entry => entry.mediaId);
    sharedMediaIds = selectedMediaIds.length > 0 ? selectedMediaIds : imageReferenceState.mediaIds;
    const canReuseExisting = hasAttachedImageReferences() && arraysEqual(sharedMediaIds, imageReferenceState.mediaIds);

    if (canReuseExisting) {
      logToPanel(`As ${imageReferenceState.mediaIds.length} imagens de referência já estão anexadas. Vou reutilizar.`, 'success');
      updateSelectedCountUI();
    } else {
      const okAttach = await attachAllReferenceImagesOnce(sharedMediaIds);
      if (!okAttach) {
        setPanelProgress('Falha ao anexar as imagens de referência');
        logToPanel('Não consegui anexar todas as imagens de referência. A fila foi interrompida.', 'error');
        return;
      }
    }
  }

  let successCount = 0;

  while (!fbgStopRequested) {
    const promptEntry = getNextSelectedPromptEntry(mode);
    if (!promptEntry) break;

    let item;
    let label;

    if (isImageMode) {
      item = {
        prompt: promptEntry.text,
        order: promptEntry.order,
        mediaIds: sharedMediaIds,
        reuseAttachedReferences: true,
        promptEntry,
      };
      label = `prompt de imagem ${promptEntry.order}`;
    } else {
      const imageEntry = getSelectionQueue('video')[promptEntry.order - 1];
      if (!imageEntry) {
        setPanelProgress(`Parado: falta imagem para o prompt ${promptEntry.order}`);
        logToPanel(`Prompt ${promptEntry.order} não tem imagem número ${promptEntry.order} selecionada. Não vou pular para o próximo.`, 'error');
        return;
      }
      item = {
        mediaId: imageEntry.mediaId,
        prompt: promptEntry.text,
        promptEntry,
      };
      label = `prompt de vídeo ${promptEntry.order} · imagem ${item_short(imageEntry.mediaId)}`;
    }

    setPanelProgress(`Modo seguro — ${label}`);
    logToPanel(`Enviando somente ${label}. Depois vou desmarcar e recomeçar a leitura da lista.`);

    const ok = await processItemUntilSuccess(item, mode, label);
    if (!ok) return;

    markPromptEntryResult(promptEntry, true);
    successCount++;
    logToPanel(`✓ ${label} enviado. Desmarcado. Agora vou procurar o próximo marcado.`, 'success');

    if (hasMoreSelectedPrompts(mode)) {
      if (!isImageMode && successCount % FBG_BATCH_SIZE === 0) {
        logToPanel(`Pausa anti-bug de ${Math.round(FBG_BATCH_PAUSE_MS / 1000)}s antes de continuar...`);
        await waitWithCountdown(FBG_BATCH_PAUSE_MS, `${successCount} vídeo(s) enviados`);
      } else {
        const delay = isImageMode ? FBG_IMAGE_BETWEEN_ITEMS_MS : FBG_BETWEEN_ITEMS_MS;
        setPanelProgress(`Aguardando ${Math.round(delay / 1000)}s antes de reler a lista`);
        await wait(delay);
      }
    }
  }

  if (fbgStopRequested) {
    setPanelProgress(`Parado: ${successCount}/${totalStart}`);
    logToPanel(`Fila parada pelo usuário: ${successCount}/${totalStart} ${modeLabel} enviados.`, 'error');
    return;
  }

  setPanelProgress(`Concluído: ${successCount}/${totalStart}`);
  logToPanel(`Fila finalizada no modo um por um: ${successCount}/${totalStart} ${modeLabel} enviados`, 'success');
  chrome.runtime.sendMessage({ type: 'QUEUE_DONE', successCount, total: totalStart, mode }).catch(() => {});
}


function showPanel() {
  ensurePanel();
  panelEl.style.display = 'flex';
}

function setPanelProgress(text) {
  ensurePanel();
  panelEl.querySelector('.fbg-panel-progress').textContent = text;
}

function logToPanel(msg, kind = 'info') {
  ensurePanel();
  const line = document.createElement('div');
  line.className = `fbg-panel-line fbg-panel-${kind}`;
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `[${time}] ${msg}`;
  panelLogEl.appendChild(line);
  panelLogEl.scrollTop = panelLogEl.scrollHeight;
}

// ------------------------------------------------------------
// PARTE 1 — Modo de seleção no grid principal
// ------------------------------------------------------------
// Grid principal confirmado: cards identificados por [data-tile-id="fe_id_<uuid>"]
// (estrutura diferente do painel de busca, que usa [role="option"]).
const GRID_ITEM_SELECTOR = '[data-tile-id]';
const FBG_BADGE_MAX_PER_PASS = 160;
const FBG_BADGE_VIEWPORT_MARGIN = 1400;

let selectionModeActive = false;
let selectionQueues = { video: [], image: [] }; // filas separadas por modo
let imageReferenceState = { attached: false, mediaIds: [] };

function getSelectionQueue(mode = null) {
  const key = mode || getSelectedMode();
  return selectionQueues[key] || [];
}

function setSelectionQueue(mode, nextQueue) {
  selectionQueues[mode] = Array.isArray(nextQueue) ? nextQueue : [];
}


function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function hasAttachedImageReferences() {
  return !!(imageReferenceState.attached && Array.isArray(imageReferenceState.mediaIds) && imageReferenceState.mediaIds.length > 0);
}

function extractMediaId(imgEl) {
  const src = imgEl?.src || '';
  const match = src.match(/name=([a-f0-9-]+)/i);
  return match ? match[1] : null;
}

function isNearViewport(el) {
  try {
    const r = el.getBoundingClientRect();
    return r.width > 0
      && r.height > 0
      && r.bottom > -FBG_BADGE_VIEWPORT_MARGIN
      && r.top < window.innerHeight + FBG_BADGE_VIEWPORT_MARGIN
      && r.right > -FBG_BADGE_VIEWPORT_MARGIN
      && r.left < window.innerWidth + FBG_BADGE_VIEWPORT_MARGIN;
  } catch (_) {
    return false;
  }
}

function injectBadges() {
  const seenTileIds = new Set();
  let injectedOrSeen = 0;

  for (const item of document.querySelectorAll(GRID_ITEM_SELECTOR)) {
    const tileId = item.getAttribute('data-tile-id');
    if (seenTileIds.has(tileId)) continue;
    seenTileIds.add(tileId);

    if (!isNearViewport(item)) continue;
    if (injectedOrSeen >= FBG_BADGE_MAX_PER_PASS) break;
    injectedOrSeen++;

    const existingBadge = item.querySelector(':scope > .fbg-select-badge');
    if (existingBadge) continue;

    const img = item.querySelector('img');
    const mediaId = extractMediaId(img);
    if (!mediaId) continue;

    const badge = document.createElement('div');
    badge.className = 'fbg-select-badge';
    badge.textContent = '+';
    badge.dataset.mediaId = mediaId;

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleSelection(mediaId, img.src, item, badge);
    });

    const currentQueue = getSelectionQueue();
    const currentIndex = currentQueue.findIndex(q => q.mediaId === mediaId);
    if (currentIndex >= 0) {
      badge.classList.add('fbg-selected');
      badge.textContent = String(currentIndex + 1);
      item.classList.add('fbg-item-selected');
    }

    // Evita getComputedStyle em massa, que travava a página em grids grandes.
    item.style.position = 'relative';
    item.appendChild(badge);
  }
}

function toggleSelection(mediaId, thumbSrc, itemEl, badgeEl) {
  const mode = getSelectedMode();
  const queue = getSelectionQueue(mode);
  const idx = queue.findIndex(q => q.mediaId === mediaId);

  if (idx >= 0) {
    queue.splice(idx, 1);
    badgeEl.classList.remove('fbg-selected');
    badgeEl.textContent = '+';
    itemEl.classList.remove('fbg-item-selected');
  } else {
    queue.push({ mediaId, thumbSrc, order: queue.length + 1 });
    badgeEl.classList.add('fbg-selected');
    badgeEl.textContent = String(queue.length);
    itemEl.classList.add('fbg-item-selected');
  }

  setSelectionQueue(mode, queue);
  renumberBadges(mode);
  updateSelectedCountUI();
}

function renumberBadges(mode = null) {
  const activeMode = mode || getSelectedMode();
  const queue = getSelectionQueue(activeMode);

  document.querySelectorAll('.fbg-select-badge').forEach(badge => {
    badge.classList.remove('fbg-selected');
    badge.textContent = '+';
  });
  document.querySelectorAll('.fbg-item-selected').forEach(el => el.classList.remove('fbg-item-selected'));

  queue.forEach((entry, i) => {
    entry.order = i + 1;
    const badge = document.querySelector(`.fbg-select-badge[data-media-id="${entry.mediaId}"]`);
    if (badge) {
      badge.classList.add('fbg-selected');
      badge.textContent = String(i + 1);
      badge.closest(GRID_ITEM_SELECTOR)?.classList.add('fbg-item-selected');
    }
  });
}

function syncGridSelectionVisuals() {
  if (!document.querySelector('.fbg-select-badge')) return;
  renumberBadges(getSelectedMode());
}

let badgeRefreshTimer = null;
function scheduleBadgeRefresh(delay = 180) {
  if (!selectionModeActive) return;
  clearTimeout(badgeRefreshTimer);
  badgeRefreshTimer = setTimeout(() => {
    badgeRefreshTimer = null;
    if (!selectionModeActive) return;
    injectBadges();
    syncGridSelectionVisuals();
  }, delay);
}

function enableSelectionMode() {
  selectionModeActive = true;
  document.body.classList.add('fbg-selection-mode');
  showPanel();
  updateSelectedCountUI();
  startGridObserver();
  scheduleBadgeRefresh(0);
  const modeLabel = getSelectedMode() === 'image' ? 'imagem' : 'vídeo';
  logToPanel(`Modo de seleção ativado para ${modeLabel} — clique nas imagens na ordem desejada`);
}

function disableSelectionMode() {
  selectionModeActive = false;
  document.body.classList.remove('fbg-selection-mode');
  stopGridObserver();
}

let gridObserver = null;
function startGridObserver() {
  if (gridObserver) return;
  gridObserver = new MutationObserver(() => scheduleBadgeRefresh(250));
  gridObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', handleSelectionScroll, true);
}
function handleSelectionScroll() {
  scheduleBadgeRefresh(180);
}
function stopGridObserver() {
  gridObserver?.disconnect();
  gridObserver = null;
  clearTimeout(badgeRefreshTimer);
  badgeRefreshTimer = null;
  window.removeEventListener('scroll', handleSelectionScroll, true);
}

function clearSelection() {
  const mode = getSelectedMode();
  setSelectionQueue(mode, []);
  syncGridSelectionVisuals();
  updateSelectedCountUI();
  logToPanel(`Seleção de ${mode === 'image' ? 'imagem' : 'vídeo'} limpa.`);
}

// ------------------------------------------------------------
// PARTE 2 — Automação do fluxo de geração de vídeo
// ------------------------------------------------------------
// PARTE 2 — Automação do fluxo de geração de vídeo
// ------------------------------------------------------------

function getCleanText(el) {
  return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function findFlowTab(label) {
  const candidates = [...document.querySelectorAll('[role="tab"].flow_tab_slider_trigger, [role="tab"], button')]
    .filter(el => getCleanText(el) === label)
    .filter(el => isVisibleAndClickable(el));

  // Prioriza tabs reais, depois botões fallback.
  return candidates.find(el => el.getAttribute('role') === 'tab') || candidates[0] || null;
}

async function clickFlowTab(label) {
  const tab = findFlowTab(label);
  if (!tab) {
    logToPanel(`Aba "${label}" não encontrada na página`, 'error');
    return false;
  }
  if (tab.getAttribute('aria-selected') !== 'true') {
    tab.click();
    logToPanel(`Aba "${label}" selecionada`);
    await wait(300);
  }
  return true;
}

async function ensureVideoFramesMode() {
  await clickFlowTab('Vídeo');
  await wait(150);
  await clickFlowTab('Frames');
}

async function ensureImageMode() {
  await clickFlowTab('Imagem');
}

async function ensureFlowMode(mode) {
  if (mode === 'image') return ensureImageMode();
  return ensureVideoFramesMode();
}

function findActiveImagePickerRoot() {
  // Importante: nunca usar o scroller da tela principal.
  // O bug vinha daqui: document.querySelector('[data-virtuoso-scroller="true"]')
  // às vezes pegava o grid principal e descia a página até o fim.
  const dialogCandidates = [
    ...document.querySelectorAll('[role="dialog"], [data-radix-dialog-content], [data-radix-popper-content-wrapper]')
  ].filter(el => {
    if (!isVisibleAndClickable(el)) return false;
    return !!el.querySelector('[role="option"], [data-virtuoso-scroller="true"]')
      || /Incluir no comando/i.test(getCleanText(el));
  });

  if (dialogCandidates.length) {
    return dialogCandidates[dialogCandidates.length - 1];
  }

  const visibleOption = [...document.querySelectorAll('[role="option"]')]
    .filter(isVisibleAndClickable)
    .at(-1);

  if (visibleOption) {
    return visibleOption.closest('[role="dialog"], [data-radix-dialog-content], [data-radix-popper-content-wrapper]')
      || visibleOption.parentElement;
  }

  return null;
}

function findImageOptionById(mediaId, root = null) {
  const scope = root || findActiveImagePickerRoot();
  if (!scope) return null;

  return [...scope.querySelectorAll('[role="option"]')]
    .find(opt => opt.querySelector('img')?.src.includes(`name=${mediaId}`));
}

function findImagePickerScroller(root = null) {
  const scope = root || findActiveImagePickerRoot();
  if (!scope || scope === document || scope === document.body || scope === document.documentElement) {
    return null;
  }

  const virtuoso = scope.querySelector('[data-virtuoso-scroller="true"]');
  if (virtuoso && isVisibleAndClickable(virtuoso)) return virtuoso;

  // Fallback: pega apenas um scroller DENTRO do popup/seletor.
  const scrollables = [...scope.querySelectorAll('*')].filter(el => {
    if (!(el instanceof HTMLElement) || !isVisibleAndClickable(el)) return false;
    const style = getComputedStyle(el);
    const canScroll = /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`);
    return canScroll && el.scrollHeight > el.clientHeight + 20;
  });

  return scrollables[0] || null;
}

async function scrollUntilFound(mediaId, maxAttempts = 20, root = null) {
  const pickerRoot = root || findActiveImagePickerRoot();
  const scroller = findImagePickerScroller(pickerRoot);

  if (!pickerRoot || !scroller) {
    logToPanel('Seletor de imagens aberto, mas não encontrei o scroller interno. Para evitar bug, não vou rolar a página principal.', 'error');
    return findImageOptionById(mediaId, pickerRoot);
  }

  for (let i = 0; i < maxAttempts; i++) {
    const found = findImageOptionById(mediaId, pickerRoot);
    if (found) return found;

    const previousTop = scroller.scrollTop;
    scroller.scrollTop = previousTop + Math.max(120, scroller.clientHeight * 0.8);
    await wait(220);

    // Se não moveu mais, chegou ao fim do popup, não da página.
    if (scroller.scrollTop === previousTop) break;
  }
  return findImageOptionById(mediaId, pickerRoot);
}

function findInitialChip() {
  // O container agrupa: [slot Inicial] + [botão de trocar] + [slot Final].
  // Quando um slot está VAZIO, ele é um <div aria-haspopup="dialog"> com o
  // texto "Inicial"/"Final". Quando está PREENCHIDO, vira um <button> com
  // a miniatura da imagem + ícone de cancelar, e PERDE o aria-haspopup —
  // por isso não dá pra confiar nesse atributo depois do 1º item (ele some
  // do slot Inicial assim que uma imagem é anexada, e passa a "sobrar" só
  // no slot Final vazio, fazendo a busca antiga cair no lugar errado).
  //
  // A forma confiável é sempre pegar o PRIMEIRO filho direto do container
  // (posição estrutural, que não muda entre vazio/preenchido).
  const container = document.querySelector('.sc-273a6a40-0');
  if (container?.firstElementChild) {
    const firstSlot = container.firstElementChild;
    // Vazio: o próprio elemento já é clicável (aria-haspopup="dialog")
    if (firstSlot.getAttribute('aria-haspopup') === 'dialog') {
      return firstSlot;
    }
    // Preenchido: o clicável é o <button> dentro dele (reabre o seletor
    // de imagem pra trocar, que é o que precisamos para o próximo item)
    const innerButton = firstSlot.querySelector('button');
    if (innerButton) return innerButton;
    return firstSlot;
  }

  // Fallback final: tenta pelo texto "Inicial" caso a estrutura mude
  return [...document.querySelectorAll('[aria-haspopup="dialog"]')]
    .find(el => el.textContent.trim() === 'Inicial') || null;
}

async function selectInitialImage(mediaId) {
  const initialChip = findInitialChip();
  if (!initialChip) {
    console.warn('[FlowBatch] Chip "Inicial" não encontrado');
    logToPanel('Chip "Inicial" não encontrado na página', 'error');
    return false;
  }
  initialChip.click();
  await wait(400);

  const pickerRoot = findActiveImagePickerRoot();
  if (!pickerRoot) {
    logToPanel('O seletor de imagens não abriu para o chip "Inicial".', 'error');
    return false;
  }

  let targetOption = findImageOptionById(mediaId, pickerRoot);
  if (!targetOption) targetOption = await scrollUntilFound(mediaId, 20, pickerRoot);
  if (!targetOption) {
    console.warn(`[FlowBatch] Imagem ${mediaId} não encontrada`);
    logToPanel(`Imagem ${item_short(mediaId)} não encontrada no painel "Inicial"`, 'error');
    return false;
  }

  targetOption.click();
  await wait(300);

  const confirmBtn = [...pickerRoot.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'Incluir no comando')
    || [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Incluir no comando');
  confirmBtn?.click();

  // Espera mais generosa: dá tempo do Flow processar internamente o anexo
  // da imagem (não só renderizar a thumbnail) antes de seguir pro prompt.
  // Sem esse tempo, o botão "Criar" pode nunca habilitar mesmo com tudo
  // visualmente pronto na tela.
  await wait(1200);
  return true;
}


function scoreReferenceAddButton(btn) {
  if (!btn || !(btn instanceof HTMLButtonElement) || !isVisibleAndClickable(btn)) return -999;
  const text = normalizeText(btn.textContent);
  const iconText = normalizeText(btn.querySelector('i.google-symbols, i')?.textContent);
  let score = 0;
  if (btn.getAttribute('aria-haspopup') === 'dialog') score += 30;
  if (iconText === 'add_2') score += 120;
  if (/\bCriar\b/i.test(text)) score += 60;
  if (text === 'add_2 Criar' || text === 'add_2Criar') score += 80;
  return score;
}

function findReferenceAddButton() {
  const candidates = [...document.querySelectorAll('button[aria-haspopup="dialog"], button')]
    .filter(btn => btn instanceof HTMLButtonElement)
    .map(btn => ({ btn, score: scoreReferenceAddButton(btn) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.btn || null;
}

async function openReferenceImagePicker() {
  const addBtn = findReferenceAddButton();
  if (!addBtn) {
    logToPanel('Botão + de adicionar imagens não encontrado no modo Imagem.', 'error');
    return false;
  }
  addBtn.click();
  await wait(450);
  return true;
}


function findComposerRoot() {
  const editor = document.querySelector('[data-slate-editor="true"]');
  let node = editor;
  for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
    const text = getCleanText(node);
    const hasAddButton = [...node.querySelectorAll('button, i')].some(el => getCleanText(el) === 'add_2');
    const hasCreateButton = /\bCriar\b|arrow_forward/.test(text);
    if (hasAddButton && hasCreateButton) return node;
  }
  return editor?.parentElement || document.body;
}

function countAttachedReferenceImages() {
  const root = findComposerRoot();
  if (!root) return 0;
  const imgs = [...root.querySelectorAll('img')].filter(img => {
    const src = img.getAttribute('src') || '';
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (src.includes('name=')) return true;
    // fallback para miniaturas anexadas no composer
    return rect.width <= 96 && rect.height <= 96;
  });
  return imgs.length;
}

async function attachSingleReferenceImage(mediaId) {
  const beforeAttached = countAttachedReferenceImages();
  const opened = await openReferenceImagePicker();
  if (!opened) return { ok: false };

  const pickerRoot = findActiveImagePickerRoot();
  if (!pickerRoot) {
    logToPanel('O seletor de imagens não abriu depois do clique no botão +.', 'error');
    return { ok: false };
  }

  const scroller = findImagePickerScroller(pickerRoot);
  if (scroller) {
    scroller.scrollTop = 0;
    await wait(120);
  }

  let targetOption = findImageOptionById(mediaId, pickerRoot);
  if (!targetOption) targetOption = await scrollUntilFound(mediaId, 25, pickerRoot);
  if (!targetOption) {
    logToPanel(`Imagem ${item_short(mediaId)} não encontrada no seletor do modo Imagem`, 'error');
    document.body.click();
    await wait(250);
    return { ok: false };
  }

  targetOption.click();
  await wait(260);

  const confirmBtn = [...pickerRoot.querySelectorAll('button')]
    .find(b => normalizeText(b.textContent) === 'Incluir no comando')
    || [...document.querySelectorAll('button')].find(b => normalizeText(b.textContent) === 'Incluir no comando');

  if (!confirmBtn) {
    const attachedNow = countAttachedReferenceImages();
    if (attachedNow > 0) {
      logToPanel(`O botão "Incluir no comando" não apareceu, mas detectei ${attachedNow} imagem(ns) já anexada(s). Vou parar de anexar e seguir para os prompts.`, 'success');
      document.body.click();
      await wait(350);
      return { ok: true, added: attachedNow > beforeAttached, stop: true, attachedCount: attachedNow };
    }

    logToPanel('Botão "Incluir no comando" não apareceu após selecionar a imagem.', 'error');
    document.body.click();
    await wait(250);
    return { ok: false };
  }

  confirmBtn.click();
  await wait(1000);
  const afterAttached = countAttachedReferenceImages();
  logToPanel(`Imagem ${item_short(mediaId)} anexada ao comando`, 'success');
  return { ok: true, added: true, stop: false, attachedCount: afterAttached };
}

async function attachAllReferenceImagesOnce(mediaIds) {
  if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
    logToPanel('Nenhuma imagem de referência foi informada para o modo Imagem.', 'error');
    return false;
  }

  logToPanel(`Anexando ${mediaIds.length} imagem(ns) de referência uma única vez...`);

  let finalAttachedCount = 0;
  for (let i = 0; i < mediaIds.length; i++) {
    setPanelProgress(`Modo Imagem — anexando referência ${i + 1} de ${mediaIds.length}`);
    const result = await attachSingleReferenceImage(mediaIds[i]);
    if (!result?.ok) return false;

    finalAttachedCount = Math.max(finalAttachedCount, result.attachedCount || 0, result.added ? i + 1 : 0);

    if (result.stop) {
      logToPanel('Anexos detectados. Interrompi a etapa de anexar para não travar e vou seguir para os prompts.', 'success');
      break;
    }

    if (i < mediaIds.length - 1) {
      await wait(500);
    }
  }

  const attachedMediaIds = mediaIds.slice(0, Math.max(1, Math.min(finalAttachedCount || mediaIds.length, mediaIds.length)));
  imageReferenceState = { attached: true, mediaIds: attachedMediaIds };
  updateSelectedCountUI();
  logToPanel('Referências anexadas/confirmadas. Agora vou trocar os prompts e gerar.', 'success');
  return true;
}

function findSettingsButton(mode = 'video') {
  const prefix = mode === 'image' ? 'Imagem' : 'Vídeo';
  const buttons = [...document.querySelectorAll('button')].filter(isVisibleAndClickable);

  // Botão de configuração no Flow costuma ser: "Vídeo · 8s x4" ou "Imagem · x4".
  return buttons.find(b => new RegExp(`^${prefix}\\s*·`).test(getCleanText(b)))
    || buttons.find(b => getCleanText(b).startsWith(prefix) && /9:16|16:9|x1|x2|x3|x4|4s|6s|8s/.test(getCleanText(b)))
    || null;
}

function findSettingsMenu() {
  const menus = [...document.querySelectorAll('[role="menu"][data-radix-menu-content]')];
  return menus.find(menu => {
    const tabTexts = [...menu.querySelectorAll('[role="tab"]')].map(getCleanText);
    return tabTexts.some(t => t === '9:16' || t === '16:9')
      || tabTexts.some(t => t === 'x1' || t === 'x2' || t === 'x3' || t === 'x4')
      || tabTexts.some(t => t === '4s' || t === '6s' || t === '8s');
  }) || null;
}

async function openSettingsMenu(mode = 'video') {
  // Se já estiver aberto, reaproveita o menu certo (não o popup do modelo).
  const existing = findSettingsMenu();
  if (existing) return existing;

  const settingsButton = findSettingsButton(mode);
  if (!settingsButton) {
    console.warn('[FlowBatch] Botão de configurações não encontrado');
    logToPanel(`Botão de configurações do modo ${mode === 'image' ? 'Imagem' : 'Vídeo'} não encontrado`, 'error');
    return null;
  }
  settingsButton.click();
  await wait(350);
  return findSettingsMenu();
}

async function selectModel(desiredModelText) {
  if (!desiredModelText) return true;

  function getExactModelLabel(button) {
    return button?.querySelector('.sc-3f41cc92-8')?.textContent.trim() || '';
  }

  const modelTrigger = [...document.querySelectorAll('button.sc-3f41cc92-3')]
    .find(b => /Omni Flash|Veo 3\.1/.test(b.textContent));

  if (!modelTrigger) {
    console.warn('[FlowBatch] Botão de modelo não encontrado na página');
    logToPanel('Botão de modelo não encontrado na página', 'error');
    return false;
  }

  // comparação EXATA (não .includes()) — necessário porque "Veo 3.1 - Lite" é
  // substring de "Veo 3.1 - Lite [Lower Priority]", o que causava falso positivo
  if (getExactModelLabel(modelTrigger) === desiredModelText) {
    return true;
  }

  modelTrigger.click();
  await wait(300);

  const openMenus = document.querySelectorAll('[role="menu"][data-radix-menu-content]');
  const modelPopup = openMenus[openMenus.length - 1]; // o mais recente aberto
  if (!modelPopup) {
    console.warn('[FlowBatch] Menu de modelo não abriu');
    return false;
  }

  const options = [...modelPopup.querySelectorAll('[role="menuitem"]')];
  const target = options.find(opt =>
    opt.querySelector('.sc-3f41cc92-8')?.textContent.trim() === desiredModelText
  );

  if (!target) {
    console.warn(`[FlowBatch] Modelo "${desiredModelText}" não encontrado nas opções`);
    logToPanel(`Modelo "${desiredModelText}" não encontrado nas opções do menu`, 'error');
    document.body.click();
    return false;
  }

  target.querySelector('button.sc-3f41cc92-3')?.click();
  await wait(300);

  // confirma que trocou de verdade (comparação exata de novo)
  const confirmTrigger = [...document.querySelectorAll('button.sc-3f41cc92-3')]
    .find(b => /Omni Flash|Veo 3\.1/.test(b.textContent));
  if (getExactModelLabel(confirmTrigger) !== desiredModelText) {
    console.warn(`[FlowBatch] Modelo pode não ter trocado para "${desiredModelText}"`);
    logToPanel(`Modelo pode não ter trocado para "${desiredModelText}"`, 'error');
    return false;
  }
  logToPanel(`Modelo definido: ${desiredModelText}`);
  return true;
}

// Busca uma aba com o texto exato em QUALQUER tablist dentro do menu,
// em vez de assumir uma posição fixa (índice) — isso evita quebrar
// se a ordem interna dos grupos (proporção/multiplicador/duração) mudar.
async function clickAnyTabWithLabel(menu, label) {
  if (!label) return true;
  const tablists = [...menu.querySelectorAll('[role="tablist"]')];
  for (const tablist of tablists) {
    const tab = [...tablist.querySelectorAll('[role="tab"]')]
      .find(t => t.textContent.trim() === label);
    if (tab) {
      if (tab.getAttribute('aria-selected') !== 'true') {
        tab.click();
        await wait(150);
      }
      return true;
    }
  }
  console.warn(`[FlowBatch] Nenhuma aba com o texto "${label}" foi encontrada no menu`);
  return false;
}

async function configureSettings(menu, { aspectRatio, multiplier, duration }) {
  if (!menu) return false;
  const okAspect = await clickAnyTabWithLabel(menu, aspectRatio);
  const okMultiplier = await clickAnyTabWithLabel(menu, multiplier);
  const okDuration = await clickAnyTabWithLabel(menu, duration);
  document.body.click(); // fecha o menu
  await wait(250);
  return okAspect && okMultiplier && okDuration;
}

async function applyPreset(mode) {
  const preset = FBG_PRESETS[mode] || FBG_PRESETS.video;
  logToPanel(`Aplicando preset: ${preset.label}`);

  await ensureFlowMode(mode);
  await wait(250);

  let menu = await openSettingsMenu(mode);
  if (!menu) {
    logToPanel('Não consegui abrir o menu de opções. Vou continuar com o que já estiver selecionado na tela.', 'error');
    return false;
  }

  if (mode === 'video') {
    await selectModel(preset.model);
    await wait(250);
    // Alguns cliques no modelo fecham o menu principal. Reabre antes de marcar 9:16/x4/8s.
    menu = findSettingsMenu() || await openSettingsMenu(mode);
  }

  const configured = await configureSettings(menu, preset);
  logToPanel(configured ? `Preset confirmado: ${preset.label}` : 'Preset aplicado parcialmente — confira visualmente antes de rodar muito lote.', configured ? 'success' : 'error');
  return configured;
}

async function setSlatePrompt(promptText) {
  const editor = document.querySelector('[data-slate-editor="true"]');
  if (!editor) {
    console.warn('[FlowBatch] Editor de prompt não encontrado');
    return false;
  }

  // 1. Simula um clique real no editor para o Slate estabelecer foco + seleção interna
  editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }));
  editor.focus();
  editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true }));
  editor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
  await wait(100);

  // 2. Seleciona todo o conteúdo atual via Selection API (necessário para o Slate
  //    saber o que substituir quando o beforeinput de delete/insert chegar)
  const range = document.createRange();
  range.selectNodeContents(editor);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  await wait(50);

  // 3. Dispara beforeinput sintético de exclusão (limpa o placeholder/conteúdo anterior)
  //    O Slate escuta esse evento diretamente e reconstrói o valor internamente,
  //    então não depende do comportamento nativo do navegador (por isso execCommand falhava).
  editor.dispatchEvent(new InputEvent('beforeinput', {
    inputType: 'deleteContentBackward',
    bubbles: true,
    cancelable: true,
    composed: true,
  }));
  await wait(80);

  // 4. Dispara beforeinput sintético de inserção com o prompt real
  editor.dispatchEvent(new InputEvent('beforeinput', {
    inputType: 'insertText',
    data: promptText,
    bubbles: true,
    cancelable: true,
    composed: true,
  }));
  await wait(200);

  // 5. Verificação: confere se o texto realmente entrou no editor
  const currentText = editor.textContent || '';
  if (!currentText.includes(promptText.slice(0, 20))) {
    console.warn('[FlowBatch] Texto pode não ter sido inserido corretamente, tentando fallback...');
    // Fallback: digitação caractere a caractere via beforeinput (mais lento, mas mais robusto)
    await typeCharByChar(editor, promptText);
  }

  return true;
}

async function typeCharByChar(editor, text) {
  for (const char of text) {
    editor.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: char,
      bubbles: true,
      cancelable: true,
      composed: true,
    }));
    await wait(8);
  }
  await wait(150);
}

async function submitPrompt() {
  const editor = document.querySelector('[data-slate-editor="true"]');
  if (!editor) {
    console.warn('[FlowBatch] Editor não encontrado ao tentar enviar');
    logToPanel('Editor de prompt não encontrado ao tentar enviar', 'error');
    return false;
  }

  // Garante que o cursor está focado no campo antes de simular o Enter
  // (igual ao comportamento manual: escrever e apertar Enter com o
  // cursor piscando dentro do campo).
  editor.focus();
  await wait(150);

  const keyOpts = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  editor.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
  await wait(100);
  editor.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
  await wait(100);
  editor.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
  await wait(600);

  // Se o Enter funcionou, o campo costuma esvaziar/voltar ao placeholder
  const stillHasText = (editor.textContent || '').trim().length > 0;
  if (!stillHasText) {
    logToPanel('Prompt enviado via tecla Enter', 'success');
    return true;
  }

  logToPanel('Enter não pareceu enviar — tentando clicar no botão "Criar" como alternativa...');
  return await clickCreate();
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isVisibleAndClickable(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
  return true;
}

function isCreateButtonEnabled(btn) {
  if (!btn) return false;
  if (btn.disabled) return false;
  if (btn.getAttribute('disabled') !== null) return false;
  if (btn.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function scoreCreateButton(btn) {
  const text = normalizeText(btn.textContent);
  const spanText = normalizeText([...btn.querySelectorAll('span')].map(s => s.textContent).join(' '));
  const iconText = normalizeText(btn.querySelector('i.google-symbols, i')?.textContent);
  const ariaLabel = normalizeText(btn.getAttribute('aria-label'));
  const title = normalizeText(btn.getAttribute('title'));
  const className = String(btn.className || '');
  let score = 0;

  // O botão real do Flow costuma vir assim:
  // <button aria-disabled="false" class="... sc-26b30722-5 ...">
  //   <i class="google-symbols">arrow_forward</i>
  //   <span ...>Criar</span>
  // </button>
  if (spanText === 'Criar') score += 120;
  if (text === 'Criar' || text === 'arrow_forward Criar' || text === 'arrow_forwardCriar') score += 100;
  if (/\bCriar\b/i.test(text)) score += 80;
  if (/\bCriar\b|\bCreate\b/i.test(`${ariaLabel} ${title}`)) score += 80;
  if (iconText === 'arrow_forward') score += 55;
  if (className.includes('sc-26b30722-5')) score += 45;
  if (btn.getAttribute('aria-disabled') === 'false') score += 30;
  if (btn.closest('[data-slate-editor="true"]')) score -= 100;
  if (!isVisibleAndClickable(btn)) score -= 80;
  if (!isCreateButtonEnabled(btn)) score -= 120;

  return score;
}

function findCreateButton({ requireEnabled = false } = {}) {
  const selectors = [
    'button.sc-26b30722-5',
    'button[aria-disabled="false"].sc-26b30722-5',
    'button[aria-disabled="false"]',
    'button',
  ];

  const candidates = [...new Set(selectors.flatMap(sel => [...document.querySelectorAll(sel)]))]
    .filter(btn => btn instanceof HTMLButtonElement)
    .filter(btn => !requireEnabled || isCreateButtonEnabled(btn))
    .map(btn => ({ btn, score: scoreCreateButton(btn) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.btn || null;
}

function dispatchPointerMouseSequence(target, x, y) {
  const commonOpts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
  };

  const pointerOpts = { ...commonOpts, pointerId: 1, pointerType: 'mouse', isPrimary: true };

  if (typeof PointerEvent !== 'undefined') {
    target.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
    target.dispatchEvent(new PointerEvent('pointerenter', pointerOpts));
    target.dispatchEvent(new PointerEvent('pointermove', pointerOpts));
    target.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
  }
  target.dispatchEvent(new MouseEvent('mouseover', commonOpts));
  target.dispatchEvent(new MouseEvent('mouseenter', commonOpts));
  target.dispatchEvent(new MouseEvent('mousemove', commonOpts));
  target.dispatchEvent(new MouseEvent('mousedown', commonOpts));

  if (typeof PointerEvent !== 'undefined') {
    target.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
  }
  target.dispatchEvent(new MouseEvent('mouseup', commonOpts));
  target.dispatchEvent(new MouseEvent('click', { ...commonOpts, buttons: 0 }));
}

async function simulateRealClick(el) {
  if (!el) return false;

  // Coloca o botão dentro da área visível; se o painel da extensão estiver em cima,
  // clicar no centro poderia acertar outro elemento. Por isso conferimos elementFromPoint.
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  await wait(120);
  el.focus?.({ preventScroll: true });
  await wait(40);

  const rect = el.getBoundingClientRect();
  const points = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + Math.min(rect.width - 4, Math.max(4, rect.width * 0.72)), rect.top + rect.height / 2],
    [rect.left + Math.min(rect.width - 4, Math.max(4, rect.width * 0.28)), rect.top + rect.height / 2],
  ];

  for (const [x, y] of points) {
    const topEl = document.elementFromPoint(x, y);
    const target = topEl && (topEl === el || el.contains(topEl)) ? topEl : el;
    dispatchPointerMouseSequence(target, x, y);
    await wait(160);
  }

  // Fallback final: alguns handlers React ainda respondem melhor ao método nativo.
  el.click();
  await wait(250);
  return true;
}

function describeCreateButton(btn) {
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return {
    text: normalizeText(btn.textContent),
    ariaDisabled: btn.getAttribute('aria-disabled'),
    disabled: !!btn.disabled,
    className: String(btn.className || '').slice(0, 180),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    score: scoreCreateButton(btn),
  };
}

function debugCreateCandidates() {
  const candidates = [...document.querySelectorAll('button')]
    .map(btn => ({ btn, score: scoreCreateButton(btn), desc: describeCreateButton(btn) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  console.table(candidates.map(x => x.desc));
  return candidates;
}

function runtimeMessage(payload, timeoutMs = 7000) {
  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(payload, response => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, reason: 'runtime_error', error: err.message });
        else resolve(response || { ok: false, reason: 'empty_response' });
      });
    } catch (err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: 'exception', error: String(err?.message || err) });
    }
  });
}

function setPanelTemporarilyHidden(hidden) {
  const previous = {
    panelDisplay: panelEl?.style.display,
    chipDisplay: restoreChipEl?.style.display,
  };
  if (hidden) {
    if (panelEl) panelEl.style.display = 'none';
    if (restoreChipEl) restoreChipEl.style.display = 'none';
  }
  return () => {
    if (!hidden) return;
    if (panelEl) panelEl.style.display = previous.panelDisplay || 'flex';
    if (restoreChipEl) restoreChipEl.style.display = previous.chipDisplay || 'none';
  };
}

async function getClickablePointForElement(el) {
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  await wait(120);
  const r = el.getBoundingClientRect();
  const points = [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + Math.max(5, r.width * 0.25), r.top + r.height / 2],
    [r.left + Math.max(5, r.width * 0.75), r.top + r.height / 2],
  ];
  for (const [x, y] of points) {
    if (x < 1 || y < 1 || x > window.innerWidth - 1 || y > window.innerHeight - 1) continue;
    const topEl = document.elementFromPoint(x, y);
    if (topEl === el || el.contains(topEl)) {
      return { x: Math.round(x), y: Math.round(y), topElText: normalizeText(topEl.textContent) };
    }
  }
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), topElText: 'fallback-center' };
}

async function clickCreateViaMainWorld() {
  const result = await runtimeMessage({ type: 'CLICK_CREATE_MAIN_WORLD' }, 8000);
  console.log('[FlowBatch] Resultado MAIN world:', result);
  if (result?.ok) {
    logToPanel(`Clique MAIN world enviado em (${result.x}, ${result.y})`, 'success');
    return true;
  }
  logToPanel(`MAIN world não resolveu: ${result?.reason || 'sem resposta'}`, 'error');
  return false;
}

async function clickCreateViaDebugger(createBtn) {
  const restorePanel = setPanelTemporarilyHidden(true);
  try {
    await wait(120);
    const point = await getClickablePointForElement(createBtn);
    logToPanel(`Clique real via navegador em (${point.x}, ${point.y})...`);
    const result = await runtimeMessage({ type: 'DEBUGGER_CLICK', x: point.x, y: point.y }, 9000);
    console.log('[FlowBatch] Resultado DEBUGGER_CLICK:', result);
    if (result?.ok) {
      logToPanel('Clique real via navegador enviado', 'success');
      return true;
    }
    logToPanel(`Clique via navegador falhou: ${result?.error || result?.reason || 'sem resposta'}`, 'error');
    return false;
  } finally {
    await wait(300);
    restorePanel();
  }
}

async function clickCreate() {
  // Dá tempo suficiente para o React re-renderizar o botão como habilitado
  // depois que o Slate processa o beforeinput e atualiza o estado do formulário.
  const maxAttempts = 50; // 50 x 300ms = 15s no total
  let createBtn = null;

  for (let i = 0; i < maxAttempts; i++) {
    createBtn = findCreateButton({ requireEnabled: false });

    if (createBtn && isCreateButtonEnabled(createBtn)) break;

    if (i > 0 && i % 6 === 0) {
      logToPanel(`Aguardando botão "Criar" habilitar... (${Math.round(i * 0.3)}s)`);
    }
    await wait(300);
  }

  const candidates = debugCreateCandidates();
  createBtn = createBtn || candidates[0]?.btn || null;

  if (!createBtn) {
    console.warn('[FlowBatch] Botão Criar não encontrado');
    logToPanel('Botão "Criar" não encontrado na página. Abre o Console/F12 e veja a tabela FlowBatch.', 'error');
    return false;
  }
  if (!isCreateButtonEnabled(createBtn)) {
    console.warn('[FlowBatch] Botão Criar continua desabilitado após espera (falta imagem/prompt)', describeCreateButton(createBtn), createBtn);
    logToPanel('Botão "Criar" encontrado, mas ainda está desabilitado — o Flow não registrou imagem/prompt.', 'error');
    return false;
  }

  console.log('[FlowBatch] Botão Criar escolhido:', describeCreateButton(createBtn), createBtn);

  // Estratégia 1: eventos normais no content script.
  const restorePanel = setPanelTemporarilyHidden(true);
  try {
    await simulateRealClick(createBtn);
  } finally {
    await wait(250);
    restorePanel();
  }
  logToPanel('Tentativa 1: clique sintético enviado');
  await wait(1200);

  // Se o botão sumiu ou desabilitou, geralmente o Flow aceitou o envio.
  let afterBtn = findCreateButton({ requireEnabled: false });
  if (!afterBtn || !isCreateButtonEnabled(afterBtn)) {
    logToPanel('O botão mudou de estado após a tentativa 1 — provável envio aceito', 'success');
    return true;
  }

  // Estratégia 2: clique no MAIN world da página.
  await clickCreateViaMainWorld();
  await wait(1200);
  afterBtn = findCreateButton({ requireEnabled: false });
  if (!afterBtn || !isCreateButtonEnabled(afterBtn)) {
    logToPanel('O botão mudou de estado após MAIN world — provável envio aceito', 'success');
    return true;
  }

  // Estratégia 3: clique real via Chrome Debugger / DevTools Protocol.
  // Esse é o mais forte: o Chrome injeta o mouse no nível do navegador.
  const okDebugger = await clickCreateViaDebugger(afterBtn || createBtn);
  if (okDebugger) {
    await wait(900);
    logToPanel('Botão "Criar" acionado pelo modo força bruta', 'success');
    return true;
  }

  logToPanel('Nenhuma estratégia conseguiu acionar o botão "Criar".', 'error');
  return false;
}

// Fallback simples: aguarda um tempo fixo. Idealmente troca por
// MutationObserver assim que soubermos como o card "gerando" aparece.
async function waitForGenerationToFinish(fallbackMs = 8000) {
  await wait(fallbackMs);
}

async function waitWithCountdown(ms, label) {
  const totalSeconds = Math.ceil(ms / 1000);
  for (let remaining = totalSeconds; remaining > 0; remaining--) {
    setPanelProgress(`${label} — próximo lote em ${remaining}s`);
    await wait(1000);
  }
}

async function processVideoItem(item) {
  const okImage = await selectInitialImage(item.mediaId);
  if (!okImage) return false;

  await setSlatePrompt(item.prompt);
  await wait(400);

  const created = await clickCreate();
  if (!created) return false;

  await waitForGenerationToFinish();
  return true;
}

async function processImageItem(item) {
  await setSlatePrompt(item.prompt);
  await wait(400);

  const created = await clickCreate();
  if (!created) return false;

  await waitForGenerationToFinish();
  return true;
}

async function processItem(item, mode) {
  if (mode === 'image') return processImageItem(item);
  return processVideoItem(item);
}

async function resetAfterFailedAttempt() {
  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
  } catch (err) {}
  try { document.body.click(); } catch (err) {}
  await wait(900);
}

async function processItemUntilSuccess(item, mode, label) {
  let attempt = 1;

  while (!fbgStopRequested) {
    if (attempt > 1) {
      setPanelProgress(`${label} — tentativa ${attempt}`);
      logToPanel(`Repetindo ${label}. Não vou pular para o próximo. Tentativa ${attempt}...`, 'error');
    }

    const ok = await processItem(item, mode);
    if (ok) return true;

    markPromptEntryRetrying(item?.promptEntry);
    await resetAfterFailedAttempt();

    const useLongPause = attempt % FBG_RETRY_LONG_PAUSE_EVERY === 0;
    const delay = useLongPause ? FBG_RETRY_LONG_PAUSE_MS : FBG_RETRY_DELAY_MS;
    logToPanel(`${label} falhou. Aguardando ${Math.round(delay / 1000)}s e tentando O MESMO prompt de novo.`, 'error');
    await waitWithCountdown(delay, `${label} falhou`);
    attempt++;
  }

  logToPanel(`${label} não foi enviado porque a fila foi parada.`, 'error');
  return false;
}

async function runQueue(items, { mode = 'video' } = {}) {
  showPanel();
  const isImageMode = mode === 'image';
  const modeLabel = isImageMode ? 'imagens' : 'vídeos';

  if (isImageMode) {
    logToPanel(`Iniciando fila de ${modeLabel}: ${items.length} item(ns) — referências anexadas 1 vez, sem pausa de 40s`);
    logToPanel(`Ritmo ativado: primeiro anexo todas as imagens marcadas. Depois envio 1 prompt por vez com intervalo de ${Math.round(FBG_IMAGE_BETWEEN_ITEMS_MS / 1000)}s.`, 'success');
  } else {
    logToPanel(`Iniciando fila de ${modeLabel}: ${items.length} item(ns) — ordem travada, sem pular prompt`);
    logToPanel('Ritmo ativado: se um prompt falhar, repete o mesmo item até enviar. Só depois vai para o próximo.', 'success');
  }

  await applyPreset(mode);

  let successCount = 0;

  if (isImageMode) {
    const sharedMediaIds = Array.isArray(items[0]?.mediaIds) ? items[0].mediaIds : getSelectionQueue('image').map(entry => entry.mediaId);
    const canReuseExisting = hasAttachedImageReferences() && arraysEqual(sharedMediaIds, imageReferenceState.mediaIds);

    if (canReuseExisting) {
      logToPanel(`As ${imageReferenceState.mediaIds.length} imagens de referência já estão marcadas como anexadas. Vou reutilizar e seguir direto para os prompts.`, 'success');
      updateSelectedCountUI();
    } else {
      const okAttach = await attachAllReferenceImagesOnce(sharedMediaIds);
      if (!okAttach) {
        setPanelProgress('Falha ao anexar as imagens de referência');
        logToPanel('Não consegui anexar todas as imagens de referência. A fila foi interrompida.', 'error');
        return;
      }
    }

    for (let i = 0; i < items.length; i++) {
      setPanelProgress(`Modo Imagem — item ${i + 1} de ${items.length}`);
      const promptOrder = items[i]?.promptEntry?.order || (i + 1);
      logToPanel(`Processando prompt de imagem ${promptOrder} sem reanexar imagens...`);

      const retryLabel = `prompt de imagem ${promptOrder}`;
      const ok = await processItemUntilSuccess(items[i], mode, retryLabel);
      if (!ok) return;
      markPromptEntryResult(items[i]?.promptEntry, true);
      successCount++;
      logToPanel(`✓ Item ${i + 1} enviado para geração`, 'success');

      if (i < items.length - 1) {
        setPanelProgress(`Modo Imagem — aguardando ${Math.round(FBG_IMAGE_BETWEEN_ITEMS_MS / 1000)}s para o próximo prompt`);
        await wait(FBG_IMAGE_BETWEEN_ITEMS_MS);
      }
    }
  } else {
    for (let batchStart = 0; batchStart < items.length; batchStart += FBG_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + FBG_BATCH_SIZE, items.length);
      const batchNumber = Math.floor(batchStart / FBG_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(items.length / FBG_BATCH_SIZE);

      logToPanel(`Lote ${batchNumber}/${totalBatches}: enviando itens ${batchStart + 1} até ${batchEnd}`);

      for (let i = batchStart; i < batchEnd; i++) {
        setPanelProgress(`Lote ${batchNumber}/${totalBatches} — item ${i + 1} de ${items.length}`);
        const promptOrder = items[i]?.promptEntry?.order || (i + 1);
        const itemLabel = `prompt de vídeo ${promptOrder} · imagem ${item_short(items[i].mediaId)}`;
        logToPanel(`Processando ${itemLabel}...`);

        const ok = await processItemUntilSuccess(items[i], mode, itemLabel);
        if (!ok) return;
        markPromptEntryResult(items[i]?.promptEntry, true);
        successCount++;
        logToPanel(`✓ Item ${i + 1} enviado para geração`, 'success');

        if (i < batchEnd - 1) {
          await wait(FBG_BETWEEN_ITEMS_MS);
        }
      }

      if (batchEnd < items.length) {
        logToPanel(`Pausa anti-bug de ${Math.round(FBG_BATCH_PAUSE_MS / 1000)}s antes do próximo lote...`);
        await waitWithCountdown(FBG_BATCH_PAUSE_MS, `Lote ${batchNumber}/${totalBatches} enviado`);
      }
    }
  }

  setPanelProgress(`Concluído: ${successCount}/${items.length}`);
  logToPanel(`Fila finalizada: ${successCount}/${items.length} ${modeLabel} enviados`, 'success');
  chrome.runtime.sendMessage({ type: 'QUEUE_DONE', successCount, total: items.length, mode }).catch(() => {});
}

function item_short(mediaId) {
  return mediaId ? mediaId.slice(0, 8) : '???';
}

// ------------------------------------------------------------
// PARTE 3 — Ponte com o popup
// ------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TOGGLE_PANEL') {
    ensurePanel();
    const isHidden = panelEl.style.display === 'none' || panelEl.style.display === '';
    if (isHidden) {
      panelEl.style.display = 'flex';
      if (restoreChipEl) restoreChipEl.style.display = 'none';
    } else {
      panelEl.style.display = 'none';
    }
    sendResponse({ ok: true });
  }
  return true; // mantém canal async aberto
});
