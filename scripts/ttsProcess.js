// Client-side helper to send chapters to a local TTS server
export async function ejecutarTTS(ebook, chapters, options) {
    // reference params to avoid "declared but never read" warnings
    void ebook;
    void chapters;
    void options;
    // prefer explicit serverUrl, otherwise default to the local bridge
    const serverUrl = options && options.serverUrl ? options.serverUrl : 'http://127.0.0.1:3001/generate';
    const statusBase = options && options.statusBase ? options.statusBase : 'http://127.0.0.1:3001';
    const pollInterval = options && typeof options.pollInterval === 'number' ? options.pollInterval : 1500;
    const timeout = options && typeof options.timeout === 'number' ? options.timeout : (1000 * 60 * 5);
    const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : () => {};

    // Build a sensible payload; you can extend this to include chapter text
    const payload = {
        prompt: "Probando la generación de audio con IA. Ta mare es puta",
        language: "es",
        // audio_file_pth may be either:
        // - a data: URL string (browser-side uploaded file)
        // - an object { path, url, orig_name, size, mime_type, meta } (already in Gradio FileData shape)
        // - left empty and the proxy will use a fallback
        audio_file_pth: { path: "", url: "", orig_name: "", size: 0, mime_type: "audio/wav", meta: { _type: 'gradio.FileData' } },
        agree: true
    };

    // Detect bridge vs Gradio: if serverUrl contains '3001' or '/generate' we treat it as bridge
    const isBridge = /:3001|\/generate(\/?$)/i.test(serverUrl);

    if (isBridge) {
        // Bridge flow: POST to /generate with { ebook, chapters } and poll /status/:jobId
        const resp = await fetch(serverUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ebook: { title: ebook && (ebook.titulo || ebook.title) || 'ebook' }, chapters }),
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Bridge /generate failed: ${resp.status} ${resp.statusText} - ${text}`);
        }
        const j = await resp.json();
        if (!j || !j.jobId) throw new Error('Bridge did not return a jobId');
        const jobId = j.jobId;

        const start = Date.now();
        while (true) {
            try {
                const sresp = await fetch(`${statusBase}/status/${encodeURIComponent(jobId)}`);
                if (sresp.ok) {
                    const status = await sresp.json();
                    try { onProgress(status); } catch (e) { console.error('onProgress', e); }
                    if (status && status.status === 'done') return status;
                    if (status && status.status === 'error') throw new Error(status.error || 'TTS job error');
                }
            } catch (e) {
                try { onProgress({ jobId, status: 'poll_error', diagnostics: [String(e)] }); } catch (er) {}
            }
            if (Date.now() - start > timeout) throw new Error('TTS job timed out');
            await new Promise(r => setTimeout(r, pollInterval));
        }
    } else {
        // Gradio flow: post to /predict with { data: [ payload ] }
        let postUrl = serverUrl;
        try {
            const u = new URL(serverUrl);
            if (!u.pathname || u.pathname === '/') u.pathname = '/predict';
            else if (!u.pathname.toLowerCase().includes('predict')) u.pathname = (u.pathname.replace(/\/$/, '') + '/predict');
            postUrl = u.toString();
        } catch (e) {
            if (serverUrl.endsWith('/')) postUrl = serverUrl + 'predict'; else postUrl = serverUrl + '/predict';
        }

        // If the caller provided a referenceAudioDataUrl, use it directly as the audio_file_pth string
        if (options && options.referenceAudioDataUrl) {
            payload.audio_file_pth = options.referenceAudioDataUrl;
        } else if (options && options.referenceAudioUrl && (!payload.audio_file_pth || !payload.audio_file_pth.path)) {
            // fetch the reference audio (proxy expected to return a data: URL)
            try {
                const r = await fetch(options.referenceAudioUrl);
                if (r.ok) {
                    const j = await r.json();
                    if (j && j.dataUrl) payload.audio_file_pth = j.dataUrl;
                }
            } catch (e) {
                console.warn('failed to fetch referenceAudioUrl', e);
            }
        }

        const gradioBody = { data: [ payload ] };

        // If a proxy URL is provided, call the proxy which will use @gradio/client server-side.
        if (options && options.proxyGradioCallUrl) {
            try {
                const proxyBody = {
                    baseUrl: serverUrl,
                    endpoint: '/predict',
                    payload: payload
                };
                console.log('[ejecutarTTS] calling proxyGradioCallUrl', options.proxyGradioCallUrl);
                console.log('[ejecutarTTS] proxyBody keys:', Object.keys(proxyBody), 'payload keys:', Object.keys(payload));
                let resp;
                try {
                    resp = await fetch(options.proxyGradioCallUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(proxyBody),
                    });
                } catch (netErr) {
                    console.error('[ejecutarTTS] network error calling proxy:', netErr);
                    // throw a normalized Error so caller's catch sees a string message
                    throw new Error('Network error calling proxyGradioCallUrl: ' + (netErr && netErr.message ? netErr.message : String(netErr)));
                }

                const text = await resp.text().catch(e => { console.error('[ejecutarTTS] error reading proxy response text', e); return null; });
                let parsed = null;
                try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
                console.log('[ejecutarTTS] proxy response status:', resp.status, 'text length:', text ? text.length : 0);
                // If proxy returned ok:true with nested result, return it
                if (resp.ok) {
                    if (parsed && parsed.ok) return parsed.result || parsed;
                    return parsed;
                }
                // Not OK: include parsed body if available
                const detail = parsed && typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed);
                throw new Error(`Proxy TTS call failed: ${resp.status} ${resp.statusText} - ${detail}`);
            } catch (e) {
                console.error('[ejecutarTTS] proxy call error (caught):', e);
                throw new Error(`Proxy call error: ${e && e.message ? e.message : String(e)}`);
            }
        }

        // Fall back to direct Gradio POST if no proxy provided
        const response = await fetch(postUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(gradioBody),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`TTS request failed: ${response.status} ${response.statusText} - ${text}`);
        }

        const result = await response.json();
        console.log('Audio generado con éxito (ejecutarTTS)');
        return result;
    }
}
