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

export function showChapterSelectionModal(allChapters, excluded, bookTitleRaw) {
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
                const proxy = 'http://127.0.0.1:3002/gradio_outputs?dir=' + encodeURIComponent(outputsDir);
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
