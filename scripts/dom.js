// DOM helpers: functions that read/write the page UI
export function archivoSubido() {
    console.log('Archivo subido (DOM)');
    const header = document.getElementById('header_container');
    const config = document.getElementById('configuracion_section');
    if (header) header.style.display = 'none';
    if (config) config.style.display = 'block';
}

export function setTitle(text) {
    const el = document.getElementById('titulo_display');
    if (el) el.textContent = text || '';
    try { window.__listenbookCurrentBookTitle = String(text || ''); } catch (error) { /* entorno sin window */ }
}

export function setAuthor(text) {
    const el = document.getElementById('autor_display');
    if (el) el.textContent = text || '';
}

export function setBookCollection(text) {
    const value = text || 'Colección no especificada';
    document.querySelectorAll('#bookSeriesLabel, #bookCoverSeriesLabel').forEach(el => {
        el.textContent = value;
    });
}

export function showCover(dataUrl, title) {
    try { window.__listenbookCurrentBookCover = String(dataUrl || ''); } catch (error) { /* entorno sin window */ }
    const prototypeCover = document.getElementById('frontCover');
    if (prototypeCover) {
        const coverImage = prototypeCover.querySelector('img[data-alt], img[data-listenbook-cover], img');
        if (coverImage && dataUrl) {
            coverImage.src = dataUrl;
            coverImage.alt = title || 'Portada del ebook';
            coverImage.dataset.listenbookCover = 'true';
        }
        prototypeCover.setAttribute('aria-label', title || 'Abrir portada y seleccionar capítulos');
        return prototypeCover;
    }
    const portadaContainer = document.getElementById('portada_display');
    if (!portadaContainer) return;
    portadaContainer.innerHTML = '';
    if (dataUrl) {
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = title || 'Portada del ebook';
        img.className = 'ebook-portada';
        img.style.maxWidth = '200px';
        img.style.height = 'auto';
        portadaContainer.appendChild(img);
        return img;
    } else {
        portadaContainer.textContent = 'No hay portada disponible';
        return null;
    }
}

export function clearCover() {
    const portadaContainer = document.getElementById('portada_display');
    if (portadaContainer) portadaContainer.innerHTML = '';
}

export function clearDownloads() {
    const list = document.getElementById('downloads_list');
    const empty = document.getElementById('downloads_empty');
    if (list) list.innerHTML = '';
    if (empty) empty.style.display = 'block';
}

export function addDownloadLink(url, filename) {
    try {
        const list = document.getElementById('downloads_list');
        const empty = document.getElementById('downloads_empty');
        if (!list) return;
        if (empty) empty.style.display = 'none';
        const row = document.createElement('div');
        row.className = 'download-row';
        row.style.margin = '8px 0';
        const a = document.createElement('a');
        let downloadUrl = url;
        try {
            const parsed = new URL(url, window.location.href);
            if (parsed.pathname === '/view' && parsed.searchParams.get('filename')) {
                const proxy = new URL('/api/audio', window.location.origin);
                ['filename', 'subfolder', 'type'].forEach(key => proxy.searchParams.set(key, parsed.searchParams.get(key) || (key === 'type' ? 'output' : '')));
                proxy.searchParams.set('download', '1');
                downloadUrl = proxy.toString();
            } else if (parsed.pathname === '/api/audio') {
                parsed.searchParams.set('download', '1');
                downloadUrl = parsed.toString();
            }
        } catch (error) { /* conserva la URL original */ }
        if (Array.from(list.querySelectorAll('a[data-listenbook-download-url]')).some(link => link.dataset.listenbookDownloadUrl === downloadUrl)) return;
        a.href = downloadUrl;
        a.dataset.listenbookDownloadUrl = downloadUrl;
        a.textContent = filename || url;
        a.download = filename || '';
        a.target = '_blank';
        a.style.marginRight = '8px';
        /* const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = url;
        audio.style.verticalAlign = 'middle';
        audio.style.maxWidth = '60%'; */
        row.appendChild(a);
        //row.appendChild(audio);
        list.appendChild(row);
    } catch (e) { console.error('addDownloadLink error', e); }
}

const logoDescargas = document.getElementById('logo_descargas');
const tituloDrag = document.getElementsByClassName('titulo_drag')[0];

if (logoDescargas) {
    logoDescargas.onclick = () => {
        const list = document.getElementById('downloads_section');
        if (tituloDrag) tituloDrag.style.display = 'none';
        if (list) list.style.display = 'block';
    };
}

// Progress widget: floating status card styled in css/listenbook.css.
let _progressWidget = null;
let _progressInterval = null;
export function createProgressWidget() {
    removeProgressWidget();
    const w = document.createElement('div');
    w.id = 'tts-progress-widget';
    w.className = 'tts-progress-widget';
    w.setAttribute('role', 'status');
    w.setAttribute('aria-live', 'polite');
    w.innerHTML = `
        <div class="tts-progress-widget-header">
            <div class="tts-progress-widget-title">
                <span class="material-symbols-outlined">graphic_eq</span>
                <span>Generando audiolibro</span>
            </div>
            <span id="tts-progress-percent" class="tts-progress-percent">0%</span>
        </div>
        <div class="tts-progress-track" aria-hidden="true">
            <div id="tts-progress-bar-fill" class="tts-progress-bar-fill"></div>
        </div>
        <div id="tts-progress-label" class="tts-progress-label">Preparando...</div>
    `;
    document.body.appendChild(w);
    _progressWidget = w;
}

export function updateProgressWidget({ percent = 0, label = '' } = {}) {
    if (!_progressWidget) return;
    try {
        const p = _progressWidget.querySelector('#tts-progress-percent');
        const l = _progressWidget.querySelector('#tts-progress-label');
        const fill = _progressWidget.querySelector('#tts-progress-bar-fill');
        const safePercent = Math.max(0, Math.min(100, Math.floor(percent)));
        if (p) p.textContent = `${safePercent}%`;
        if (fill) fill.style.width = `${safePercent}%`;
        if (l) l.textContent = label || '';
    } catch (e) { }
}

export function removeProgressWidget() {
    try {
        if (_progressInterval) { clearInterval(_progressInterval); _progressInterval = null; }
        if (_progressWidget && _progressWidget.parentNode) {
            _progressWidget.parentNode.removeChild(_progressWidget);
        }
    } catch (e) {}
    _progressWidget = null;
}
