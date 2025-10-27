import { archivoSubido, setTitle, setAuthor, showCover } from './dom.js';
import { showProcessing, closeProcessing, showChapterSelectionModal } from './ui.js';
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

// Generic click capture (non-intrusive: don't call preventDefault)
document.addEventListener('click', (e) => {
    if (!ENABLE_DEBUG_CAPTURE) return;
    try {
        const t = e.target || {};
        const info = {
            type: 'click',
            tag: (t.tagName || '').toLowerCase(),
            id: t.id || null,
            classes: t.className || null,
            x: e.clientX,
            y: e.clientY,
            href: t.href || null,
            text: (t.innerText && t.innerText.length > 200) ? t.innerText.slice(0, 200) : (t.innerText || null)
        };
        sendDebugEvent(info);
    } catch (e) {}
}, false);

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
                            const result = await ejecutarTTS(ebook, seleccionados, {
                                // point to Gradio base URL; ejecutarTTS will post to /predict
                                serverUrl: 'http://127.0.0.1:7860',
                                statusBase: 'http://127.0.0.1:7860',
                                // allow passing user-uploaded data URL; fallback to proxy example audio
                                referenceAudioDataUrl: referenceDataUrl,
                                referenceAudioUrl: 'http://127.0.0.1:3002/proxy?url=' + encodeURIComponent('https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav'),
                                // prefer using local proxy for server-side Gradio invocation
                                proxyGradioCallUrl: 'http://127.0.0.1:3002/gradio_call',
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
                                console.log('[UI] ejecutarTTS finished in', _ttsMs, 'ms — result:', result);
                            // When done, show results
                            if (result && result.status === 'done') {
                                const files = result.files || [];
                                if (typeof Swal !== 'undefined') {
                                    const list = files.map(f => {
                                        const url = (f.url && f.url.startsWith('http')) ? f.url : (`http://127.0.0.1:3001${f.url}`);
                                        return `<div style="margin:8px 0;"><div>${f.filename || ''}</div><audio controls src="${url}"></audio></div>`;
                                    }).join('');
                                    Swal.fire({ title: 'Audios generados', html: `<div style="text-align:left">${list || 'No se generaron archivos'}</div>` });
                                }
                            } else {
                                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'La generación falló o fue cancelada.' });
                            }
                        } catch (err) {
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
