// DOM helpers: functions that read/write the page UI
export function archivoSubido() {
    console.log('Archivo subido (DOM)');
    const header = document.getElementById('header_container');
    const logo = document.getElementById('logo_container');
    const config = document.getElementById('configuracion_section');
    if (header) header.style.display = 'none';
    if (logo) logo.style.display = 'none';
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
