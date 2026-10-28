import { addDownloadLink } from './dom.js?v=4';

// UI wrappers (use global Swal from CDN)
export function showProcessing(title = 'Procesando ebook', text = 'Espere a que termine el procesamiento.') {
    if (typeof Swal !== 'undefined') {
        Swal.fire({ title, text, icon: 'info', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    }
}

export function closeProcessing() { if (typeof Swal !== 'undefined') Swal.close(); }

export function toast(msg, opts = {}) {
    if (typeof Swal === 'undefined') return;
    Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: opts.timer || 2000, title: msg });
}

function chapterDisplayTitle(chapter, index) {
    const raw = String(chapter && (chapter.titulo || chapter.title || '') || '').replace(/\s+/g, ' ').trim();
    if (raw && raw.length <= 180 && !/^\d+(?:\.0)?$/.test(raw)) return raw;
    const html = String(chapter && (chapter.contenido || chapter.content || '') || '');
    const htmlTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleText = htmlTitle ? htmlTitle[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (titleText && titleText.length <= 180) return titleText;
    const titledHeading = html.match(/<h[1-6][^>]*\btitle=["']([^"']+)["'][^>]*>/i);
    if (titledHeading && titledHeading[1].trim().length <= 180) return titledHeading[1].replace(/\s+/g, ' ').trim();
    const subtitle = html.match(/class=["'][^"']*subtit14[^"']*["'][^>]*>([\s\S]*?)<\//i);
    const subtitleText = subtitle ? subtitle[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (subtitleText && subtitleText.length <= 180) return subtitleText;
    const heading = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const headingText = heading ? heading[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    return (headingText && headingText.length <= 180 ? headingText : '') || String(chapter && chapter.href || `Capítulo ${index + 1}`).split('/').pop().replace(/\.[^.]+$/, '') || `Capítulo ${index + 1}`;
}

const GENERATED_AUDIO_STORAGE_KEY = 'listenbook.generated.audio.v2';
const PLAYER_POSITION_STORAGE_KEY = 'listenbook.audio.player.position.v1';

function normalizeAudioUrl(url) {
    try {
        const parsed = new URL(url, window.location.href);
        if (parsed.pathname !== '/view' || !parsed.searchParams.get('filename')) return url;
        const proxy = new URL('/api/audio', window.location.origin);
        ['filename', 'subfolder', 'type'].forEach(key => proxy.searchParams.set(key, parsed.searchParams.get(key) || (key === 'type' ? 'output' : '')));
        proxy.searchParams.set('download', '0');
        return proxy.toString();
    } catch (error) {
        return url;
    }
}

function formatGeneratedAudioDuration(seconds) {
    const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainder = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function updateGeneratedSummary(count, seconds) {
    const inline = document.getElementById('generatedChaptersInline');
    const badge = document.getElementById('generatedChaptersBadge');
    const duration = document.getElementById('totalDurationBadge');
    if (inline) inline.textContent = `(${count})`;
    if (badge) badge.textContent = String(count);
    if (duration) duration.textContent = formatGeneratedAudioDuration(seconds);
}

function readAudioDuration(url) {
    return new Promise(resolve => {
        if (!url || typeof document === 'undefined') return resolve(0);
        const audio = document.createElement('audio');
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            audio.removeAttribute('src');
            audio.load();
            resolve(Number.isFinite(value) ? value : 0);
        };
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => finish(audio.duration);
        audio.onerror = () => finish(0);
        window.setTimeout(() => finish(0), 10000);
        audio.src = url;
    });
}

async function refreshGeneratedSummary(bookIdentity, records = null) {
    const key = generatedAudioBookKey(bookIdentity);
    const currentBookId = String(window.__listenbookCurrentBookId || '').trim();
    const isCurrentBook = !currentBookId || generatedAudioBookKey(currentBookId) === key;
    const state = readGeneratedAudioState();
    const bookRecords = records || state[key] || {};
    const entries = Object.entries(bookRecords);
    if (isCurrentBook) updateGeneratedSummary(entries.length, entries.reduce((sum, [, audio]) => sum + (Number(audio?.durationSeconds) || 0), 0));
    if (!entries.length) return;

    let stateChanged = false;
    const durations = await Promise.all(entries.map(async ([chapterIndex, audio]) => {
        const storedDuration = Number(audio?.durationSeconds);
        if (Number.isFinite(storedDuration) && storedDuration > 0) return [chapterIndex, storedDuration];
        const duration = await readAudioDuration(audio?.url);
        if (duration > 0 && state[key]?.[chapterIndex]) {
            state[key][chapterIndex].durationSeconds = duration;
            stateChanged = true;
        }
        return [chapterIndex, duration];
    }));

    if (stateChanged) writeGeneratedAudioState(state);
    const totalSeconds = durations.reduce((sum, [, duration]) => sum + (Number(duration) || 0), 0);
    if (isCurrentBook) updateGeneratedSummary(entries.length, totalSeconds);
}

function generatedAudioBookKey(bookIdentity) {
    const identity = String(bookIdentity || '').trim();
    if (/^book[-_:]/i.test(identity)) return `id_${identity.replace(/[^\p{L}\p{N}_-]/gu, '_').toLowerCase()}`;
    const tokenRe = /[\p{L}\p{N}]+/gu;
    const tokens = Array.from(identity.matchAll(tokenRe)).map(match => match[0].toLowerCase());
    return tokens.join('_') || 'ebook';
}

function readGeneratedAudioState() {
    try {
        const value = JSON.parse(localStorage.getItem(GENERATED_AUDIO_STORAGE_KEY) || '{}');
        return value && typeof value === 'object' ? value : {};
    } catch (error) {
        return {};
    }
}

function writeGeneratedAudioState(state) {
    try { localStorage.setItem(GENERATED_AUDIO_STORAGE_KEY, JSON.stringify(state)); } catch (error) { /* storage unavailable */ }
    try {
        fetch('/api/generated-audio', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state),
            keepalive: true
        }).catch(() => {});
    } catch (error) { /* servidor central no disponible */ }
}

function readPlaybackPanelPosition() {
    try {
        const position = JSON.parse(localStorage.getItem(PLAYER_POSITION_STORAGE_KEY) || 'null');
        if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) return position;
    } catch (error) { /* storage unavailable */ }
    return null;
}

function writePlaybackPanelPosition(left, top) {
    try { localStorage.setItem(PLAYER_POSITION_STORAGE_KEY, JSON.stringify({ left, top })); } catch (error) { /* storage unavailable */ }
}

function installPlaybackPanelDrag(panel) {
    if (!panel || panel.dataset.listenbookDragReady === 'true') return;
    const header = panel.querySelector('.listenbook-audio-player-header');
    if (!header) return;
    panel.dataset.listenbookDragReady = 'true';

    const savedPosition = readPlaybackPanelPosition();
    if (savedPosition) {
        panel.style.left = `${savedPosition.left}px`;
        panel.style.top = `${savedPosition.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    let dragState = null;
    const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
    const finishDrag = event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        try { header.releasePointerCapture(event.pointerId); } catch (error) { /* capture may already be released */ }
        writePlaybackPanelPosition(parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0);
        dragState = null;
        panel.classList.remove('is-dragging');
    };

    header.addEventListener('pointerdown', event => {
        if (event.target.closest('button, audio')) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const bounds = panel.getBoundingClientRect();
        panel.style.left = `${bounds.left}px`;
        panel.style.top = `${bounds.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        dragState = {
            pointerId: event.pointerId,
            offsetX: event.clientX - bounds.left,
            offsetY: event.clientY - bounds.top
        };
        try { header.setPointerCapture(event.pointerId); } catch (error) { /* pointer capture unavailable */ }
        panel.classList.add('is-dragging');
        event.preventDefault();
    });

    header.addEventListener('pointermove', event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const maxLeft = window.innerWidth - panel.offsetWidth;
        const maxTop = window.innerHeight - panel.offsetHeight;
        const left = clamp(event.clientX - dragState.offsetX, 0, maxLeft);
        const top = clamp(event.clientY - dragState.offsetY, 0, maxTop);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    });
    header.addEventListener('pointerup', finishDrag);
    header.addEventListener('pointercancel', finishDrag);
    window.addEventListener('resize', () => {
        if (!panel.style.left || !panel.style.top || !panel.classList.contains('is-visible')) return;
        const left = clamp(parseFloat(panel.style.left) || 0, 0, window.innerWidth - panel.offsetWidth);
        const top = clamp(parseFloat(panel.style.top) || 0, 0, window.innerHeight - panel.offsetHeight);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        writePlaybackPanelPosition(left, top);
    });
}

function ensurePlaybackPanel() {
    let panel = document.getElementById('listenbook-audio-player');
    if (panel) {
        installPlaybackPanelDrag(panel);
        return panel;
    }

    panel = document.createElement('aside');
    panel.id = 'listenbook-audio-player';
    panel.className = 'listenbook-audio-player';
    panel.innerHTML = `
        <div class="listenbook-audio-player-header">
            <div class="listenbook-audio-player-title">
                <span class="material-symbols-outlined">volume_up</span>
                <div>
                    <small>Reproduciendo desde</small>
                    <strong id="listenbook-audio-player-chapter">Capítulo</strong>
                </div>
            </div>
            <button type="button" class="listenbook-audio-player-close" aria-label="Cerrar reproductor">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
        <audio id="listenbook-audio-player-audio" controls preload="metadata"></audio>
    `;
    panel.querySelector('.listenbook-audio-player-close')?.addEventListener('click', () => {
        const audio = panel.querySelector('audio');
        if (audio) audio.pause();
        panel.classList.remove('is-visible');
    });
    document.body.appendChild(panel);
    installPlaybackPanelDrag(panel);
    return panel;
}

function playGeneratedAudio(audio, title) {
    if (!audio || !audio.url) return;
    const panel = ensurePlaybackPanel();
    const player = panel.querySelector('audio');
    const titleElement = panel.querySelector('#listenbook-audio-player-chapter');
    if (!player) return;
    if (titleElement) titleElement.textContent = title || audio.filename || 'Capítulo';
    player.src = audio.url;
    player.load();
    panel.classList.add('is-visible');
    player.play().catch(() => {});
}

function setGeneratedRowState(row, audio, title) {
    if (!row || !audio || !audio.url) return;
    row.classList.add('chapter-row-generated');
    row.dataset.generatedAudioUrl = audio.url;
    row.dataset.generatedAudioFilename = audio.filename || '';
    row.title = 'Audio generado. Pasa el ratón para reproducir desde aquí.';
    const checkbox = row.querySelector('.chapter-cb');
    if (checkbox) {
        const wasChecked = checkbox.checked;
        if (wasChecked) {
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
        checkbox.remove();
    }
    if (typeof window.__listenbookRefreshChapterControls === 'function') window.__listenbookRefreshChapterControls();
    if (row.dataset.listenbookGeneratedInteraction !== 'true') {
        row.dataset.listenbookGeneratedInteraction = 'true';
        row.addEventListener('click', event => {
            if (event.target.closest('input, button')) return;
            row.classList.toggle('chapter-row-active');
        });
    }

    let status = row.querySelector('.chapter-generated-status');
    if (!status) {
        status = document.createElement('span');
        status.className = 'chapter-generated-status material-symbols-outlined';
        status.textContent = 'check_circle';
        status.setAttribute('aria-label', 'Audio generado');
        const duration = row.querySelector(':scope > span:last-child');
        if (duration) duration.before(status);
        else row.appendChild(status);
    }

    let action = row.querySelector('.chapter-play-action');
    if (!action) {
        action = document.createElement('button');
        action.type = 'button';
        action.className = 'chapter-play-action';
        action.innerHTML = '<span class="material-symbols-outlined">play_arrow</span><span>Reproducir desde aquí</span>';
        action.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            playGeneratedAudio({
                url: row.dataset.generatedAudioUrl,
                filename: row.dataset.generatedAudioFilename
            }, title);
        });
        row.appendChild(action);
    }
}

export function markChapterGenerated(chapterIndex, audio, bookTitle, persist = true) {
    const rows = document.querySelectorAll(`#bookOpenVolume [data-chapter-index="${Number(chapterIndex)}"]`);
    rows.forEach(row => setGeneratedRowState(row, audio, row.dataset.chapterTitle || 'Capítulo'));
    if (!persist || !bookTitle || !audio || !audio.url) return;
    const state = readGeneratedAudioState();
    const key = generatedAudioBookKey(bookTitle);
    if (!state[key] || typeof state[key] !== 'object') state[key] = {};
    state[key][String(chapterIndex)] = {
        url: audio.url,
        filename: audio.filename || '',
        durationSeconds: Number(audio.durationSeconds) || 0,
        updatedAt: Date.now()
    };
    writeGeneratedAudioState(state);
    refreshGeneratedSummary(bookTitle, state[key]).catch(() => {});
}

async function audioFileExists(url) {
    if (!url) return false;
    try {
        const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (head.ok) return true;
        if (head.status !== 405 && head.status !== 501) return false;
    } catch (error) {
        return false;
    }
    try {
        const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
        return probe.ok || probe.status === 206;
    } catch (error) {
        return false;
    }
}

export async function restoreGeneratedAudioForBook(bookIdentity) {
    const localState = readGeneratedAudioState();
    let state = localState;
    try {
        const response = await fetch('/api/generated-audio', { cache: 'no-store' });
        if (response.ok) {
            const serverState = await response.json();
            if (serverState && typeof serverState === 'object') {
                state = { ...serverState };
                Object.entries(localState).forEach(([bookKey, records]) => {
                    state[bookKey] = { ...(serverState[bookKey] || {}), ...(records || {}) };
                });
                writeGeneratedAudioState(state);
            }
        }
    } catch (error) { /* conserva la copia local si el servidor aún no responde */ }
    const key = generatedAudioBookKey(bookIdentity);
    const records = state[key] || {};
    const validRecords = {};
    await Promise.all(Object.entries(records).map(async ([chapterIndex, audio]) => {
        const normalizedAudio = audio && audio.url ? { ...audio, url: normalizeAudioUrl(audio.url) } : audio;
        if (await audioFileExists(normalizedAudio && normalizedAudio.url)) {
            validRecords[chapterIndex] = normalizedAudio;
            markChapterGenerated(chapterIndex, normalizedAudio, bookIdentity, false);
            if (normalizedAudio && normalizedAudio.url) addDownloadLink(normalizedAudio.url, normalizedAudio.filename || `capitulo-${Number(chapterIndex) + 1}.mp3`);
        }
    }));
    if (Object.keys(validRecords).length !== Object.keys(records).length) {
        state[key] = validRecords;
        writeGeneratedAudioState(state);
    }
    await refreshGeneratedSummary(bookIdentity, validRecords);
}

export function clearPrototypeChapterDemo() {
    document.querySelectorAll('#bookOpenVolume .custom-scroll label').forEach(row => {
        if (row.classList.contains('chapter-row') || row.querySelector('.chapter-cb')) row.remove();
    });
}

// Sustituye los capítulos de demostración del prototipo por los capítulos reales
// del EPUB. Se conserva la estructura visual de las páginas del libro.
export function renderPrototypeChapterSelection(allChapters = [], excluded = []) {
    const volume = document.getElementById('bookOpenVolume');
    const firstSpread = document.getElementById('spreadSet1');
    if (!volume || !firstSpread) return;

    const sourcePage = firstSpread.querySelector('.custom-scroll');
    let source = sourcePage && Array.from(sourcePage.querySelectorAll('label')).find(row => row.querySelector('.chapter-cb'));
    if (!source) {
        source = document.createElement('label');
        source.className = 'flex items-start justify-between p-1.5 rounded-lg hover:bg-[#ebdcc7]/70 transition-colors cursor-pointer group';
        source.innerHTML = `
            <div class="flex items-start gap-2 max-w-[78%] min-w-0">
                <input class="chapter-cb accent-[#8e4e00] w-3.5 h-3.5 mt-0.5 rounded cursor-pointer shrink-0" type="checkbox">
                <div class="flex flex-col min-w-0 overflow-hidden">
                    <span class="font-serif text-[11px] sm:text-[12px] text-[#2c1307] group-hover:text-secondary font-semibold leading-tight"></span>
                    <span class="text-[9.5px] font-mono text-[#8a705c]"></span>
                </div>
            </div>
            <span class="font-mono text-[10px] text-[#7c6352] pt-0.5 font-medium shrink-0"></span>`;
    }

    const excludedKeys = new Set((excluded || []).map((ch, index) => chapterDisplayTitle(ch, index)));
    const chapters = Array.isArray(allChapters) ? allChapters : [];
    const rowsPerPage = 8;
    const pageCount = Math.max(1, Math.ceil(chapters.length / rowsPerPage));
    const spreadCount = Math.max(1, Math.ceil(pageCount / 2));
    const estimatedMinutes = (chapter) => {
        const text = String(chapter && (chapter.contenido || chapter.content || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const words = text ? text.split(/\s+/).length : 0;
        return Math.max(1, Math.round(words / 150));
    };
    const formatDuration = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    updateGeneratedSummary(0, 0);
    const spreads = [firstSpread];
    Array.from(volume.querySelectorAll('.spread-pane[data-listenbook-dynamic="true"]')).forEach(spread => spread.remove());
    const secondSpread = document.getElementById('spreadSet2');
    if (secondSpread) spreads.push(secondSpread);
    const spreadTemplate = secondSpread || firstSpread;
    const spreadParent = spreadTemplate.parentElement;
    const gutter = spreadParent && Array.from(spreadParent.children).find(child => child.classList.contains('gutter-crease-shadow'));
    for (let i = spreads.length; i < spreadCount; i++) {
        const spread = spreadTemplate.cloneNode(true);
        spread.id = `spreadSet${i + 1}`;
        spread.dataset.listenbookDynamic = 'true';
        spread.classList.add('hidden');
        spread.style.opacity = '0';
        if (spreadParent) spreadParent.insertBefore(spread, gutter || null);
        spreads.push(spread);
    }

    const pages = spreads.flatMap(spread => Array.from(spread.children).filter(child => child.classList.contains('parchment-pattern'))
        .map(page => page.querySelector('.custom-scroll')).filter(Boolean));
    pages.forEach((page, pageIndex) => {
        page.parentElement.style.display = pageIndex < pageCount ? 'flex' : 'none';
        page.querySelectorAll('label').forEach(row => {
            if (row.classList.contains('chapter-row') || row.querySelector('.chapter-cb')) row.remove();
        });
    });

    chapters.forEach((chapter, index) => {
        const page = pages[Math.floor(index / rowsPerPage)];
        if (!page) return;
        const row = source.cloneNode(true);
        row.classList.add('chapter-row');
        row.dataset.chapterIndex = String(index);
        const checkbox = row.querySelector('.chapter-cb');
        const spans = row.querySelectorAll('span');
        const title = chapterDisplayTitle(chapter, index);
        row.dataset.chapterTitle = title;
        const duration = estimatedMinutes(chapter);
        const isExcluded = excludedKeys.has(title);
        checkbox.dataset.index = String(index);
        checkbox.dataset.duration = String(duration);
        checkbox.checked = !isExcluded;
        checkbox.disabled = false;
        if (spans[0]) {
            spans[0].textContent = title;
            spans[0].classList.add('truncate', 'block', 'whitespace-nowrap');
            spans[0].style.maxWidth = '100%';
            spans[0].style.overflow = 'hidden';
            spans[0].style.textOverflow = 'ellipsis';
            spans[0].style.whiteSpace = 'nowrap';
            spans[0].title = title;
        }
        if (spans[1]) {
            const text = String(chapter && (chapter.contenido || chapter.content || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            spans[1].textContent = `${text ? text.split(/\s+/).length.toLocaleString('es-ES') : 0} palabras`;
        }
        if (spans[2]) spans[2].textContent = formatDuration(duration);
        const titleContainer = row.querySelector('.flex.flex-col');
        if (titleContainer) {
            titleContainer.style.minWidth = '0';
            titleContainer.style.overflow = 'hidden';
        }
        page.appendChild(row);
    });

    const chapterInputs = () => Array.from(volume.querySelectorAll('.chapter-cb'));
    const selectedMinutes = () => chapterInputs()
        .filter(cb => cb.checked).reduce((sum, cb) => sum + Number(cb.dataset.duration || 0), 0);
    const refreshCounters = () => {
        const selected = chapterInputs().filter(cb => cb.checked).length;
        const total = selectedMinutes();
        const formatted = `~${Math.floor(total / 60)}h ${total % 60}m`;
        const count = document.getElementById('totalChaptersBadge');
        const heading = document.getElementById('actionHeadingCount');
        const calculated = document.getElementById('actionCalculatedTime');
        const button = document.getElementById('synthesisBtnText');
        if (count) count.textContent = String(chapters.length);
        if (heading) heading.textContent = `${selected} capítulos seleccionados`;
        if (calculated) calculated.textContent = formatted;
        if (button) button.textContent = `Procesar capítulos seleccionados (${selected})`;
        const selectAllButton = document.getElementById('bookSelectAllBtn');
        if (selectAllButton) {
            const selectable = chapterInputs().filter(input => !input.disabled);
            const allSelected = selectable.length > 0 && selectable.every(input => input.checked);
            selectAllButton.textContent = `${allSelected ? 'Desmarcar todos' : 'Marcar todos'} (${selectable.length})`;
        }
    };
    window.__listenbookRefreshChapterControls = refreshCounters;
    chapterInputs().forEach(cb => cb.addEventListener('change', refreshCounters));

    const pageStateBadge = document.getElementById('pageStateBadge');
    const previous = document.getElementById('prevPageBtn');
    const next = document.getElementById('nextPageBtn');
    let currentSpread = 0;
    const showSpread = (index) => {
        currentSpread = Math.max(0, Math.min(spreadCount - 1, index));
        spreads.forEach((spread, spreadIndex) => {
            const active = spreadIndex === currentSpread;
            spread.classList.toggle('hidden', !active);
            spread.style.opacity = active ? '1' : '0';
        });
        if (previous) previous.disabled = currentSpread === 0;
        if (next) next.disabled = currentSpread >= spreadCount - 1;
        if (pageStateBadge) {
            const start = currentSpread * 2 + 1;
            const end = Math.min(pageCount, start + 1);
            pageStateBadge.textContent = `Págs ${start} - ${end}`;
        }
    };
    window.__listenbookPageNavigation = {
        move: delta => showSpread(currentSpread + delta)
    };
    if (previous && previous.dataset.listenbookDynamicNavigation !== 'true') {
        previous.dataset.listenbookDynamicNavigation = 'true';
        previous.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.__listenbookPageNavigation.move(-1);
        }, true);
    }
    if (next && next.dataset.listenbookDynamicNavigation !== 'true') {
        next.dataset.listenbookDynamicNavigation = 'true';
        next.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.__listenbookPageNavigation.move(1);
        }, true);
    }
    showSpread(0);

    const chaptersCard = document.getElementById('totalChaptersBadge')?.closest('.bg-surface-container-lowest');
    if (chaptersCard && chaptersCard.dataset.listenbookToggleAll !== 'true') {
        chaptersCard.dataset.listenbookToggleAll = 'true';
        chaptersCard.style.cursor = 'pointer';
        chaptersCard.title = 'Marcar o desmarcar todos los capítulos';
        chaptersCard.addEventListener('click', event => {
            if (event.target.closest('input, button, a')) return;
            const inputs = chapterInputs().filter(input => !input.disabled);
            const markAll = inputs.some(input => !input.checked);
            inputs.forEach(input => { input.checked = markAll; });
            refreshCounters();
        });
    }
    refreshCounters();
}

function showPrototypeChapterDrawer(allChapters, excluded) {
    return new Promise((resolve) => {
        const drawer = document.getElementById('chapters-drawer');
        const content = document.getElementById('drawer-content');
        const list = content && content.querySelector('.custom-scroll');
        const closeButton = document.getElementById('btn-close-drawer');
        const backdrop = document.getElementById('drawer-backdrop');
        const listenButton = document.getElementById('btn-listen-drawer');
        if (!drawer || !content || !list || !listenButton) return resolve(null);

        const excludedKeys = new Set((excluded || []).map((chapter, index) => chapterDisplayTitle(chapter, index)));
        const visibleSelection = new Map(Array.from(document.querySelectorAll('#bookOpenVolume .chapter-cb'))
            .filter(input => input.dataset.index !== undefined)
            .map(input => [Number(input.dataset.index), input.checked]));
        list.innerHTML = '';
        (allChapters || []).forEach((chapter, index) => {
            const title = chapterDisplayTitle(chapter, index);
            const row = document.createElement('label');
            row.className = 'flex items-start justify-between p-3.5 rounded-xl bg-[#FAF7F2] border border-[#EBE4D8] cursor-pointer hover:bg-[#F4EFE8] transition-colors';
            const left = document.createElement('span');
            left.className = 'flex items-start gap-3 max-w-[82%]';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'chapter-cb accent-[#8e4e00] w-3.5 h-3.5 mt-0.5 rounded cursor-pointer shrink-0';
            checkbox.dataset.index = String(index);
            const generatedRow = document.querySelector(`#bookOpenVolume [data-chapter-index="${index}"].chapter-row-generated`);
            const alreadyGenerated = Boolean(generatedRow);
            checkbox.checked = visibleSelection.has(index) ? visibleSelection.get(index) : !excludedKeys.has(title);
            const label = document.createElement('span');
            label.className = 'font-label-md text-label-md text-[#2C1810] font-semibold';
            label.textContent = title;
            if (alreadyGenerated) left.append(label);
            else left.append(checkbox, label);
            const marker = document.createElement('span');
            marker.className = 'material-symbols-outlined text-[#8E4E00] text-sm';
            marker.textContent = 'check_circle';
            row.append(left, marker);
            checkbox.addEventListener('change', () => { marker.style.opacity = checkbox.checked ? '1' : '.25'; });
            list.appendChild(row);
        });

        const close = () => {
            drawer.classList.add('pointer-events-none', 'opacity-0');
            drawer.classList.remove('opacity-100');
            content.classList.add('translate-x-full');
        };
        const open = () => {
            drawer.classList.remove('pointer-events-none', 'opacity-0');
            drawer.classList.add('opacity-100');
            content.classList.remove('translate-x-full');
        };
        const cancel = () => { close(); resolve(null); };
        closeButton.onclick = cancel;
        backdrop.onclick = cancel;
        listenButton.onclick = () => {
            const selected = Array.from(list.querySelectorAll('.chapter-cb:checked:not(:disabled)'))
                .map(input => allChapters[Number(input.dataset.index)])
                .filter(Boolean);
            if (!selected.length) return;
            const selectedIndexes = new Set(Array.from(list.querySelectorAll('.chapter-cb:checked:not(:disabled)')).map(input => Number(input.dataset.index)));
            document.querySelectorAll('#bookOpenVolume .chapter-cb').forEach(input => {
                if (input.dataset.index !== undefined) input.checked = selectedIndexes.has(Number(input.dataset.index));
            });
            close();
            resolve(selected);
        };
        open();
    });
}

export function showChapterSelectionModal(allChapters, excluded, bookTitleRaw) {
    if (document.getElementById('chapters-drawer')) {
        return showPrototypeChapterDrawer(allChapters, excluded);
    }
    return new Promise(async (resolve) => {
        // If a book title was provided, query the proxy to see which chapter files already exist
    // We'll collect keys of the form `${chapterToken}__${order}` to uniquely identify chapters.
    const existingChapterTokens = new Set();
        try {
            if (bookTitleRaw) {
                // client-side TitleCase normalization (match server behavior): extract alnum tokens, capitalize first letter, rest lower, join without separator for book folder
                const tokenRe = /[\p{L}\p{N}]+/gu;
                const tokens = Array.from(String(bookTitleRaw).matchAll(tokenRe)).map(m => m[0]);
                const cap = tokens.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join('');
                const safeBook = cap || String(bookTitleRaw).replace(/[^A-Za-z0-9]/g, '_');
                const outputsDir = `D:\\TTS\\outputs\\${safeBook}`;
                const proxyBase = (typeof PROXY_BASE !== 'undefined') ? PROXY_BASE : (window && window.PROXY_BASE) ? window.PROXY_BASE : 'http://127.0.0.1:3002';
                const proxy = proxyBase + '/gradio_outputs?dir=' + encodeURIComponent(outputsDir);
                const resp = await fetch(proxy);
                if (resp && resp.ok) {
                    const j = await resp.json().catch(() => null);
                    if (j && Array.isArray(j.files)) {
                        for (const f of j.files) {
                            try {
                                const filename = f.filename || f.file || f.path || '';
                                if (!filename) continue;
                                if (!/\.wav$/i.test(filename)) continue;
                                // New filename format: <Book>_<ChapterToken>_<Order>_<YYYYMMDD>.wav
                                // We'll try to extract chapter token and order. If order is missing
                                // fall back to older format (chapter token only).
                                const mWithOrder = String(filename).match(/^[^_]*_([^_]*)_(\d+)_/);
                                if (mWithOrder && mWithOrder[1]) {
                                    const token = mWithOrder[1];
                                    const order = mWithOrder[2];
                                    existingChapterTokens.add(`${token}__${order}`);
                                    continue;
                                }
                                // legacy fallback: extract token between first and second underscore
                                const mLegacy = String(filename).match(/^[^_]*_([^_]*)_/);
                                if (mLegacy && mLegacy[1]) {
                                    existingChapterTokens.add(`${mLegacy[1]}__`); // order unknown
                                }
                            } catch (e) { /* ignore per-file errors */ }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[ui] failed to query outputs for existing chapters', e);
        }
        // helper: strip HTML tags
        const stripTags = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        // helper: extract text from possible nested/array/object fields
        const extractText = (v) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'string') return v;
            if (typeof v === 'number' || typeof v === 'boolean') return String(v);
            if (Array.isArray(v)) return v.map(extractText).join(' ');
            if (typeof v === 'object') {
                // common property names
                const keys = ['text','contenido','content','html','descripcion','description','subtitulo','subtitle'];
                for (const k of keys) {
                    if (v[k] !== undefined && v[k] !== null) return extractText(v[k]);
                }
                try { return Object.values(v).map(extractText).join(' '); } catch (e) { return ''; }
            }
            return '';
        };
        // helper: decide if chapter has real narration text (not just title)
            const hasNarration = (c) => {
                try {
                    const title = (c.titulo || c.title || '').toString().trim();
                    const norm = (s) => (s || '').toString().normalize('NFD').replace(/[\u0000-\u036f]/g, '').toLowerCase().replace(/\s+/g,' ').trim();

                    // Build the preview text the same way the UI does and compare directly (use extractText on the whole chapter)
                    const rawPreview = extractText(c) || '';
                    const previewTextRaw = stripTags(rawPreview).replace(/\s+/g, ' ').trim();

                    // If there's no preview content, treat as no narration
                    if (!previewTextRaw) return false;

                    // If no title, any content counts as narration
                    if (!title) return true;

                    return (previewTextRaw.length < title.length || previewTextRaw.length < 70) ? false : true;
                } catch (e) { return true; }
            };

        const PREVIEW_LEN = 120;
        const html = allChapters.map((c, i) => {
            const title = (c.titulo || c.title || c.href || `Capítulo ${i+1}`).toString();
            const isExcluded = excluded.some(e => (e.titulo || e.href) === (c.titulo || c.href));

            // build preview (first N chars) from stripped content — do this first and use it for detection
            const rawPreview = extractText(c) || '';
            const previewTextRaw = stripTags(rawPreview).replace(/\s+/g, ' ').trim();
            const previewText = previewTextRaw ? (previewTextRaw.length > PREVIEW_LEN ? previewTextRaw.slice(0, PREVIEW_LEN).trim() + '…' : previewTextRaw) : '';

            // decide if substantive by using the central helper (ensures consistent behavior)
            const substantive = hasNarration(c);

            const checked = (isExcluded || !substantive) ? '' : 'checked';
            const escTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // mark already-generated chapters based on filename tokens + order
            let generatedNote = '';
            try {
                // compute chapter token in same way server does for chapter naming: TitleCase tokens joined with underscores
                const tokenRe = /[\p{L}\p{N}]+/gu;
                const chapTokens = Array.from(String(title).matchAll(tokenRe)).map(m => m[0]);
                const chapTokenName = chapTokens.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join('_');
                // chapter order may be present in the chapter object as 'numero'
                const chapOrder = (c && (c.numero || c.number || c.index)) ? String(c.numero || c.number || c.index) : null;
                if (chapOrder) {
                    // Strict match: require both chapter token and order to match exactly
                    if (existingChapterTokens.has(`${chapTokenName}__${chapOrder}`)) {
                        generatedNote = ' <small style="color:green">(ya generado)</small>';
                    }
                } else {
                    // No order info available for this chapter: fall back to legacy token-only matching
                    if (existingChapterTokens.has(`${chapTokenName}__`) || Array.from(existingChapterTokens).some(k => k.startsWith(chapTokenName + '__'))) {
                        generatedNote = ' <small style="color:green">(ya generado)</small>';
                    }
                }
            } catch (e) { /* ignore */ }

            const note = substantive ? generatedNote : ' <small style="color:#666">(sin narración)</small>';
            return `<div style="margin:6px 0;"><label><input type="checkbox" name="chap-${i}" value="${i}" ${checked} /> <span style="margin-left:8px">${escTitle}${note}</span></label></div>`;
        }).join('');

        Swal.fire({
            title: 'Selecciona capítulos',
            html: `
                <div style="text-align:left; margin-bottom:6px; display:flex; gap:8px; align-items:center;">
                    <button id="toggle-all-chaps" type="button" style="padding:6px 10px; font-size:0.9rem;">Marcar todo</button>
                    <button id="revert-selection" type="button" style="padding:6px 10px; font-size:0.9rem;">Restablecer</button>
                </div>
                <div style="text-align:left; max-height:40vh; overflow:auto; padding:8px">${html}</div>
            `,
            width: '700px',
            showCancelButton: true,
            confirmButtonText: 'Procesar seleccionados',
            cancelButtonText: 'Cancelar',
            focusConfirm: false,
            didOpen: () => {
                const toggleBtn = document.getElementById('toggle-all-chaps');
                const revertBtn = document.getElementById('revert-selection');
                const initialState = Array.from(document.querySelectorAll('input[type="checkbox"][name^="chap-"]')).map(cb => !!cb.checked);
                toggleBtn.addEventListener('click', () => {
                    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"][name^="chap-"]'));
                    const anyUnchecked = checkboxes.some(cb => !cb.checked);
                    checkboxes.forEach(cb => cb.checked = anyUnchecked);
                    toggleBtn.textContent = anyUnchecked ? 'Desmarcar todo' : 'Marcar todo';
                });
                revertBtn.addEventListener('click', () => {
                    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"][name^="chap-"]'));
                    checkboxes.forEach((cb, idx) => {
                        const prev = cb.checked;
                        const now = !!initialState[idx];
                        cb.checked = now;
                        if (prev !== now) {
                            const row = cb.closest('div');
                            if (row) {
                                row.classList.remove('revert-flash');
                                void row.offsetWidth;
                                row.classList.add('revert-flash');
                                setTimeout(() => row.classList.remove('revert-flash'), 800);
                            }
                        }
                    });
                });
                const boxes = Array.from(document.querySelectorAll('input[type="checkbox"][name^="chap-"]'));
                const anyUnchecked = boxes.some(cb => !cb.checked);
                toggleBtn.textContent = anyUnchecked ? 'Marcar todo' : 'Desmarcar todo';
            },
            preConfirm: () => {
                const checked = Array.from(document.querySelectorAll('input[type="checkbox"][name^="chap-"]:checked')).map(i => parseInt(i.value, 10));
                if (!checked || checked.length === 0) {
                    Swal.showValidationMessage('Selecciona al menos un capítulo para procesar.');
                    return false;
                }
                return checked;
            }
        }).then(result => {
            if (!result.isConfirmed) return resolve(null);
            const indices = result.value || [];
            const selectedChaps = indices.map(i => allChapters[i]).filter(Boolean);
            resolve(selectedChaps);
        });
    });
}
