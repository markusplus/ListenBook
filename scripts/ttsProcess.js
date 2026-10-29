// TTS through the ComfyUI HTTP API.
// The JSON saved by the ComfyUI interface is a canvas workflow; /prompt
// receives the equivalent API prompt built below.

const DEFAULT_COMFYUI = 'http://127.0.0.1:8188';
const WORKFLOW_CONFIG = 'resources/comfyUI/comfyui_omnivoice_es_es_rapido.json';
let workflowSettingsPromise = null;
const DEFAULT_WORKFLOW_SETTINGS = {
    referenceText: 'Para evitar el colapso, se administraban comprimidos de oxígeno artificial y se racionaba cada respiración. Fumar estaba estrictamente prohibido bajo el agua. Las condiciones higiénicas eran mínimas. Había solo un inodoro funcional ubicado en la parte delantera del submarino junto a los tubos lanzatorpedos.',
    language: 'spanish',
    instruct: '',
    generation: {
        seed: 42,
        randomSeed: true,
        numStep: 16,
        guidanceScale: 2,
        speed: 1,
        duration: 0,
        tShift: 0.1,
        denoise: true,
        preprocessPrompt: true,
        postprocessOutput: true,
        layerPenaltyFactor: 5,
        positionTemperature: 5,
        classTemperature: 0,
        audioChunkDuration: 15,
        audioChunkThreshold: 30
    }
};

// Sustituciones para mejorar la pronunciación. Se aplican únicamente al texto
// que se envía a OmniVoice, nunca al EPUB ni al texto mostrado en ListenBook.
const TTS_REPLACEMENTS = [
    [/\ba\s*\.\s*c\s*\.?/gi, 'antes de Cristo'],
    [/\bd\s*\.\s*c\s*\.?/gi, 'después de Cristo'],
    [/\betc\./gi, 'etcétera'],
    [/\bp\s*\.\s*ej\.?/gi, 'por ejemplo'],
    [/\baprox\./gi, 'aproximadamente'],
    [/\b(?:n|nº|n°)\.?\s*(?=\d)/gi, 'número '],
    [/\bSr\./gi, 'señor'],
    [/\bSra\./gi, 'señora'],
    [/\bDr\./gi, 'doctor'],
    [/\bDra\./gi, 'doctora']
];

function prepararTextoParaTTS(value) {
    let text = String(value || '').replace(/<[^>]*>/g, ' ');

    // El texto del EPUB puede llegar con entidades HTML y con saltos
    // serializados literalmente como "\\n". OmniVoice necesita recibirlos
    // como espacios y puntuación, no como caracteres que pueda pronunciar.
    if (typeof document !== 'undefined') {
        const decoder = document.createElement('textarea');
        decoder.innerHTML = text;
        text = decoder.value;
    } else {
        text = text.replace(/&nbsp;/gi, ' ');
    }
    text = text.replace(/\u00a0/g, ' ');

    // OmniVoice recibe una sola generación. Convertimos una separación doble
    // en puntuación para conservar al menos una pausa natural del modelo.
    text = text.replace(/\\+n[ \t]*\\+n/g, '. … ');
    text = text.replace(/\\+r?\\n[ \t]*\\+r?\\n/g, '. … ');
    text = text.replace(/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/g, '. … ');
    text = text.replace(/\\+r?\\n/g, ' ');
    text = text.replace(/\r\n|\r|\n/g, ' ');

    for (const [pattern, replacement] of TTS_REPLACEMENTS) {
        text = text.replace(pattern, replacement);
    }
    return text.replace(/[ \t]+/g, ' ').trim();
}

function comfyBase(options) {
    const configured = options && options.comfyuiBase;
    const globalBase = typeof window !== 'undefined' && window.COMFYUI_BASE;
    return String(configured || globalBase || DEFAULT_COMFYUI).replace(/\/$/, '');
}

async function loadWorkflowSettings() {
    if (!workflowSettingsPromise) {
        workflowSettingsPromise = (async () => {
            try {
                const response = await fetch(new URL(WORKFLOW_CONFIG, window.location.href));
                if (!response.ok) return DEFAULT_WORKFLOW_SETTINGS;
                const workflow = await response.json();
                const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
                const promptNode = nodes.find(node => node.id === 3);
                const generateNode = nodes.find(node => node.id === 4);
                const values = generateNode && Array.isArray(generateNode.widgets_values)
                    ? generateNode.widgets_values : [];
                const transcript = promptNode && Array.isArray(promptNode.widgets_values)
                    ? String(promptNode.widgets_values[0] || '') : '';
                const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
                return {
                    referenceText: transcript.startsWith('AQUÍ ESCRIBE') ? DEFAULT_WORKFLOW_SETTINGS.referenceText : (transcript || DEFAULT_WORKFLOW_SETTINGS.referenceText),
                    language: String(values[1] || DEFAULT_WORKFLOW_SETTINGS.language).toLowerCase(),
                    instruct: String(values[3] || DEFAULT_WORKFLOW_SETTINGS.instruct),
                    generation: {
                        ...DEFAULT_WORKFLOW_SETTINGS.generation,
                        seed: numberOr(values[4], DEFAULT_WORKFLOW_SETTINGS.generation.seed),
                        numStep: numberOr(values[6], DEFAULT_WORKFLOW_SETTINGS.generation.numStep),
                        guidanceScale: numberOr(values[7], DEFAULT_WORKFLOW_SETTINGS.generation.guidanceScale),
                        speed: numberOr(values[8], DEFAULT_WORKFLOW_SETTINGS.generation.speed),
                        duration: numberOr(values[9], DEFAULT_WORKFLOW_SETTINGS.generation.duration),
                        tShift: numberOr(values[10], DEFAULT_WORKFLOW_SETTINGS.generation.tShift),
                        denoise: values[11] !== false,
                        preprocessPrompt: values[12] !== false,
                        postprocessOutput: values[13] !== false,
                        layerPenaltyFactor: numberOr(values[14], DEFAULT_WORKFLOW_SETTINGS.generation.layerPenaltyFactor),
                        positionTemperature: numberOr(values[15], DEFAULT_WORKFLOW_SETTINGS.generation.positionTemperature),
                        classTemperature: numberOr(values[16], DEFAULT_WORKFLOW_SETTINGS.generation.classTemperature),
                        audioChunkDuration: numberOr(values[17], DEFAULT_WORKFLOW_SETTINGS.generation.audioChunkDuration),
                        audioChunkThreshold: numberOr(values[18], DEFAULT_WORKFLOW_SETTINGS.generation.audioChunkThreshold)
                    }
                };
            } catch (error) {
                console.warn('[ejecutarTTS] no se pudo leer la configuración del flujo:', error);
                return DEFAULT_WORKFLOW_SETTINGS;
            }
        })();
    }
    return workflowSettingsPromise;
}

function makeUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // HTTP origins on a LAN/Tailscale connection may not expose
    // crypto.randomUUID(). Keep the fallback valid for ComfyUI's prompt_id.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        const value = character === 'x' ? random : (random & 0x3 | 0x8);
        return value.toString(16);
    });
}

function makeClientId() {
    return makeUuid();
}

function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!match) return null;
    const mime = match[1] || 'audio/wav';
    if (match[2]) {
        const binary = atob(match[3]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(match[3])], { type: mime });
}

async function getReferenceBlob(options) {
    if (options && options.referenceAudioDataUrl) {
        const blob = dataUrlToBlob(options.referenceAudioDataUrl);
        if (blob) return blob;
    }
    const url = options && options.referenceAudioUrl;
    if (!url) throw new Error('No se ha encontrado el audio de referencia.');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo leer el audio de referencia: ${response.status}`);
    return response.blob();
}

async function uploadReferenceAudio(base, blob, filename) {
    const form = new FormData();
    form.append('image', blob, filename);
    form.append('type', 'input');
    form.append('subfolder', 'listenbook');
    form.append('overwrite', 'true');

    const response = await fetch(`${base}/upload/image`, { method: 'POST', body: form });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`ComfyUI no pudo subir el audio (${response.status}): ${detail}`);
    }
    const result = await response.json();
    return result.name ? `${result.subfolder ? `${result.subfolder}/` : ''}${result.name}` : `listenbook/${filename}`;
}

function buildPrompt(text, audioName, referenceText, settings, options) {
    const generation = (options && options.audioSettings) || settings.generation || DEFAULT_WORKFLOW_SETTINGS.generation;
    const value = (key, fallback) => generation[key] !== undefined && generation[key] !== null ? generation[key] : fallback;
    const seed = value('randomSeed', true)
        ? Math.floor(Math.random() * 2147483647)
        : (Number.isInteger(Number(value('seed', options && options.seed))) ? Number(value('seed', options && options.seed)) : Math.floor(Math.random() * 2147483647));
    const prefix = options && options.outputPrefix ? options.outputPrefix : 'audio/ListenBook';
    return {
        '1': { class_type: 'LoadAudio', inputs: { audio: audioName } },
        '2': {
            class_type: 'OmniVoiceLoadModel',
            inputs: { download_missing_files: true, device: 'auto', dtype: 'auto' }
        },
        '3': {
            class_type: 'OmniVoiceCreateVoiceClonePrompt',
            inputs: {
                model: ['2', 0],
                ref_audio: ['1', 0],
                ref_text: referenceText || '',
                use_ref_text_from_input: true,
                preprocess_prompt: true
            }
        },
        '4': {
            class_type: 'OmniVoiceGenerate',
            inputs: {
                model: ['2', 0],
                text,
                language: value('language', settings.language || 'spanish'),
                ref_text: ['3', 1],
                instruct: value('instruct', settings.instruct || ''),
                seed,
                num_step: Number(value('numStep', options && Number.isInteger(options.numStep) ? options.numStep : 16)),
                guidance_scale: Number(value('guidanceScale', 2)),
                speed: Number(value('speed', 1)),
                duration: Number(value('duration', 0)),
                t_shift: Number(value('tShift', 0.1)),
                denoise: Boolean(value('denoise', true)),
                preprocess_prompt: Boolean(value('preprocessPrompt', true)),
                postprocess_output: Boolean(value('postprocessOutput', true)),
                layer_penalty_factor: Number(value('layerPenaltyFactor', 5)),
                position_temperature: Number(value('positionTemperature', 5)),
                class_temperature: Number(value('classTemperature', 0)),
                audio_chunk_duration: Number(value('audioChunkDuration', 15)),
                audio_chunk_threshold: Number(value('audioChunkThreshold', 30)),
                voice_clone_prompt: ['3', 0],
                ref_audio: ['1', 0]
            }
        },
        '6': {
            class_type: 'SaveAudioMP3',
            inputs: { audio: ['4', 0], filename_prefix: prefix, quality: 'V0' }
        }
    };
}

async function logPromptToTerminal(prompt, text) {
    const payload = {
        text,
        language: prompt['4'] && prompt['4'].inputs ? prompt['4'].inputs.language : '',
        instruct: prompt['4'] && prompt['4'].inputs ? prompt['4'].inputs.instruct : ''
    };
    console.log('[ListenBook → ComfyUI] Prompt de texto:', payload);
    try {
        const endpoint = typeof window !== 'undefined' && window.location && window.location.origin
            ? `${window.location.origin}/api/log-prompt`
            : null;
        if (endpoint) {
            await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true
            });
        }
    } catch (error) {
        console.warn('[ListenBook] no se pudo escribir el prompt en la terminal:', error);
    }
}

function outputUrl(base, audio) {
    const params = new URLSearchParams({
        filename: audio.filename,
        subfolder: audio.subfolder || '',
        type: audio.type || 'output'
    });
    if (typeof window !== 'undefined' && window.location && /^https?:$/.test(window.location.protocol)) {
        params.set('download', '0');
        return `${window.location.origin}/api/audio?${params.toString()}`;
    }
    return `${base}/view?${params.toString()}`;
}

const DURATION_STORAGE_KEY = 'listenbook.omnivoice.duration.samples';

function getDurationEstimate() {
    try {
        const values = JSON.parse(localStorage.getItem(DURATION_STORAGE_KEY) || '[]')
            .map(Number)
            .filter(value => Number.isFinite(value) && value > 0);
        if (values.length) {
            const recent = values.slice(-5);
            return recent.reduce((total, value) => total + value, 0) / recent.length;
        }
    } catch (e) {}
    return 60;
}

function recordDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    try {
        const values = JSON.parse(localStorage.getItem(DURATION_STORAGE_KEY) || '[]')
            .map(Number)
            .filter(value => Number.isFinite(value) && value > 0);
        values.push(seconds);
        localStorage.setItem(DURATION_STORAGE_KEY, JSON.stringify(values.slice(-10)));
    } catch (e) {}
}

function openProgressSocket(base, clientId, promptId, onProgress) {
    if (typeof WebSocket === 'undefined') return null;
    // ListenBook proxies the ComfyUI HTTP API, but not WebSockets. Remote
    // clients use the /history polling fallback instead.
    if (/\/api\/comfy\/?$/.test(base)) return null;
    const wsBase = base.replace(/^http/i, 'ws');
    const socket = new WebSocket(`${wsBase}/ws?clientId=${encodeURIComponent(clientId)}`);
    const samples = [];
    let firstProgressAt = null;

    socket.onmessage = event => {
        if (typeof event.data !== 'string') return;
        let message;
        try { message = JSON.parse(event.data); } catch (e) { return; }
        if (message.type !== 'progress_state' || !message.data || message.data.prompt_id !== promptId) return;

        const nodes = message.data.nodes || {};
        const progress = nodes['4'] || Object.values(nodes).find(node => node && node.max > 0);
        if (!progress || !progress.max) return;

        const now = Date.now();
        const value = Number(progress.value) || 0;
        const max = Number(progress.max) || 0;
        if (!firstProgressAt && value > 0) firstProgressAt = now;
        if (value <= 0 || !firstProgressAt) return;

        samples.push({ time: now, value });
        while (samples.length > 6) samples.shift();
        const first = samples[0];
        const last = samples[samples.length - 1];
        const elapsed = (now - firstProgressAt) / 1000;
        const rate = last.value > first.value && last.time > first.time
            ? (last.value - first.value) / ((last.time - first.time) / 1000)
            : value / Math.max(elapsed, 0.1);
        const etaSeconds = rate > 0 ? Math.max(0, (max - value) / rate) : null;
        const percent = Math.min(100, Math.max(0, (value / max) * 100));
        socket._listenbookHasProgress = true;
        socket._listenbookEtaSeconds = etaSeconds;
        try { onProgress({ status: 'running', percent, value, max, etaSeconds }); } catch (e) {}
    };
    socket.onerror = () => {};
    return socket;
}

function waitForSocket(socket, timeout = 1500) {
    if (!socket || socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise(resolve => {
        const timer = setTimeout(resolve, timeout);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener('error', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
}

async function waitForHistory(base, promptId, progressSocket, options) {
    const timeout = options && typeof options.timeout === 'number' ? options.timeout : 10 * 60 * 1000;
    const pollInterval = options && typeof options.pollInterval === 'number' ? options.pollInterval : 1000;
    const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const started = Date.now();
    const estimatedTotalSeconds = getDurationEstimate();
    try { onProgress({ promptId, status: 'running', percent: 0, etaSeconds: estimatedTotalSeconds }); } catch (e) {}
    try {
        while (Date.now() - started < timeout) {
            const response = await fetch(`${base}/history/${encodeURIComponent(promptId)}`);
            if (!response.ok) throw new Error(`No se pudo consultar el historial de ComfyUI (${response.status}).`);
            const history = await response.json();
            const job = history && history[promptId];
            if (job && job.status && job.status.status_str === 'error') {
                throw new Error('ComfyUI ha devuelto un error al ejecutar el flujo. Revisa el registro de ComfyUI.');
            }
            if (job && job.outputs) {
                const files = [];
                for (const nodeOutput of Object.values(job.outputs)) {
                    for (const audio of (nodeOutput && nodeOutput.audio) || []) {
                        if (!audio || !audio.filename) continue;
                        files.push({
                            url: outputUrl(base, audio),
                            filename: audio.filename,
                            path: audio.filename,
                            subfolder: audio.subfolder || '',
                            type: audio.type || 'output'
                        });
                    }
                }
                if (files.length) {
                    recordDuration((Date.now() - started) / 1000);
                    return { files, prompt_id: promptId, history: job };
                }
            }
            if (!progressSocket || !progressSocket._listenbookHasProgress) {
                const elapsed = (Date.now() - started) / 1000;
                const percent = Math.min(99, (elapsed / estimatedTotalSeconds) * 100);
                const etaSeconds = Math.max(0, estimatedTotalSeconds - elapsed);
                try { onProgress({ promptId, status: 'running', percent, etaSeconds }); } catch (e) {}
            } else {
                const etaSeconds = progressSocket && Number.isFinite(progressSocket._listenbookEtaSeconds)
                    ? progressSocket._listenbookEtaSeconds
                    : estimatedTotalSeconds;
                try { onProgress({ promptId, status: 'running', etaSeconds }); } catch (e) {}
            }
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        throw new Error('La generación de audio ha superado el tiempo máximo de espera.');
    } finally {
        if (progressSocket) progressSocket.close();
    }
}

export async function ejecutarTTS(ebook, chapters, options) {
    void ebook;
    const base = comfyBase(options);
    const chapter = Array.isArray(chapters) ? chapters[0] : chapters;
    const text = typeof chapter === 'string'
        ? chapter
        : (chapter && (chapter.contenido || chapter.texto || chapter.text || chapter.content || chapter.body || chapter.plain)) || '';
    if (!String(text).trim()) throw new Error('El capítulo no contiene texto para generar.');

    const settings = await loadWorkflowSettings();
    const referenceBlob = await getReferenceBlob(options);
    const audioName = await uploadReferenceAudio(base, referenceBlob, 'listenbook_reference.wav');
    const prompt = buildPrompt(
        prepararTextoParaTTS(text),
        audioName,
        (options && options.referenceText) || settings.referenceText,
        settings,
        options
    );
    await logPromptToTerminal(prompt, prompt['4'].inputs.text);

    const clientId = makeClientId();
    const promptId = makeClientId();
    const progressSocket = openProgressSocket(base, clientId, promptId, options && options.onProgress);
    await waitForSocket(progressSocket);
    const response = await fetch(`${base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: clientId, prompt_id: promptId })
    });
    const rawBody = await response.text().catch(() => '');
    let body = null;
    try { body = rawBody ? JSON.parse(rawBody) : null; } catch (error) { body = rawBody; }
    if (!response.ok || !body || !body.prompt_id) {
        console.error('[ListenBook -> ComfyUI] Respuesta de /prompt:', response.status, body);
        throw new Error(`ComfyUI rechazó la petición (${response.status}): ${JSON.stringify(body)}`);
    }
    return waitForHistory(base, body.prompt_id, progressSocket, options);
}
