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

export function showChapterSelectionModal(allChapters, excluded) {
    return new Promise((resolve) => {
        const html = allChapters.map((c, i) => {
            const title = (c.titulo || c.title || c.href || `Capítulo ${i+1}`).toString();
            const isExcluded = excluded.some(e => (e.titulo || e.href) === (c.titulo || c.href));
            const checked = isExcluded ? '' : 'checked';
            const escTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<div style="margin:6px 0;"><label><input type="checkbox" name="chap-${i}" value="${i}" ${checked} /> <span style="margin-left:8px">${escTitle}</span></label></div>`;
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
