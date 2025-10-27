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
