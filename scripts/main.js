import { archivoSubido, setTitle, setAuthor, showCover, addDownloadLink, clearDownloads } from './dom.js';
import { showProcessing, closeProcessing, showChapterSelectionModal } from './ui.js';
import { createProgressWidget, updateProgressWidget, removeProgressWidget } from './dom.js';
import { Ebook, extraerCapitulos } from './ebook.js';
import { ejecutarTTS } from './ttsProcess.js';

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

// -------------------------
// Debug capture / send
// -------------------------
const ENABLE_DEBUG_CAPTURE = true; // flip to false to disable
const DEBUG_ENDPOINT = 'http://127.0.0.1:3002/debug_event';
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
                        const seleccionados = await showChapterSelectionModal(allCaps, excluded);
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
                                const _ttsStart = Date.now();
                                // Setup persistent progress widget (top-right)
                                try {
                                    // Estimate seconds per 50 chars (tunable). 0.0-∞. Adjust later if you want.
                                    const BASE_SEC_PER_50 = 0.92; // seconds per 50 chars (estimate)
                                    // approximate prompt length from selected chapters
                                    const approxPromptLength = (seleccionados || []).map(c => ((c.contenido || c.text || c.content) || (c.titulo || c.title) || '')).join('\n').length || 0;
                                    const units = Math.max(1, Math.ceil(approxPromptLength / 50));
                                    const estimatedSeconds = units * BASE_SEC_PER_50;
                                    let elapsedSeconds = 0;
                                    createProgressWidget();
                                    updateProgressWidget({ percent: 0, label: `Estimado: ${estimatedSeconds}s — Iniciando...` });
                                    // tick every 1s to update percent as elapsed/estimated
                                    const progressStart = Date.now();
                                    const progressInterval = setInterval(() => {
                                        elapsedSeconds = Math.floor((Date.now() - progressStart) / 1000);
                                        let pct = estimatedSeconds > 0 ? (elapsedSeconds / estimatedSeconds) * 100 : 0;
                                        if (pct > 99) pct = 99; // keep below 100 until finished
                                        updateProgressWidget({ percent: pct, label: `Estimado: ${estimatedSeconds}s · ${elapsedSeconds}s transcurridos` });
                                    }, 1000);
                                    // store interval so we can clear on completion
                                    window.__tts_progress_interval = progressInterval;
                                    window.__tts_progress_meta = { estimatedSeconds, progressStart };
                                } catch (e) { console.warn('progress widget init failed', e); }
                                // clear previous downloads for a fresh run
                                try { clearDownloads(); } catch (e) {}
                            const result = await ejecutarTTS(ebook, seleccionados, {
                                // point to Gradio base URL; ejecutarTTS will post to /predict
                                serverUrl: 'http://127.0.0.1:7860',
                                statusBase: 'http://127.0.0.1:7860',
                                // allow passing user-uploaded data URL; fallback to proxy example audio
                                referenceAudioDataUrl: referenceDataUrl,
                                referenceAudioUrl: 'http://127.0.0.1:3002/proxy?url=' + encodeURIComponent('https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav'),
                                // prefer using local proxy for server-side Gradio invocation
                                proxyGradioCallUrl: 'http://127.0.0.1:3002/gradio_call',
                                // extend client-side fetch timeout to 10 minutes to avoid premature aborts
                                // 0 = wait indefinitely (no client-side abort)
                                clientTimeout: 0,
                                pollInterval: 1500,
                                timeout: 1000 * 60 * 5,
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

                                const _ttsMs = Date.now() - _ttsStart;
                                // clear progress widget
                                try {
                                    if (window.__tts_progress_interval) { clearInterval(window.__tts_progress_interval); window.__tts_progress_interval = null; }
                                    removeProgressWidget();
                                } catch (e) {}
                                console.log('[UI] ejecutarTTS finished in', _ttsMs, 'ms — raw result:', result);
                            // When done, try to extract file URLs from result and add to downloads
                            try {
                                // Defensive: if result is a JSON string, try to parse it
                                let normalized = result;
                                if (typeof normalized === 'string') {
                                    try { normalized = JSON.parse(normalized); console.log('[UI] parsed result string into object'); } catch (e) { console.warn('[UI] result is string but not JSON'); }
                                }
                                const files = extractFilesFromResult(normalized || {});
                                console.log('[UI] extracted files:', files);
                                try {
                                    if (files && files.length >= 2) {
                                        // Delete files[0] on server and rename files[1] to book+chapter+creationDate.wav
                                        const f0 = files[0];
                                        const f1 = files[1];
                                        // extract raw paths
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
                                        // build desired base name
                                        const bookTitleRaw = (ebook && (ebook.titulo || ebook.title)) ? (ebook.titulo || ebook.title) : 'ebook';
                                        const bookTitleNoSpaces = String(bookTitleRaw).replace(/\s+/g, '');
                                        // pick chapter name from selection: assume first selected chapter corresponds to files[1]
                                        let chapterName = 'capitulo1';
                                        try { if (Array.isArray(seleccionados) && seleccionados.length > 0) chapterName = seleccionados[0].titulo || seleccionados[0].title || chapterName; } catch(e){}
                                        const chapterSafe = String(chapterName).replace(/\s+/g, '');
                                        const desiredBase = `${bookTitleNoSpaces}${chapterSafe}`;

                                        // Call proxy finalize endpoint: delete directory of file0, move file1 into outputs/<bookName>/<book_chapter_date>.wav
                                        try {
                                            const finalResp = await fetch('http://127.0.0.1:3002/gradio_finalize', {
                                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ deleteDirPath: path0, targetPath: path1, bookName: bookTitleNoSpaces, chapterName: chapterSafe, baseUrl: 'http://127.0.0.1:7860' })
                                            });
                                            if (finalResp && finalResp.ok) {
                                                    const fj = await finalResp.json().catch(() => null);
                                                    const finalUrl = (fj && fj.ok && (fj.outputsUrl || fj.url)) ? (fj.outputsUrl || fj.url) : null;
                                                    if (finalUrl) {
                                                        addDownloadLink(finalUrl, fj && fj.filename ? fj.filename : f1.filename);
                                                    } else {
                                                        // Finalize didn't return an outputs URL — refresh outputs list (do not show Gradio temp files)
                                                        try { await fetchAndShowOutputsDir(); } catch (e) { /* ignore */ }
                                                    }
                                                } else {
                                                    try { await fetchAndShowOutputsDir(); } catch (e) { /* ignore */ }
                                                }
                                            } catch (e) { console.error('finalize error', e); try { await fetchAndShowOutputsDir(); } catch (e2) {} }
                                    } else if (files && files.length === 1) {
                                        // only one file — do not show ephemeral Gradio temp files; refresh outputs dir
                                        try { await fetchAndShowOutputsDir(); } catch (e) { /* ignore */ }
                                    } else {
                                        console.warn('[UI] no files found in result');
                                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'No se encontraron audios generados.' });
                                    }
                                } catch (e) {
                                    console.error('Error processing files for delete/rename', e);
                                }
                            } catch (e) {
                                console.error('Error procesando resultado TTS para descargas', e);
                                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'La generación finalizó pero no se pudieron procesar los archivos.' });
                            }
                            // Refresh downloads from outputs directory only
                            try {
                                await fetchAndShowOutputsDir();
                            } catch (e) { console.warn('fetchAndShowOutputsDir failed', e); }
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

// Helper to find file-like objects (with url/path) in various result shapes
function extractFilesFromResult(obj) {
    const results = [];
    const seen = new Set();
    function normalizeUrl(u) {
        if (!u) return u;
        if (typeof u !== 'string') u = String(u);
        if (u.startsWith('http')) return u;
        if (u.startsWith('/')) return 'http://127.0.0.1:7860' + u;
        if (u.startsWith('file=')) return 'http://127.0.0.1:7860/' + u;
        // windows path like C:\... -> expose via gradio file= prefix
        if (/^[A-Za-z]:\\/.test(u)) return 'http://127.0.0.1:7860/file=' + encodeURIComponent(u);
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
        const proxy = 'http://127.0.0.1:3002/gradio_outputs';
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
        const proxy = 'http://127.0.0.1:3002/gradio_outputs?dir=' + encodeURIComponent(outputsDir);
        const resp = await fetch(proxy);
        if (!resp.ok) return; // no outputs or proxy not available
        const j = await resp.json().catch(() => null);
        if (!j || !Array.isArray(j.files) || !j.dir) return;
        const baseProxy = 'http://127.0.0.1:3002/outputs';
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
