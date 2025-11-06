import { archivoSubido, setTitle, setAuthor, showCover, addDownloadLink, clearDownloads } from './dom.js';
import { showProcessing, closeProcessing, showChapterSelectionModal } from './ui.js';
import { createProgressWidget, updateProgressWidget, removeProgressWidget } from './dom.js';
import { Ebook, extraerCapitulos } from './ebook.js';
import { ejecutarTTS } from './ttsProcess.js';

const GRADIO_HOST = '192.168.1.131';
const GRADIO_PORT = 7860;
const GRADIO_BASE = `http://${GRADIO_HOST}:${GRADIO_PORT}`;
// proxy runs on port 3002 by default
const PROXY_PORT = 3002;
const PROXY_BASE = `http://${GRADIO_HOST}:${PROXY_PORT}`;
// bridge (legacy local bridge) runs on port 3001 by default — expose so other modules can use it
const BRIDGE_PORT = 3001;
const BRIDGE_BASE = `http://${GRADIO_HOST}:${BRIDGE_PORT}`;
// expose to other modules that may read window.PROXY_BASE / window.GRADIO_BASE / window.BRIDGE_BASE
try { window.GRADIO_BASE = GRADIO_BASE; window.PROXY_BASE = PROXY_BASE; window.BRIDGE_BASE = BRIDGE_BASE; } catch (e) {}

// Mobile detection and activation: add 'mobile' class to <html> when accessed from a smartphone or narrow viewport
function activateMobileIfNeeded() {
    try {
        const ua = navigator.userAgent || '';
        const isMobileUA = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(ua);
        const isNarrow = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 700;
        if (isMobileUA || isNarrow) {
            try { document.documentElement.classList.add('mobile'); } catch (e) {}
        }
    } catch (e) { /* ignore */ }
}
window.addEventListener('load', activateMobileIfNeeded);
window.addEventListener('resize', () => { try { activateMobileIfNeeded(); } catch (e) {} });

const dropArea = document.getElementById('upload_section');
if (dropArea) {
    dropArea.addEventListener('dragover', (event) => { event.preventDefault(); dropArea.classList.add('dragging'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragging'));
    dropArea.addEventListener('drop', (event) => {
        event.preventDefault(); dropArea.classList.remove('dragging');
        const files = event.dataTransfer.files;
        const fileInput = document.getElementById('file-upload');
        if (fileInput) fileInput.files = files;
        archivoSubido();
    });
}

const fileInput = document.getElementById('file-upload');
// Directory upload elements (hidden input + trigger button)
const dirInput = document.getElementById('dir-upload');
const dirUploadBtn = document.getElementById('dir-upload-btn');
// Global error handlers to surface unhandled rejections and prevent silent failures
window.addEventListener('unhandledrejection', (ev) => {
    console.error('[global] unhandledrejection', ev.reason);
    try {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error inesperado', text: String(ev.reason) });
    } catch (e) {}
    ev.preventDefault();
});
window.addEventListener('error', (ev) => {
    console.error('[global] error', ev.error || ev.message || ev);
    try { if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error de script', text: String(ev.message || ev.error || ev) }); } catch (e) {}
});

// Prevent accidental form submits, but allow the upload form (class 'form_subida') to submit normally
document.addEventListener('submit', (ev) => {
    try {
        const tgt = ev && ev.target;
        if (tgt && typeof tgt.matches === 'function' && tgt.matches('.form_subida')) {
            // allow the EPUB upload form to submit to server-side upload.php
            console.log('[global] allow submit for .form_subida');
            return;
        }
        ev.preventDefault();
        console.warn('[global] prevented form submit');
    } catch (e) { console.error('[global] prevent submit failed', e); }
});

// Persistent off-DOM reference-audio input (avoids creating/removing inputs inside modals)
let refAudioInput = document.getElementById('ref-audio-input');
if (!refAudioInput) {
    refAudioInput = document.createElement('input');
    refAudioInput.type = 'file';
    refAudioInput.accept = 'audio/*';
    refAudioInput.style.display = 'none';
    refAudioInput.id = 'ref-audio-input';
    // keep it attached to body so it stays outside any modal/form contexts
    document.body.appendChild(refAudioInput);
}

// Helper that triggers the persistent input and resolves with a data URL or null
function pickReferenceAudio() {
    return new Promise((resolve) => {
        const handler = () => {
            try {
                const file = refAudioInput.files && refAudioInput.files[0];
                if (!file) {
                    refAudioInput.value = '';
                    return resolve(null);
                }
                const reader = new FileReader();
                reader.onload = () => {
                    refAudioInput.value = '';
                    resolve(reader.result);
                };
                reader.onerror = () => {
                    refAudioInput.value = '';
                    resolve(null);
                };
                reader.readAsDataURL(file);
            } catch (e) {
                try { refAudioInput.value = ''; } catch (e2) {}
                resolve(null);
            }
        };
        // Use { once: true } to auto-remove listener after first use
        refAudioInput.addEventListener('change', handler, { once: true });
        // programmatic click to open file picker
        refAudioInput.click();
    });
}

// Set media metadata for lock-screen / notification controls using the Media Session API when available
function setMediaSessionMetadata(bookTitle, chapterTitle, artworkUrl, filename) {
    try {
        if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
        const meta = {
            title: chapterTitle || filename || 'ListenBook',
            artist: bookTitle || '',
            album: bookTitle || '',
            artwork: []
        };
        if (artworkUrl) {
            // include a few common sizes; the browser picks the best one
            meta.artwork.push({ src: artworkUrl, sizes: '512x512', type: 'image/png' });
            meta.artwork.push({ src: artworkUrl, sizes: '256x256', type: 'image/png' });
            meta.artwork.push({ src: artworkUrl, sizes: '96x96', type: 'image/png' });
        }
        try { navigator.mediaSession.metadata = new MediaMetadata(meta); } catch (e) { /* some browsers require proper types */ }
        try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
        // Optional: wire basic action handlers so the media notification controls work
        try {
            navigator.mediaSession.setActionHandler('play', () => { const ap = document.getElementById('audio_player'); if (ap) ap.play().catch(()=>{}); });
            navigator.mediaSession.setActionHandler('pause', () => { const ap = document.getElementById('audio_player'); if (ap) ap.pause(); });
            navigator.mediaSession.setActionHandler('seekto', (details) => { const ap = document.getElementById('audio_player'); if (ap && details && details.seekTime !== undefined) ap.currentTime = details.seekTime; });
        } catch (e) { /* ignore action handler errors on unsupported browsers */ }
    } catch (e) { console.warn('setMediaSessionMetadata failed', e); }
}

// Playback progress persistence helpers
const __progress = { data: {}, dirHandle: null, storageKeyPrefix: 'listenbook.progress.' };

function makeSafeBookKey(bookTitle) {
    try {
        const tokenRe = /[\p{L}\p{N}]+/gu;
        const tokens = Array.from(String(bookTitle || '').matchAll(tokenRe)).map(m => m[0]);
        const cap = tokens.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join('');
        return cap || String(bookTitle || 'ebook').replace(/[^A-Za-z0-9]/g, '_');
    } catch (e) { return String(bookTitle || 'ebook').replace(/[^A-Za-z0-9]/g, '_'); }
}

async function loadProgressFromHandle(dirHandle) {
    try {
        if (!dirHandle) return {};
        const fh = await dirHandle.getFileHandle('progress.txt').catch(() => null);
        if (!fh) return {};
        const file = await fh.getFile();
        const text = await file.text();
        try { return JSON.parse(text); } catch (e) { return {}; }
    } catch (e) { console.warn('loadProgressFromHandle failed', e); return {}; }
}

async function writeProgressToHandle(dirHandle, data) {
    try {
        if (!dirHandle) return false;
        const fh = await dirHandle.getFileHandle('progress.txt', { create: true });
        const writable = await fh.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
        return true;
    } catch (e) { console.warn('writeProgressToHandle failed', e); return false; }
}

function loadProgressForBook(safeBook) {
    try {
        __progress.data = {};
        const key = __progress.storageKeyPrefix + safeBook;
        const raw = localStorage.getItem(key);
        if (raw) {
            try { __progress.data = JSON.parse(raw); } catch (e) { __progress.data = {}; }
        }
    } catch (e) { __progress.data = {}; }
}

function saveProgressForBook(safeBook) {
    try {
        const key = __progress.storageKeyPrefix + safeBook;
        localStorage.setItem(key, JSON.stringify(__progress.data || {}));
        // also try write to dir handle if available
        if (__progress.dirHandle) writeProgressToHandle(__progress.dirHandle, __progress.data).catch(() => {});
    } catch (e) { console.warn('saveProgressForBook failed', e); }
}

function getSavedPosition(filename) {
    try { return (__progress.data && __progress.data[filename]) ? Number(__progress.data[filename]) : 0; } catch (e) { return 0; }
}

function setSavedPosition(filename, seconds) {
    try {
        __progress.data = __progress.data || {};
        __progress.data[filename] = Math.floor(Number(seconds) || 0);
    } catch (e) {}
}

async function promptAndEnableFolderSaving() {
    try {
        if (!window.showDirectoryPicker) {
            alert('El navegador no soporta escritura directa en carpetas (File System Access API). Se usará localStorage en su lugar.');
            return false;
        }
        const handle = await window.showDirectoryPicker();
        __progress.dirHandle = handle;
        const data = await loadProgressFromHandle(handle);
        __progress.data = Object.assign({}, __progress.data || {}, data || {});
        // write back merged data
        await writeProgressToHandle(handle, __progress.data);
        return true;
    } catch (e) { console.warn('promptAndEnableFolderSaving failed', e); return false; }
}

function exportProgressFile(safeBook) {
    try {
        const blob = new Blob([JSON.stringify(__progress.data || {}, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'progress.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    } catch (e) { console.warn('exportProgressFile failed', e); }
}

// -------------------------
// Debug capture / send
// -------------------------
const ENABLE_DEBUG_CAPTURE = true; // flip to false to disable
const DEBUG_ENDPOINT = PROXY_BASE + '/debug_event';
const debugPending = [];

async function sendDebugEvent(evt) {
    if (!ENABLE_DEBUG_CAPTURE) return;
    const payload = Object.assign({ ts: new Date().toISOString() }, evt);
    try {
        // use keepalive to allow send during unload in modern browsers
        await fetch(DEBUG_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        });
    } catch (e) {
        // queue for sendBeacon on unload
        try { console.warn('[debug] send failed, queued', e && e.message ? e.message : e); } catch (e2) {}
        debugPending.push(payload);
    }
}

// Try to flush queued events via sendBeacon on unload
window.addEventListener('beforeunload', () => {
    try {
        if (debugPending.length === 0) return;
        const blob = new Blob([JSON.stringify({ batch: debugPending })], { type: 'application/json' });
        if (navigator && typeof navigator.sendBeacon === 'function') {
            navigator.sendBeacon(DEBUG_ENDPOINT, blob);
        } else {
            // best-effort fallback
            fetch(DEBUG_ENDPOINT, { method: 'POST', body: JSON.stringify({ batch: debugPending }), headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
        }
    } catch (e) { }
});

// Generic click capture removed to avoid sending debug events on every user click

// Capture reference-audio input changes
try {
    if (refAudioInput) {
        refAudioInput.addEventListener('change', () => {
            try { sendDebugEvent({ type: 'ref_audio_change', files: refAudioInput.files ? refAudioInput.files.length : 0 }); } catch (e) {}
        }, { passive: true });
    }
} catch (e) {}

// Capture epub file input changes
try {
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            try { sendDebugEvent({ type: 'epub_input_change', files: fileInput.files ? fileInput.files.length : 0 }); } catch (e) {}
        }, { passive: true });
    }
} catch (e) {}

// (removed click-capture debug hook)

// (removed file-change interception for reference audio picker)
if (fileInput) {
    fileInput.addEventListener('change', async () => {
        if (fileInput.files.length > 0 && fileInput.files.length <= 1) {
            const file = fileInput.files[0];
            const allowedExtensions = /(\.epub)$/i;
            if (!allowedExtensions.exec(file.name)) {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'warning', title: 'Atención', text: 'Formato de archivo no válido. Por favor, sube un archivo .epub' });
                }
                fileInput.value = '';
                return;
            }

            try {
                const ebook = new Ebook(file);
                await ebook.parse();
                setTitle(ebook.titulo);
                setAuthor(ebook.autor);
                const img = showCover(ebook.portada, ebook.titulo);
                if (img) {
                    img.onmouseover = () => img.style.opacity = '0.5';
                    img.onmouseout = () => img.style.opacity = '1';
                    // restore simple click handler on the cover image
                    img.onclick = async () => {
                        console.log('[UI] cover image clicked — executing handler');
                        showProcessing();
                        const resultado = await extraerCapitulos(ebook);
                        closeProcessing();
                        const allCaps = resultado.all || [];
                        const excluded = resultado.excluded || [];
                        const seleccionados = await showChapterSelectionModal(allCaps, excluded, (ebook && (ebook.titulo || ebook.title)) ? (ebook.titulo || ebook.title) : null);
                        if (!seleccionados) { console.log('Selección cancelada'); return; }
                        console.log('Capítulos seleccionados:', seleccionados);

                        // Show progress modal
                        if (typeof Swal !== 'undefined') {
                            Swal.fire({
                                title: 'Generando audio',
                                html: '<div id="tts-progress">Preparando...</div>',
                                allowOutsideClick: false,
                                showCancelButton: true,
                                cancelButtonText: 'Cancelar'
                            });
                        }

                        try {
                            // Ask the user whether they want to upload a reference audio file
                            let referenceDataUrl = null;
                            if (typeof Swal !== 'undefined') {
                                const wantUpload = await Swal.fire({
                                    title: '¿Quieres subir un audio de referencia?',
                                    html: 'Puedes subir un archivo de audio (WAV) que servirá como referencia para la generación. Si cancelas, se usará un audio de ejemplo.',
                                    showCancelButton: true,
                                    confirmButtonText: 'Sí, subir archivo',
                                    cancelButtonText: 'No, usar ejemplo',
                                    allowOutsideClick: false
                                });
                                if (wantUpload.isConfirmed) {
                                    try {
                                        if (typeof Swal !== 'undefined') Swal.fire({ title: 'Leyendo archivo', text: 'Por favor espera...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                                        referenceDataUrl = await pickReferenceAudio();
                                    } finally {
                                        try { if (typeof Swal !== 'undefined') Swal.close(); } catch (e) {}
                                    }
                                }
                            }

                                console.log('[UI] invoking ejecutarTTS — selected chapters:', seleccionados.length, seleccionados.map(c => c.titulo || c.title || c.href));
                                console.log('[UI] referenceDataUrl present?', !!referenceDataUrl);
                                // clear previous downloads for a fresh run
                                try { clearDownloads(); } catch (e) {}

                                // Process each chapter separately (one predict per chapter)
                                for (let ci = 0; ci < (seleccionados || []).length; ci++) {
                                    const chap = seleccionados[ci];
                                    try {
                                        // Setup per-chapter progress widget
                                        try {
                                            const BASE_SEC_PER_50 = 0.92; // seconds per 50 chars (estimate)
                                            const textForLength = ((chap.contenido || chap.text || chap.content) || (chap.titulo || chap.title) || '');
                                            const approxPromptLength = (textForLength || '').length || 0;
                                            const units = Math.max(1, Math.ceil(approxPromptLength / 50));
                                            const estimatedSeconds = units * BASE_SEC_PER_50;
                                            let elapsedSeconds = 0;
                                            createProgressWidget();
                                            updateProgressWidget({ percent: 0, label: `Estimado: ${estimatedSeconds}s — Iniciando capítulo ${ci+1}/${seleccionados.length}` });
                                            const progressStart = Date.now();
                                            const progressInterval = setInterval(() => {
                                                elapsedSeconds = Math.floor((Date.now() - progressStart) / 1000);
                                                let pct = estimatedSeconds > 0 ? (elapsedSeconds / estimatedSeconds) * 100 : 0;
                                                if (pct > 99) pct = 99;
                                                updateProgressWidget({ percent: pct, label: `Cap ${ci+1}/${seleccionados.length} · Est: ${estimatedSeconds}s · ${elapsedSeconds}s` });
                                            }, 1000);
                                            window.__tts_progress_interval = progressInterval;
                                            window.__tts_progress_meta = { estimatedSeconds, progressStart };
                                        } catch (e) { console.warn('progress widget init failed', e); }

                                        // One predict per chapter: pass single chapter
                                        const result = await ejecutarTTS(ebook, [chap], {
                                            serverUrl: GRADIO_BASE,
                                            statusBase: GRADIO_BASE,
                                            referenceAudioDataUrl: referenceDataUrl,
                                            // default example audio served from the ListenBook folder
                                            referenceAudioUrl: (function(){
                                                try {
                                                    // resolve relative to current page so it works whether Live Server serves ListenBook
                                                    return new URL('default_audios/esp_default/narrador_esp.wav', window.location.href).toString();
                                                } catch(e) { return '/default_audios/esp_default/narrador_esp.wav'; }
                                            })(),
                                            proxyGradioCallUrl: PROXY_BASE + '/gradio_call',
                                            clientTimeout: 0,
                                            pollInterval: 1500,
                                            timeout: 1000 * 60 * 10,
                                            onProgress: (status) => {
                                                try{
                                                    const el = document.getElementById('tts-progress');
                                                    if (el) {
                                                        let html = '';
                                                        if (status.jobId) html += `<div>Job: ${status.jobId}</div>`;
                                                        if (status.status) html += `<div>Estado: ${status.status}</div>`;
                                                        if (status.diagnostics && status.diagnostics.length) html += `<div>Diagnostics: ${status.diagnostics.length} items</div>`;
                                                        if (status.files && status.files.length) html += `<div>Archivos generados: ${status.files.length}</div>`;
                                                        el.innerHTML = html;
                                                    }
                                                }catch(e){ console.error('progress update err', e); }
                                            }
                                        });

                                        // clear per-chapter progress
                                        try {
                                            if (window.__tts_progress_interval) { clearInterval(window.__tts_progress_interval); window.__tts_progress_interval = null; }
                                            removeProgressWidget();
                                        } catch (e) {}

                                        // Process result for this chapter (same logic as before, but use chap as source for naming)
                                        try {
                                            let normalized = result;
                                            if (typeof normalized === 'string') {
                                                try { normalized = JSON.parse(normalized); console.log('[UI] parsed result string into object'); } catch (e) { console.warn('[UI] result is string but not JSON'); }
                                            }
                                            const files = extractFilesFromResult(normalized || {});
                                            console.log('[UI] extracted files for chapter', ci, files);
                                            try {
                                                if (files && files.length >= 2) {
                                                    const f0 = files[0];
                                                    const f1 = files[1];
                                                    function rawPathFromFileObj(f) {
                                                        if (!f) return null;
                                                        if (f.path) return f.path;
                                                        if (f.url) {
                                                            const m = String(f.url).match(/file=(.*)$/);
                                                            if (m && m[1]) return decodeURIComponent(m[1]);
                                                        }
                                                        return null;
                                                    }
                                                    const path0 = rawPathFromFileObj(f0);
                                                    const path1 = rawPathFromFileObj(f1);
                                                    const bookTitleRaw = (ebook && (ebook.titulo || ebook.title)) ? (ebook.titulo || ebook.title) : 'ebook';
                                                    let chapterName = 'capitulo';
                                                    try { chapterName = chap.titulo || chap.title || chapterName; } catch(e){}

                                                    try {
                                                        // Instead of moving the file into a permanent outputs folder on the server,
                                                        // trigger a direct download from the proxy which will stream the file and
                                                        // delete it on the server after the transfer completes. This avoids leaving
                                                        // permanent copies on the host machine.
                                                        try {
                                                            // Build a default safe filename in the format:
                                                            // Titulo_Del_Libro_Nombre_Capitulo_XX_YYYYMMDD.wav
                                                            // Create TitleCase concatenated tokens (no separators) for book and chapter
                                                            function makeTitleConcat(s) {
                                                                try {
                                                                    const tokenRe = /[\p{L}\p{N}]+/gu;
                                                                    const tokens = Array.from(String(s || '').matchAll(tokenRe)).map(m => m[0]);
                                                                    const joined = tokens.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join('');
                                                                    return joined || String(s || '').replace(/[^A-Za-z0-9]/g,'');
                                                                } catch (e) { return String(s || '').replace(/[^A-Za-z0-9]/g,''); }
                                                            }
                                                            const bookSafePart = makeTitleConcat(bookTitleRaw || 'Libro');
                                                            const chapterSafePart = makeTitleConcat(chapterName || ('Capitulo' + (ci+1)));
                                                            // Determine chapter order: prefer explicit chap.numero/number (absolute position in book), fallback to loop index
                                                            const chapterOrder = (chap && (chap.numero || chap.number)) ? (chap.numero || chap.number) : (function(){
                                                                try {
                                                                    if (typeof allCaps !== 'undefined' && Array.isArray(allCaps)) {
                                                                        const list = allCaps;
                                                                        const titleA = (chap && (chap.titulo || chap.title) ? (chap.titulo || chap.title).toString().trim() : null);
                                                                        if (titleA) {
                                                                            const idx = list.findIndex(c => {
                                                                                try { return (c && (c.titulo || c.title) ? (c.titulo || c.title).toString().trim() : '') === titleA; } catch (e) { return false; }
                                                                            });
                                                                            if (idx >= 0) return idx + 1;
                                                                        }
                                                                    }
                                                                } catch (e) {}
                                                                return (ci + 1);
                                                            })();
                                                            const orderPart = String(chapterOrder); // no zero-padding per request
                                                            const fecha = (new Date()).toISOString().slice(0,10).replace(/-/g,'');
                                                            const suggested = `${bookSafePart}_${chapterSafePart}_${orderPart}_${fecha}.wav`;

                                                            const proxyDownload = PROXY_BASE + '/proxy_download?path=' + encodeURIComponent(path1) + '&suggestName=' + encodeURIComponent(suggested);
                                                            // Create a temporary anchor and click it so the browser opens the Save dialog
                                                            const a = document.createElement('a');
                                                            a.href = proxyDownload;
                                                            // Suggest a filename to the browser (also provided to proxy)
                                                            a.download = suggested;
                                                            a.style.display = 'none';
                                                            document.body.appendChild(a);
                                                            a.click();
                                                            setTimeout(() => { try { document.body.removeChild(a); } catch (e) {} }, 1000);
                                                            // give the proxy a moment to clean up and refresh outputs listing
                                                            await new Promise(r => setTimeout(r, 1000));
                                                            try { await fetchAndShowOutputsDir(); } catch (e) {}
                                                        } catch (e) {
                                                            console.error('download trigger failed', e);
                                                            try { await fetchAndShowOutputsDir(); } catch (e) {}
                                                        }
                                                    } catch (e) { console.error('finalize error', e); try { await fetchAndShowOutputsDir(); } catch (e2) {} }
                                                } else if (files && files.length === 1) {
                                                    try { await fetchAndShowOutputsDir(); } catch (e) { /* ignore */ }
                                                } else {
                                                    console.warn('[UI] no files found in result for chapter', ci);
                                                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: `No se encontraron audios generados para el capítulo ${ci+1}.` });
                                                }
                                            } catch (e) {
                                                console.error('Error processing files for delete/rename', e);
                                            }
                                        } catch (e) {
                                            console.error('Error procesando resultado TTS para descargas', e);
                                            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'La generación finalizó pero no se pudieron procesar los archivos.' });
                                        }

                                        // Refresh downloads listing after each chapter
                                        try { await fetchAndShowOutputsDir(); } catch (e) { console.warn('fetchAndShowOutputsDir failed', e); }
                                    } catch (errChapter) {
                                        try { if (window.__tts_progress_interval) { clearInterval(window.__tts_progress_interval); window.__tts_progress_interval = null; } removeProgressWidget(); } catch(e){}
                                        try {
                                            console.error('Error ejecutando TTS para capítulo', ci, errChapter);
                                            console.error('Error ejecutando TTS (JSON):', JSON.stringify(errChapter, Object.getOwnPropertyNames(errChapter), 2));
                                        } catch (e) { console.error('Error serializing error object', e, errChapter); }
                                        if (typeof Swal !== 'undefined') {
                                            const detail = (errChapter && (errChapter.message || errChapter.details || errChapter.toString())) ? (errChapter.message || errChapter.details || errChapter.toString()) : 'Error desconocido';
                                            const small = String(detail).slice(0, 1000);
                                            Swal.fire({ icon: 'error', title: 'Error', html: `<pre style="text-align:left; white-space:pre-wrap; word-break:break-word">${small}</pre>` });
                                        }
                                    }
                                }
                            } catch (err) {
                                try { if (window.__tts_progress_interval) { clearInterval(window.__tts_progress_interval); window.__tts_progress_interval = null; } removeProgressWidget(); } catch(e){}
                            // Log full error object (handles non-Error throws)
                            try {
                                console.error('Error ejecutando TTS (raw):', err);
                                console.error('Error ejecutando TTS (JSON):', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
                            } catch (e) {
                                console.error('Error serializing error object', e, err);
                            }
                            // Show a more informative modal if possible
                            if (typeof Swal !== 'undefined') {
                                const detail = (err && (err.message || err.details || err.toString())) ? (err.message || err.details || err.toString()) : 'Error desconocido';
                                const small = String(detail).slice(0, 1000);
                                Swal.fire({ icon: 'error', title: 'Error', html: `<pre style="text-align:left; white-space:pre-wrap; word-break:break-word">${small}</pre>` });
                            }
                        }
                    };
                }
                archivoSubido();
            } catch (err) {
                console.error('Error procesando ebook:', err);
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo procesar el ebook.' });
            }
        } else {
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'Atención', text: 'Por favor, sube un solo archivo.' });
            fileInput.value = '';
        }
    });
}

// Handle directory-picker button (opens picker) and directory selection behavior
try {
    if (dirUploadBtn && dirInput) {
        dirUploadBtn.addEventListener('click', (ev) => { ev.preventDefault(); try { dirInput.click(); } catch (e) {} });
    }
    if (dirInput) {
        dirInput.addEventListener('change', (ev) => {
            try {
                const files = dirInput.files;
                if (!files || files.length === 0) return;
                const header = document.getElementById('header_container');
                const reproducir = document.getElementById('reproducir_section');
                if (header) header.style.display = 'none';
                if (reproducir) reproducir.style.display = 'block';
                try { sendDebugEvent({ type: 'dir_selected', count: files.length }); } catch (e) {}

                // Look for an EPUB in the selected directory and, if found, parse metadata and chapters
                (async () => {
                    try {
                        const fileArr = Array.from(files || []);
                        const epubFile = fileArr.find(f => /\.epub$/i.test(f.name));
                        if (!epubFile) {
                            console.warn('[dir] no EPUB found in selected directory');
                            return;
                        }
                        // Parse EPUB metadata
                        const ebook = new Ebook(epubFile);
                        try { showProcessing('Procesando carpeta', 'Extrayendo metadatos del EPUB...'); } catch(e){}
                        await ebook.parse();
                        try { closeProcessing(); } catch(e){}

                        // Set cover and title in the reproducir area
                        try {
                            const coverEl = document.getElementById('reproducir_cover');
                            const titleEl = document.getElementById('reproducir_titulo');
                            if (coverEl) {
                                if (ebook.portada) coverEl.src = ebook.portada;
                                else coverEl.removeAttribute('src');
                            }
                            if (titleEl) titleEl.textContent = ebook.titulo || ebook.title || epubFile.name;
                        } catch (e) { console.warn('[dir] failed to set cover/title', e); }

                        // Extract chapters (use filtered list to mimic selection elsewhere)
                        let caps = [];
                        try {
                            showProcessing('Extrayendo capítulos', 'Por favor espera...');
                            const resultado = await extraerCapitulos(ebook);
                            caps = (resultado && resultado.filtered && resultado.filtered.length) ? resultado.filtered : (resultado.all || []);
                        } catch (e) { console.warn('[dir] extraerCapitulos failed', e); }
                        try { closeProcessing(); } catch(e){}

                        // Build map of available WAVs in the directory: key -> File
                        // key format: `${chapterToken}__${order}` when order is present, otherwise `${chapterToken}__` for legacy
                        const wavMap = new Map();
                        for (const f of fileArr) {
                            try {
                                if (!f || !f.name) continue;
                                if (!/\.wav$/i.test(f.name)) continue;
                                const name = String(f.name);
                                // try new format: <Book>_<ChapterToken>_<Order>_<YYYYMMDD>.wav
                                const mWithOrder = name.match(/^[^_]*_([^_]*)_(\d+)_/);
                                if (mWithOrder && mWithOrder[1]) {
                                    const token = mWithOrder[1];
                                    const order = mWithOrder[2];
                                    wavMap.set(`${token}__${order}`, f);
                                    continue;
                                }
                                // legacy fallback: extract token between first and second underscore
                                const mLegacy = name.match(/^[^_]*_([^_]*)_/);
                                if (mLegacy && mLegacy[1]) {
                                    wavMap.set(`${mLegacy[1]}__`, f);
                                }
                            } catch (e) { /* ignore file errors */ }
                        }

                        // Prepare chapter list container under reproducir_section
                        // also prepare progress storage for this book
                        const safeBook = makeSafeBookKey(ebook && (ebook.titulo || ebook.title) ? (ebook.titulo || ebook.title) : epubFile.name);
                        loadProgressForBook(safeBook);
                        let chaptersContainer = document.getElementById('reproducir_chapters');
                        if (!chaptersContainer) {
                            chaptersContainer = document.createElement('div');
                            chaptersContainer.id = 'reproducir_chapters';
                            chaptersContainer.classList.add('section_secundaria');
                            chaptersContainer.style.marginTop = '12px';
                            chaptersContainer.style.maxHeight = '40vh';
                            chaptersContainer.style.overflow = 'auto';
                            const parent = reproducir || document.getElementById('header_container');
                            if (reproducir && reproducir.parentNode) reproducir.parentNode.insertBefore(chaptersContainer, reproducir.nextSibling);
                            else document.body.appendChild(chaptersContainer);
                        } else {
                            chaptersContainer.innerHTML = '';
                        }

                        // Add progress controls (enable folder saving / export)
                        const controlsBar = document.createElement('div');
                        controlsBar.style.display = 'flex';
                        controlsBar.style.gap = '8px';
                        controlsBar.style.alignItems = 'center';
                        controlsBar.style.marginBottom = '8px';
                        const enableSaveBtn = document.createElement('button');
                        enableSaveBtn.type = 'button';
                        enableSaveBtn.textContent = 'Guardar progreso en carpeta';
                        enableSaveBtn.addEventListener('click', async (ev) => {
                            ev.preventDefault();
                            try {
                                const ok = await promptAndEnableFolderSaving();
                                if (ok) alert('Acceso concedido. El progreso se guardará en la carpeta seleccionada.');
                                else alert('No se pudo activar el guardado en carpeta.');
                            } catch (e) { console.warn('enableSave failed', e); alert('Error al activar guardado en carpeta'); }
                        });
                        const exportBtn = document.createElement('button');
                        exportBtn.type = 'button';
                        exportBtn.textContent = 'Exportar progress.txt';
                        exportBtn.addEventListener('click', (ev) => { ev.preventDefault(); try { exportProgressFile(safeBook); } catch (e) { console.warn(e); } });
                        controlsBar.appendChild(enableSaveBtn);
                        controlsBar.appendChild(exportBtn);
                        chaptersContainer.appendChild(controlsBar);

                        // Audio player element
                        const audioPlayer = document.getElementById('audio_player');
                        let currentObjectUrl = null;

                        // Persist current position on pause/ended and beforeunload
                        try {
                            audioPlayer.addEventListener('pause', async () => {
                                try {
                                    const fname = audioPlayer && audioPlayer.src ? (audioPlayer._playingFileName || null) : null;
                                    if (fname) {
                                        const pos = Math.floor(audioPlayer.currentTime || 0);
                                        setSavedPosition(fname, pos);
                                        // always persist to localStorage immediately
                                        saveProgressForBook(safeBook);
                                        // log to console that we're saving
                                        try { console.log('[progress] saving progress for', fname, 'position', pos); } catch (e) {}
                                        // if we have a directory handle, write progress.txt into it and log
                                        if (__progress.dirHandle) {
                                            try {
                                                console.log('[progress] writing progress.txt to selected folder...');
                                                await writeProgressToHandle(__progress.dirHandle, __progress.data);
                                                console.log('[progress] progress.txt saved to folder.');
                                            } catch (e) { console.warn('[progress] failed to write progress.txt to folder', e); }
                                        }
                                    }
                                } catch (e) { console.warn('pause save failed', e); }
                            });
                            audioPlayer.addEventListener('ended', () => {
                                try {
                                    const fname = audioPlayer && audioPlayer.src ? (audioPlayer._playingFileName || null) : null;
                                    if (fname) {
                                        setSavedPosition(fname, 0); // reset on end
                                        saveProgressForBook(safeBook);
                                    }
                                } catch (e) { console.warn('ended save failed', e); }
                            });
                            window.addEventListener('beforeunload', () => {
                                try { saveProgressForBook(safeBook); } catch (e) {}
                            });
                        } catch (e) { /* ignore */ }

                        const ul = document.createElement('ul');
                        ul.style.listStyle = 'none';
                        ul.style.padding = '0';
                        ul.style.margin = '0';

                        const tokenRe = /[\p{L}\p{N}]+/gu;
                        caps.forEach((chap, idx) => {
                            const li = document.createElement('li');
                            li.style.padding = '6px 8px';
                            li.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
                            li.style.cursor = 'pointer';
                            li.dataset.index = String(idx);
                            const title = (chap.titulo || chap.title || `Capítulo ${idx+1}`).toString();
                            const span = document.createElement('span');
                            span.textContent = title;
                            li.appendChild(span);

                            // compute chapter token name (TitleCase tokens joined with underscores)
                            let chapTokenName = '';
                            try {
                                const chapTokens = Array.from(String(title).matchAll(tokenRe)).map(m => m[0]);
                                chapTokenName = chapTokens.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join('_');
                            } catch (e) { chapTokenName = title.replace(/\s+/g, '_'); }

                            // determine chapter order (prefer explicit numero from parsed chapters)
                            const hasExplicitOrder = !!(chap && (chap.numero || chap.number));
                            const chapOrder = hasExplicitOrder ? String(chap.numero || chap.number) : String(idx + 1);

                            // Matching policy: if chapter has an explicit order from parsing, require exact token+order match.
                            // Only when no explicit order is available, allow legacy token-only fallback.
                            let wavFile = null;
                            if (chapTokenName && hasExplicitOrder) {
                                if (wavMap.has(`${chapTokenName}__${chapOrder}`)) {
                                    wavFile = wavMap.get(`${chapTokenName}__${chapOrder}`);
                                }
                            } else if (chapTokenName) {
                                // no explicit order: permissive fallback to any legacy or matching key
                                if (wavMap.has(`${chapTokenName}__${chapOrder}`)) {
                                    wavFile = wavMap.get(`${chapTokenName}__${chapOrder}`);
                                } else if (wavMap.has(`${chapTokenName}__`)) {
                                    wavFile = wavMap.get(`${chapTokenName}__`);
                                } else {
                                    for (const [k, v] of wavMap.entries()) {
                                        if (k.startsWith(chapTokenName + '__')) { wavFile = v; break; }
                                    }
                                }
                            }
                            if (wavFile) {
                                const playBtn = document.createElement('button');
                                playBtn.type = 'button';
                                playBtn.textContent = 'Reproducir ▶';
                                playBtn.style.marginLeft = '12px';
                                playBtn.addEventListener('click', (ev) => {
                                    ev.stopPropagation();
                                    try {
                                        if (!audioPlayer) return;
                                        if (currentObjectUrl) { try { URL.revokeObjectURL(currentObjectUrl); } catch (e) {} currentObjectUrl = null; }
                                        const objUrl = URL.createObjectURL(wavFile);
                                        currentObjectUrl = objUrl;
                                        audioPlayer.src = objUrl;
                                        // remember which file name we are playing so save handler can reference it
                                        try { audioPlayer._playingFileName = wavFile && wavFile.name ? wavFile.name : null; } catch (e) {}
                                        // if we have a saved position for this file, seek to it once metadata is loaded
                                        try {
                                            const savedSec = getSavedPosition(wavFile && wavFile.name ? wavFile.name : '');
                                            if (savedSec && savedSec > 0) {
                                                const onMeta = function() { try { if (audioPlayer.duration > savedSec) audioPlayer.currentTime = savedSec; } catch (e) {} };
                                                audioPlayer.addEventListener('loadedmetadata', onMeta, { once: true });
                                            }
                                        } catch (e) {}
                                        // set media metadata for lock-screen / notification controls
                                        try { setMediaSessionMetadata(ebook && (ebook.titulo || ebook.title) ? (ebook.titulo || ebook.title) : '', title, (ebook && ebook.portada) ? ebook.portada : null, wavFile && wavFile.name ? wavFile.name : 'audio.wav'); } catch (e) {}
                                        // show player area
                                        const reproductorDisplay = document.getElementById('reproductor_display');
                                        if (reproductorDisplay) reproductorDisplay.style.display = 'block';
                                        audioPlayer.play().catch(() => {});
                                    } catch (e) { console.error('failed to play wav file', e); }
                                });
                                li.appendChild(playBtn);
                            } else {
                                const noSpan = document.createElement('small');
                                noSpan.style.color = '#999';
                                noSpan.style.marginLeft = '12px';
                                noSpan.textContent = '(sin .wav correspondiente)';
                                li.appendChild(noSpan);
                            }

                            // clicking the row also tries to play if available
                            li.addEventListener('click', () => {
                                try {
                                    if (!wavFile) return;
                                    if (!audioPlayer) return;
                                    if (currentObjectUrl) { try { URL.revokeObjectURL(currentObjectUrl); } catch (e) {} currentObjectUrl = null; }
                                    const objUrl = URL.createObjectURL(wavFile);
                                    currentObjectUrl = objUrl;
                                    audioPlayer.src = objUrl;
                                    try { audioPlayer._playingFileName = wavFile && wavFile.name ? wavFile.name : null; } catch (e) {}
                                    try { setMediaSessionMetadata(ebook && (ebook.titulo || ebook.title) ? (ebook.titulo || ebook.title) : '', title, (ebook && ebook.portada) ? ebook.portada : null, wavFile && wavFile.name ? wavFile.name : 'audio.wav'); } catch (e) {}
                                    // resume from saved pos if present
                                    try {
                                        const savedSec = getSavedPosition(wavFile && wavFile.name ? wavFile.name : '');
                                        if (savedSec && savedSec > 0) {
                                            audioPlayer.addEventListener('loadedmetadata', function onm() { try { if (audioPlayer.duration > savedSec) audioPlayer.currentTime = savedSec; } catch (e) {} }, { once: true });
                                        }
                                    } catch (e) {}
                                    const reproductorDisplay = document.getElementById('reproductor_display');
                                    if (reproductorDisplay) reproductorDisplay.style.display = 'block';
                                    audioPlayer.play().catch(() => {});
                                } catch (e) { console.error('row play failed', e); }
                            });

                            ul.appendChild(li);
                        });

                        chaptersContainer.appendChild(ul);

                    } catch (err) {
                        console.error('Error processing directory EPUB:', err);
                    }
                })();
            } catch (e) { console.error('dir upload handler failed', e); }
        });
    }
} catch (e) { console.warn('directory upload hookup failed', e); }

// Helper to find file-like objects (with url/path) in various result shapes
function extractFilesFromResult(obj) {
    const results = [];
    const seen = new Set();
    function normalizeUrl(u) {
    if (!u) return u;
    if (typeof u !== 'string') u = String(u);
    if (u.startsWith('http')) return u;
    if (u.startsWith('/')) return GRADIO_BASE + u;
    if (u.startsWith('file=')) return GRADIO_BASE + '/' + u;
    // windows path like C:\... -> expose via gradio file= prefix
    if (/^[A-Za-z]:\\/.test(u)) return GRADIO_BASE + '/file=' + encodeURIComponent(u);
        return u;
    }
    function walk(x) {
        if (!x) return;
        if (typeof x === 'string') return;
        if (Array.isArray(x)) return x.forEach(walk);
        if (typeof x === 'object') {
            const hasUrl = (typeof x.url === 'string' && x.url) || (typeof x.path === 'string' && x.path);
            if (hasUrl) {
                const raw = x.url || x.path;
                const url = normalizeUrl(raw);
                const filename = x.orig_name || x.origName || x.filename || (typeof raw === 'string' ? raw.split(/[\\/]/).pop() : 'file');
                if (!seen.has(url)) { seen.add(url); results.push({ url, filename }); }
            }
            Object.keys(x).forEach(k => walk(x[k]));
        }
    }
    walk(obj);
    return results;
}

// Fetch list of generated outputs from the local proxy and add them to downloads
async function fetchAndShowGeneratedOutputs() {
    try {
        const proxy = PROXY_BASE + '/gradio_outputs';
        const resp = await fetch(proxy);
        if (!resp.ok) return console.warn('gradio_outputs request failed', resp.status);
        const j = await resp.json().catch(() => null);
        if (!j || !Array.isArray(j.files)) return;
        j.files.forEach(f => {
            try { addDownloadLink(f.url, f.filename); } catch (e) { console.error('addDownloadLink failed for gradio_outputs', e); }
        });
    } catch (e) { console.warn('fetchAndShowGeneratedOutputs error', e); }
}

// Also show any files already moved into the outputs directory (served by proxy at /outputs)
async function fetchAndShowOutputsDir() {
    try {
        const outputsDir = 'D:\\TTS\\outputs';
    const proxy = PROXY_BASE + '/gradio_outputs?dir=' + encodeURIComponent(outputsDir);
        const resp = await fetch(proxy);
        if (!resp.ok) return; // no outputs or proxy not available
        const j = await resp.json().catch(() => null);
        if (!j || !Array.isArray(j.files) || !j.dir) return;
    const baseProxy = PROXY_BASE + '/outputs';
        j.files.forEach(f => {
            try {
                // compute relative path inside outputs dir
                let full = f.path || f.file || f.filename || '';
                if (!full) return;
                let root = j.dir;
                if (full.startsWith(root)) {
                    let rel = full.slice(root.length);
                    // trim leading separators
                    rel = rel.replace(/^\\+|^\/+/, '');
                    // split path segments and encode each
                    const parts = rel.split(/\\|\//).map(p => encodeURIComponent(p));
                    const url = baseProxy + '/' + parts.join('/');
                    addDownloadLink(url, f.filename || parts[parts.length-1]);
                }
            } catch (e) { console.error('addDownloadLink failed for outputs dir', e); }
        });
    } catch (e) { /* silent */ }
}

// On page load, populate downloads list with files only from the outputs directory
try { window.addEventListener('load', () => { try { clearDownloads(); fetchAndShowOutputsDir(); } catch (e) {} }); } catch (e) {}
