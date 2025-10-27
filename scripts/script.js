// Using SweetAlert2 via CDN provides a global `Swal` object.
// Removed ES module import to avoid "Cannot use import statement outside a module" in the browser.

const dropArea = document.getElementById('upload_section');

dropArea.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropArea.classList.add('dragging');
});

dropArea.addEventListener('dragleave', () => {
    dropArea.classList.remove('dragging');
});

dropArea.addEventListener('drop', (event) => {
    event.preventDefault();
    dropArea.classList.remove('dragging');
    const files = event.dataTransfer.files;
    document.getElementById('file-upload').files = files;
    archivoSubido();
});
const fileInput = document.getElementById('file-upload');
const uploadSection = document.getElementById('upload_section');

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0 && fileInput.files.length <= 1) {
        const isValid = validaFormato(fileInput.files[0]);
        if (isValid) {
            const ebookData = procesaEbook(fileInput.files[0]);
            archivoSubido();
        }
    } else {
        Swal.fire({
            icon: 'warning',
            title: 'Atención',
            text: 'Por favor, sube un solo archivo.',
        });
        fileInput.value = '';
    }
});

const archivoSubido = () => {
    console.log('Archivo subido');
    document.getElementById('header_container').style.display = 'none';
    document.getElementById('logo_container').style.display = 'none';
    document.getElementById('configuracion_section').style.display = 'block';
}

function validaFormato(file) {
    const allowedExtensions = /(\.epub)$/i;
    if (!allowedExtensions.exec(file.name)) {
        Swal.fire({
            icon: 'warning',
            title: 'Atención',
            text: 'Formato de archivo no válido. Por favor, sube un archivo .epub',
        });
        fileInput.value = '';
        return false;
    } else {
        return true;
        console.log('Formato de archivo válido');
    }
}

class Ebook {
    constructor(archivo) {
        this.archivo = archivo;
        this.titulo = '';
        this.autor = '';
        this.portada = '';
        this.procesado = false;
    }
    async parse() {
        const fileData = await this.readFile();
        await this.extractMetadata(fileData);
    }

    readFile() {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = (event) => reject(event.target.error);
            reader.readAsArrayBuffer(this.archivo);
        });
    }
    async extractMetadata(fileData) {
        try {
            if (typeof JSZip === 'undefined') {
                await new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
                    s.onload = resolve;
                    s.onerror = reject;
                    document.head.appendChild(s);
                });
            }

            const zip = await JSZip.loadAsync(fileData);

            const containerFile = zip.file('META-INF/container.xml');
            if (!containerFile) throw new Error('META-INF/container.xml no encontrado en EPUB');
            const containerXml = await containerFile.async('string');
            const parser = new DOMParser();
            const containerDoc = parser.parseFromString(containerXml, 'application/xml');
            const rootfile = containerDoc.querySelector('rootfile');
            if (!rootfile) throw new Error('rootfile no encontrado en container.xml');
            const opfPath = rootfile.getAttribute('full-path');

            const opfFile = zip.file(opfPath);
            if (!opfFile) throw new Error('Archivo OPF no encontrado en ' + opfPath);
            const opfXml = await opfFile.async('string');
            const opfDoc = parser.parseFromString(opfXml, 'application/xml');

            const dcNS = 'http://purl.org/dc/elements/1.1/';
            const getFirstText = (nsName, localName) => {
                let el = opfDoc.getElementsByTagNameNS
                    ? opfDoc.getElementsByTagNameNS(nsName, localName)[0]
                    : null;
                if (!el) el = opfDoc.getElementsByTagName(localName)[0];
                return el ? el.textContent.trim() : '';
            };

            const title = getFirstText(dcNS, 'title') || '';
            const creator = getFirstText(dcNS, 'creator') || '';

            // Buscar id de portada vía <meta name="cover" content="id"> (EPUB2)
            let coverId = null;
            const metaCover = Array.from(opfDoc.getElementsByTagName('meta')).find(m => (m.getAttribute('name') || '').toLowerCase() === 'cover' || (m.getAttribute('property') || '').toLowerCase() === 'cover');
            if (metaCover) coverId = metaCover.getAttribute('content');

            // Buscar en manifest el item de la portada
            const manifestItems = Array.from(opfDoc.getElementsByTagName('item'));
            const getItemById = id => manifestItems.find(i => i.getAttribute('id') === id);
            let coverItem = coverId ? getItemById(coverId) : null;

            // EPUB3: properties="cover-image"
            if (!coverItem) {
                coverItem = manifestItems.find(i => {
                    const props = (i.getAttribute('properties') || '').split(/\s+/);
                    return props.includes('cover-image');
                });
            }

            // heurística: id/href con 'cover' o media-type image/*
            if (!coverItem) {
                coverItem = manifestItems.find(i => /(cover|titlepage)/i.test(i.getAttribute('id') || '') && (i.getAttribute('media-type') || '').startsWith('image/'));
            }
            if (!coverItem) {
                coverItem = manifestItems.find(i => (i.getAttribute('media-type') || '').startsWith('image/'));
            }

            let coverDataUrl = '';
            if (coverItem) {
                const href = coverItem.getAttribute('href');
                const mediaType = coverItem.getAttribute('media-type') || '';
                // Resolver ruta relativa respecto al OPF
                const basePath = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
                const fullPath = (basePath + href).replace(/^\.\//, '');
                const coverFile = zip.file(fullPath) || zip.file(decodeURIComponent(fullPath));
                if (coverFile) {
                    const buffer = await coverFile.async('arraybuffer');
                    const blob = new Blob([buffer], { type: mediaType || 'image/*' });
                    coverDataUrl = await new Promise(resolve => {
                        const r = new FileReader();
                        r.onload = () => resolve(r.result);
                        r.readAsDataURL(blob);
                    });
                }
            }
            this.titulo = title || '';
            this.autor = creator || '';
            this.portada = coverDataUrl || '';
            this.procesado = true;
        } catch (err) {
            console.error('Error extrayendo metadata EPUB:', err);
            this.procesado = false;
        }
    }
}

function procesaEbook(archivo) {
    const ebook = new Ebook(archivo);
    return ebook.parse().then(() => {
        document.getElementById('titulo_display').textContent = ebook.titulo;
        document.getElementById('autor_display').textContent = ebook.autor;
        const portadaContainer = document.getElementById('portada_display');
        portadaContainer.innerHTML = '';
        if (ebook.portada) {
            const img = document.createElement('img');
            img.src = ebook.portada;
            img.alt = ebook.titulo || 'Portada del ebook';
            img.className = 'ebook-portada';
            img.style.maxWidth = '200px';
            img.style.height = 'auto';
            portadaContainer.appendChild(img);
            img.onmouseover = () => {
                img.style.opacity = '0.5';
            };
            img.onmouseout = () => {
                img.style.opacity = '1';
            };
            img.onclick = () => {
                procesarContenidoEbook(ebook);
            };
        } else {
            portadaContainer.textContent = 'No hay portada disponible';
        }
        return ebook;
    });
}

async function procesarContenidoEbook(ebook) {
    Swal.fire({
        title: 'Procesando ebook',
        text: 'Espere a que termine el procesamiento.',
        icon: 'info',
    });

    const resultado = await extraerCapitulos(ebook);
    // resultado: { all, filtered, excluded }
    const allCaps = resultado.all || [];
    const filtered = resultado.filtered || [];
    const excluded = resultado.excluded || [];

    // Show selection modal so the user can manually exclude/include chapters
    const seleccionados = await showChapterSelectionModal(allCaps, excluded);
    if (!seleccionados) {
        console.log('Selección de capítulos cancelada por el usuario.');
        return;
    }

    console.log('Capítulos seleccionados por el usuario:', seleccionados);


}

/**
 * Muestra un modal con la lista de capítulos y checkboxes para seleccionar cuáles procesar.
 * Devuelve un array de capítulos seleccionados (objetos) o null si el usuario cancela.
 */
function showChapterSelectionModal(allChapters, excluded) {
    return new Promise((resolve) => {
        // Build HTML list
        const html = allChapters.map((c, i) => {
            const title = (c.titulo || c.title || c.titulo || c.href || `Capítulo ${i+1}`).toString();
            const isExcluded = excluded.some(e => (e.titulo || e.href) === (c.titulo || c.href));
            const checked = isExcluded ? '' : 'checked';
            // escape title for HTML
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
                // store initial heuristic state
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
                        // if state changed, animate the parent row
                        if (prev !== now) {
                            const row = cb.closest('div');
                            if (row) {
                                row.classList.remove('revert-flash');
                                // force reflow to restart animation
                                void row.offsetWidth;
                                row.classList.add('revert-flash');
                                // remove after animation
                                setTimeout(() => row.classList.remove('revert-flash'), 800);
                            }
                        }
                    });
                });

                // Set initial label based on current state
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

async function extraerCapitulos(ebook) {
    try {
        const arrayBuffer = await ebook.archivo.arrayBuffer();

        if (typeof JSZip === 'undefined') {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });
        }

        const zip = await JSZip.loadAsync(arrayBuffer);
        const capitulos = [];

        // Helpers
        const parser = new DOMParser();
        const getTextContent = (el) => (el ? el.textContent.trim() : '');

        // Determine opf path from container.xml
        let opfPath = null;
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) throw new Error('META-INF/container.xml no encontrado');
        const containerXml = await containerFile.async('string');
        const containerDoc = parser.parseFromString(containerXml, 'application/xml');
        const rootfile = containerDoc.querySelector('rootfile');
        if (!rootfile) throw new Error('rootfile no encontrado en container.xml');
        opfPath = rootfile.getAttribute('full-path');
        const basePath = opfPath && opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

        const resolveHref = (href) => {
            if (!href) return href;
            let p = href.replace(/^\.\//, '');
            if (/^[a-z]+:\/\//i.test(p) || p.startsWith('/')) return decodeURIComponent(p);
            return decodeURIComponent((basePath + p).replace(/\/{2,}/g, '/'));
        };

        // Load OPF
        const opfFile = zip.file(opfPath) || zip.file(decodeURIComponent(opfPath));
        if (!opfFile) throw new Error('OPF no encontrado en ' + opfPath);
        const opfXml = await opfFile.async('string');
        const opfDoc = parser.parseFromString(opfXml, 'application/xml');

        // Build manifest map
        const manifestElems = Array.from(opfDoc.getElementsByTagName('item'));
        const manifest = {};
        manifestElems.forEach(item => {
            manifest[item.getAttribute('id')] = {
                id: item.getAttribute('id'),
                href: item.getAttribute('href'),
                'media-type': item.getAttribute('media-type'),
                properties: item.getAttribute('properties') || ''
            };
        });

        // Find TOC NCX (EPUB2) or NAV (EPUB3)
        let tocItem = manifestElems.find(i => {
            const mt = (i.getAttribute('media-type') || '').toLowerCase();
            const id = (i.getAttribute('id') || '').toLowerCase();
            const href = (i.getAttribute('href') || '').toLowerCase();
            const props = (i.getAttribute('properties') || '').toLowerCase();
            return mt === 'application/x-dtbncx+xml' || id === 'toc' || href.includes('toc.ncx') || props.includes('nav');
        });

        let capitulosPromises = [];

        if (tocItem && (tocItem.getAttribute('media-type') || '').toLowerCase() === 'application/x-dtbncx+xml') {
            // EPUB2: parse NCX
            const ncxHref = resolveHref(tocItem.getAttribute('href'));
            const ncxFile = zip.file(ncxHref) || zip.file(decodeURIComponent(ncxHref));
            if (ncxFile) {
                const ncxXml = await ncxFile.async('string');
                const ncxDoc = parser.parseFromString(ncxXml, 'application/xml');
                const navPoints = Array.from(ncxDoc.getElementsByTagName('navPoint'));

                navPoints.forEach((np, idx) => {
                    const navLabel = np.getElementsByTagName('navLabel')[0];
                    const textEl = navLabel ? navLabel.getElementsByTagName('text')[0] : null;
                    const title = getTextContent(textEl) || (`Capítulo ${idx + 1}`);
                    const contentEl = np.getElementsByTagName('content')[0];
                    const src = contentEl ? contentEl.getAttribute('src') : null;
                    const srcSplit = src ? src.split('#') : [null];
                    const href = srcSplit[0];
                    const fragment = srcSplit[1] || null;

                    capitulosPromises.push((async () => {
                        try {
                            const filePath = resolveHref(href);
                            const file = zip.file(filePath) || zip.file(decodeURIComponent(filePath));
                            let contenido = '';
                            if (file) {
                                const fileText = await file.async('string');
                                const doc = parser.parseFromString(fileText, 'text/html');
                                if (fragment) {
                                    const el = doc.getElementById(fragment);
                                    contenido = el ? el.innerHTML.trim() : (doc.body ? doc.body.innerHTML.trim() : fileText);
                                } else {
                                    const article = doc.querySelector('article') || doc.querySelector('section');
                                    contenido = article ? article.innerHTML.trim() : (doc.body ? doc.body.innerHTML.trim() : fileText);
                                }
                            }
                            return { numero: parseInt(np.getAttribute('playOrder')) || (idx + 1), titulo: title, href: href, fragment: fragment, contenido: contenido };
                        } catch (err) {
                            return { numero: idx + 1, titulo: title, href: href, fragment: fragment, contenido: '' };
                        }
                    })());
                });
            }
        } else {
            // EPUB3 or fallback: use spine order
            const spine = Array.from(opfDoc.getElementsByTagName('itemref'));
            spine.forEach((itemref, idx) => {
                const idref = itemref.getAttribute('idref');
                const manifestItem = manifest[idref];
                if (!manifestItem) return;
                const href = manifestItem.href;
                const filePath = resolveHref(href);
                capitulosPromises.push((async () => {
                    try {
                        const file = zip.file(filePath) || zip.file(decodeURIComponent(filePath));
                        let title = manifestItem.properties && manifestItem.properties.includes('nav') ? manifestItem.href : `Capítulo ${idx + 1}`;
                        let contenido = '';
                        if (file) {
                            const fileText = await file.async('string');
                            const doc = parser.parseFromString(fileText, 'text/html');
                            const h = doc.querySelector('h1') || doc.querySelector('h2') || doc.querySelector('title');
                            if (h && getTextContent(h)) title = getTextContent(h);
                            const article = doc.querySelector('article') || doc.querySelector('section');
                            contenido = article ? article.innerHTML.trim() : (doc.body ? doc.body.innerHTML.trim() : fileText);
                        }
                        return { numero: idx + 1, titulo: title, href: href, contenido: contenido };
                    } catch (err) {
                        return { numero: idx + 1, titulo: `Capítulo ${idx + 1}`, href: href, contenido: '' };
                    }
                })());
            });
        }

        const resultados = await Promise.all(capitulosPromises);
        resultados.sort((a, b) => (a.numero || 0) - (b.numero || 0));
        resultados.forEach(r => capitulos.push(r));

        // Heurística de exclusión (definida localmente)
        const IGNORE_TITLE_PATTERNS = [
            /^\s*cubierta\b/i,
            ...(ebook && (ebook.titulo || ebook.title) ? [ new RegExp('^\\s*' + ((ebook.titulo).normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) + '(?:\\b|$)', 'iu') ] : []),
            /^\s*creditos?\b/i,
            /^\s*personajes\b/i,
            /^\s*dedicatoria\b/i,
            /^\s*agradecimientos?\b/i,
            /^\s*cita\b/i,
            /^\s*colof[oó]n\b/i,
            /^\s*\u00edndice\b/i,
            /^\s*nota(s)?\b/i,
            /^\s*anexo\b/i,
            /^\s*copyright\b/i,
            /^\s*portada\b/i,
            /^\s*contraportada\b/i,
            /^\s*autor(es)?\b/i,

        ];

            const normalize = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

        const isIgnored = (chap) => {
            const title = normalize(chap.titulo || chap.title || '');
            if (!title && chap.contenido) {
                const txt = chap.contenido.replace(/<[^>]+>/g, '').trim();
                if (txt.split(/\s+/).length < 8) return true;
            }
            for (const re of IGNORE_TITLE_PATTERNS) {
                try { if (re.test(title)) return true; } catch (e) {}
            }
            const contentText = (chap.contenido || '').replace(/<[^>]+>/g, '').toLowerCase();
            if (contentText && /^(?:creditos|agradecimientos|dedicatoria|indice|prefacio|pr[oó]logo)\b/.test(contentText.trim().slice(0, 50))) return true;
            return false;
        };

        const filtered = capitulos.filter(c => !isIgnored(c));
        const excluded = capitulos.filter(c => isIgnored(c));
        if (excluded.length > 0) console.info('Capítulos excluidos por heurística:', excluded.map(e => e.titulo || e.href || '(sin título)'));

        return { all: capitulos, filtered, excluded };
    } catch (err) {
        console.error('Error extrayendo capítulos:', err);
        return { all: [], filtered: [], excluded: [] };
    }
}
