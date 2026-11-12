(() => {
    const gate = document.getElementById('listenbook-auth-gate');
    const title = document.getElementById('listenbook-auth-title');
    const subtitle = document.getElementById('listenbook-auth-subtitle');
    const form = document.getElementById('listenbook-auth-form');
    const usernameInput = document.getElementById('listenbook-auth-username');
    const passwordInput = document.getElementById('listenbook-auth-password');
    const confirmField = document.getElementById('listenbook-auth-confirm-field');
    const confirmInput = document.getElementById('listenbook-auth-confirm');
    const submit = document.getElementById('listenbook-auth-submit');
    const errorMessage = document.getElementById('listenbook-auth-error');
    const help = document.getElementById('listenbook-auth-help');
    const accountButton = document.getElementById('listenbook-account-btn');
    const accountModal = document.getElementById('listenbook-account-modal');
    const accountUser = document.getElementById('listenbook-account-user');
    const settingsModal = document.getElementById('listenbook-settings-modal');
    const settingsForm = document.getElementById('listenbook-settings-form');
    const settingsUrl = document.getElementById('listenbook-biblioses-url');
    const settingsError = document.getElementById('listenbook-settings-error');

    let setupMode = false;

    function setGateVisible(visible) {
        if (!gate) return;
        gate.classList.toggle('is-visible', visible);
        gate.setAttribute('aria-hidden', String(!visible));
    }

    function setError(element, message = '') {
        if (!element) return;
        element.textContent = message;
        element.classList.toggle('is-visible', Boolean(message));
    }

    function setAuthMode(isSetup) {
        setupMode = isSetup;
        if (title) title.textContent = isSetup ? 'Crea tu cuenta' : 'Inicia sesión';
        if (subtitle) subtitle.textContent = isSetup
            ? 'Será la cuenta inicial de este servidor de ListenBook.'
            : 'Accede a tu biblioteca y a tus ajustes privados.';
        confirmField?.classList.toggle('hidden', !isSetup);
        confirmInput?.toggleAttribute('required', isSetup);
        if (passwordInput) passwordInput.autocomplete = isSetup ? 'new-password' : 'current-password';
        if (submit) submit.textContent = isSetup ? 'Crear cuenta' : 'Entrar';
        if (help) help.textContent = isSetup
            ? 'La contraseña debe tener al menos 8 caracteres.'
            : 'El registro público queda cerrado después de crear la primera cuenta.';
    }

    async function requestJson(path, options = {}) {
        const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `La petición respondió ${response.status}.`);
        return payload;
    }

    function setAuthenticated(user) {
        window.listenbookAuth = { authenticated: true, user };
        if (accountUser) accountUser.textContent = `Sesión activa como ${user?.username || 'usuario'}`;
        setGateVisible(false);
        window.dispatchEvent(new CustomEvent('listenbook:authenticated', { detail: user }));
    }

    function showAccount() {
        if (!accountModal) return;
        accountModal.classList.add('is-visible');
        accountModal.setAttribute('aria-hidden', 'false');
    }

    function closeModal(modal) {
        modal?.classList.remove('is-visible');
        modal?.setAttribute('aria-hidden', 'true');
    }

    async function openSettings() {
        try {
            const payload = await requestJson('/api/settings');
            if (settingsUrl) settingsUrl.value = payload.bibliosesOpdsUrl || '';
            setError(settingsError);
            closeModal(accountModal);
            settingsModal?.classList.add('is-visible');
            settingsModal?.setAttribute('aria-hidden', 'false');
            settingsUrl?.focus();
        } catch (error) {
            setError(settingsError, error.message || String(error));
        }
    }

    async function initialize() {
        setGateVisible(true);
        try {
            const status = await requestJson('/api/auth/status');
            if (status.authenticated && status.user) {
                setAuthenticated(status.user);
                return status;
            }
            setAuthMode(Boolean(status.setupRequired));
            setError(errorMessage);
            usernameInput?.focus();
            return status;
        } catch (error) {
            setAuthMode(false);
            setError(errorMessage, `No se puede comprobar la sesión: ${error.message || error}`);
            return { authenticated: false, setupRequired: false };
        }
    }

    form?.addEventListener('submit', async event => {
        event.preventDefault();
        setError(errorMessage);
        const username = String(usernameInput?.value || '').trim();
        const password = String(passwordInput?.value || '');
        if (setupMode && password !== String(confirmInput?.value || '')) {
            setError(errorMessage, 'Las contraseñas no coinciden.');
            return;
        }
        submit.disabled = true;
        submit.classList.add('is-loading');
        try {
            const payload = await requestJson(setupMode ? '/api/auth/register' : '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            setAuthenticated(payload.user);
            window.location.reload();
        } catch (error) {
            setError(errorMessage, error.message || String(error));
        } finally {
            submit.disabled = false;
            submit.classList.remove('is-loading');
        }
    });

    accountButton?.addEventListener('click', showAccount);
    document.querySelectorAll('[data-listenbook-close-account]').forEach(button => button.addEventListener('click', () => closeModal(accountModal)));
    document.querySelectorAll('[data-listenbook-close-settings]').forEach(button => button.addEventListener('click', () => closeModal(settingsModal)));
    accountModal?.addEventListener('click', event => { if (event.target === accountModal) closeModal(accountModal); });
    settingsModal?.addEventListener('click', event => { if (event.target === settingsModal) closeModal(settingsModal); });
    document.getElementById('listenbook-open-settings')?.addEventListener('click', openSettings);
    document.getElementById('listenbook-logout')?.addEventListener('click', async () => {
        try { await requestJson('/api/auth/logout', { method: 'POST' }); } finally { window.location.reload(); }
    });
    settingsForm?.addEventListener('submit', async event => {
        event.preventDefault();
        setError(settingsError);
        const button = settingsForm.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            await requestJson('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bibliosesOpdsUrl: String(settingsUrl?.value || '').trim() })
            });
            closeModal(settingsModal);
            window.dispatchEvent(new CustomEvent('listenbook:settings-updated'));
        } catch (error) {
            setError(settingsError, error.message || String(error));
        } finally {
            button.disabled = false;
        }
    });

    window.openListenBookSettings = openSettings;
    document.querySelector('a[data-path="configuracion"]')?.addEventListener('click', event => {
        event.preventDefault();
        openSettings();
    });
    window.listenbookAuthReady = initialize();
})();
