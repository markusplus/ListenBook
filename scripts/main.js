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

// Prevent any accidental form submits that would reload the page in this single-page app
document.addEventListener('submit', (ev) => {
    try {
        ev.preventDefault();
        console.warn('[global] prevented form submit');
    } catch (e) { console.error('[global] prevent submit failed', e); }
});

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
                    // use addEventListener in capture phase and prevent default to avoid accidental form submits/navigation
                    img.addEventListener('click', async (event) => {
                        // stop other handlers as early as possible
                        try { if (event && typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation(); } catch (e) {}
                        if (event && typeof event.preventDefault === 'function') {
                            try { event.preventDefault(); event.stopPropagation(); } catch (e) {}
                        }
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
                                    // Use an off-DOM file input to avoid embedding inputs inside modal HTML
                                    referenceDataUrl = await new Promise((resolve) => {
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.accept = 'audio/*';
                                        input.style.display = 'none';
                                        document.body.appendChild(input);
                                        const cleanup = () => { try { document.body.removeChild(input); } catch (e) {} };
                                        input.addEventListener('change', () => {
                                            const file = input.files && input.files[0];
                                            if (!file) { cleanup(); return resolve(null); }
                                            const reader = new FileReader();
                                            Swal.fire({ title: 'Leyendo archivo', text: 'Por favor espera...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                                            reader.onload = () => { Swal.close(); cleanup(); resolve(reader.result); };
                                            reader.onerror = (err) => { Swal.close(); cleanup(); resolve(null); };
                                            reader.readAsDataURL(file);
                                        }, { once: true });
                                        // open picker
                                        input.click();
                                    });
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
                    });
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
