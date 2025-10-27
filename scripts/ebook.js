// Ebook processing: class Ebook and chapter extraction
export class Ebook {
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
                let el = opfDoc.getElementsByTagNameNS ? opfDoc.getElementsByTagNameNS(nsName, localName)[0] : null;
                if (!el) el = opfDoc.getElementsByTagName(localName)[0];
                return el ? el.textContent.trim() : '';
            };
            const title = getFirstText(dcNS, 'title') || '';
            const creator = getFirstText(dcNS, 'creator') || '';
            // portada
            let coverId = null;
            const metaCover = Array.from(opfDoc.getElementsByTagName('meta')).find(m => (m.getAttribute('name') || '').toLowerCase() === 'cover' || (m.getAttribute('property') || '').toLowerCase() === 'cover');
            if (metaCover) coverId = metaCover.getAttribute('content');
            const manifestItems = Array.from(opfDoc.getElementsByTagName('item'));
            const getItemById = id => manifestItems.find(i => i.getAttribute('id') === id);
            let coverItem = coverId ? getItemById(coverId) : null;
            if (!coverItem) {
                coverItem = manifestItems.find(i => {
                    const props = (i.getAttribute('properties') || '').split(/\s+/);
                    return props.includes('cover-image');
                });
            }
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
            throw err;
        }
    }
}

export async function extraerCapitulos(ebook) {
    // reuse the previous implementation but scoped here
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
        const parser = new DOMParser();
        const getTextContent = (el) => (el ? el.textContent.trim() : '');
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) throw new Error('META-INF/container.xml no encontrado');
        const containerXml = await containerFile.async('string');
        const containerDoc = parser.parseFromString(containerXml, 'application/xml');
        const rootfile = containerDoc.querySelector('rootfile');
        if (!rootfile) throw new Error('rootfile no encontrado en container.xml');
        const opfPath = rootfile.getAttribute('full-path');
        const basePath = opfPath && opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
        const resolveHref = (href) => {
            if (!href) return href;
            let p = href.replace(/^\.\//, '');
            if (/^[a-z]+:\/\//i.test(p) || p.startsWith('/')) return decodeURIComponent(p);
            return decodeURIComponent((basePath + p).replace(/\/{2,}/g, '/'));
        };
        const opfFile = zip.file(opfPath) || zip.file(decodeURIComponent(opfPath));
        if (!opfFile) throw new Error('OPF no encontrado en ' + opfPath);
        const opfXml = await opfFile.async('string');
        const opfDoc = parser.parseFromString(opfXml, 'application/xml');
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
        let tocItem = manifestElems.find(i => {
            const mt = (i.getAttribute('media-type') || '').toLowerCase();
            const id = (i.getAttribute('id') || '').toLowerCase();
            const href = (i.getAttribute('href') || '').toLowerCase();
            const props = (i.getAttribute('properties') || '').toLowerCase();
            return mt === 'application/x-dtbncx+xml' || id === 'toc' || href.includes('toc.ncx') || props.includes('nav');
        });
        let capitulosPromises = [];
        if (tocItem && (tocItem.getAttribute('media-type') || '').toLowerCase() === 'application/x-dtbncx+xml') {
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
        // heuristics
        const IGNORE_TITLE_PATTERNS = [
            /^\s*cubierta\b/i,
            ...(ebook && (ebook.titulo || ebook.title) ? [ new RegExp('^\\s*' + ((ebook.titulo).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) + '(?:\\b|$)', 'iu') ] : []),
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
