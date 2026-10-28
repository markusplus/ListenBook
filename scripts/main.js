import { archivoSubido, setTitle, setAuthor, showCover, addDownloadLink, clearDownloads } from './dom.js?v=5';
import { showProcessing, closeProcessing, showChapterSelectionModal, renderPrototypeChapterSelection, clearPrototypeChapterDemo, markChapterGenerated, restoreGeneratedAudioForBook } from './ui.js?v=20';
import { createProgressWidget, updateProgressWidget, removeProgressWidget } from './dom.js?v=5';
import { Ebook, extraerCapitulos } from './ebook.js?v=2';
import { ejecutarTTS } from './ttsProcess.js?v=15';

// El listado inicial del Stitch es solo una maqueta. La aplicación debe
// mostrar exclusivamente los capítulos del EPUB cargado por el usuario.
clearPrototypeChapterDemo();

function activateMenuItem(path) {
    const nav = document.querySelector('nav[data-active-classes]');
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll('a[data-path]'));
    const activeClasses = ['bg-white', 'text-[#2C1810]', 'font-bold', 'rounded-lg', 'shadow-sm', 'shadow-xs', 'font-semibold'];
    links.forEach(link => {
        activeClasses.forEach(className => link.classList.remove(className));
        link.classList.add('text-[#504440]');
    });
    const activeLink = nav.querySelector(`a[data-path="${path}"]`);
    if (activeLink) {
        activeLink.classList.remove('text-[#504440]');
        activeLink.classList.add('bg-white', 'text-[#2C1810]', 'font-bold', 'rounded-lg', 'shadow-sm');
    }
}

function activateConvertEpubMenu() { activateMenuItem('convertir-epub'); }

function showShelfView() {
    const header = document.getElementById('header_container');
    const workspace = document.getElementById('configuracion_section');
    const downloads = document.getElementById('downloads_section');
    const shelf = document.getElementById('bookshelf-stage');
    const tome = document.getElementById('tome-3d-stage');
    if (workspace) workspace.style.display = 'none';
    if (downloads) downloads.style.display = 'none';
    if (header) header.style.display = 'block';
    if (shelf) shelf.classList.remove('hidden');
    if (tome) tome.classList.add('hidden');
    activateMenuItem('mis-audiolibros');
}

function showConvertView() {
    const header = document.getElementById('header_container');
    const workspace = document.getElementById('configuracion_section');
    const downloads = document.getElementById('downloads_section');
    if (downloads) downloads.style.display = 'none';
    if (window.__listenbookEbook) {
        if (header) header.style.display = 'none';
        if (workspace) workspace.style.display = 'block';
    } else {
        if (workspace) workspace.style.display = 'none';
        if (header) header.style.display = 'block';
        const shelf = document.getElementById('bookshelf-stage');
        const tome = document.getElementById('tome-3d-stage');
        if (shelf) shelf.classList.remove('hidden');
        if (tome) tome.classList.add('hidden');
    }
    activateMenuItem('convertir-epub');
}

const appMenu = document.querySelector('nav[data-active-classes]');
if (appMenu) {
    appMenu.querySelectorAll('a[data-path]').forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault();
            const path = link.dataset.path;
            if (path === 'mis-audiolibros') showShelfView();
            if (path === 'convertir-epub') showConvertView();
        });
    });
}

const COMFYUI_HOST = (typeof window !== 'undefined' && window.location && window.location.hostname)
    ? window.location.hostname
    : '127.0.0.1';
const COMFYUI_PORT = 8188;
const COMFYUI_BASE = (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol))
    ? `${window.location.origin}/api/comfy`
    : `http://${COMFYUI_HOST}:${COMFYUI_PORT}`;
// Kept as aliases for legacy download/debug helpers below.
const GRADIO_BASE = COMFYUI_BASE;
// proxy runs on port 3002 by default
const PROXY_PORT = 3002;
const PROXY_BASE = `http://${COMFYUI_HOST}:${PROXY_PORT}`;
// bridge (legacy local bridge) runs on port 3001 by default — expose so other modules can use it
const BRIDGE_PORT = 3001;
const BRIDGE_BASE = `http://${COMFYUI_HOST}:${BRIDGE_PORT}`;
// expose to other modules that may read window.PROXY_BASE / window.GRADIO_BASE / window.BRIDGE_BASE
try { window.COMFYUI_BASE = COMFYUI_BASE; window.GRADIO_BASE = GRADIO_BASE; window.PROXY_BASE = PROXY_BASE; window.BRIDGE_BASE = BRIDGE_BASE; } catch (e) {}

// Mobile detection and activation: add 'mobile' class to <html> when accessed from a smartphone or narrow viewport
function activateMobileIfNeeded() {
    try {
        const ua = navigator.userAgent || '';
        const isMobileUA = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(ua);
        const isNarrow = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 700;
        if (isMobileUA || isNarrow) {
            try { document.documentElement.classList.add('mobile'); } catch (e) {}
        }
    } catch (e) { /* ignore */ }
}
window.addEventListener('load', activateMobileIfNeeded);
window.addEventListener('resize', () => { try { activateMobileIfNeeded(); } catch (e) {} });

const dropArea = document.getElementById('upload_section') || document.getElementById('shelf-dropzone-target');
if (dropArea) {
    dropArea.addEventListener('dragover', (event) => { event.preventDefault(); dropArea.classList.add('dragging'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragging'));
}

// El arrastre usa exactamente el mismo flujo que el selector de archivos.
// Se captura en window para impedir que el prototipo abra su tomo de ejemplo.
window.addEventListener('drop', (event) => {
    const files = Array.from(event.dataTransfer?.files || []).filter(file => /\.epub$/i.test(file.name));
    if (!files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (dropArea) dropArea.classList.remove('dragging');
    const curtain = document.getElementById('drag-drop-curtain');
    if (curtain) {
        curtain.classList.add('opacity-0', 'pointer-events-none');
        curtain.classList.remove('opacity-100');
    }
    const fileInput = document.getElementById('file-upload');
    if (!fileInput) return;
    try {
        const transfer = new DataTransfer();
        transfer.items.add(files[0]);
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        archivoSubido();
    } catch (error) {
        console.warn('[EPUB] No se pudo preparar el archivo arrastrado:', error);
    }
}, true);

const fileInput = document.getElementById('file-upload');
const reuploadButton = document.getElementById('reupload_button');
const coverActionHint = document.getElementById('cover_action_hint');
const backToMainButton = document.getElementById('back_to_main');
const deleteLoadedBookButton = document.getElementById('delete_loaded_book');
const deleteLoadedBookStatButton = document.getElementById('delete_loaded_book_stat');

// Importación de tomos: archivo local o catálogo OPDS de Biblioses.
const newBookSourceModal = document.getElementById('new-book-source-modal');
const newBookSourceOptions = document.getElementById('new-book-source-options');
const newBookSourceClose = document.getElementById('new-book-source-close');
const newBookLocalOption = document.getElementById('new-book-local-option');
const newBookBibliosesOption = document.getElementById('new-book-biblioses-option');
const bibliosesBrowser = document.getElementById('biblioses-browser');
const bibliosesSearchInput = document.getElementById('biblioses-search-input');
const bibliosesSearchButton = document.getElementById('biblioses-search-button');
const bibliosesStatus = document.getElementById('biblioses-status');
const bibliosesResults = document.getElementById('biblioses-results');

function closeNewBookSourceChooser() {
    if (!newBookSourceModal) return;
    newBookSourceModal.classList.add('hidden');
    newBookSourceModal.classList.remove('flex');
    newBookSourceModal.setAttribute('aria-hidden', 'true');
}

function showBibliosesStatus(message, visible = true) {
    if (!bibliosesStatus) return;
    bibliosesStatus.textContent = message;
    bibliosesStatus.classList.toggle('hidden', !visible);
}

function openNewBookSourceChooser() {
    if (!newBookSourceModal) return fileInput?.click();
    newBookSourceModal.classList.remove('hidden');
    newBookSourceModal.classList.add('flex');
    newBookSourceModal.setAttribute('aria-hidden', 'false');
    newBookSourceOptions?.classList.remove('hidden');
    bibliosesBrowser?.classList.add('hidden');
    if (bibliosesResults) bibliosesResults.replaceChildren();
    showBibliosesStatus('', false);
}

window.openNewBookSourceChooser = openNewBookSourceChooser;
newBookSourceClose?.addEventListener('click', closeNewBookSourceChooser);
newBookSourceModal?.addEventListener('click', event => {
    if (event.target === newBookSourceModal) closeNewBookSourceChooser();
});
newBookLocalOption?.addEventListener('click', () => {
    closeNewBookSourceChooser();
    fileInput?.click();
});

async function searchBiblioses() {
    if (!bibliosesResults) return;
    const query = String(bibliosesSearchInput?.value || '').trim();
    bibliosesResults.replaceChildren();
    showBibliosesStatus('Consultando Biblioses…');
    try {
        const response = await fetch(`/api/biblioses/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Biblioses respondió ${response.status}`);
        const data = await response.json();
        const books = Array.isArray(data.books) ? data.books : [];
        showBibliosesStatus(books.length ? `${books.length} libros disponibles` : 'No se encontraron libros.', true);
        books.forEach(book => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'flex w-full items-center gap-3 rounded-xl border border-[#E8E0D6] bg-white p-3 text-left hover:border-[#8E4E00] hover:bg-[#FFF9F2]';
            const cover = document.createElement('div');
            cover.className = 'flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-[#F0E8DD] text-[#8E4E00]';
            if (book.coverUrl) {
                const image = document.createElement('img');
                image.src = book.coverUrl;
                image.alt = '';
                image.className = 'h-full w-full object-cover';
                cover.appendChild(image);
            } else {
                cover.textContent = 'EPUB';
            }
            const text = document.createElement('span');
            text.className = 'min-w-0 flex-1';
            const title = document.createElement('strong');
            title.className = 'block truncate text-sm text-[#2C1810]';
            title.textContent = book.title || 'Sin título';
            const author = document.createElement('small');
            author.className = 'block truncate text-xs text-[#82746F]';
            author.textContent = book.author || 'Autor desconocido';
            text.append(title, author);
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined text-[#8E4E00]';
            icon.textContent = 'download';
            row.append(cover, text, icon);
            row.addEventListener('click', () => importBibliosesBook(book));
            bibliosesResults.appendChild(row);
        });
    } catch (error) {
        console.error('[Biblioses] No se pudo consultar el catálogo:', error);
        showBibliosesStatus('No se pudo consultar Biblioses. Revisa el terminal de ListenBook.', true);
    }
}

async function importBibliosesBook(book) {
    if (!book?.downloadUrl || !fileInput) return;
    showBibliosesStatus(`Descargando «${book.title || 'EPUB'}»…`);
    try {
        const response = await fetch(`/api/biblioses/download?url=${encodeURIComponent(book.downloadUrl)}`);
        if (!response.ok) throw new Error(`Descarga respondió ${response.status}`);
        const blob = await response.blob();
        const safeName = String(book.title || 'biblioses-book').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'biblioses-book';
        const file = new File([blob], `${safeName}.epub`, { type: 'application/epub+zip' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
        closeNewBookSourceChooser();
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
        console.error('[Biblioses] No se pudo importar el EPUB:', error);
        showBibliosesStatus('No se pudo descargar el EPUB seleccionado.', true);
    }
}

newBookBibliosesOption?.addEventListener('click', () => {
    newBookSourceOptions?.classList.add('hidden');
    bibliosesBrowser?.classList.remove('hidden');
    searchBiblioses();
});
bibliosesSearchButton?.addEventListener('click', searchBiblioses);
bibliosesSearchInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') searchBiblioses();
});

// Biblioteca local: metadatos en localStorage y el EPUB en IndexedDB.
const BOOKS_STORAGE_KEY = 'listenbook.library.books.v1';
const BOOK_DB_NAME = 'listenbook-library';
const BOOK_FILE_STORE = 'files';
let bookDbPromise = null;

function readStoredBooks() {
    try {
        const value = JSON.parse(localStorage.getItem(BOOKS_STORAGE_KEY) || '[]');
        return Array.isArray(value) ? value : [];
    } catch (error) {
        console.warn('[Biblioteca] No se pudieron leer los libros:', error);
        return [];
    }
}

function writeStoredBooks(books) {
    try { localStorage.setItem(BOOKS_STORAGE_KEY, JSON.stringify(books)); }
    catch (error) { console.warn('[Biblioteca] No se pudieron guardar los libros:', error); }
}

async function serverLibraryRequest(path, options = {}) {
    const response = await fetch(path, { cache: 'no-store', ...options });
    if (!response.ok) throw new Error(`Servidor de biblioteca respondió ${response.status}`);
    return response;
}

async function persistBookToServer(record, file = null) {
    if (!record || !record.id) return false;
    try {
        await serverLibraryRequest(`/api/library/records/${encodeURIComponent(record.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record)
        });
        if (file) {
            await serverLibraryRequest(`/api/library/files/${encodeURIComponent(record.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/epub+zip' },
                body: file
            });
        }
        return true;
    } catch (error) {
        console.warn('[Biblioteca] No se pudo sincronizar el libro con el servidor:', error);
        return false;
    }
}

async function deleteBookFromServer(id) {
    try {
        await serverLibraryRequest(`/api/library/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (error) { console.warn('[Biblioteca] No se pudo borrar el libro del servidor:', error); }
}

async function syncLibraryWithServer() {
    try {
        const response = await serverLibraryRequest('/api/library');
        const serverBooks = await response.json();
        if (!Array.isArray(serverBooks)) return readStoredBooks();
        const localBooks = readStoredBooks();
        const serverKeys = new Set(serverBooks.map(book => book.id));
        const serverBookKeys = new Set(serverBooks.map(book => book.bookKey || `${normalizeBookIdentity(book.title)}|${normalizeBookIdentity(book.author)}`));
        for (const localBook of localBooks) {
            if (serverKeys.has(localBook.id) || serverBookKeys.has(localBook.bookKey)) continue;
            const file = await readBookFile(localBook.id);
            if (file && await persistBookToServer(localBook, file)) {
                serverBooks.push(localBook);
                serverKeys.add(localBook.id);
                serverBookKeys.add(localBook.bookKey);
            }
        }
        writeStoredBooks(serverBooks);
        serverBooks.forEach(book => applyBookToShelf(book));
        return serverBooks;
    } catch (error) {
        console.warn('[Biblioteca] Servidor central no disponible; se usa la copia local:', error);
        return readStoredBooks();
    }
}

function createBookId() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (error) {}
    return `book-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function openBookDatabase() {
    if (bookDbPromise) return bookDbPromise;
    if (!window.indexedDB) return Promise.resolve(null);
    bookDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(BOOK_DB_NAME, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(BOOK_FILE_STORE)) request.result.createObjectStore(BOOK_FILE_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }).catch(error => { console.warn('[Biblioteca] IndexedDB no disponible:', error); return null; });
    return bookDbPromise;
}

async function storeBookFile(id, file) {
    try {
        const db = await openBookDatabase();
        if (!db) return false;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(BOOK_FILE_STORE, 'readwrite');
            tx.objectStore(BOOK_FILE_STORE).put(file, id);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        return true;
    } catch (error) { console.warn('[Biblioteca] No se pudo guardar el EPUB:', error); return false; }
}

async function readBookFile(id) {
    try {
        const db = await openBookDatabase();
        const localFile = db ? await new Promise((resolve, reject) => {
            const tx = db.transaction(BOOK_FILE_STORE, 'readonly');
            const request = tx.objectStore(BOOK_FILE_STORE).get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        }) : null;
        try {
            const response = await fetch(`/api/library/files/${encodeURIComponent(id)}`, { cache: 'no-store' });
            if (response.ok) {
                const blob = await response.blob();
                const remoteFile = new File([blob], `${id}.epub`, { type: 'application/epub+zip' });
                await storeBookFile(id, remoteFile);
                return remoteFile;
            }
        } catch (error) { /* permite continuar con la copia local */ }
        return localFile || null;
    } catch (error) { console.warn('[Biblioteca] No se pudo leer el EPUB:', error); return null; }
}

async function removeBookFile(id) {
    try {
        const db = await openBookDatabase();
        if (!db) return;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(BOOK_FILE_STORE, 'readwrite');
            tx.objectStore(BOOK_FILE_STORE).delete(id);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (error) { console.warn('[Biblioteca] No se pudo borrar el EPUB:', error); }
}

function escapeBookText(value) {
    return String(value || '').replace(/[&<>\'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function rgbToHex(red, green, blue) {
    return `#${[red, green, blue].map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

function darkenHex(hex, factor = 0.62) {
    const match = String(hex || '').match(/^#([\da-f]{6})$/i);
    if (!match) return '#5B2D12';
    const rgb = [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16));
    return rgbToHex(rgb[0] * factor, rgb[1] * factor, rgb[2] * factor);
}

function getShelfColorFromCover(coverDataUrl) {
    return new Promise(resolve => {
        if (!coverDataUrl || typeof Image === 'undefined') return resolve('#8E4E00');
        const image = new Image();
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const size = 48;
                canvas.width = size;
                canvas.height = size;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (!context) return resolve('#8E4E00');
                context.drawImage(image, 0, 0, size, size);
                const pixels = context.getImageData(0, 0, size, size).data;
                const bins = new Map();
                for (let index = 0; index < pixels.length; index += 4) {
                    const alpha = pixels[index + 3];
                    if (alpha < 180) continue;
                    const red = pixels[index];
                    const green = pixels[index + 1];
                    const blue = pixels[index + 2];
                    const max = Math.max(red, green, blue);
                    const min = Math.min(red, green, blue);
                    const saturation = max ? (max - min) / max : 0;
                    const brightness = (red + green + blue) / 3;
                    if (brightness > 242 || brightness < 18) continue;
                    const key = [red, green, blue].map(channel => Math.round(channel / 32) * 32).join(',');
                    const current = bins.get(key) || { score: 0, red: 0, green: 0, blue: 0, count: 0 };
                    const weight = 1 + saturation * 2;
                    current.score += weight;
                    current.red += red * weight;
                    current.green += green * weight;
                    current.blue += blue * weight;
                    current.count += weight;
                    bins.set(key, current);
                }
                const best = Array.from(bins.values()).sort((a, b) => b.score - a.score)[0];
                resolve(best ? rgbToHex(best.red / best.count, best.green / best.count, best.blue / best.count) : '#8E4E00');
            } catch (error) { resolve('#8E4E00'); }
        };
        image.onerror = () => resolve('#8E4E00');
        image.src = coverDataUrl;
    });
}

function shelfSlots() {
    return Array.from(document.querySelectorAll('#shelf-dropzone-target .realistic-shelf-cluster > .tight-book'))
        .filter(slot => slot.id !== 'btn-shelf-add');
}

function normalizeBookIdentity(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

async function getBookFileHash(file) {
    try {
        if (!window.crypto?.subtle) return '';
        const buffer = await file.arrayBuffer();
        const digest = await window.crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        console.warn('[Biblioteca] No se pudo calcular la identidad del EPUB:', error);
        return '';
    }
}

function bookLengthMetric(record) {
    if (Number(record.chapterCount) > 0) return Number(record.chapterCount);
    if (Number(record.fileSize) > 0) return Math.max(1, Math.round(Number(record.fileSize) / 100000));
    return 1;
}

function getShelfDimensions(record) {
    const books = readStoredBooks();
    const metrics = books.map(bookLengthMetric);
    const min = Math.min(...metrics, bookLengthMetric(record));
    const max = Math.max(...metrics, bookLengthMetric(record));
    const range = max - min;
    const relativeLength = range > 0 ? (bookLengthMetric(record) - min) / range : 0.5;
    // Altura principal según longitud y una pequeña variación estable para empates.
    const tieVariation = ((Number(record.slotIndex) || 0) % 5) * 0.025;
    const normalized = Math.max(0, Math.min(1, relativeLength * 0.85 + tieVariation));
    return {
        width: Math.round(56 + normalized * 18),
        height: Math.round(292 + normalized * 64)
    };
}

function initializeShelfSlots() {
    shelfSlots().forEach((slot, index) => {
        if (!slot.dataset.listenbookSlot) slot.dataset.listenbookSlot = String(index);
        if (!slot.dataset.listenbookDefaultCaptured) {
            slot.__listenbookDefaultHTML = slot.innerHTML;
            slot.__listenbookDefaultBookId = slot.dataset.bookId || '';
            slot.__listenbookDefaultTitle = slot.getAttribute('title') || '';
            slot.__listenbookDefaultClassName = slot.className;
            slot.dataset.listenbookDefaultCaptured = 'true';
        }
    });
}

function createExtraShelfSlot(index) {
    const cluster = document.querySelector('#shelf-dropzone-target .realistic-shelf-cluster');
    const addSlot = document.getElementById('btn-shelf-add');
    if (!cluster || !addSlot) return null;
    const slot = document.createElement('div');
    slot.className = 'tight-book group relative';
    slot.dataset.listenbookSlot = String(index);
    slot.dataset.listenbookDynamic = 'true';
    cluster.insertBefore(slot, addSlot);
    return slot;
}

function getShelfSlotForRecord(record) {
    initializeShelfSlots();
    return shelfSlots().find(slot => slot.dataset.listenbookSlot === String(record.slotIndex)) || createExtraShelfSlot(record.slotIndex);
}

function applyBookToShelf(record) {
    const slot = getShelfSlotForRecord(record);
    if (!slot) return null;
    const title = record.title || record.name.replace(/\.epub$/i, '') || 'EPUB';
    const author = record.author || 'Autor desconocido';
    const shelfColor = record.shelfColor || '#8E4E00';
    const shelfColorDark = darkenHex(shelfColor);
    const dimensions = getShelfDimensions(record);
    const cover = record.cover ? `<img src="${escapeBookText(record.cover)}" alt="" class="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-screen pointer-events-none">` : '';
    slot.className = `${slot.className.replace(/\bhidden\b/g, '').trim()} relative`;
    slot.dataset.listenbookUserBook = 'true';
    slot.dataset.listenbookBookId = record.id;
    slot.dataset.bookId = record.id;
    slot.setAttribute('title', `Abrir ${title}`);
    slot.innerHTML = `
        <div class="tome-body w-14 sm:w-16 md:w-[70px] h-72 sm:h-80 md:h-[336px] rounded-t-[3px] flex flex-col justify-between py-4 px-2 relative overflow-hidden transition-all duration-300" style="width: ${dimensions.width}px; height: ${dimensions.height}px; background: linear-gradient(180deg, ${escapeBookText(shelfColor)} 0%, ${escapeBookText(shelfColorDark)} 100%); box-shadow: -2px 2px 7px rgba(44,24,16,0.18), inset 1.5px 0 2px rgba(255,255,255,0.18), inset -2px 0 3px rgba(0,0,0,0.35);">
            ${cover}
            <div class="w-full h-1 bg-[#F5ECE1]/40 rounded-full relative z-[1]"></div>
            <div class="flex-1 flex flex-col items-center justify-center my-3 overflow-hidden relative z-[1]"><span class="font-headline-sm text-[#F7F2EB] text-xs sm:text-[13px] tracking-widest uppercase [writing-mode:vertical-rl] rotate-180 font-serif drop-shadow-xs truncate max-h-full">${escapeBookText(title)}</span><span class="font-label-sm text-[#E2C7BE] text-[9px] [writing-mode:vertical-rl] rotate-180 uppercase tracking-wider mt-2.5 truncate max-h-20">${escapeBookText(author)}</span></div>
            <div class="flex flex-col items-center gap-1.5 relative z-[1]"><span class="material-symbols-outlined text-[#F5ECE1]/70 text-xs">auto_stories</span><div class="w-5 h-0.5 bg-[#F5ECE1]/30 rounded-full"></div></div>
        </div>
        <div class="absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] font-label-sm font-semibold uppercase tracking-wider text-[#2C1810] px-2.5 py-0.5 rounded bg-white border border-[#E0D8CB] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm">Abrir tomo</div>
        <button type="button" data-listenbook-delete="${escapeBookText(record.id)}" aria-label="Eliminar ${escapeBookText(title)}" class="absolute -top-3 -right-3 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-[#E0D8CB] bg-white text-[#8E4E00] opacity-0 shadow-md transition-opacity group-hover:opacity-100 hover:bg-[#8E4E00] hover:text-white"><span class="material-symbols-outlined text-[16px]">delete</span></button>`;
    return slot;
}

function restoreShelfSlot(record) {
    const slot = shelfSlots().find(candidate => candidate.dataset.listenbookBookId === record.id);
    if (!slot) return;
    if (slot.dataset.listenbookDynamic === 'true') { slot.remove(); return; }
    slot.innerHTML = slot.__listenbookDefaultHTML || '';
    slot.className = slot.__listenbookDefaultClassName || 'tight-book group';
    slot.dataset.bookId = slot.__listenbookDefaultBookId || '';
    delete slot.dataset.listenbookUserBook;
    delete slot.dataset.listenbookBookId;
    slot.setAttribute('title', slot.__listenbookDefaultTitle || '');
}

function findNextBookSlot(books) {
    const used = new Set(books.map(book => Number.isInteger(book.slotIndex) ? book.slotIndex : -1));
    let index = 0;
    while (used.has(index)) index += 1;
    return index;
}

async function saveBookInLibrary(file, ebook, existingId = null) {
    const books = readStoredBooks();
    const previous = existingId ? books.find(book => book.id === existingId) : null;
    const title = ebook.titulo || file.name.replace(/\.epub$/i, '');
    const author = ebook.autor || '';
    const bookKey = `${normalizeBookIdentity(title)}|${normalizeBookIdentity(author)}`;
    const fileHash = await getBookFileHash(file);
    const duplicate = books.find(book => {
        if (book.id === existingId) return false;
        const sameHash = fileHash && book.fileHash && fileHash === book.fileHash;
        const storedKey = book.bookKey || `${normalizeBookIdentity(book.title)}|${normalizeBookIdentity(book.author)}`;
        return sameHash || (bookKey !== '|' && storedKey === bookKey);
    });
    if (duplicate) {
        applyBookToShelf(duplicate);
        window.__listenbookCurrentBookId = duplicate.id;
        await persistBookToServer(duplicate, await readBookFile(duplicate.id));
        return { record: duplicate, duplicate: true };
    }
    const shelfColor = await getShelfColorFromCover(ebook.portada || '');
    const record = { id: existingId || createBookId(), name: file.name, title, author, bookKey, fileHash, fileSize: file.size || 0, chapterCount: previous?.chapterCount || 0, cover: ebook.portada || '', shelfColor, slotIndex: previous && Number.isInteger(previous.slotIndex) ? previous.slotIndex : findNextBookSlot(books), createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    writeStoredBooks(previous ? books.map(book => book.id === record.id ? record : book) : [...books, record]);
    await storeBookFile(record.id, file);
    await persistBookToServer(record, file);
    applyBookToShelf(record);
    window.__listenbookCurrentBookId = record.id;
    return { record, duplicate: false };
}

function updateStoredBookMetrics(id, chapterCount, fileSize) {
    if (!id) return;
    const books = readStoredBooks();
    const record = books.find(book => book.id === id);
    if (!record) return;
    if (Number(chapterCount) > 0) record.chapterCount = Number(chapterCount);
    if (Number(fileSize) > 0) record.fileSize = Number(fileSize);
    writeStoredBooks(books);
    books.forEach(book => applyBookToShelf(book));
    const updated = books.find(book => book.id === id);
    if (updated) persistBookToServer(updated).catch(() => {});
}

async function deleteStoredBook(id) {
    if (!id) return;
    const books = readStoredBooks();
    const record = books.find(book => book.id === id);
    if (!record) return;
    writeStoredBooks(books.filter(book => book.id !== id));
    await removeBookFile(id);
    await deleteBookFromServer(id);
    restoreShelfSlot(record);
    if (window.__listenbookCurrentBookId === id) { window.__listenbookCurrentBookId = null; window.__listenbookEbook = null; window.__listenbookChapterData = null; }
}

async function confirmDeleteLoadedBook() {
    const id = window.__listenbookCurrentBookId;
    const record = readStoredBooks().find(book => book.id === id);
    if (!record) return;
    let confirmed = false;
    if (typeof Swal !== 'undefined') {
        const result = await Swal.fire({
            icon: 'warning',
            title: '¿Eliminar este tomo?',
            text: `Se eliminará «${record.title || record.name || 'este libro'}» y sus datos guardados de ListenBook.`,
            showCancelButton: true,
            confirmButtonText: 'Eliminar tomo',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#A23D33',
            cancelButtonColor: '#82746F'
        });
        confirmed = result.isConfirmed;
    } else {
        confirmed = window.confirm(`¿Eliminar «${record.title || record.name || 'este libro'}»?`);
    }
    if (!confirmed) return;
    await deleteStoredBook(id);
    showShelfView();
}

async function openStoredBook(record) {
    if (!fileInput || !record) return;
    const stored = await readBookFile(record.id);
    if (!stored) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'Archivo no disponible', text: 'Este tomo sigue registrado, pero su EPUB ya no está disponible en el navegador.' });
        return;
    }
    try {
        const file = stored instanceof File ? stored : new File([stored], record.name, { type: 'application/epub+zip' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        window.__listenbookOpeningStoredBook = record.id;
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
        console.error('[Biblioteca] No se pudo abrir el tomo:', error);
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'No se pudo abrir el tomo', text: 'El navegador no ha podido preparar el EPUB guardado.' });
    }
}

async function restoreStoredBooksOnShelf() {
    initializeShelfSlots();
    const books = readStoredBooks();
    let changed = false;
    books.forEach(record => {
        if (!Number.isInteger(record.slotIndex)) {
            record.slotIndex = findNextBookSlot(books);
            changed = true;
        }
        applyBookToShelf(record);
        if (!record.shelfColor && record.cover) {
            getShelfColorFromCover(record.cover).then(color => {
                const currentBooks = readStoredBooks();
                const current = currentBooks.find(book => book.id === record.id);
                if (!current || current.shelfColor) return;
                current.shelfColor = color;
                writeStoredBooks(currentBooks);
                applyBookToShelf(current);
            });
        }
        if (!record.fileSize) {
            readBookFile(record.id).then(file => {
                if (file && file.size) updateStoredBookMetrics(record.id, record.chapterCount, file.size);
            });
        }
    });
    if (changed) writeStoredBooks(books);
    await syncLibraryWithServer();
}

const shelfStage = document.getElementById('shelf-dropzone-target');
if (shelfStage) {
    shelfStage.addEventListener('click', event => {
        const deleteButton = event.target.closest('[data-listenbook-delete]');
        if (deleteButton) { event.preventDefault(); event.stopImmediatePropagation(); deleteStoredBook(deleteButton.dataset.listenbookDelete).catch(error => console.error('[Biblioteca] Error eliminando tomo:', error)); return; }
        const book = event.target.closest('.tight-book[data-listenbook-user-book="true"]');
        if (book) {
            const record = readStoredBooks().find(item => item.id === book.dataset.listenbookBookId);
            if (!record) return;
            event.preventDefault(); event.stopImmediatePropagation(); openStoredBook(record);
            return;
        }
        // El resto de los tomos son material de ejemplo. Se mantienen sus
        // efectos visuales, pero el clic no debe alcanzar el controlador del
        // prototipo que abre el tomo de demostración.
        const exampleBook = event.target.closest('.tight-book:not(#btn-shelf-add)');
        if (exampleBook) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
}
restoreStoredBooksOnShelf().catch(error => console.warn('[Biblioteca] No se pudo sincronizar la estantería:', error));

if (reuploadButton && fileInput) {
    reuploadButton.addEventListener('click', () => fileInput.click());
}
if (deleteLoadedBookButton) {
    deleteLoadedBookButton.addEventListener('click', confirmDeleteLoadedBook);
}
if (deleteLoadedBookStatButton) {
    deleteLoadedBookStatButton.addEventListener('click', confirmDeleteLoadedBook);
}
if (coverActionHint) {
    coverActionHint.addEventListener('click', () => {
        const cover = document.querySelector('#portada_display img');
        if (cover) cover.click();
    });
}
if (backToMainButton) {
    backToMainButton.addEventListener('click', () => {
        const downloads = document.getElementById('downloads_section');
        const workspace = document.getElementById('configuracion_section');
        if (downloads) downloads.style.display = 'none';
        if (workspace) workspace.style.display = 'block';
    });
}
// Directory upload elements (hidden input + trigger button)
const dirInput = document.getElementById('dir-upload');
const dirUploadBtn = document.getElementById('dir-upload-btn');
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

// Set media metadata for lock-screen / notification controls using the Media Session API when available
function setMediaSessionMetadata(bookTitle, chapterTitle, artworkUrl, filename) {
    try {
        if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
        const meta = {
            title: chapterTitle || filename || 'ListenBook',
            artist: bookTitle || '',
            album: bookTitle || '',
            artwork: []
        };
        if (artworkUrl) {
            // include a few common sizes; the browser picks the best one
            meta.artwork.push({ src: artworkUrl, sizes: '512x512', type: 'image/png' });
            meta.artwork.push({ src: artworkUrl, sizes: '256x256', type: 'image/png' });
            meta.artwork.push({ src: artworkUrl, sizes: '96x96', type: 'image/png' });
        }
        try { navigator.mediaSession.metadata = new MediaMetadata(meta); } catch (e) { /* some browsers require proper types */ }
        try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
        // Optional: wire basic action handlers so the media notification controls work
        try {
            navigator.mediaSession.setActionHandler('play', () => { const ap = document.getElementById('audio_player'); if (ap) ap.play().catch(()=>{}); });
            navigator.mediaSession.setActionHandler('pause', () => { const ap = document.getElementById('audio_player'); if (ap) ap.pause(); });
            navigator.mediaSession.setActionHandler('seekto', (details) => { const ap = document.getElementById('audio_player'); if (ap && details && details.seekTime !== undefined) ap.currentTime = details.seekTime; });
        } catch (e) { /* ignore action handler errors on unsupported browsers */ }
    } catch (e) { console.warn('setMediaSessionMetadata failed', e); }
}

// Playback progress persistence helpers
const __progress = { data: {}, dirHandle: null, storageKeyPrefix: 'listenbook.progress.' };

function makeSafeBookKey(bookTitle) {
    try {
        const tokenRe = /[\p{L}\p{N}]+/gu;
        const tokens = Array.from(String(bookTitle || '').matchAll(tokenRe)).map(m => m[0]);
        const cap = tokens.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join('');
        return cap || String(bookTitle || 'ebook').replace(/[^A-Za-z0-9]/g, '_');
    } catch (e) { return String(bookTitle || 'ebook').replace(/[^A-Za-z0-9]/g, '_'); }
}

async function loadProgressFromHandle(dirHandle) {
    try {
        if (!dirHandle) return {};
        const fh = await dirHandle.getFileHandle('progress.txt').catch(() => null);
        if (!fh) return {};
        const file = await fh.getFile();
        const text = await file.text();
        try { return JSON.parse(text); } catch (e) { return {}; }
    } catch (e) { console.warn('loadProgressFromHandle failed', e); return {}; }
}

async function writeProgressToHandle(dirHandle, data) {
    try {
        if (!dirHandle) return false;
        const fh = await dirHandle.getFileHandle('progress.txt', { create: true });
        const writable = await fh.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
        return true;
    } catch (e) { console.warn('writeProgressToHandle failed', e); return false; }
}

function loadProgressForBook(safeBook) {
    try {
        __progress.data = {};
        const key = __progress.storageKeyPrefix + safeBook;
        const raw = localStorage.getItem(key);
        if (raw) {
            try { __progress.data = JSON.parse(raw); } catch (e) { __progress.data = {}; }
        }
    } catch (e) { __progress.data = {}; }
}

function saveProgressForBook(safeBook) {
    try {
        const key = __progress.storageKeyPrefix + safeBook;
        localStorage.setItem(key, JSON.stringify(__progress.data || {}));
        // also try write to dir handle if available
        if (__progress.dirHandle) writeProgressToHandle(__progress.dirHandle, __progress.data).catch(() => {});
    } catch (e) { console.warn('saveProgressForBook failed', e); }
}

function getSavedPosition(filename) {
    try { return (__progress.data && __progress.data[filename]) ? Number(__progress.data[filename]) : 0; } catch (e) { return 0; }
}

function setSavedPosition(filename, seconds) {
    try {
        __progress.data = __progress.data || {};
        __progress.data[filename] = Math.floor(Number(seconds) || 0);
    } catch (e) {}
}

async function promptAndEnableFolderSaving() {
    try {
        if (!window.showDirectoryPicker) {
            alert('El navegador no soporta escritura directa en carpetas (File System Access API). Se usará localStorage en su lugar.');
            return false;
        }
        const handle = await window.showDirectoryPicker();
        __progress.dirHandle = handle;
        const data = await loadProgressFromHandle(handle);
        __progress.data = Object.assign({}, __progress.data || {}, data || {});
        // write back merged data
        await writeProgressToHandle(handle, __progress.data);
        return true;
    } catch (e) { console.warn('promptAndEnableFolderSaving failed', e); return false; }
}

function exportProgressFile(safeBook) {
    try {
        const blob = new Blob([JSON.stringify(__progress.data || {}, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'progress.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    } catch (e) { console.warn('exportProgressFile failed', e); }
}

// -------------------------
// Debug capture / send
// -------------------------
const ENABLE_DEBUG_CAPTURE = true; // flip to false to disable
const DEBUG_ENDPOINT = PROXY_BASE + '/debug_event';
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

// Generic click capture removed to avoid sending debug events on every user click

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
                const openingStoredBookId = window.__listenbookOpeningStoredBook || null;
                window.__listenbookOpeningStoredBook = null;
                const libraryResult = await saveBookInLibrary(file, ebook, openingStoredBookId);
                if (libraryResult && libraryResult.duplicate) {
                    window.__listenbookEbook = null;
                    window.__listenbookChapterData = null;
                    fileInput.value = '';
                    if (typeof Swal !== 'undefined') {
                        await Swal.fire({ icon: 'info', title: 'Este libro ya está en la estantería', text: 'No se ha añadido una segunda copia.' });
                    }
                    showShelfView();
                    return;
                }
                const libraryRecord = libraryResult && libraryResult.record;
                setTitle(ebook.titulo);
                setAuthor(ebook.autor);
                const img = showCover(ebook.portada, ebook.titulo);

                // La detección se hace al cargar el EPUB para que el libro abierto
                // muestre desde el principio sus capítulos reales y no los del prototipo.
                let chapterData = { all: [], excluded: [] };
                try {
                    showProcessing('Extrayendo capítulos', 'Detectando todos los capítulos del EPUB...');
                    const resultado = await extraerCapitulos(ebook);
                    chapterData = {
                        all: resultado && Array.isArray(resultado.all) ? resultado.all : [],
                        excluded: resultado && Array.isArray(resultado.excluded) ? resultado.excluded : []
                    };
                    window.__listenbookChapterData = chapterData;
                    window.__listenbookEbook = ebook;
                    updateStoredBookMetrics(libraryRecord && libraryRecord.id, chapterData.all.length, file.size);
                    console.info('[EPUB] Capítulos detectados:', chapterData.all.length, chapterData.all.map(chapter => chapter.titulo || chapter.title || chapter.href));
                    try {
                        renderPrototypeChapterSelection(chapterData.all, chapterData.excluded);
                        restoreGeneratedAudioForBook((libraryRecord && libraryRecord.id) || ebook.titulo || ebook.title).catch(error => {
                            console.warn('[EPUB] No se pudieron comprobar los audios ya generados:', error);
                        });
                    } catch (renderError) {
                        console.error('[EPUB] Error mostrando los capítulos detectados:', renderError);
                    }
                    activateConvertEpubMenu();
                    if (!chapterData.all.length && typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'warning', title: 'No se detectaron capítulos', text: 'El EPUB se ha cargado, pero su índice o estructura de lectura no contiene capítulos reconocibles.' });
                    }
                } catch (chapterError) {
                    console.error('[EPUB] No se pudieron detectar los capítulos:', chapterError);
                    try { renderPrototypeChapterSelection([], []); } catch (renderError) { console.error('[EPUB] Error limpiando la lista:', renderError); }
                } finally {
                    closeProcessing();
                }
                if (img) {
                    img.onmouseover = () => img.style.opacity = '0.5';
                    img.onmouseout = () => img.style.opacity = '1';
                    // restore simple click handler on the cover image
                const runSynthesisForChapters = async (seleccionados) => {
                    const allCaps = (window.__listenbookChapterData || { all: [] }).all || [];
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
                            // clear previous downloads for a fresh run
                            try { clearDownloads(); } catch (e) {}

                            // Process each chapter separately (one predict per chapter)
                            for (let ci = 0; ci < (seleccionados || []).length; ci++) {
                                const chap = seleccionados[ci];
                                try {
                                    // Setup per-chapter progress widget
                                    try {
                                        createProgressWidget();
                                        updateProgressWidget({ percent: 0, label: `Cap ${ci+1}/${seleccionados.length} · Esperando el progreso de ComfyUI...` });
                                    } catch (e) { console.warn('progress widget init failed', e); }

                                    // One predict per chapter: pass single chapter
                                    const result = await ejecutarTTS(ebook, [chap], {
                                        comfyuiBase: COMFYUI_BASE,
                                        referenceAudioDataUrl: referenceDataUrl,
                                        // default example audio served from the ListenBook folder
                                        referenceAudioUrl: (function(){
                                            try {
                                                // resolve relative to current page so it works whether Live Server serves ListenBook
                                                return new URL('default_audios/esp_default/narrador_esp.wav', window.location.href).toString();
                                            } catch(e) { return '/default_audios/esp_default/narrador_esp.wav'; }
                                        })(),
                                        clientTimeout: 0,
                                        pollInterval: 1500,
                                        timeout: 1000 * 60 * 10,
                                        onProgress: (status) => {
                                            try{
                                                if (typeof status.percent === 'number') {
                                                    const eta = Number.isFinite(status.etaSeconds)
                                                        ? (status.etaSeconds < 60
                                                            ? `${Math.ceil(status.etaSeconds)} s`
                                                            : `${Math.floor(status.etaSeconds / 60)} min ${Math.ceil(status.etaSeconds % 60)} s`)
                                                        : 'calculando...';
                                                    updateProgressWidget({
                                                        percent: status.percent,
                                                        label: `Cap ${ci+1}/${seleccionados.length} · Restante aprox.: ${eta}`
                                                    });
                                                }
                                            }catch(e){ console.error('progress update err', e); }
                                        }
                                    });

                                    // clear per-chapter progress
                                    try {
                                        if (window.__tts_progress_interval) { clearInterval(window.__tts_progress_interval); window.__tts_progress_interval = null; }
                                        removeProgressWidget();
                                    } catch (e) {}

                                    // Process result for this chapter (same logic as before, but use chap as source for naming)
                                    try {
                                        let normalized = result;
                                        if (typeof normalized === 'string') {
                                            try { normalized = JSON.parse(normalized); console.log('[UI] parsed result string into object'); } catch (e) { console.warn('[UI] result is string but not JSON'); }
                                        }
                                        const files = extractFilesFromResult(normalized || {});
                                        console.log('[UI] extracted files for chapter', ci, files);
                                        try {
                                            if (files && files.length >= 1) {
                                                const f0 = files[0];
                                                const f1 = files[files.length - 1];
                                                function rawPathFromFileObj(f) {
                                                    if (!f) return null;
                                                    if (f.path) return f.path;
                                                    if (f.url) {
                                                        const m = String(f.url).match(/file=(.*)$/);
                                                        if (m && m[1]) return decodeURIComponent(m[1]);
                                                    }
                                                    return null;
                                                }
                                                const path0 = rawPathFromFileObj(f0);
                                                const path1 = rawPathFromFileObj(f1);
                                                const bookTitleRaw = (ebook && (ebook.titulo || ebook.title)) ? (ebook.titulo || ebook.title) : 'ebook';
                                                let chapterName = 'capitulo';
                                                try { chapterName = chap.titulo || chap.title || chapterName; } catch(e){}

                                                try {
                                                    // Instead of moving the file into a permanent outputs folder on the server,
                                                    // trigger a direct download from the proxy which will stream the file and
                                                    // delete it on the server after the transfer completes. This avoids leaving
                                                    // permanent copies on the host machine.
                                                    try {
                                                        // Build a default safe filename in the format:
                                                        // Titulo_Del_Libro_Nombre_Capitulo_XX_YYYYMMDD.mp3
                                                        // Create TitleCase concatenated tokens (no separators) for book and chapter
                                                        function makeTitleConcat(s) {
                                                            try {
                                                                const tokenRe = /[\p{L}\p{N}]+/gu;
                                                                const tokens = Array.from(String(s || '').matchAll(tokenRe)).map(m => m[0]);
                                                                const joined = tokens.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join('');
                                                                return joined || String(s || '').replace(/[^A-Za-z0-9]/g,'');
                                                            } catch (e) { return String(s || '').replace(/[^A-Za-z0-9]/g,''); }
                                                        }
                                                        const bookSafePart = makeTitleConcat(bookTitleRaw || 'Libro');
                                                        const chapterSafePart = makeTitleConcat(chapterName || ('Capitulo' + (ci+1)));
                                                        // Determine chapter order: prefer explicit chap.numero/number (absolute position in book), fallback to loop index
                                                        const chapterOrder = (chap && (chap.numero || chap.number)) ? (chap.numero || chap.number) : (function(){
                                                            try {
                                                                if (typeof allCaps !== 'undefined' && Array.isArray(allCaps)) {
                                                                    const list = allCaps;
                                                                    const titleA = (chap && (chap.titulo || chap.title) ? (chap.titulo || chap.title).toString().trim() : null);
                                                                    if (titleA) {
                                                                        const idx = list.findIndex(c => {
                                                                            try { return (c && (c.titulo || c.title) ? (c.titulo || c.title).toString().trim() : '') === titleA; } catch (e) { return false; }
                                                                        });
                                                                        if (idx >= 0) return idx + 1;
                                                                    }
                                                                }
                                                            } catch (e) {}
                                                            return (ci + 1);
                                                        })();
                                                        const orderPart = String(chapterOrder); // no zero-padding per request
                                                        const fecha = (new Date()).toISOString().slice(0,10).replace(/-/g,'');
                                                        const suggested = `${bookSafePart}_${chapterSafePart}_${orderPart}_${fecha}.mp3`;

                                                        const generatedAudio = files[files.length - 1] || files[0];
                                                        const chapterAbsoluteIndex = allCaps.indexOf(chap) >= 0
                                                            ? allCaps.indexOf(chap)
                                                            : Math.max(0, (Number(chap && (chap.index || chap.numero || chap.number)) || 1) - 1);
                                                        markChapterGenerated(chapterAbsoluteIndex, {
                                                            url: generatedAudio.url,
                                                            filename: generatedAudio.filename || suggested
                                                        }, (window.__listenbookCurrentBookId || bookTitleRaw));
                                                        addDownloadLink(generatedAudio.url, generatedAudio.filename || suggested);
                                                        console.info('[UI] Audio generado y marcado en el capítulo:', chapterName, generatedAudio.url);
                                                    } catch (e) {
                                                        console.error('generated audio registration failed', e);
                                                    }
                                                } catch (e) { console.error('finalize error', e); try { await fetchAndShowOutputsDir(); } catch (e2) {} }
                                            } else if (files && files.length === 1) {
                                                try { await fetchAndShowOutputsDir(); } catch (e) { /* ignore */ }
                                            } else {
                                                console.warn('[UI] no files found in result for chapter', ci);
                                                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: `No se encontraron audios generados para el capítulo ${ci+1}.` });
                                            }
                                        } catch (e) {
                                            console.error('Error processing files for delete/rename', e);
                                        }
                                    } catch (e) {
                                        console.error('Error procesando resultado TTS para descargas', e);
                                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'La generación finalizó pero no se pudieron procesar los archivos.' });
                                    }

                                    // Refresh downloads listing after each chapter
                                    try { await fetchAndShowOutputsDir(); } catch (e) { console.warn('fetchAndShowOutputsDir failed', e); }
                                } catch (errChapter) {
                                    try { if (window.__tts_progress_interval) { clearInterval(window.__tts_progress_interval); window.__tts_progress_interval = null; } removeProgressWidget(); } catch(e){}
                                    try {
                                        console.error('Error ejecutando TTS para capítulo', ci, errChapter);
                                        console.error('Error ejecutando TTS (JSON):', JSON.stringify(errChapter, Object.getOwnPropertyNames(errChapter), 2));
                                    } catch (e) { console.error('Error serializing error object', e, errChapter); }
                                    if (typeof Swal !== 'undefined') {
                                        const detail = (errChapter && (errChapter.message || errChapter.details || errChapter.toString())) ? (errChapter.message || errChapter.details || errChapter.toString()) : 'Error desconocido';
                                        const small = String(detail).slice(0, 1000);
                                        Swal.fire({ icon: 'error', title: 'Error', html: `<pre style="text-align:left; white-space:pre-wrap; word-break:break-word">${small}</pre>` });
                                    }
                                }
                            }
                        } catch (err) {
                            try { if (window.__tts_progress_interval) { clearInterval(window.__tts_progress_interval); window.__tts_progress_interval = null; } removeProgressWidget(); } catch(e){}
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

                img.onclick = async () => {
                    console.log('[UI] cover image clicked — executing handler');
                    const resultado = window.__listenbookChapterData || { all: [], excluded: [] };
                    const allCaps = resultado.all || [];
                    const excluded = resultado.excluded || [];
                    const seleccionados = await showChapterSelectionModal(
                        allCaps,
                        excluded,
                        (ebook && (ebook.titulo || ebook.title)) ? (ebook.titulo || ebook.title) : null
                    );
                    if (!seleccionados) {
                        console.log('Selección cancelada');
                        return;
                    }
                    console.log('Capítulos seleccionados:', seleccionados);
                    await runSynthesisForChapters(seleccionados);
                };

                const startSynthesisBtn = document.getElementById('startSynthesisBtn');
                if (startSynthesisBtn) {
                    if (startSynthesisBtn.__listenbookSynthesisHandler) {
                        startSynthesisBtn.removeEventListener('click', startSynthesisBtn.__listenbookSynthesisHandler);
                    }
                    const synthesisHandler = async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const allCaps = (window.__listenbookChapterData || { all: [] }).all || [];
                        const chapterInputs = Array.from(document.querySelectorAll('#bookOpenVolume .chapter-cb'));
                        const seleccionados = chapterInputs
                            .filter(input => input.checked && !input.disabled)
                            .map(input => allCaps[Number(input.dataset.index)])
                            .filter(Boolean);
                        if (!seleccionados.length) {
                            if (typeof Swal !== 'undefined') {
                                await Swal.fire({
                                    icon: 'warning',
                                    title: 'No hay capítulos seleccionados',
                                    text: 'Marca al menos un capítulo antes de iniciar la síntesis.'
                                });
                            }
                            return;
                        }
                        console.log('[UI] startSynthesisBtn — capítulos seleccionados:', seleccionados);
                        await runSynthesisForChapters(seleccionados);
                    };
                    startSynthesisBtn.__listenbookSynthesisHandler = synthesisHandler;
                    startSynthesisBtn.addEventListener('click', synthesisHandler);
                }

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

// Handle directory-picker button (opens picker) and directory selection behavior
try {
    if (dirUploadBtn && dirInput) {
        dirUploadBtn.addEventListener('click', (ev) => { ev.preventDefault(); try { dirInput.click(); } catch (e) {} });
    }
    if (dirInput) {
        dirInput.addEventListener('change', (ev) => {
            try {
                const files = dirInput.files;
                if (!files || files.length === 0) return;
                const header = document.getElementById('header_container');
                const reproducir = document.getElementById('reproducir_section');
                if (header) header.style.display = 'none';
                if (reproducir) reproducir.style.display = 'block';
                try { sendDebugEvent({ type: 'dir_selected', count: files.length }); } catch (e) {}

                // Look for an EPUB in the selected directory and, if found, parse metadata and chapters
                (async () => {
                    try {
                        const fileArr = Array.from(files || []);
                        const epubFile = fileArr.find(f => /\.epub$/i.test(f.name));
                        if (!epubFile) {
                            console.warn('[dir] no EPUB found in selected directory');
                            return;
                        }
                        // Parse EPUB metadata
                        const ebook = new Ebook(epubFile);
                        try { showProcessing('Procesando carpeta', 'Extrayendo metadatos del EPUB...'); } catch(e){}
                        await ebook.parse();
                        try { closeProcessing(); } catch(e){}

                        // Set cover and title in the reproducir area
                        try {
                            const coverEl = document.getElementById('reproducir_cover');
                            const titleEl = document.getElementById('reproducir_titulo');
                            if (coverEl) {
                                if (ebook.portada) coverEl.src = ebook.portada;
                                else coverEl.removeAttribute('src');
                            }
                            if (titleEl) titleEl.textContent = ebook.titulo || ebook.title || epubFile.name;
                        } catch (e) { console.warn('[dir] failed to set cover/title', e); }

                        // Extract chapters (use filtered list to mimic selection elsewhere)
                        let caps = [];
                        try {
                            showProcessing('Extrayendo capítulos', 'Por favor espera...');
                            const resultado = await extraerCapitulos(ebook);
                            caps = (resultado && resultado.filtered && resultado.filtered.length) ? resultado.filtered : (resultado.all || []);
                            window.__listenbookChapterData = {
                                all: resultado && Array.isArray(resultado.all) ? resultado.all : caps,
                                excluded: resultado && Array.isArray(resultado.excluded) ? resultado.excluded : []
                            };
                            renderPrototypeChapterSelection(window.__listenbookChapterData.all, window.__listenbookChapterData.excluded);
                        } catch (e) { console.warn('[dir] extraerCapitulos failed', e); }
                        try { closeProcessing(); } catch(e){}

                        // Build map of available WAVs in the directory: key -> File
                        // key format: `${chapterToken}__${order}` when order is present, otherwise `${chapterToken}__` for legacy
                        const wavMap = new Map();
                        for (const f of fileArr) {
                            try {
                                if (!f || !f.name) continue;
                                if (!/\.wav$/i.test(f.name)) continue;
                                const name = String(f.name);
                                // try new format: <Book>_<ChapterToken>_<Order>_<YYYYMMDD>.wav
                                const mWithOrder = name.match(/^[^_]*_([^_]*)_(\d+)_/);
                                if (mWithOrder && mWithOrder[1]) {
                                    const token = mWithOrder[1];
                                    const order = mWithOrder[2];
                                    wavMap.set(`${token}__${order}`, f);
                                    continue;
                                }
                                // legacy fallback: extract token between first and second underscore
                                const mLegacy = name.match(/^[^_]*_([^_]*)_/);
                                if (mLegacy && mLegacy[1]) {
                                    wavMap.set(`${mLegacy[1]}__`, f);
                                }
                            } catch (e) { /* ignore file errors */ }
                        }

                        // Prepare chapter list container under reproducir_section
                        // also prepare progress storage for this book
                        const safeBook = makeSafeBookKey(ebook && (ebook.titulo || ebook.title) ? (ebook.titulo || ebook.title) : epubFile.name);
                        loadProgressForBook(safeBook);
                        let chaptersContainer = document.getElementById('reproducir_chapters');
                        if (!chaptersContainer) {
                            chaptersContainer = document.createElement('div');
                            chaptersContainer.id = 'reproducir_chapters';
                            chaptersContainer.classList.add('section_secundaria');
                            chaptersContainer.style.marginTop = '12px';
                            chaptersContainer.style.maxHeight = '40vh';
                            chaptersContainer.style.overflow = 'auto';
                            const parent = reproducir || document.getElementById('header_container');
                            if (reproducir && reproducir.parentNode) reproducir.parentNode.insertBefore(chaptersContainer, reproducir.nextSibling);
                            else document.body.appendChild(chaptersContainer);
                        } else {
                            chaptersContainer.innerHTML = '';
                        }

                        // Add progress controls (enable folder saving / export)
                        const controlsBar = document.createElement('div');
                        controlsBar.style.display = 'flex';
                        controlsBar.style.gap = '8px';
                        controlsBar.style.alignItems = 'center';
                        controlsBar.style.marginBottom = '8px';
                        const enableSaveBtn = document.createElement('button');
                        enableSaveBtn.type = 'button';
                        enableSaveBtn.textContent = 'Guardar progreso en carpeta';
                        enableSaveBtn.addEventListener('click', async (ev) => {
                            ev.preventDefault();
                            try {
                                const ok = await promptAndEnableFolderSaving();
                                if (ok) alert('Acceso concedido. El progreso se guardará en la carpeta seleccionada.');
                                else alert('No se pudo activar el guardado en carpeta.');
                            } catch (e) { console.warn('enableSave failed', e); alert('Error al activar guardado en carpeta'); }
                        });
                        const exportBtn = document.createElement('button');
                        exportBtn.type = 'button';
                        exportBtn.textContent = 'Exportar progress.txt';
                        exportBtn.addEventListener('click', (ev) => { ev.preventDefault(); try { exportProgressFile(safeBook); } catch (e) { console.warn(e); } });
                        controlsBar.appendChild(enableSaveBtn);
                        controlsBar.appendChild(exportBtn);
                        chaptersContainer.appendChild(controlsBar);

                        // Audio player element
                        const audioPlayer = document.getElementById('audio_player');
                        let currentObjectUrl = null;

                        // Persist current position on pause/ended and beforeunload
                        try {
                            audioPlayer.addEventListener('pause', async () => {
                                try {
                                    const fname = audioPlayer && audioPlayer.src ? (audioPlayer._playingFileName || null) : null;
                                    if (fname) {
                                        const pos = Math.floor(audioPlayer.currentTime || 0);
                                        setSavedPosition(fname, pos);
                                        // always persist to localStorage immediately
                                        saveProgressForBook(safeBook);
                                        // log to console that we're saving
                                        try { console.log('[progress] saving progress for', fname, 'position', pos); } catch (e) {}
                                        // if we have a directory handle, write progress.txt into it and log
                                        if (__progress.dirHandle) {
                                            try {
                                                console.log('[progress] writing progress.txt to selected folder...');
                                                await writeProgressToHandle(__progress.dirHandle, __progress.data);
                                                console.log('[progress] progress.txt saved to folder.');
                                            } catch (e) { console.warn('[progress] failed to write progress.txt to folder', e); }
                                        }
                                    }
                                } catch (e) { console.warn('pause save failed', e); }
                            });
                            audioPlayer.addEventListener('ended', () => {
                                try {
                                    const fname = audioPlayer && audioPlayer.src ? (audioPlayer._playingFileName || null) : null;
                                    if (fname) {
                                        setSavedPosition(fname, 0); // reset on end
                                        saveProgressForBook(safeBook);
                                    }
                                } catch (e) { console.warn('ended save failed', e); }
                            });
                            window.addEventListener('beforeunload', () => {
                                try { saveProgressForBook(safeBook); } catch (e) {}
                            });
                        } catch (e) { /* ignore */ }

                        const ul = document.createElement('ul');
                        ul.style.listStyle = 'none';
                        ul.style.padding = '0';
                        ul.style.margin = '0';

                        const tokenRe = /[\p{L}\p{N}]+/gu;
                        caps.forEach((chap, idx) => {
                            const li = document.createElement('li');
                            li.style.padding = '6px 8px';
                            li.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
                            li.style.cursor = 'pointer';
                            li.dataset.index = String(idx);
                            const title = (chap.titulo || chap.title || `Capítulo ${idx+1}`).toString();
                            const span = document.createElement('span');
                            span.textContent = title;
                            li.appendChild(span);

                            // compute chapter token name (TitleCase tokens joined with underscores)
                            let chapTokenName = '';
                            try {
                                const chapTokens = Array.from(String(title).matchAll(tokenRe)).map(m => m[0]);
                                chapTokenName = chapTokens.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join('_');
                            } catch (e) { chapTokenName = title.replace(/\s+/g, '_'); }

                            // determine chapter order (prefer explicit numero from parsed chapters)
                            const hasExplicitOrder = !!(chap && (chap.numero || chap.number));
                            const chapOrder = hasExplicitOrder ? String(chap.numero || chap.number) : String(idx + 1);

                            // Matching policy: if chapter has an explicit order from parsing, require exact token+order match.
                            // Only when no explicit order is available, allow legacy token-only fallback.
                            let wavFile = null;
                            if (chapTokenName && hasExplicitOrder) {
                                if (wavMap.has(`${chapTokenName}__${chapOrder}`)) {
                                    wavFile = wavMap.get(`${chapTokenName}__${chapOrder}`);
                                }
                            } else if (chapTokenName) {
                                // no explicit order: permissive fallback to any legacy or matching key
                                if (wavMap.has(`${chapTokenName}__${chapOrder}`)) {
                                    wavFile = wavMap.get(`${chapTokenName}__${chapOrder}`);
                                } else if (wavMap.has(`${chapTokenName}__`)) {
                                    wavFile = wavMap.get(`${chapTokenName}__`);
                                } else {
                                    for (const [k, v] of wavMap.entries()) {
                                        if (k.startsWith(chapTokenName + '__')) { wavFile = v; break; }
                                    }
                                }
                            }
                            if (wavFile) {
                                const playBtn = document.createElement('button');
                                playBtn.type = 'button';
                                playBtn.textContent = 'Reproducir ▶';
                                playBtn.style.marginLeft = '12px';
                                playBtn.addEventListener('click', (ev) => {
                                    ev.stopPropagation();
                                    try {
                                        if (!audioPlayer) return;
                                        if (currentObjectUrl) { try { URL.revokeObjectURL(currentObjectUrl); } catch (e) {} currentObjectUrl = null; }
                                        const objUrl = URL.createObjectURL(wavFile);
                                        currentObjectUrl = objUrl;
                                        audioPlayer.src = objUrl;
                                        // remember which file name we are playing so save handler can reference it
                                        try { audioPlayer._playingFileName = wavFile && wavFile.name ? wavFile.name : null; } catch (e) {}
                                        // if we have a saved position for this file, seek to it once metadata is loaded
                                        try {
                                            const savedSec = getSavedPosition(wavFile && wavFile.name ? wavFile.name : '');
                                            if (savedSec && savedSec > 0) {
                                                const onMeta = function() { try { if (audioPlayer.duration > savedSec) audioPlayer.currentTime = savedSec; } catch (e) {} };
                                                audioPlayer.addEventListener('loadedmetadata', onMeta, { once: true });
                                            }
                                        } catch (e) {}
                                        // set media metadata for lock-screen / notification controls
                                        try { setMediaSessionMetadata(ebook && (ebook.titulo || ebook.title) ? (ebook.titulo || ebook.title) : '', title, (ebook && ebook.portada) ? ebook.portada : null, wavFile && wavFile.name ? wavFile.name : 'audio.wav'); } catch (e) {}
                                        // show player area
                                        const reproductorDisplay = document.getElementById('reproductor_display');
                                        if (reproductorDisplay) reproductorDisplay.style.display = 'block';
                                        audioPlayer.play().catch(() => {});
                                    } catch (e) { console.error('failed to play wav file', e); }
                                });
                                li.appendChild(playBtn);
                            } else {
                                const noSpan = document.createElement('small');
                                noSpan.style.color = '#999';
                                noSpan.style.marginLeft = '12px';
                                noSpan.textContent = '(sin .wav correspondiente)';
                                li.appendChild(noSpan);
                            }

                            // clicking the row also tries to play if available
                            li.addEventListener('click', () => {
                                try {
                                    if (!wavFile) return;
                                    if (!audioPlayer) return;
                                    if (currentObjectUrl) { try { URL.revokeObjectURL(currentObjectUrl); } catch (e) {} currentObjectUrl = null; }
                                    const objUrl = URL.createObjectURL(wavFile);
                                    currentObjectUrl = objUrl;
                                    audioPlayer.src = objUrl;
                                    try { audioPlayer._playingFileName = wavFile && wavFile.name ? wavFile.name : null; } catch (e) {}
                                    try { setMediaSessionMetadata(ebook && (ebook.titulo || ebook.title) ? (ebook.titulo || ebook.title) : '', title, (ebook && ebook.portada) ? ebook.portada : null, wavFile && wavFile.name ? wavFile.name : 'audio.wav'); } catch (e) {}
                                    // resume from saved pos if present
                                    try {
                                        const savedSec = getSavedPosition(wavFile && wavFile.name ? wavFile.name : '');
                                        if (savedSec && savedSec > 0) {
                                            audioPlayer.addEventListener('loadedmetadata', function onm() { try { if (audioPlayer.duration > savedSec) audioPlayer.currentTime = savedSec; } catch (e) {} }, { once: true });
                                        }
                                    } catch (e) {}
                                    const reproductorDisplay = document.getElementById('reproductor_display');
                                    if (reproductorDisplay) reproductorDisplay.style.display = 'block';
                                    audioPlayer.play().catch(() => {});
                                } catch (e) { console.error('row play failed', e); }
                            });

                            ul.appendChild(li);
                        });

                        chaptersContainer.appendChild(ul);

                    } catch (err) {
                        console.error('Error processing directory EPUB:', err);
                    }
                })();
            } catch (e) { console.error('dir upload handler failed', e); }
        });
    }
} catch (e) { console.warn('directory upload hookup failed', e); }

// Helper to find file-like objects (with url/path) in various result shapes
function extractFilesFromResult(obj) {
    const results = [];
    const seen = new Set();
    function normalizeUrl(u) {
    if (!u) return u;
    if (typeof u !== 'string') u = String(u);
    if (u.startsWith('http')) return u;
    if (u.startsWith('/')) return GRADIO_BASE + u;
    if (u.startsWith('file=')) return GRADIO_BASE + '/' + u;
    // windows path like C:\... -> expose via gradio file= prefix
    if (/^[A-Za-z]:\\/.test(u)) return GRADIO_BASE + '/file=' + encodeURIComponent(u);
        return u;
    }
    function walk(x) {
        if (!x) return;
        if (typeof x === 'string') return;
        if (Array.isArray(x)) return x.forEach(walk);
        if (typeof x === 'object') {
            const hasUrl = (typeof x.url === 'string' && x.url) || (typeof x.path === 'string' && x.path);
            if (hasUrl) {
                const raw = x.url || x.path;
                const url = normalizeUrl(raw);
                const filename = x.orig_name || x.origName || x.filename || (typeof raw === 'string' ? raw.split(/[\\/]/).pop() : 'file');
                if (!seen.has(url)) { seen.add(url); results.push({ url, filename }); }
            }
            Object.keys(x).forEach(k => walk(x[k]));
        }
    }
    walk(obj);
    return results;
}

// Fetch list of generated outputs from the local proxy and add them to downloads
async function fetchAndShowGeneratedOutputs() {
    try {
        const proxy = PROXY_BASE + '/gradio_outputs';
        const resp = await fetch(proxy);
        if (!resp.ok) return console.warn('gradio_outputs request failed', resp.status);
        const j = await resp.json().catch(() => null);
        if (!j || !Array.isArray(j.files)) return;
        j.files.forEach(f => {
            try { addDownloadLink(f.url, f.filename); } catch (e) { console.error('addDownloadLink failed for gradio_outputs', e); }
        });
    } catch (e) { console.warn('fetchAndShowGeneratedOutputs error', e); }
}

// Also show any files already moved into the outputs directory (served by proxy at /outputs)
async function fetchAndShowOutputsDir() {
    try {
        const outputsDir = 'D:\\TTS\\outputs';
    const proxy = PROXY_BASE + '/gradio_outputs?dir=' + encodeURIComponent(outputsDir);
        const resp = await fetch(proxy);
        if (!resp.ok) return; // no outputs or proxy not available
        const j = await resp.json().catch(() => null);
        if (!j || !Array.isArray(j.files) || !j.dir) return;
    const baseProxy = PROXY_BASE + '/outputs';
        j.files.forEach(f => {
            try {
                // compute relative path inside outputs dir
                let full = f.path || f.file || f.filename || '';
                if (!full) return;
                let root = j.dir;
                if (full.startsWith(root)) {
                    let rel = full.slice(root.length);
                    // trim leading separators
                    rel = rel.replace(/^\\+|^\/+/, '');
                    // split path segments and encode each
                    const parts = rel.split(/\\|\//).map(p => encodeURIComponent(p));
                    const url = baseProxy + '/' + parts.join('/');
                    addDownloadLink(url, f.filename || parts[parts.length-1]);
                }
            } catch (e) { console.error('addDownloadLink failed for outputs dir', e); }
        });
    } catch (e) { /* silent */ }
}

// On page load, populate downloads list with files only from the outputs directory
try { window.addEventListener('load', () => { try { clearDownloads(); fetchAndShowOutputsDir(); } catch (e) {} }); } catch (e) {}
