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
}

export function setAuthor(text) {
    const el = document.getElementById('autor_display');
    if (el) el.textContent = text || '';
}

export function showCover(dataUrl, title) {
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
        a.href = url;
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

logoDescargas.onclick = () => {
    const list = document.getElementById('downloads_section');
    tituloDrag.style.display = 'none';
    if (list) list.style.display = 'block';
}

// Progress widget: floating box at top-right showing percent and status
let _progressWidget = null;
let _progressInterval = null;
export function createProgressWidget() {
    removeProgressWidget();
    const w = document.createElement('div');
    w.id = 'tts-progress-widget';
    w.style.position = 'fixed';
    w.style.top = '12px';
    w.style.right = '12px';
    w.style.zIndex = '9999';
    w.style.background = 'rgba(0,0,0,0.75)';
    w.style.color = '#fff';
    w.style.padding = '10px 12px';
    w.style.borderRadius = '8px';
    w.style.fontFamily = 'sans-serif';
    w.style.fontSize = '13px';
    w.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    w.innerHTML = `<div id="tts-progress-percent" style="font-weight:700; font-size:14px;">0%</div><div id="tts-progress-label" style="color:#ddd; margin-top:4px; font-size:12px;">Preparando...</div>`;
    document.body.appendChild(w);
    _progressWidget = w;
}

export function updateProgressWidget({ percent = 0, label = '' } = {}) {
    if (!_progressWidget) return;
    try {
        const p = _progressWidget.querySelector('#tts-progress-percent');
        const l = _progressWidget.querySelector('#tts-progress-label');
        if (p) p.textContent = `${Math.max(0, Math.min(100, Math.floor(percent)))}%`;
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