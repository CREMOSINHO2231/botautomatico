/* ==========================================================================
   STATE & DEFAULTS
   ========================================================================== */
const DEFAULT_TEMPLATE = `🔥 <b>{title}</b>
💵 De: <s>R$ {oldPrice}</s>
🤑 Por apenas: <b>R$ {price}</b>
🎫 Cupom: <b>{coupon}</b>
🛒 Compre aqui: {link}`;

const state = {
    config: {
        tgToken: '',
        tgChatId: '',
        amzTag: '',
        mlCampaign: '',
        shopeeKey: '',
        shopeeSecret: '',
        shopeeFallback: '',
        aliId: '',
        fbToken: '',
        fbPageId: ''
    },
    template: DEFAULT_TEMPLATE,
    history: [],
    currentProduct: {
        rawUrl: '',
        convertedUrl: '',
        title: '',
        oldPrice: '',
        price: '',
        image: '',
        marketplace: '',
        coupon: ''
    },
    automation: {
        active: false,
        timer: null,
        blacklist: '',
        alreadyPostedDeals: [],
        category: 'all',
        autoFacebook: false
    },
    instagram: {
        token: '',
        businessId: '',
        textTop: 'SUPER OFERTA!',
        textBottom: 'LINK NO GRUPO NA BIO! 👆',
        theme: 'instagram',
        duration: 30,
        videoBlob: null,
        autoPost: false
    }
};

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar o sistema de autenticação antes de inicializar o painel
    initAuthSystem().then(async (authenticated) => {
        if (authenticated) {
            await loadSettings();
            initTabNavigation();
            initEventListeners();
            updateStatusIndicators();
            renderHistory();
            resetProductForm();
            startLogsPolling();
        }
    });
});

/* ==========================================================================
   SISTEMA DE AUTENTICAÇÃO E SESSÃO (EMAIL + SENHA + CHAVE DE ACESSO)
   ========================================================================== */
async function initAuthSystem() {
    const token = localStorage.getItem('auth_token');
    
    // Configurar os listeners dos formulários
    setupAuthFormListeners();
    
    try {
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch('/api/auth/status', { headers });
        if (!res.ok) throw new Error();
        
        const data = await res.json();
        
        if (!data.setupCompleted) {
            // Mostrar tela de setup inicial
            document.body.classList.add('unauthenticated');
            showAuthForm('setup');
            return false;
        }
        
        if (data.licenseExpired) {
            // Mostrar tela de licença expirada
            showAuthForm('license-expired', data.licenseError);
            return false;
        }
        
        if (!data.loggedIn) {
            // Mostrar tela de login
            document.body.classList.add('unauthenticated');
            showAuthForm('login');
            return false;
        }
        
        // Logado com sucesso!
        document.body.classList.remove('unauthenticated');
        document.body.classList.add('authenticated');
        document.getElementById('auth-overlay').style.opacity = '0';
        setTimeout(() => {
            document.getElementById('auth-overlay').style.display = 'none';
        }, 300);
        return true;
    } catch (e) {
        console.error("Erro na verificação de autenticação", e);
        document.body.classList.add('unauthenticated');
        showAuthForm('login');
        return false;
    }
}

function showAuthForm(name, errorText = '') {
    document.getElementById('auth-setup-form').classList.add('hidden');
    document.getElementById('auth-login-form').classList.add('hidden');
    
    const licenseForm = document.getElementById('auth-license-expired');
    if (licenseForm) {
        licenseForm.classList.add('hidden');
    }
    
    const subtitle = document.getElementById('auth-card-subtitle');
    
    // Garantir que o overlay fique visível ao exibir qualquer formulário de autenticação/bloqueio
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
    }
    document.body.classList.add('unauthenticated');
    document.body.classList.remove('authenticated');
    
    if (name === 'setup') {
        document.getElementById('auth-setup-form').classList.remove('hidden');
        subtitle.innerText = 'Configuração Inicial';
    } else if (name === 'login') {
        document.getElementById('auth-login-form').classList.remove('hidden');
        subtitle.innerText = 'Identificação';
    } else if (name === 'license-expired') {
        if (licenseForm) {
            licenseForm.classList.remove('hidden');
            document.getElementById('license-expired-text').innerText = errorText || 'A sua chave de licença expirou ou é inválida.';
        }
        subtitle.innerText = 'Acesso Bloqueado';
    }
}

function setupAuthFormListeners() {
    // Submit do Setup
    document.getElementById('auth-setup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('setup-email').value.trim();
        const password = document.getElementById('setup-password').value;
        const key = document.getElementById('setup-key').value.trim();
        
        const btn = document.getElementById('btn-setup-submit');
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<span>Salvando...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;
        
        try {
            const res = await fetch('/api/auth/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, key })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                showToast('Cadastro concluído com sucesso! Digite as credenciais para acessar.', 'success');
                showAuthForm('login');
            } else {
                showToast(data.error || 'Erro ao realizar cadastro.', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Falha de conexão com o servidor local.', 'error');
        } finally {
            btn.innerHTML = originalContent;
            btn.disabled = false;
        }
    });
    
    // Submit do Login (Login Direto sem OTP)
    document.getElementById('auth-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const key = document.getElementById('login-key').value.trim();
        
        const btn = document.getElementById('btn-login-submit');
        const originalContent = btn.innerHTML;
        btn.innerHTML = '<span>Verificando...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;
        
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, key })
            });
            const data = await res.json();
            if (res.ok && data.success && data.token) {
                localStorage.setItem('auth_token', data.token);
                showToast('Acesso concedido com sucesso!', 'success');
                
                const overlay = document.getElementById('auth-overlay');
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.style.display = 'none';
                    document.body.classList.remove('unauthenticated');
                    document.body.classList.add('authenticated');
                    
                    // Inicializar o painel principal
                    loadSettings();
                    initTabNavigation();
                    initEventListeners();
                    updateStatusIndicators();
                    renderHistory();
                    resetProductForm();
                }, 300);
            } else {
                showToast(data.error || 'E-mail, senha ou chave de acesso incorretos.', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Falha ao conectar com o servidor local. Verifique se o proxy está rodando.', 'error');
        } finally {
            btn.innerHTML = originalContent;
            btn.disabled = false;
        }
    });

    // Alternar entre Login e Cadastro
    const btnGotoRegister = document.getElementById('btn-goto-register');
    if (btnGotoRegister) {
        btnGotoRegister.addEventListener('click', () => {
            showAuthForm('setup');
        });
    }

    const btnGotoLogin = document.getElementById('btn-goto-login');
    if (btnGotoLogin) {
        btnGotoLogin.addEventListener('click', () => {
            showAuthForm('login');
        });
    }

    // Submit da Atualização de Licença (Reativar com Nova Chave)
    const licenseUpdateForm = document.getElementById('auth-license-update-form');
    if (licenseUpdateForm) {
        licenseUpdateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const key = document.getElementById('new-access-key-input').value.trim();
            
            const btn = document.getElementById('btn-update-license');
            const originalContent = btn.innerHTML;
            btn.innerHTML = '<span>Verificando...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
            btn.disabled = true;
            
            try {
                const res = await fetch('/api/auth/update-license', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    showToast('Licença atualizada com sucesso! Reiniciando...', 'success');
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                } else {
                    showToast(data.error || 'Chave inválida ou expirada.', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Erro de conexão ao atualizar a chave de licença.', 'error');
            } finally {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }
        });
    }
    
    // Botão de Logout no Header
    document.getElementById('btn-logout').addEventListener('click', async () => {
        const token = localStorage.getItem('auth_token');
        if (token) {
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch (e) {
                console.error("Erro ao deslogar do servidor", e);
            }
        }
        localStorage.removeItem('auth_token');
        showToast('Sessão encerrada.', 'info');
        setTimeout(() => {
            window.location.reload();
        }, 800);
    });
}

/* ==========================================================================
   LOCALSTORAGE & CONFIG MANAGEMENT
   ========================================================================== */
async function loadSettings() {
    const token = localStorage.getItem('auth_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    
    try {
        const res = await fetch('/api/settings', { headers });
        if (!res.ok) throw new Error("Falha ao carregar configurações do servidor");
        const data = await res.json();
        
        if (data.settings) {
            state.config = { ...state.config, ...data.settings };
        }
        
        state.template = data.template || DEFAULT_TEMPLATE;
        document.getElementById('active-template').value = state.template;
        
        if (data.automation) {
            state.automation = { ...state.automation, ...data.automation };
            document.getElementById('cfg-auto-blacklist').value = state.automation.blacklist || '';
            document.getElementById('cfg-auto-category').value = state.automation.category || 'all';
            document.getElementById('chk-auto-facebook').checked = state.automation.autoFacebook || false;
            
            if (state.automation.interval) {
                document.getElementById('cfg-auto-interval').value = state.automation.interval;
            }
            if (state.automation.sources) {
                document.getElementById('chk-src-promobit').checked = state.automation.sources.promobit !== false;
                document.getElementById('chk-src-gatry').checked = state.automation.sources.gatry !== false;
            }
            
            updateAutomationUI(state.automation.active);
        }
        
        document.getElementById('cfg-tg-token').value = state.config.tgToken || '';
        document.getElementById('cfg-tg-chat-id').value = state.config.tgChatId || '';
        document.getElementById('cfg-amz-tag').value = state.config.amzTag || '';
        document.getElementById('cfg-ml-campaign').value = state.config.mlCampaign || '';
        document.getElementById('cfg-shopee-key').value = state.config.shopeeKey || '';
        document.getElementById('cfg-shopee-secret').value = state.config.shopeeSecret || '';
        document.getElementById('cfg-shopee-fallback').value = state.config.shopeeFallback || '';
        document.getElementById('cfg-ali-id').value = state.config.aliId || '';
        document.getElementById('cfg-fb-token').value = state.config.fbToken || '';
        document.getElementById('cfg-fb-page-id').value = state.config.fbPageId || '';
        
    } catch (e) {
        console.error("Erro ao carregar configurações do servidor, usando fallback local", e);
        writeLog("Aviso: Não foi possível carregar configurações do servidor.", "warning");
    }
}

async function saveSettings(event) {
    if (event) event.preventDefault();

    state.config.tgToken = document.getElementById('cfg-tg-token').value.trim();
    state.config.tgChatId = document.getElementById('cfg-tg-chat-id').value.trim();
    state.config.amzTag = document.getElementById('cfg-amz-tag').value.trim();
    state.config.mlCampaign = document.getElementById('cfg-ml-campaign').value.trim();
    state.config.shopeeKey = document.getElementById('cfg-shopee-key').value.trim();
    state.config.shopeeSecret = document.getElementById('cfg-shopee-secret').value.trim();
    state.config.shopeeFallback = document.getElementById('cfg-shopee-fallback').value.trim();
    state.config.aliId = document.getElementById('cfg-ali-id').value.trim();
    state.config.fbToken = document.getElementById('cfg-fb-token').value.trim();
    state.config.fbPageId = document.getElementById('cfg-fb-page-id').value.trim();

    const token = localStorage.getItem('auth_token');
    const headers = { 
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
    
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                settings: state.config,
                template: state.template,
                automation: {
                    blacklist: state.automation.blacklist,
                    category: state.automation.category,
                    autoFacebook: state.automation.autoFacebook,
                    sources: {
                        promobit: document.getElementById('chk-src-promobit').checked,
                        gatry: document.getElementById('chk-src-gatry').checked
                    }
                }
            })
        });
        
        if (!res.ok) throw new Error("Erro de resposta HTTP");
        
        showToast('Configurações salvas com sucesso no servidor!', 'success');
        updateStatusIndicators();
        
        if (state.config.tgToken) {
            verifyTelegramBot();
        }
    } catch (e) {
        console.error("Erro ao salvar no servidor", e);
        showToast('Erro ao salvar configurações no servidor.', 'error');
    }
}

function updateStatusIndicators() {
    const tgIndicator = document.getElementById('telegram-status');
    const configIndicator = document.getElementById('config-status');

    // Config completeness check
    const hasTg = state.config.tgToken && state.config.tgChatId;
    const hasAff = state.config.amzTag || state.config.mlCampaign || state.config.shopeeFallback || (state.config.shopeeKey && state.config.shopeeSecret) || state.config.aliId;

    if (hasTg && hasAff) {
        configIndicator.innerHTML = '<span class="status-dot online"></span><span class="status-label">Pronto para Uso</span>';
    } else {
        configIndicator.innerHTML = '<span class="status-dot offline"></span><span class="status-label">Falta Configuração</span>';
    }
}

async function verifyTelegramBot() {
    if (!state.config.tgToken) return;
    const tgIndicator = document.getElementById('telegram-status');
    
    try {
        const res = await fetch(`https://api.telegram.org/bot${state.config.tgToken}/getMe`);
        const data = await res.json();
        
        if (data.ok) {
            tgIndicator.innerHTML = `<span class="status-dot online"></span><span class="status-label">Bot: @${data.result.username}</span>`;
            document.getElementById('preview-chat-title').innerText = state.config.tgChatId || `Bot: @${data.result.username}`;
            return true;
        } else {
            throw new Error("Invalid token");
        }
    } catch (err) {
        tgIndicator.innerHTML = '<span class="status-dot offline"></span><span class="status-label">Telegram Token Inválido</span>';
        return false;
    }
}

/* ==========================================================================
   NAVIGATION TAB SYSTEM
   ========================================================================== */
function initTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');

            tabButtons.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });
}

/* ==========================================================================
   EVENT LISTENERS
   ========================================================================== */
function initEventListeners() {
    // Config form submit
    document.getElementById('config-form').addEventListener('submit', saveSettings);

    // Test Telegram Connection
    document.getElementById('btn-test-telegram-connection').addEventListener('click', async () => {
        const token = document.getElementById('cfg-tg-token').value.trim();
        const chatId = document.getElementById('cfg-tg-chat-id').value.trim();
        
        if (!token || !chatId) {
            showToast('Preencha o Token e o Chat ID para testar.', 'warning');
            return;
        }

        showToast('Testando conexão com o Telegram...', 'info');
        
        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: '🚀 <b>OfertasBot</b>: Conexão de teste realizada com sucesso!',
                    parse_mode: 'HTML'
                })
            });
            const data = await res.json();
            if (data.ok) {
                showToast('Mensagem de teste enviada com sucesso no Telegram!', 'success');
                verifyTelegramBot();
            } else {
                showToast(`Erro no Telegram: ${data.description}`, 'error');
            }
        } catch (err) {
            showToast('Erro ao conectar com a API do Telegram. Verifique seu token.', 'error');
        }
    });

    // Fetch and convert raw link
    document.getElementById('btn-fetch-link').addEventListener('click', handleFetchAndConvert);
    document.getElementById('raw-url').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleFetchAndConvert();
    });

    // Helper para salvar modelo no servidor
    async function saveTemplateToServer(text) {
        const token = localStorage.getItem('auth_token');
        const headers = { 
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        };
        try {
            await fetch('/api/settings', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ template: text })
            });
        } catch (e) {
            console.error("Erro ao salvar modelo no servidor", e);
        }
    }

    // Template save
    document.getElementById('btn-save-template').addEventListener('click', async () => {
        const text = document.getElementById('active-template').value;
        state.template = text;
        await saveTemplateToServer(text);
        showToast('Modelo de post salvo!', 'success');
        updateLivePreview();
    });

    // Template reset
    document.getElementById('btn-reset-template').addEventListener('click', async () => {
        document.getElementById('active-template').value = DEFAULT_TEMPLATE;
        state.template = DEFAULT_TEMPLATE;
        await saveTemplateToServer(DEFAULT_TEMPLATE);
        showToast('Modelo restaurado para o padrão.', 'info');
        updateLivePreview();
    });

    // Handle template tags badge clicking
    document.querySelectorAll('.tag-badge').forEach(badge => {
        badge.addEventListener('click', () => {
            const tag = badge.getAttribute('data-tag');
            const textarea = document.getElementById('active-template');
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            textarea.value = text.substring(0, start) + tag + text.substring(end);
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = start + tag.length;
        });
    });

    // Live preview inputs binding
    const liveInputs = ['prod-title', 'prod-price-old', 'prod-price-new', 'prod-image', 'prod-aff-url', 'prod-coupon'];
    liveInputs.forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            syncFormToState();
            generateDefaultMessageText();
            updateLivePreview();
            updateInstagramFieldsFromProduct();
        });
    });

    // Textarea message custom binding
    document.getElementById('message-content').addEventListener('input', (e) => {
        const text = e.target.value;
        document.getElementById('char-counter').innerText = `${text.length} caracteres`;
        
        // Render raw formatted message inside preview
        const formatted = convertMarkdownToHtml(text);
        document.getElementById('preview-text').innerHTML = formatted || '<i>Escreva uma mensagem...</i>';
    });

    // Verify Image preview action
    document.getElementById('btn-verify-image').addEventListener('click', () => {
        const url = document.getElementById('prod-image').value.trim();
        const previewImg = document.getElementById('preview-image');
        const placeholder = document.getElementById('preview-image-placeholder');
        
        if (url) {
            previewImg.src = url;
            previewImg.style.display = 'block';
            placeholder.style.display = 'none';
            showToast('Imagem carregada!', 'info');
        } else {
            previewImg.removeAttribute('src');
            previewImg.style.display = 'none';
            placeholder.style.display = 'flex';
        }
    });

    // Copy Generated URL Button
    document.getElementById('btn-copy-url').addEventListener('click', () => {
        const urlInput = document.getElementById('prod-aff-url');
        if (urlInput.value) {
            copyTextToClipboard(urlInput.value, 'Link copiado!');
        }
    });

    // Copy Full Post Text Button
    document.getElementById('btn-copy-full-text').addEventListener('click', () => {
        const text = document.getElementById('message-content').value;
        if (text) {
            copyTextToClipboard(text, 'Post completo copiado!');
        } else {
            showToast('Não há conteúdo no post para copiar.', 'warning');
        }
    });

    // Post to Telegram Button
    document.getElementById('btn-post-telegram').addEventListener('click', handlePostTelegram);

    // Post to Facebook Button
    document.getElementById('btn-post-facebook').addEventListener('click', handlePostFacebook);

    // Clear history
    document.getElementById('btn-clear-history').addEventListener('click', async () => {
        if (confirm('Deseja realmente limpar todo o histórico de ofertas e redefinir a fila de automação?')) {
            const token = localStorage.getItem('auth_token');
            const headers = { 
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            };
            try {
                const res = await fetch('/api/automation/clear-history', {
                    method: 'POST',
                    headers: headers
                });
                if (res.ok) {
                    state.history = [];
                    localStorage.setItem('cfg_history_tg', JSON.stringify(state.history));
                    state.automation.alreadyPostedDeals = [];
                    localStorage.setItem('cfg_already_posted', JSON.stringify([]));
                    renderHistory();
                    showToast('Histórico e fila de automação limpos no servidor!', 'info');
                } else {
                    throw new Error("Erro de resposta HTTP");
                }
            } catch (e) {
                console.error("Erro ao limpar histórico no servidor", e);
                showToast('Erro ao limpar histórico no servidor.', 'error');
            }
        }
    });

    // Automation tab bindings
    document.getElementById('btn-toggle-automation').addEventListener('click', toggleAutomation);
    document.getElementById('btn-clear-logs').addEventListener('click', () => {
        document.getElementById('console-logs-area').innerHTML = '<div class="log-line text-muted">[sistema] Console limpo.</div>';
    });

    document.getElementById('cfg-auto-blacklist').addEventListener('change', async (e) => {
        state.automation.blacklist = e.target.value.trim();
        await saveSettings();
    });

    document.getElementById('cfg-auto-category').addEventListener('change', async (e) => {
        state.automation.category = e.target.value;
        await saveSettings();
    });

    document.getElementById('chk-src-promobit').addEventListener('change', async () => {
        await saveSettings();
    });

    document.getElementById('chk-src-gatry').addEventListener('change', async () => {
        await saveSettings();
    });

    document.getElementById('cfg-auto-interval').addEventListener('change', async () => {
        if (state.automation.active) {
            await toggleAutomation();
            await toggleAutomation();
        } else {
            await saveSettings();
        }
    });

    // Instagram Controls bindings
    document.getElementById('chk-auto-instagram').addEventListener('change', (e) => {
        state.instagram.autoPost = e.target.checked;
        localStorage.setItem('cfg_ig_autopost', state.instagram.autoPost);
    });

    document.getElementById('chk-auto-facebook').addEventListener('change', async (e) => {
        state.automation.autoFacebook = e.target.checked;
        await saveSettings();
    });

    document.getElementById('ig-video-text').addEventListener('input', (e) => {
        state.instagram.textTop = e.target.value.trim();
        localStorage.setItem('cfg_ig_text_top', state.instagram.textTop);
        updateInstagramFieldsFromProduct();
    });

    document.getElementById('ig-video-cta').addEventListener('input', (e) => {
        state.instagram.textBottom = e.target.value.trim();
        localStorage.setItem('cfg_ig_text_bottom', state.instagram.textBottom);
        updateInstagramFieldsFromProduct();
    });

    document.getElementById('ig-video-theme').addEventListener('change', (e) => {
        state.instagram.theme = e.target.value;
        localStorage.setItem('cfg_ig_theme', state.instagram.theme);
        updateInstagramFieldsFromProduct();
    });

    document.getElementById('ig-video-duration').addEventListener('change', (e) => {
        state.instagram.duration = parseInt(e.target.value);
        localStorage.setItem('cfg_ig_duration', state.instagram.duration);
    });

    document.getElementById('ig-post-type').addEventListener('change', (e) => {
        state.instagram.postType = e.target.value;
        localStorage.setItem('cfg_ig_post_type', state.instagram.postType);
        updateInstagramFieldsFromProduct();
    });

    document.getElementById('ig-sim-sponsored').addEventListener('change', (e) => {
        state.instagram.sponsored = e.target.checked;
        localStorage.setItem('cfg_ig_sponsored', state.instagram.sponsored);
        updateInstagramFieldsFromProduct();
    });

    document.getElementById('btn-ig-generate').addEventListener('click', () => {
        const prod = state.currentProduct.title ? state.currentProduct : {
            title: 'Smartphone Novo Modelo',
            price: '1.499,00',
            oldPrice: '1.999,00',
            image: ''
        };
        startReelsRecording(prod, state.instagram.duration, state.instagram.textTop, state.instagram.textBottom, state.instagram.theme);
    });

    document.getElementById('btn-ig-download').addEventListener('click', downloadReelsVideo);

    document.getElementById('btn-ig-copy-caption').addEventListener('click', () => {
        const text = document.getElementById('ig-caption-text').value;
        if (text) {
            copyTextToClipboard(text, 'Legenda do Reels copiada!');
        } else {
            showToast('Não há legenda para copiar.', 'warning');
        }
    });

    document.getElementById('btn-ig-publish').addEventListener('click', async () => {
        if (!state.instagram.videoBlob) {
            showToast('Gere o vídeo do Reels primeiro!', 'warning');
            return;
        }
        
        const token = state.instagram.token;
        const businessId = state.instagram.businessId;
        if (!token || !businessId) {
            showToast('Configure as credenciais do Instagram antes de publicar.', 'error');
            return;
        }
        
        const btn = document.getElementById('btn-ig-publish');
        btn.disabled = true;
        btn.innerHTML = '<span>Publicando...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
        
        try {
            showToast('Iniciando upload do Reels...', 'info');
            const tempUrl = await uploadVideoToTempHost(state.instagram.videoBlob);
            const caption = document.getElementById('ig-caption-text').value;
            
            await publishToInstagramReels(tempUrl, caption);
            showToast('Reels publicado no Instagram com sucesso!', 'success');
        } catch (err) {
            showToast(`Falha: ${err.message}`, 'error');
            console.error(err);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<span>Publicar Reels Manual</span> <i class="fa-solid fa-paper-plane"></i>';
        }
    });
}

/* ==========================================================================
   SCRAPER & CONVERTER LOGIC (CORS BYPASS)
   ========================================================================== */
async function handleFetchAndConvert() {
    const rawUrl = document.getElementById('raw-url').value.trim();
    if (!rawUrl) {
        showToast('Insira um link válido para buscar.', 'warning');
        return;
    }

    const loader = document.getElementById('scraper-loader');
    const form = document.getElementById('product-form');
    loader.style.display = 'flex';
    form.style.display = 'none';

    try {
        let urlToProcess = rawUrl;
        let aggregatorData = null;
        
        // If it's an aggregator (Promobit/Gatry), fetch it first to grab promotional details
        if (rawUrl.includes('promobit.com.br') || rawUrl.includes('gatry.com')) {
            showToast('Extraindo dados da oferta...', 'info');
            try {
                const aggResponse = await fetchViaProxy(rawUrl);
                urlToProcess = aggResponse.finalUrl || rawUrl;
                
                const parser = new DOMParser();
                const aggDoc = parser.parseFromString(aggResponse.contents, 'text/html');
                aggregatorData = extractSchemaAndMetaValues(aggDoc);
                
                if (!aggregatorData.price) {
                    const priceEl = aggDoc.querySelector('.price') || aggDoc.querySelector('.amount') || aggDoc.querySelector('.deal-price') || aggDoc.querySelector('.promotional-price');
                    if (priceEl) aggregatorData.price = priceEl.textContent;
                }
            } catch (aggErr) {
                console.warn("Erro ao ler dados do agregador", aggErr);
            }
            
            if (urlToProcess.includes('promobit.com.br') || urlToProcess.includes('gatry.com') || isShortlink(urlToProcess)) {
                urlToProcess = await resolveFinalUrl(urlToProcess);
            }
        } else if (isShortlink(rawUrl)) {
            showToast('Resolvendo link encurtado...', 'info');
            urlToProcess = await resolveFinalUrl(rawUrl);
        }
        
        // Clean any tracking and nesting from the URL
        urlToProcess = cleanProductUrl(urlToProcess);
        
        const platform = detectPlatform(urlToProcess);
        state.currentProduct.marketplace = platform;
        state.currentProduct.rawUrl = urlToProcess;

        let scrapedData = { title: '', price: '', oldPrice: '', image: '' };
        try {
            scrapedData = await scrapeProductInfo(urlToProcess, platform);
        } catch (scrapeErr) {
            console.warn("Scraping failed, fallback to manual entry.", scrapeErr);
            showToast('Não foi possível obter todos os dados automaticamente do e-commerce.', 'warning');
        }

        const convertedUrl = await convertToAffiliate(urlToProcess, platform);
        state.currentProduct.convertedUrl = convertedUrl;

        // Prioritize aggregator values if they exist (they contain the exact promotional deal)
        state.currentProduct.title = (aggregatorData && aggregatorData.title) || scrapedData.title || '';
        state.currentProduct.price = (aggregatorData && aggregatorData.price) || scrapedData.price || '';
        state.currentProduct.image = (aggregatorData && aggregatorData.image) || scrapedData.image || '';
        state.currentProduct.coupon = (aggregatorData && aggregatorData.coupon) || lastResolvedCoupon || extractCouponFromTitle(state.currentProduct.title) || '';
        
        let oldPriceVal = scrapedData.oldPrice || (aggregatorData && aggregatorData.oldPrice) || '';
        const pPrice = parsePriceToFloat(state.currentProduct.price);
        const pOldPrice = parsePriceToFloat(oldPriceVal);
        
        if ((!oldPriceVal || oldPriceVal === '0,00' || oldPriceVal.trim() === '' || pOldPrice <= pPrice) && pPrice > 0) {
            oldPriceVal = formatCurrencyText((pPrice * 1.25).toFixed(2));
        }
        state.currentProduct.oldPrice = oldPriceVal;
        state.currentProduct.image = state.currentProduct.image || scrapedData.image || '';

        document.getElementById('prod-title').value = state.currentProduct.title;
        document.getElementById('prod-price-old').value = state.currentProduct.oldPrice;
        document.getElementById('prod-price-new').value = state.currentProduct.price;
        document.getElementById('prod-image').value = state.currentProduct.image;
        document.getElementById('prod-aff-url').value = state.currentProduct.convertedUrl;
        document.getElementById('prod-coupon').value = state.currentProduct.coupon;

        generateDefaultMessageText();
        updateLivePreview();
        updateInstagramFieldsFromProduct();

        loader.style.display = 'none';
        form.style.display = 'block';

        showToast('Link processado com sucesso!', 'success');

    } catch (err) {
        console.error("Erro geral de processamento", err);
        loader.style.display = 'none';
        showToast('Erro ao processar link. Tente novamente.', 'error');
    }
}

function detectPlatform(url) {
    if (!url) return 'desconhecido';
    const lowercaseUrl = url.toLowerCase();
    if (lowercaseUrl.includes('promobit.com.br') || lowercaseUrl.includes('promoby.me') || lowercaseUrl.includes('gatry.com')) {
        return 'desconhecido';
    }
    if (lowercaseUrl.includes('amazon.com.br') || lowercaseUrl.includes('amzn.to')) {
        return 'amazon';
    } else if (lowercaseUrl.includes('mercadolivre.com.br') || lowercaseUrl.includes('mercadolivre.com') || lowercaseUrl.includes('ml-api.com.br') || lowercaseUrl.includes('mpago.la') || lowercaseUrl.includes('meli.la') || lowercaseUrl.includes('meli.li')) {
        return 'mercadolivre';
    } else if (lowercaseUrl.includes('shopee.com.br') || lowercaseUrl.includes('shopee.com') || lowercaseUrl.includes('shp.ee') || lowercaseUrl.includes('shope.ee')) {
        return 'shopee';
    } else if (lowercaseUrl.includes('aliexpress.com') || lowercaseUrl.includes('aliexpress.us') || lowercaseUrl.includes('s.click.aliexpress.com')) {
        return 'aliexpress';
    }
    return 'desconhecido';
}

async function fetchViaProxy(url) {
    const proxies = [
        // 1. Local CORS Proxy (PowerShell script - RECOMMENDED)
        async (u) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 6000);
            try {
                const token = localStorage.getItem('auth_token');
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const res = await fetch(`/proxy?url=${encodeURIComponent(u)}`, { 
                    signal: controller.signal,
                    headers: headers
                });
                clearTimeout(id);
                if (res.status === 403) {
                    const data = await res.json().catch(() => ({}));
                    if (data.licenseExpired) {
                        showAuthForm('license-expired', data.error);
                        throw new Error(`Licença Expirada: ${data.error}`);
                    }
                }
                if (!res.ok) throw new Error(`Local Proxy HTTP ${res.status}`);
                const text = await res.text();
                const finalUrlHeader = res.headers.get('x-final-url');
                return { contents: text, finalUrl: finalUrlHeader || u };
            } catch (err) {
                clearTimeout(id);
                throw err;
            }
        },
        // 2. Direct Fetch (Bypasses Cloudflare if user has a CORS extension enabled)
        async (u) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 6000);
            try {
                const res = await fetch(u, { signal: controller.signal });
                clearTimeout(id);
                if (!res.ok) throw new Error(`Direct fetch HTTP ${res.status}`);
                const text = await res.text();
                return { contents: text, finalUrl: u };
            } catch (err) {
                clearTimeout(id);
                throw err;
            }
        },
        // 2. AllOrigins JSON (with timeout & cache bypass)
        async (u) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 6000);
            try {
                const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(u)}&_=${Date.now()}`, { signal: controller.signal });
                clearTimeout(id);
                if (!res.ok) throw new Error(`AllOrigins HTTP ${res.status}`);
                const json = await res.json();
                if (!json.contents) throw new Error("AllOrigins returned empty contents");
                return { contents: json.contents, finalUrl: json.status?.url || u };
            } catch (err) {
                clearTimeout(id);
                throw err;
            }
        },
        // 3. Codetabs Proxy (with timeout & correct quest= parameter)
        async (u) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 6000);
            try {
                const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`, { signal: controller.signal });
                clearTimeout(id);
                if (!res.ok) throw new Error(`Codetabs HTTP ${res.status}`);
                const text = await res.text();
                if (!text) throw new Error("Codetabs returned empty response");
                return { contents: text, finalUrl: u };
            } catch (err) {
                clearTimeout(id);
                throw err;
            }
        },
        // 4. ThingProxy (with timeout)
        async (u) => {
            const secureUrl = u.startsWith('http:') ? u.replace('http:', 'https:') : u;
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 6000);
            try {
                const res = await fetch(`https://thingproxy.freeboard.io/fetch/${secureUrl}`, { signal: controller.signal });
                clearTimeout(id);
                if (!res.ok) throw new Error(`ThingProxy HTTP ${res.status}`);
                const text = await res.text();
                if (!text) throw new Error("ThingProxy returned empty response");
                return { contents: text, finalUrl: u };
            } catch (err) {
                clearTimeout(id);
                throw err;
            }
        }
    ];

    let lastError = null;
    for (let i = 0; i < proxies.length; i++) {
        try {
            return await proxies[i](url);
        } catch (err) {
            console.warn(`Proxy ${i+1} falhou para ${url}:`, err);
            lastError = err;
        }
    }
    throw lastError || new Error("Todos os proxies falharam");
}

let lastResolvedCoupon = '';

function extractCouponFromTitle(title) {
    if (!title) return '';
    const matches = title.match(/\[?\bCUPOM\b:?\s*([A-Z0-9_-]{3,15})\]?/i);
    if (matches && matches[1]) {
        const potentialCode = matches[1].toUpperCase();
        const blacklist = ['OFF', 'DESCONTO', 'REAIS', 'OFERTA', 'CUPOM', 'GRATIS', 'FRETE'];
        if (!blacklist.includes(potentialCode)) {
            return potentialCode;
        }
    }
    return '';
}

function extractCouponFromDoc(doc) {
    const promobitCoupon = doc.querySelector('.coupon-code, .coupon, [class*="coupon-code" i], [class*="coupon__code" i], .couponCode, .coupon_code, .voucher-code, .voucher');
    if (promobitCoupon && promobitCoupon.textContent.trim()) {
        const text = promobitCoupon.textContent.trim();
        if (text.length >= 3 && text.length <= 15 && !text.includes(' ')) {
            return text.toUpperCase();
        }
    }
    
    const couponInput = doc.querySelector('input[value*="CUPOM" i], input[id*="coupon" i], input[class*="coupon" i]');
    if (couponInput && couponInput.value && couponInput.value.length >= 3 && couponInput.value.length <= 15) {
        return couponInput.value.trim().toUpperCase();
    }
    
    const bodyText = doc.body ? doc.body.innerText : '';
    if (bodyText) {
        const matches = bodyText.match(/cupom(?:\s+de\s+desconto)?:\s*([a-z0-9_-]{3,15})/i) ||
                        bodyText.match(/cupom\s+([a-z0-9_-]{3,15})/i);
        if (matches && matches[1]) {
            const potential = matches[1].toUpperCase();
            const blacklist = ['OFF', 'DESCONTO', 'REAIS', 'OFERTA', 'CUPOM', 'GRATIS', 'FRETE'];
            if (!blacklist.includes(potential)) {
                return potential;
            }
        }
    }
    return '';
}

function extractSchemaAndMetaValues(doc) {
    let title = '';
    let image = '';
    let price = '';
    let oldPrice = '';
    let coupon = extractCouponFromDoc(doc) || '';
    
    // Check for Next.js __NEXT_DATA__ (highly reliable for Promobit)
    const nextDataEl = doc.getElementById('__NEXT_DATA__');
    if (nextDataEl) {
        try {
            const nextData = JSON.parse(nextDataEl.textContent);
            const serverOffer = nextData.props?.pageProps?.serverOffer;
            if (serverOffer) {
                title = serverOffer.offerTitle || title;
                price = serverOffer.offerPrice ? String(serverOffer.offerPrice) : price;
                oldPrice = serverOffer.offerOldPrice ? String(serverOffer.offerOldPrice) : oldPrice;
                coupon = serverOffer.offerCoupon || coupon;
                
                if (serverOffer.offerPhoto) {
                    image = serverOffer.offerPhoto.startsWith('http') || serverOffer.offerPhoto.startsWith('//')
                        ? serverOffer.offerPhoto
                        : `https://www.promobit.com.br/static/p${serverOffer.offerPhoto}`;
                }
            }
        } catch (e) {
            console.error("Erro ao fazer parse de __NEXT_DATA__", e);
        }
    }
    
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
        try {
            const json = JSON.parse(script.textContent);
            const items = Array.isArray(json) ? json : (json['@graph'] ? json['@graph'] : [json]);
            for (const item of items) {
                if (item['@type'] === 'Product' || item['type'] === 'Product') {
                    if (item.name && !title) title = item.name;
                    if (item.image && !image) {
                        image = Array.isArray(item.image) ? item.image[0] : item.image;
                    }
                    if (item.offers) {
                        const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                        if (offers.price && !price) price = String(offers.price);
                        if (offers.lowPrice && !price) price = String(offers.lowPrice);
                        if (offers.highPrice && !oldPrice) oldPrice = String(offers.highPrice);
                    }
                }
            }
        } catch (e) {}
    }
    
    if (!title) {
        title = getMetaValue(doc, 'og:title') || getMetaValue(doc, 'twitter:title') || doc.title || '';
    }
    if (!image) {
        image = getMetaValue(doc, 'og:image') || getMetaValue(doc, 'twitter:image') || '';
    }
    if (!price) {
        price = getMetaValue(doc, 'product:price:amount') || 
                getMetaValue(doc, 'og:price:amount') || 
                getMetaValue(doc, 'price') ||
                (doc.querySelector('[itemprop="price"]') ? doc.querySelector('[itemprop="price"]').getAttribute('content') : '');
    }
    
    return { title, image, price, oldPrice, coupon };
}

function parsePriceToFloat(priceStr) {
    if (!priceStr) return 0;
    if (typeof priceStr === 'number') return priceStr;
    
    let clean = String(priceStr).trim();
    
    // If it contains a range (e.g. "19,90 - 29,90"), split and take the first price
    if (clean.includes('-')) {
        const parts = clean.split('-');
        clean = parts[0].trim();
    }
    
    // If it has spaces (e.g. "R$ 1.999,00 R$ 2.499,00"), split and take the first numeric part
    if (clean.includes(' ')) {
        const parts = clean.split(/\s+/);
        for (const part of parts) {
            if (/\d/.test(part)) {
                clean = part.trim();
                break;
            }
        }
    }
    
    clean = clean.replace(/[^\d,.-]/g, '').trim();
    if (!clean) return 0;
    
    const commaCount = (clean.match(/,/g) || []).length;
    const dotCount = (clean.match(/\./g) || []).length;
    
    if (commaCount === 1 && dotCount === 0) {
        clean = clean.replace(',', '.');
    } else if (dotCount === 1 && commaCount === 0) {
        const parts = clean.split('.');
        const lastPart = parts[parts.length - 1];
        if (lastPart.length === 3) {
            clean = clean.replace(/\./g, '');
        }
    } else if (commaCount > 0 && dotCount > 0) {
        const firstComma = clean.indexOf(',');
        const firstDot = clean.indexOf('.');
        if (firstComma < firstDot) {
            clean = clean.replace(/,/g, '');
        } else {
            clean = clean.replace(/\./g, '').replace(',', '.');
        }
    } else if (dotCount > 1) {
        clean = clean.replace(/\./g, '');
    } else if (commaCount > 1) {
        clean = clean.replace(/,/g, '');
    }
    
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
}

function getLowerPrice(p1, p2) {
    const v1 = parsePriceToFloat(p1);
    const v2 = parsePriceToFloat(p2);
    if (v1 > 0 && v2 > 0) {
        return v1 < v2 ? p1 : p2;
    }
    return p1 || p2 || '';
}

function getHigherPrice(p1, p2) {
    const v1 = parsePriceToFloat(p1);
    const v2 = parsePriceToFloat(p2);
    if (v1 > 0 && v2 > 0) {
        return v1 > v2 ? p1 : p2;
    }
    return p1 || p2 || '';
}

async function scrapeProductInfo(url, platform) {
    const data = await fetchViaProxy(url);
    const html = data.contents;
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    let result = { title: '', price: '', oldPrice: '', image: '' };

    const schemaData = extractSchemaAndMetaValues(doc);

    if (platform === 'amazon') {
        const titleEl = doc.querySelector('#productTitle');
        if (titleEl) result.title = titleEl.textContent.trim();
        
        const priceContainer = doc.querySelector('#corePriceDisplay_desktop_feature_div') || 
                               doc.querySelector('#corePrice_desktop') || 
                               doc.querySelector('#apex_desktop') ||
                               doc.querySelector('#priceInsideBuyBox') ||
                               doc.querySelector('#newBuyBoxPrice') ||
                               doc;
                               
        const priceOffscreen = priceContainer.querySelector('.a-price .a-offscreen') || 
                               priceContainer.querySelector('.a-offscreen');
        const priceWhole = priceContainer.querySelector('.a-price-whole');
        const priceFraction = priceContainer.querySelector('.a-price-fraction');
        
        if (priceOffscreen) {
            result.price = parseNumericPrice(priceOffscreen.textContent);
        } else if (priceWhole) {
            result.price = priceWhole.textContent.replace(/[^\d]/g, '') + ',' + (priceFraction ? priceFraction.textContent.replace(/[^\d]/g, '') : '00');
        } else {
            const priceBlock = priceContainer.querySelector('#priceblock_ourprice') || 
                               priceContainer.querySelector('#priceblock_dealprice') ||
                               doc.querySelector('#priceblock_ourprice') || 
                               doc.querySelector('#priceblock_dealprice');
            if (priceBlock) result.price = parseNumericPrice(priceBlock.textContent);
        }

        const oldPriceContainer = doc.querySelector('#corePriceDisplay_desktop_feature_div') || 
                                  doc.querySelector('#corePrice_desktop') || 
                                  doc.querySelector('#apex_desktop') ||
                                  doc;
        const oldPriceEl = oldPriceContainer.querySelector('.basisPrice .a-offscreen') || 
                           oldPriceContainer.querySelector('span.a-price.a-text-price span.a-offscreen') || 
                           oldPriceContainer.querySelector('span.a-price.a-text-price') || 
                           oldPriceContainer.querySelector('.a-line-through') || 
                           oldPriceContainer.querySelector('.a-size-small.a-color-secondary.a-text-strike') ||
                           doc.querySelector('.basisPrice .a-offscreen') ||
                           doc.querySelector('span.a-price.a-text-price span.a-offscreen');
        if (oldPriceEl) result.oldPrice = parseNumericPrice(oldPriceEl.textContent);

        const imgEl = doc.querySelector('#landingImage') || doc.querySelector('#imgBlkFront');
        if (imgEl) result.image = imgEl.getAttribute('src') || imgEl.getAttribute('data-a-dynamic-image') || result.image;
        if (result.image.startsWith('{')) {
            try { result.image = Object.keys(JSON.parse(result.image))[0]; } catch(e) {}
        }
    } 
    else if (platform === 'mercadolivre') {
        const titleEl = doc.querySelector('.ui-pdp-title');
        if (titleEl) result.title = titleEl.textContent.trim();

        const mainPriceContainer = doc.querySelector('.ui-pdp-price__second-line') || 
                                   doc.querySelector('.ui-vip-core-price') || 
                                   doc.querySelector('.ui-pdp-price') ||
                                   doc;
        const priceFraction = mainPriceContainer.querySelector('.andes-money-amount__fraction');
        const priceCents = mainPriceContainer.querySelector('.andes-money-amount__cents');
        if (priceFraction) {
            result.price = priceFraction.textContent.trim() + ',' + (priceCents ? priceCents.textContent.trim() : '00');
        }

        const oldPriceContainer = doc.querySelector('.ui-pdp-price__original-value') || 
                                  doc.querySelector('.ui-pdp-price__old') || 
                                  doc;
        const oldPriceFraction = oldPriceContainer.querySelector('.andes-money-amount__fraction');
        const oldPriceCents = oldPriceContainer.querySelector('.andes-money-amount__cents');
        if (oldPriceFraction) {
            result.oldPrice = oldPriceFraction.textContent.trim() + ',' + (oldPriceCents ? oldPriceCents.textContent.trim() : '00');
        }

        const imgEl = doc.querySelector('.ui-pdp-gallery__figure__image') || doc.querySelector('.ui-pdp-image');
        if (imgEl) result.image = imgEl.getAttribute('src') || imgEl.getAttribute('data-zoom') || result.image;
    }
    else if (platform === 'shopee') {
        result.title = schemaData.title || getMetaValue(doc, 'og:title') || '';
        result.image = schemaData.image || getMetaValue(doc, 'og:image') || '';
        result.price = schemaData.price || '';
        result.oldPrice = schemaData.oldPrice || '';
    }
    else if (platform === 'aliexpress') {
        result.title = schemaData.title || getMetaValue(doc, 'og:title') || doc.title || '';
        result.image = schemaData.image || getMetaValue(doc, 'og:image') || '';
        result.price = schemaData.price || '';
        result.oldPrice = schemaData.oldPrice || '';

        // Fallbacks for HTML elements
        if (!result.title) {
            const titleEl = doc.querySelector('.product-title, [class*="product-title" i], h1');
            if (titleEl) result.title = titleEl.textContent.trim();
        }
        if (!result.image) {
            const imgEl = doc.querySelector('.magnifier-image, [class*="magnifier" i], [class*="product-image" i] img, img[src*="item/detail"]');
            if (imgEl) result.image = imgEl.getAttribute('src');
        }
        if (!result.price) {
            const priceEl = doc.querySelector('.product-price-value, [class*="price-current" i], [class*="price-value" i], [class*="product-price" i]');
            if (priceEl) result.price = parseNumericPrice(priceEl.textContent);
        }
        if (!result.oldPrice) {
            const oldPriceEl = doc.querySelector('.product-price-del, [class*="price-original" i], [class*="price-del" i], del');
            if (oldPriceEl) result.oldPrice = parseNumericPrice(oldPriceEl.textContent);
        }

        const scripts = doc.querySelectorAll('script');
        scripts.forEach(s => {
            if (s.textContent.includes('runParams')) {
                const priceMatch = s.textContent.match(/"actPrice"\s*:\s*"([^"]+)"/i) || 
                                   s.textContent.match(/"price"\s*:\s*"([^"]+)"/i) ||
                                   s.textContent.match(/"formatedActivityPrice"\s*:\s*"([^"]+)"/i) ||
                                   s.textContent.match(/"formatedPrice"\s*:\s*"([^"]+)"/i);
                if (priceMatch && priceMatch[1] && !result.price) {
                    result.price = priceMatch[1];
                }
            }
        });
    }

    // Merge schema data and platform-specific scraped data
    result.title = schemaData.title || result.title || '';
    result.image = schemaData.image || result.image || '';
    result.price = getLowerPrice(schemaData.price, result.price);
    result.oldPrice = getHigherPrice(schemaData.oldPrice, result.oldPrice);

    if (result.title) result.title = cleanTitle(result.title);
    if (result.price) result.price = formatCurrencyText(result.price);
    if (result.oldPrice) result.oldPrice = formatCurrencyText(result.oldPrice);

    return result;
}

function getMetaValue(doc, name) {
    const meta = doc.querySelector(`meta[property="${name}"]`) || doc.querySelector(`meta[name="${name}"]`);
    return meta ? meta.getAttribute('content') : null;
}

function cleanTitle(title) {
    return title
        .replace(/\|.*/, '')
        .replace(/- Mercado Livre.*/i, '')
        .replace(/- Amazon.com.br.*/i, '')
        .replace(/: Amazon.com.br.*/i, '')
        .trim();
}

function parseNumericPrice(val) {
    if (!val) return '';
    const clean = val.replace(/[^\d,.]/g, '').trim();
    return clean;
}

function formatCurrencyText(val) {
    if (val === undefined || val === null) return '';
    let clean = String(val).replace(/[^\d,.-]/g, '').trim();
    if (!clean) return '';
    
    const num = parsePriceToFloat(clean);
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ==========================================================================
   URL CLEANING & REDIRECT RESOLUTION HELPERS
   ========================================================================== */
function isShortlink(url) {
    if (!url) return false;
    const lowercaseUrl = url.toLowerCase();
    return lowercaseUrl.includes('shope.ee') || 
           lowercaseUrl.includes('shp.ee') || 
           lowercaseUrl.includes('s.shopee.com') || 
           lowercaseUrl.includes('meli.la') || 
           lowercaseUrl.includes('meli.li') || 
           lowercaseUrl.includes('amzn.to') || 
           lowercaseUrl.includes('s.click.aliexpress.com') ||
           lowercaseUrl.includes('a.aliexpress.com') ||
           lowercaseUrl.includes('aliexpress.com/e/') ||
           lowercaseUrl.includes('mpago.la') ||
           lowercaseUrl.includes('promoby.me');
}

function extractTargetUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        // Look for common nested redirect parameters
        const params = ['url', 'link', 'dl_target_url', 'ulp', 'dest', 'destination', 'u', 'openid.returnto', 'redirect_url', 'next', 'return_to', 'returnto'];
        for (const param of params) {
            const val = parsed.searchParams.get(param);
            if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
                return extractTargetUrl(val);
            }
        }
    } catch (e) {}
    return url;
}

function cleanProductUrl(url) {
    if (!url) return '';
    let target = extractTargetUrl(url);
    try {
        const parsed = new URL(target);
        const platform = detectPlatform(target);
        
        if (platform === 'mercadolivre') {
            const cleanParams = ['url', 'as_source', 'as_campaign', 'matt_tool', 'matt_word', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
            cleanParams.forEach(p => parsed.searchParams.delete(p));
            return parsed.toString();
        } else if (platform === 'shopee') {
            const cleanParams = ['sp_atk', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'xgids'];
            cleanParams.forEach(p => parsed.searchParams.delete(p));
            return parsed.toString();
        } else if (platform === 'amazon') {
            parsed.searchParams.delete('tag');
            parsed.searchParams.delete('language');
            parsed.searchParams.delete('ref_');
            return parsed.toString();
        }
    } catch (e) {}
    return target;
}

function isProductUrl(url, platform) {
    if (!url) return false;
    const lowercaseUrl = url.toLowerCase();
    
    if (platform === 'amazon') {
        return /\/(?:dp|gp\/product|product)\/[a-z0-9]{10}/i.test(url);
    }
    if (platform === 'mercadolivre') {
        return lowercaseUrl.includes('/mlb-') || lowercaseUrl.includes('/p/mlb') || lowercaseUrl.includes('produto.mercadolivre.com.br') || /\/p\/[a-z0-9]+/i.test(url);
    }
    if (platform === 'shopee') {
        return /-i\.\d+\.\d+/i.test(url) || lowercaseUrl.includes('/product/');
    }
    if (platform === 'aliexpress') {
        return lowercaseUrl.includes('/item/') || /\/item\/\d+\.html/i.test(url);
    }
    return false;
}

/* ==========================================================================
   AFFILIATE CONVERSION ENGINE
   ========================================================================== */
async function convertToAffiliate(url, platform) {
    // Clean target product URL first to strip previous affiliate tags and nested redirects
    const cleanUrl = cleanProductUrl(url);
    
    if (platform === 'amazon') {
        const tag = state.config.amzTag || 'tag-afiliado-20';
        const asinMatch = cleanUrl.match(/(?:\/dp\/|\/gp\/product\/|\/product\/)([A-Z0-9]{10})/i);
        if (asinMatch && asinMatch[1]) {
            return `https://www.amazon.com.br/dp/${asinMatch[1]}?tag=${tag}`;
        }
        return `${cleanUrl}${cleanUrl.includes('?') ? '&' : '?'}tag=${tag}`;
    }
    
    else if (platform === 'mercadolivre') {
        const campaign = state.config.mlCampaign || 'ofertasbot';
        if (campaign.includes('lomadee') || (campaign === '' && state.config.shopeeFallback.includes('lomadee'))) {
            const lomadeeKey = state.config.shopeeFallback || 'suachavelomadee';
            return `https://links.lomadee.com/v2/generator?key=${lomadeeKey}&sourceId=38000000&link=${encodeURIComponent(cleanUrl)}`;
        }
        if (campaign.startsWith('http')) {
            return `${campaign}${campaign.includes('?') ? '&' : '?'}url=${encodeURIComponent(cleanUrl)}`;
        }
        try {
            const parsedUrl = new URL(cleanUrl);
            parsedUrl.searchParams.set('affiliate', campaign);
            return parsedUrl.toString();
        } catch (e) {
            return `${cleanUrl}${cleanUrl.includes('?') ? '&' : '?'}affiliate=${campaign}`;
        }
    }
    
    else if (platform === 'shopee') {
        if (state.config.shopeeKey && state.config.shopeeSecret) {
            try {
                return await fetchShopeeOfficialLink(cleanUrl);
            } catch (err) {
                console.error("Erro na API oficial da Shopee, gerando link alternativo", err);
            }
        }
        
        const fallback = state.config.shopeeFallback || '';
        if (fallback.includes('lomadee')) {
            return `https://links.lomadee.com/v2/generator?key=${fallback}&sourceId=38000000&link=${encodeURIComponent(cleanUrl)}`;
        } else if (fallback.startsWith('http')) {
            return `${fallback}${fallback.includes('?') ? '&' : '?'}sub_id=ofertasbot&url=${encodeURIComponent(cleanUrl)}`;
        }
        return cleanUrl;
    }
    
    else if (platform === 'aliexpress') {
        const trackingId = state.config.aliId || 'default_ali_id';
        if (trackingId.startsWith('http')) {
            return `${trackingId}${trackingId.includes('?') ? '&' : '?'}dl_target_url=${encodeURIComponent(cleanUrl)}`;
        }
        return `https://s.click.aliexpress.com/e/_${trackingId}?dl_target_url=${encodeURIComponent(cleanUrl)}`;
    }

    return cleanUrl;
}

/* OFFICIAL SHOPEE OPEN API SIGNATURE GENERATION */
async function fetchShopeeOfficialLink(originUrl) {
    const appKey = state.config.shopeeKey;
    const appSecret = state.config.shopeeSecret;
    const timestamp = Math.floor(Date.now() / 1000);
    
    const graphqlQuery = {
        query: `mutation {
            generateShortLink(originUrl: "${originUrl}") {
                shortLink
            }
        }`
    };
    
    const requestBody = JSON.stringify(graphqlQuery);
    const rawSignatureString = appKey + timestamp + requestBody + appSecret;
    const signature = await calculateSHA256(rawSignatureString);
    
    const targetApiUrl = 'https://open-api.affiliate.shopee.com.br/api/v1/rest';
    
    const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetApiUrl)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `SHA256 AppKey=${appKey}, Timestamp=${timestamp}, Sign=${signature}`
        },
        body: requestBody
    });
    
    if (!response.ok) throw new Error("Erro na rede da API Shopee");
    const json = await response.json();
    
    if (json.data && json.data.generateShortLink && json.data.generateShortLink.shortLink) {
        return json.data.generateShortLink.shortLink;
    }
    
    throw new Error(json.errors ? json.errors[0].message : "Formato de retorno Shopee inválido");
}

async function calculateSHA256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ==========================================================================
   LIVE PREVIEW & MESSAGES TEMPLATING
   ========================================================================== */
function syncFormToState() {
    state.currentProduct.title = document.getElementById('prod-title').value.trim();
    state.currentProduct.oldPrice = document.getElementById('prod-price-old').value.trim();
    state.currentProduct.price = document.getElementById('prod-price-new').value.trim();
    state.currentProduct.image = document.getElementById('prod-image').value.trim();
    state.currentProduct.convertedUrl = document.getElementById('prod-aff-url').value.trim();
    state.currentProduct.coupon = document.getElementById('prod-coupon').value.trim();
}

function generateDefaultMessageText() {
    let discount = '0';
    if (state.currentProduct.oldPrice && state.currentProduct.price) {
        const oldVal = parsePriceToFloat(state.currentProduct.oldPrice);
        const newVal = parsePriceToFloat(state.currentProduct.price);
        if (oldVal > newVal && oldVal > 0) {
            discount = Math.round((1 - newVal / oldVal) * 100).toString();
        }
    }

    let text = state.template;
    text = text.replace(/{title}/g, state.currentProduct.title || 'Título do Produto');
    text = text.replace(/{oldPrice}/g, state.currentProduct.oldPrice || '0,00');
    text = text.replace(/{price}/g, state.currentProduct.price || '0,00');
    text = text.replace(/{link}/g, state.currentProduct.convertedUrl || '#');
    text = text.replace(/{discount}/g, discount);
    
    if (state.currentProduct.coupon) {
        text = text.replace(/{coupon}/g, state.currentProduct.coupon);
    } else {
        text = text.replace(/🎫 Cupom: <b>{coupon}<\/b>\r?\n?/g, '')
                   .replace(/🎫 Cupom: {coupon}\r?\n?/g, '')
                   .replace(/{coupon}/g, '');
    }

    document.getElementById('message-content').value = text;
    document.getElementById('char-counter').innerText = `${text.length} caracteres`;
}

function updateLivePreview() {
    const title = state.currentProduct.title || 'Smartphone Novo Modelo';
    const oldPrice = state.currentProduct.oldPrice || '1.999,00';
    const price = state.currentProduct.price || '1.499,00';
    const imgUrl = state.currentProduct.image;
    const affUrl = state.currentProduct.convertedUrl || '#';

    const previewImg = document.getElementById('preview-image');
    const placeholder = document.getElementById('preview-image-placeholder');
    
    if (imgUrl) {
        previewImg.src = imgUrl;
        previewImg.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        previewImg.removeAttribute('src');
        previewImg.style.display = 'none';
        placeholder.style.display = 'flex';
    }

    const textEditor = document.getElementById('message-content').value;
    const htmlText = convertMarkdownToHtml(textEditor);
    document.getElementById('preview-text').innerHTML = htmlText || '<i>Escreva uma mensagem...</i>';

    const actionBtn = document.getElementById('preview-action-btn');
    actionBtn.href = affUrl;
    
    const now = new Date();
    document.getElementById('preview-time').innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function convertMarkdownToHtml(text) {
    if (!text) return '';
    let html = text;
    
    html = html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    html = html
        .replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>')
        .replace(/&lt;strong&gt;/g, '<strong>').replace(/&lt;\/strong&gt;/g, '</strong>')
        .replace(/&lt;i&gt;/g, '<i>').replace(/&lt;\/i&gt;/g, '</i>')
        .replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>')
        .replace(/&lt;s&gt;/g, '<s>').replace(/&lt;\/s&gt;/g, '</s>')
        .replace(/&lt;strike&gt;/g, '<strike>').replace(/&lt;\/strike&gt;/g, '</strike>')
        .replace(/&lt;del&gt;/g, '<del>').replace(/&lt;\/del&gt;/g, '</del>')
        .replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>')
        .replace(/&lt;code&gt;/g, '<code>').replace(/&lt;\/code&gt;/g, '</code>')
        .replace(/&lt;pre&gt;/g, '<pre>').replace(/&lt;\/pre&gt;/g, '</pre>');

    html = html.replace(/\*([^*]+)\*/g, '<b>$1</b>');
    html = html.replace(/_([^_]+)_/g, '<i>$1</i>');
    html = html.replace(/~([^~]+)~/g, '<s>$1</s>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    const urlPattern = /(\b(https?):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    html = html.replace(urlPattern, '<a href="$1" target="_blank">$1</a>');

    return html;
}

function resetProductForm() {
    document.getElementById('product-form').style.display = 'none';
    document.getElementById('raw-url').value = '';
    document.getElementById('prod-coupon').value = '';
    
    state.currentProduct = {
        rawUrl: '',
        convertedUrl: '',
        title: '',
        oldPrice: '',
        price: '',
        image: '',
        marketplace: '',
        coupon: ''
    };
}

/* ==========================================================================
   TELEGRAM INTEGRATION (FETCH CLIENT-SIDE)
   ========================================================================== */
async function handlePostTelegram() {
    const token = state.config.tgToken;
    const chatId = state.config.tgChatId;
    
    if (!token || !chatId) {
        showToast('Configure o Telegram na aba "Configurações" antes de postar.', 'error');
        document.getElementById('btn-tab-config').click();
        return;
    }

    const messageText = document.getElementById('message-content').value;
    if (!messageText) {
        showToast('Escreva ou gere uma mensagem para postar.', 'warning');
        return;
    }

    const imageUrl = state.currentProduct.image;
    const affUrl = state.currentProduct.convertedUrl;
    
    if (affUrl && (affUrl.includes('promobit.com.br') || affUrl.includes('promoby.me') || affUrl.includes('gatry.com'))) {
        showToast('ERRO: Não é possível publicar um link do Promobit ou Gatry no Telegram. Insira o link direto da loja ou aguarde a resolução completa.', 'error');
        return;
    }
    
    showToast('Enviando post para o Telegram...', 'info');

    let tgHtml = messageText;
    tgHtml = tgHtml.replace(/\*([^*]+)\*/g, '<b>$1</b>');
    tgHtml = tgHtml.replace(/_([^_]+)_/g, '<i>$1</i>');
    tgHtml = tgHtml.replace(/~([^~]+)~/g, '<s>$1</s>');
    tgHtml = tgHtml.replace(/`([^`]+)`/g, '<code>$1</code>');

    const replyMarkup = {
        inline_keyboard: [[
            { text: '🛒 COMPRAR AGORA', url: affUrl || 'https://shopee.com.br' }
        ]]
    };

    let urlCall = '';
    let payload = {};
    let usingPhoto = false;

    // Check if image URL is a valid public HTTP/HTTPS URL
    if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        urlCall = `https://api.telegram.org/bot${token}/sendPhoto`;
        payload = {
            chat_id: chatId,
            photo: imageUrl,
            caption: tgHtml,
            parse_mode: 'HTML',
            reply_markup: JSON.stringify(replyMarkup)
        };
        usingPhoto = true;
    } else {
        urlCall = `https://api.telegram.org/bot${token}/sendMessage`;
        payload = {
            chat_id: chatId,
            text: tgHtml,
            parse_mode: 'HTML',
            reply_markup: JSON.stringify(replyMarkup)
        };
    }

    try {
        let res = await fetch(urlCall, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        let data = await res.json();
        
        // Fallback if sendPhoto failed due to web page content type / bad image URL
        if (!data.ok && usingPhoto) {
            console.warn("Telegram sendPhoto failed, falling back to sendMessage. Error:", data.description);
            showToast('Erro com a imagem. Tentando enviar apenas com texto...', 'warning');
            
            urlCall = `https://api.telegram.org/bot${token}/sendMessage`;
            payload = {
                chat_id: chatId,
                text: tgHtml,
                parse_mode: 'HTML',
                reply_markup: JSON.stringify(replyMarkup)
            };
            
            res = await fetch(urlCall, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            data = await res.json();
        }
        
        if (data.ok) {
            showToast('Oferta publicada no Telegram!', 'success');
            
            let tgLink = '';
            if (data.result && data.result.chat && data.result.chat.username) {
                tgLink = `https://t.me/${data.result.chat.username}/${data.result.message_id}`;
            } else if (chatId.startsWith('@')) {
                tgLink = `https://t.me/${chatId.replace('@', '')}/${data.result.message_id}`;
            }

            addToHistory({
                title: state.currentProduct.title || 'Produto sem título',
                marketplace: state.currentProduct.marketplace,
                price: state.currentProduct.price || '0,00',
                image: state.currentProduct.image,
                timestamp: Date.now(),
                tgLink: tgLink
            });

            resetProductForm();
            updateLivePreview();
        } else {
            console.error(data);
            showToast(`Falha ao enviar: ${data.description}`, 'error');
        }

    } catch (error) {
        console.error("Erro no envio", error);
        showToast('Erro de conexão ao enviar para o Telegram.', 'error');
    }
}

/* ==========================================================================
   HISTORY MANAGEMENT
   ========================================================================== */
function addToHistory(item) {
    state.history.unshift(item);
    if (state.history.length > 50) {
        state.history.pop();
    }
    localStorage.setItem('cfg_history_tg', JSON.stringify(state.history));
    renderHistory();
}

function renderHistory() {
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = '';
    
    if (state.history.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="5">Nenhuma oferta enviada ainda. Suas ofertas aparecerão aqui após postar!</td>
            </tr>
        `;
        return;
    }

    state.history.forEach((item, index) => {
        const row = document.createElement('tr');
        
        const dateStr = new Date(item.timestamp).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        const badgeClass = item.marketplace ? item.marketplace.toLowerCase() : 'desconhecido';
        const labelText = item.marketplace ? item.marketplace.charAt(0).toUpperCase() + item.marketplace.slice(1) : 'Desconhecido';

        row.innerHTML = `
            <td>
                <div class="history-prod-cell">
                    ${item.image ? `<img src="${item.image}" class="history-thumb" alt="Miniatura">` : `<div class="history-thumb" style="display:flex;align-items:center;justify-content:center;background:#1a1c29"><i class="fa-solid fa-camera" style="color:#4b5a6a"></i></div>`}
                    <span class="history-title-txt" title="${item.title}">${item.title}</span>
                </div>
            </td>
            <td>
                <span class="badge-plat ${badgeClass}">${labelText}</span>
            </td>
            <td><strong>R$ ${item.price}</strong></td>
            <td>${dateStr}</td>
            <td>
                <div class="history-actions">
                    ${item.tgLink ? `
                        <a href="${item.tgLink}" target="_blank" class="history-action-btn btn-tg-link" title="Ver no Telegram">
                            <i class="fa-brands fa-telegram"></i>
                        </a>
                    ` : ''}
                    <button class="history-action-btn" onclick="reuseOffer(${index})" title="Reutilizar dados">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>
                    <button class="history-action-btn" style="color:var(--danger)" onclick="deleteHistoryItem(${index})" title="Remover do Histórico">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

window.reuseOffer = function(index) {
    const item = state.history[index];
    if (!item) return;

    state.currentProduct = {
        rawUrl: '',
        convertedUrl: '',
        title: item.title,
        oldPrice: '',
        price: item.price,
        image: item.image,
        marketplace: item.marketplace
    };

    document.getElementById('prod-title').value = item.title;
    document.getElementById('prod-price-old').value = '';
    document.getElementById('prod-price-new').value = item.price;
    document.getElementById('prod-image').value = item.image;
    document.getElementById('prod-aff-url').value = '';

    document.getElementById('btn-tab-converter').click();
    document.getElementById('product-form').style.display = 'block';
    
    generateDefaultMessageText();
    updateLivePreview();
    
    showToast('Dados da oferta carregados no conversor!', 'info');
};

window.deleteHistoryItem = function(index) {
    state.history.splice(index, 1);
    localStorage.setItem('cfg_history_tg', JSON.stringify(state.history));
    renderHistory();
    showToast('Oferta removida do histórico.', 'info');
};

/* ==========================================================================
   UI UTILS & HELPERS
   ========================================================================== */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

function copyTextToClipboard(text, successMsg = 'Copiado!') {
    navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg, 'success');
    }).catch(err => {
        console.error('Falha ao copiar texto: ', err);
        showToast('Erro ao copiar para a área de transferência.', 'error');
    });
}

/* ==========================================================================
   AUTOMATION CORE FUNCTIONS (BROWSER SCRAPER LOOP)
   ========================================================================== */
function writeLog(message, type = 'info') {
    const logsArea = document.getElementById('console-logs-area');
    if (!logsArea) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const logEl = document.createElement('div');
    logEl.className = `log-line ${type}`;
    logEl.innerText = `[${timeStr}] ${message}`;

    logsArea.appendChild(logEl);
    
    // Auto-scroll to bottom
    logsArea.scrollTop = logsArea.scrollHeight;
}

function updateAutomationUI(active) {
    const btn = document.getElementById('btn-toggle-automation');
    const dot = document.getElementById('auto-dot');
    const txt = document.getElementById('auto-txt-status');
    
    if (active) {
        dot.className = 'status-dot pulsing';
        txt.innerText = 'Autopost Ativo';
        btn.className = 'btn-secondary';
        btn.innerHTML = '<span>Parar Autopost</span> <i class="fa-solid fa-stop" style="color:var(--danger)"></i>';
    } else {
        dot.className = 'status-dot offline';
        txt.innerText = 'Autopost Desativado';
        btn.className = 'btn-primary';
        btn.innerHTML = '<span>Iniciar Autopost</span> <i class="fa-solid fa-play"></i>';
    }
}

let logsInterval = null;

function startLogsPolling() {
    if (logsInterval) return;
    
    logsInterval = setInterval(async () => {
        const token = localStorage.getItem('auth_token');
        if (!token) return;
        
        try {
            const res = await fetch('/api/automation/logs', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.logs && data.logs.length > 0) {
                    const logsArea = document.getElementById('console-logs-area');
                    if (logsArea) {
                        logsArea.innerHTML = '';
                        data.logs.forEach(line => {
                            const logEl = document.createElement('div');
                            logEl.className = 'log-line';
                            
                            if (line.includes('✅') || line.includes('[SUCCESS]') || line.includes('sucesso')) {
                                logEl.className += ' success';
                            } else if (line.includes('❌') || line.includes('[ERROR]') || line.includes('ERRO')) {
                                logEl.className += ' error';
                            } else if (line.includes('⚠️') || line.includes('AVISO') || line.includes('[WARNING]') || line.includes('Pulado')) {
                                logEl.className += ' warning';
                            }
                            
                            logEl.innerText = line;
                            logsArea.appendChild(logEl);
                        });
                        logsArea.scrollTop = logsArea.scrollHeight;
                    }
                }
            }
        } catch(e) {
            console.error("Erro no polling de logs", e);
        }
    }, 3000);
}

async function toggleAutomation() {
    const token = state.config.tgToken;
    const chatId = state.config.tgChatId;

    if (!token || !chatId) {
        showToast('Configure o Token e o Chat ID nas "Configurações" antes de iniciar.', 'error');
        writeLog('ERRO: Token ou Chat ID do Telegram ausentes nas configurações.', 'error');
        document.getElementById('btn-tab-config').click();
        return;
    }

    const hasAff = state.config.amzTag || state.config.mlCampaign || state.config.shopeeFallback || (state.config.shopeeKey && state.config.shopeeSecret) || state.config.aliId;
    if (!hasAff) {
        showToast('Configure pelo menos um ID de Afiliado nas "Configurações" antes de iniciar.', 'error');
        writeLog('ERRO: Nenhum ID de afiliado configurado.', 'error');
        document.getElementById('btn-tab-config').click();
        return;
    }

    const activeState = !state.automation.active;
    const minutes = parseInt(document.getElementById('cfg-auto-interval').value) || 10;
    
    const authToken = localStorage.getItem('auth_token');
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': authToken ? `Bearer ${authToken}` : ''
    };

    try {
        const res = await fetch('/api/automation/toggle', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                active: activeState,
                interval: minutes
            })
        });
        
        if (!res.ok) throw new Error("Erro na rede ao alternar automação");
        const data = await res.json();
        
        state.automation.active = data.active;
        updateAutomationUI(state.automation.active);
        
        if (state.automation.active) {
            writeLog(`Automação ativada no servidor! Frequência: a cada ${minutes} minuto(s).`, 'success');
            showToast('Autopostagem iniciada no servidor!', 'success');
        } else {
            writeLog('Automação desativada no servidor pelo usuário.', 'warning');
            showToast('Autopostagem parada no servidor.', 'info');
        }
    } catch (err) {
        console.error("Falha ao alternar automação", err);
        showToast('Erro ao conectar com o servidor de automação.', 'error');
    }
}

function isDealInSelectedCategory(deal, selectedCat) {
    if (!selectedCat || selectedCat === 'all') return true;
    
    // Promobit is already filtered at the fetch level by using the category-specific URL
    if (deal.source === 'promobit') return true;
    
    // For Gatry (and other general sources), we filter by title keywords
    const title = deal.title.toLowerCase();
    
    if (selectedCat === 'automotivo') {
        const automotiveKeywords = [
            'pneu', 'capacete', 'óleo', 'lubrificante', 'carro', 'moto', 'motociclista', 'automotivo', 
            'multimídia', 'alto-falante', 'retrovisor', 'calota', 'aditivo', 'freio', 'farol', 'lanterna', 
            'para-brisa', 'veicular', 'compressor', 'aspirador portátil', 'cadeirinha', 'ferramenta', 
            'macaco', 'tampa', 'bateria', 'suporte celular', 'jaqueta', 'luva', 'bota', 'intercomunicador',
            'gps', 'alarme', 'som ', 'pioneer', 'jbl', 'limpador', 'cera', 'polimento', 'shampoo', 'pretinho',
            'parabrisa', 'motocicleta', 'cavalete', 'escape', 'escapamento', 'motos', 'carros'
        ];
        return automotiveKeywords.some(keyword => title.includes(keyword));
    }
    
    if (selectedCat === 'informatica') {
        const informaticaKeywords = [
            'notebook', 'pc', 'computador', 'monitor', 'teclado', 'mouse', 'ssd', 'hd', 'memória', 'ram',
            'processador', 'ryzen', 'intel', 'geforce', 'radeon', 'nvidia', 'amd', 'placa de vídeo', 
            'placa mae', 'placa mãe', 'gabinete', 'fonte', 'cooler', 'roteador', 'switch', 'headset', 
            'impressora', 'toner', 'cartucho', 'wi-fi', 'wifi', 'pendrive', 'pen drive', 'microfone'
        ];
        return informaticaKeywords.some(keyword => title.includes(keyword));
    }
    
    if (selectedCat === 'games') {
        const gamesKeywords = [
            'ps5', 'playstation', 'xbox', 'nintendo', 'switch', 'console', 'game', 'jogo', 'joystick', 
            'controle', 'dualsense', 'gamer', 'headset gamer', 'cadeira gamer', 'teclado gamer', 
            'mouse gamer', 'steam', 'playstation 5', 'playstation 4', 'ps4'
        ];
        return gamesKeywords.some(keyword => title.includes(keyword));
    }
    
    if (selectedCat === 'smartphones') {
        const smartphonesKeywords = [
            'celular', 'smartphone', 'iphone', 'galaxy', 'motorola', 'xiaomi', 'redmi', 'poco', 'asus', 
            'realme', 'capinha', 'película', 'carregador', 'cabo usb', 'fone de ouvido', 'smartwatch'
        ];
        return smartphonesKeywords.some(keyword => title.includes(keyword));
    }
    
    return true;
}

async function runAutomationScan() {
    if (!state.automation.active) return;

    const selectedCat = state.automation.category || 'all';

    const sourcePromobit = document.getElementById('chk-src-promobit').checked;
    const sourceGatry = document.getElementById('chk-src-gatry').checked;

    if (!sourcePromobit && !sourceGatry) {
        writeLog('AVISO: Nenhuma fonte de ofertas (Promobit/Gatry) selecionada.', 'warning');
        return;
    }

    writeLog('Buscando novas ofertas nos agregadores...', 'info');

    let deals = [];

    // 1. Promobit Homepage HTML & JSON-LD
    if (sourcePromobit) {
        try {
            writeLog('Conectando ao Promobit...', 'info');
            
            // Build the URL based on the chosen category focus
            let promobitUrl = 'https://www.promobit.com.br/';
            if (selectedCat === 'informatica') {
                promobitUrl = 'https://www.promobit.com.br/promocoes/informatica/';
                writeLog('Foco de categoria: Informática & Hardware (PC)', 'info');
            } else if (selectedCat === 'games') {
                promobitUrl = 'https://www.promobit.com.br/promocoes/games/';
                writeLog('Foco de categoria: Games e Consoles', 'info');
            } else if (selectedCat === 'smartphones') {
                promobitUrl = 'https://www.promobit.com.br/promocoes/smartphones-tablets-e-telefones/';
                writeLog('Foco de categoria: Celulares & Smartphones', 'info');
            } else if (selectedCat === 'automotivo') {
                promobitUrl = 'https://www.promobit.com.br/promocoes/pecas-e-acessorios-para-automoveis/';
                writeLog('Foco de categoria: Carros & Motos (Automotivo)', 'info');
            }
            
            const data = await fetchViaProxy(promobitUrl);
            
            if (data.contents && (data.contents.includes('cf-challenge') || data.contents.includes('Just a moment...') || data.contents.includes('Attention Required!'))) {
                writeLog('AVISO: O Promobit bloqueou o proxy via Cloudflare. DICA: Ative uma extensão de desativar CORS (como "Allow CORS" ou "CORS Unblock") no seu navegador para buscar com o seu próprio IP residencial diretamente, sem bloqueios.', 'warning');
            }
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(data.contents, "text/html");
            
            // Look for any application/ld+json script that matches ItemList type to extract product deals
            const scriptEls = doc.querySelectorAll('script[type="application/ld+json"]');
            let json = null;
            for (const scriptEl of scriptEls) {
                try {
                    const parsed = JSON.parse(scriptEl.textContent);
                    if (parsed && (parsed['@type'] === 'ItemList' || parsed['type'] === 'ItemList') && parsed.itemListElement && parsed.itemListElement.length > 0) {
                        json = parsed;
                        break;
                    }
                } catch (e) {}
            }
            
            let count = 0;
            const seenUrls = new Set();
            if (json) {
                try {
                    const listElements = json.itemListElement || [];
                    for (const elem of listElements) {
                        const product = elem.item;
                        if (product && product.offers && product.offers[0]) {
                            const title = product.name;
                            let relUrl = product.offers[0].url;
                            if (relUrl) {
                                const link = relUrl.startsWith('http') ? relUrl : `https://www.promobit.com.br${relUrl}`;
                                const price = product.offers[0].price || '';
                                const image = product.image ? (Array.isArray(product.image) ? product.image[0] : product.image) : '';
                                if (!seenUrls.has(link)) {
                                    seenUrls.add(link);
                                    deals.push({
                                        id: link,
                                        title: title,
                                        link: link,
                                        source: 'promobit',
                                        price: price ? String(price) : '',
                                        image: image
                                    });
                                    count++;
                                }
                            }
                        }
                    }
                } catch (jsonErr) {
                    console.error("Erro ao fazer parse do JSON-LD do Promobit", jsonErr);
                }
            }
            
            // Always run anchor scraping to extract even more deals that are in the HTML cards
            try {
                const anchors = doc.querySelectorAll('a[href*="/oferta/"]');
                for (const a of anchors) {
                    const href = a.getAttribute('href');
                    let title = a.textContent?.trim() || '';
                    if (!title) {
                        const img = a.querySelector('img');
                        if (img) title = img.getAttribute('alt') || '';
                    }
                    if (href && title && title.length > 5) {
                        const link = href.startsWith('http') ? href : `https://www.promobit.com.br${href}`;
                        if (!seenUrls.has(link)) {
                            seenUrls.add(link);
                            
                            let image = '';
                            let price = '';
                            
                            // Find closest grid item/card container to extract image/price
                            const card = a.closest('[class*="offer" i]') || a.closest('[class*="card" i]') || a.closest('article') || a.parentElement;
                            if (card) {
                                const imgEl = card.querySelector('img');
                                if (imgEl) image = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
                                
                                const priceEl = card.querySelector('[class*="price" i]') || card.querySelector('[class*="valor" i]') || card.querySelector('[class*="amount" i]');
                                if (priceEl) price = priceEl.textContent;
                            }
                            
                            deals.push({
                                id: link,
                                title: cleanTitle(title),
                                link: link,
                                source: 'promobit',
                                price: price ? price.trim() : '',
                                image: image
                            });
                            count++;
                        }
                    }
                }
            } catch (anchorErr) {
                console.error("Erro ao fazer scrape de anchors no Promobit", anchorErr);
            }
            writeLog(`Promobit processado. ${count} ofertas listadas.`, 'info');
        } catch (err) {
            writeLog('Erro ao carregar ofertas do Promobit. DICA: Se a conexão falhou, ative uma extensão de CORS (como "Allow CORS") no seu navegador para fazer a requisição direta sem depender de proxies públicos.', 'error');
            console.error(err);
        }
    }

    // 2. Gatry Homepage HTML
    if (sourceGatry) {
        try {
            writeLog('Conectando ao Gatry...', 'info');
            const data = await fetchViaProxy('https://gatry.com/');
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(data.contents, "text/html");
            const articles = doc.querySelectorAll('article');
            
            let count = 0;
            articles.forEach(article => {
                const titleEl = article.querySelector('h3 a');
                if (titleEl) {
                    const title = titleEl.textContent.trim();
                    let link = titleEl.getAttribute('href');
                    if (link) {
                        if (link.startsWith('/')) {
                            link = `https://gatry.com${link}`;
                        }
                        const priceEl = article.querySelector('.price');
                        const priceText = priceEl ? priceEl.textContent.replace(/[^\d,.]/g, '').trim() : '';
                        const imgEl = article.querySelector('.image img');
                        const image = imgEl ? imgEl.getAttribute('src') : '';
                        deals.push({
                            id: link,
                            title: title,
                            link: link,
                            source: 'gatry',
                            price: priceText,
                            image: image
                        });
                        count++;
                    }
                }
            });
            writeLog(`Gatry processado. ${count} ofertas listadas.`, 'info');
        } catch (err) {
            writeLog('Erro ao carregar ofertas do Gatry.', 'error');
            console.error(err);
        }
    }

    if (deals.length === 0) {
        writeLog('Nenhuma oferta encontrada nos feeds desta vez.', 'warning');
        return;
    }

    // 3. Processar ofertas novas
    const blacklistWords = state.automation.blacklist.toLowerCase().split(',').map(w => w.trim()).filter(w => w !== '');
    
    // Filtrar duplicadas locais
    const newDeals = deals.filter(d => !state.automation.alreadyPostedDeals.includes(d.id));
    
    writeLog(`Identificadas ${newDeals.length} ofertas inéditas para analisar.`, 'info');

    for (let i = 0; i < newDeals.length; i++) {
        if (!state.automation.active) break;

        const deal = newDeals[i];
        lastResolvedCoupon = '';
        
        // Check blacklist words
        const containsBlacklist = blacklistWords.some(word => deal.title.toLowerCase().includes(word));
        if (containsBlacklist) {
            writeLog(`[Pulado] "${deal.title}" (contém palavra-chave bloqueada).`, 'warning');
            saveDealPostedId(deal.id); // Add to avoid processing again
            continue;
        }

        // Check category focus for general feeds (like Gatry)
        if (!isDealInSelectedCategory(deal, selectedCat)) {
            writeLog(`[Pulado] "${deal.title}" (não corresponde à categoria selecionada: ${selectedCat}).`, 'info');
            saveDealPostedId(deal.id); // Add to avoid processing again
            continue;
        }

        writeLog(`Analisando oferta: "${deal.title}"...`, 'info');

        try {
            // Resolve final store link (following redirection)
            let finalUrl = await resolveFinalUrl(deal.link);
            finalUrl = cleanProductUrl(finalUrl);
            const platform = detectPlatform(finalUrl);

            const productKey = getProductUniqueKey(finalUrl, platform);
            if (productKey && state.automation.alreadyPostedDeals.includes(productKey)) {
                writeLog(`[Pulado] "${deal.title}" (produto já postado recentemente com chave: ${productKey}).`, 'warning');
                saveDealPostedId(deal.id, productKey);
                continue;
            }

            if (platform === 'desconhecido') {
                writeLog(`[Pulado] Loja final não suportada para o link: ${finalUrl.substring(0, 45)}...`, 'warning');
                saveDealPostedId(deal.id, productKey);
                continue;
            }

            // Verify if e-commerce store is allowed in checkboxes
            const chkStore = document.getElementById(`chk-store-${platform}`);
            if (chkStore && !chkStore.checked) {
                writeLog(`[Pulado] Loja "${platform.toUpperCase()}" desmarcada nas opções permitidas.`, 'warning');
                saveDealPostedId(deal.id, productKey);
                continue;
            }

            writeLog(`Link final detectado: ${platform.toUpperCase()} - buscando dados...`, 'info');

            // Scrape e-commerce page details
            let scraped = { title: deal.title, price: '', oldPrice: '', image: '' };
            try {
                scraped = await scrapeProductInfo(finalUrl, platform);
            } catch (scrpErr) {
                writeLog(`Scraping falhou na loja final, usando dados do feed.`, 'warning');
            }

            // Fallbacks
            if (!scraped.title) scraped.title = cleanTitle(deal.title);
            
            // Prioritize feed price over scraped price because feed price is the exact promotional value
            if (deal.price && deal.price !== 'Consultar' && deal.price !== '0,00' && deal.price.trim() !== '') {
                scraped.price = formatCurrencyText(deal.price);
                writeLog(`Usando preço promocional do feed: R$ ${scraped.price}`, 'info');
            } else if (!scraped.price || scraped.price === 'Consultar' || scraped.price === '0,00' || scraped.price.trim() === '') {
                scraped.price = 'Consultar';
            }

            // Fallback to feed image
            if (!scraped.image && deal.image) {
                scraped.image = deal.image;
            }

            // Check if price is valid
            const numericPrice = parsePriceToFloat(scraped.price);
            const hasValidPrice = scraped.price && scraped.price !== 'Consultar' && scraped.price !== '0,00' && numericPrice > 0;

            if (hasValidPrice) {
                const numericOldPrice = parsePriceToFloat(scraped.oldPrice);
                // Ensure we have a valid oldPrice, if missing, empty, or not greater than price, estimate it (20% OFF markup)
                if (!scraped.oldPrice || scraped.oldPrice === '0,00' || scraped.oldPrice.trim() === '' || numericOldPrice <= numericPrice) {
                    const estimatedOldVal = numericPrice * 1.25; // 20% discount makes original price 25% higher (e.g. 80 * 1.25 = 100)
                    scraped.oldPrice = formatCurrencyText(estimatedOldVal.toFixed(2));
                }
            }

            // Convert e-commerce link to affiliate URL
            const affiliateUrl = await convertToAffiliate(finalUrl, platform);

            // Compute discount
            let discount = '0';
            if (hasValidPrice && scraped.oldPrice) {
                const oldVal = parsePriceToFloat(scraped.oldPrice);
                const newVal = parsePriceToFloat(scraped.price);
                if (oldVal > newVal && oldVal > 0) {
                    discount = Math.round((1 - newVal / oldVal) * 100).toString();
                }
            }

            // Format message template
            let messageText = state.template;
            
            // If the deal doesn't have a valid price, dynamically hide the price lines
            if (!hasValidPrice) {
                messageText = messageText
                    .replace(/💵 De: <s>R\$ {oldPrice}<\/s>\n?/g, '')
                    .replace(/🤑 Por apenas: <b>R\$ {price}<\/b>\n?/g, '')
                    .replace(/💵 De: <s>R\$ {oldPrice}<\/s>\r?\n?/g, '')
                    .replace(/🤑 Por apenas: <b>R\$ {price}<\/b>\r?\n?/g, '');
            } else {
                messageText = messageText.replace(/{oldPrice}/g, scraped.oldPrice || '0,00');
                messageText = messageText.replace(/{price}/g, scraped.price);
                messageText = messageText.replace(/{discount}/g, discount);
            }
            
            // Handle coupon replacement
            const finalCoupon = lastResolvedCoupon || extractCouponFromTitle(deal.title) || '';
            if (finalCoupon) {
                messageText = messageText.replace(/{coupon}/g, finalCoupon);
            } else {
                messageText = messageText
                    .replace(/🎫 Cupom: <b>{coupon}<\/b>\r?\n?/g, '')
                    .replace(/🎫 Cupom: {coupon}\r?\n?/g, '')
                    .replace(/{coupon}/g, '');
            }
            
            messageText = messageText.replace(/{title}/g, scraped.title);
            messageText = messageText.replace(/{link}/g, affiliateUrl);

            // Translate format symbols to HTML tags for Telegram
            let tgHtml = messageText;
            tgHtml = tgHtml.replace(/\*([^*]+)\*/g, '<b>$1</b>');
            tgHtml = tgHtml.replace(/_([^_]+)_/g, '<i>$1</i>');
            tgHtml = tgHtml.replace(/~([^~]+)~/g, '<s>$1</s>');
            tgHtml = tgHtml.replace(/`([^`]+)`/g, '<code>$1</code>');

            writeLog(`Publicando no Telegram...`, 'info');

            // Dispatch post
            const result = await autoPublishToTelegram(scraped.title, scraped.image, tgHtml, affiliateUrl, platform, scraped.price);

            if (result.ok) {
                writeLog(`SUCESSO: "${scraped.title.substring(0, 35)}..." publicado no Telegram!`, 'success');
                
                // Add to visible table history
                addToHistory({
                    title: scraped.title,
                    marketplace: platform,
                    price: scraped.price,
                    image: scraped.image,
                    timestamp: Date.now(),
                    tgLink: result.link
                });

                // Post to Instagram Reels if checked, configured, and is a valid product (has price)
                const chkIg = document.getElementById('chk-auto-instagram');
                if (chkIg && chkIg.checked && state.instagram.token && state.instagram.businessId) {
                    if (!hasValidPrice) {
                        writeLog("Link de cupom/categoria detectado. Ignorando postagem no Instagram Reels (apenas produtos físicos com preço são permitidos).", "info");
                    } else {
                        writeLog("Autopost do Instagram ativo. Iniciando geração do vídeo...", "info");
                        try {
                            const tempProduct = {
                                title: scraped.title,
                                price: scraped.price,
                                oldPrice: scraped.oldPrice,
                                image: scraped.image
                            };
                            
                            const igVideoBlob = await generateVideoBlobInBackground(tempProduct, state.instagram.textTop, state.instagram.textBottom, state.instagram.theme, state.instagram.duration);
                            
                            if (igVideoBlob) {
                                writeLog("Upload do vídeo para o host temporário...", "info");
                                const tempUrl = await uploadVideoToTempHost(igVideoBlob);
                                writeLog(`Publicando no Instagram (${state.instagram.postType.toUpperCase()})...`, "info");
                                const igPostId = await publishToInstagramMedia(tempUrl, igCaption, state.instagram.postType);
                                writeLog(`SUCESSO: Publicado no Instagram! ID: ${igPostId}`, "success");
                            }
                        } catch (igErr) {
                            writeLog(`ERRO no Autopost do Instagram: ${igErr.message}`, "error");
                            console.error(igErr);
                        }
                    }
                }

                // Post to Facebook Page if checked and configured
                const chkFb = document.getElementById('chk-auto-facebook');
                if (chkFb && chkFb.checked && state.config.fbToken && state.config.fbPageId) {
                    writeLog("Autopost do Facebook ativo. Iniciando publicação...", "info");
                    try {
                        const fbPostId = await publishToFacebookPage(scraped.image, tgHtml, affiliateUrl);
                        writeLog(`SUCESSO: Publicado na Página do Facebook! ID: ${fbPostId}`, "success");
                    } catch (fbErr) {
                        writeLog(`ERRO no Autopost do Facebook: ${fbErr.message}`, "error");
                        console.error(fbErr);
                    }
                }
            } else {
                writeLog(`ERRO ao enviar para o Telegram: ${result.error}`, 'error');
            }

            // Guard id as posted
            saveDealPostedId(deal.id, productKey);

            // Wait 5 seconds to avoid spamming / rate limits
            await sleep(5000);

        } catch (dealErr) {
            writeLog(`Erro ao processar a oferta "${deal.title.substring(0, 30)}...": ${dealErr.message}`, 'error');
            saveDealPostedId(deal.id); // Guard to prevent looping error
        }
    }

    writeLog('Varredura de ofertas finalizada.', 'success');
}

async function resolveFinalUrl(aggregatorUrl) {
    try {
        let currentUrl = aggregatorUrl;
        let json = null;
        let offerId = null;
        
        // 1. Try to extract offer ID from initial URL if it's already a Promobit offer page
        let offerIdMatch = currentUrl.match(/\/oferta\/.*?-(\d+)\/?(?:[?#]|$)/i);
        if (offerIdMatch) {
            offerId = offerIdMatch[1];
        }
        
        // 2. If not found, or if it is a shortened redirect link, fetch the page first
        if (!offerId) {
            json = await fetchViaProxy(currentUrl);
            currentUrl = json.finalUrl || currentUrl;
            
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(json.contents, 'text/html');
                const coupon = extractCouponFromDoc(doc);
                if (coupon) lastResolvedCoupon = coupon;
            } catch (e) {}

            offerIdMatch = currentUrl.match(/\/oferta\/.*?-(\d+)\/?(?:[?#]|$)/i);
            if (offerIdMatch) {
                offerId = offerIdMatch[1];
            } else {
                // Try to extract from the HTML content as a fallback
                const contentIdMatch = json.contents.match(/"offerId"\s*:\s*(\d+)/i);
                if (contentIdMatch) {
                    offerId = contentIdMatch[1];
                }
            }
        }
        
        if (offerId) {
            const redirectUrl = `https://www.promobit.com.br/Redirect/to/${offerId}/`;
            try {
                const redirectJson = await fetchViaProxy(redirectUrl);
                const html = redirectJson.contents;
                
                // Extract target URL from javascript assignment: l = '...' or location.href = '...'
                const finalUrlMatch = html.match(/\b(?:l|location\.href)\b\s*=\s*['"]([^'"]+)['"]/i);
                if (finalUrlMatch && finalUrlMatch[1]) {
                    let targetUrl = finalUrlMatch[1];
                    
                    // If it is a redirect shortlink, follow it to get the final store page
                    if (isShortlink(targetUrl)) {
                        try {
                            const resolvedJson = await fetchViaProxy(targetUrl);
                            if (resolvedJson.finalUrl) {
                                return resolvedJson.finalUrl;
                            }
                        } catch (e) {
                            console.warn("Falha ao resolver redirecionamento do link final:", e);
                        }
                    }
                    return targetUrl;
                }
            } catch (promobitErr) {
                console.warn("Falha no fluxo de redirecionamento interno do Promobit:", promobitErr);
            }
        }

        // Standard logic fallback
        if (!json) {
            json = await fetchViaProxy(currentUrl);
        }
        
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(json.contents, 'text/html');
            const coupon = extractCouponFromDoc(doc);
            if (coupon) lastResolvedCoupon = coupon;
        } catch (e) {}

        let resolvedUrl = json.finalUrl || currentUrl;
        
        const platform = detectPlatform(resolvedUrl);
        if (platform !== 'desconhecido' && !isShortlink(resolvedUrl) && !resolvedUrl.includes('promobit.com.br') && !resolvedUrl.includes('gatry.com')) {
            return resolvedUrl;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(json.contents, 'text/html');
        
        let redirectUrl = null;
        
        // Selectors for detail redirect links (removed promoby.me to prevent matching ad banners)
        const btnPromobit = doc.querySelector('a[href*="/Redirect/to/" i], a[href*="/link/" i]');
        const btnGatry = doc.querySelector('a[href*="/link?" i]');
        const genericLink = doc.querySelector('.btn-go-to-store, a[class*="go-to" i], a[class*="loja" i]');
        
        if (btnPromobit) {
            redirectUrl = btnPromobit.getAttribute('href');
        } else if (btnGatry) {
            redirectUrl = btnGatry.getAttribute('href');
        } else if (genericLink) {
            redirectUrl = genericLink.getAttribute('href');
        }
        
        if (redirectUrl) {
            if (redirectUrl.startsWith('/')) {
                const base = new URL(resolvedUrl).origin;
                redirectUrl = base + redirectUrl;
            }
            
            // Follow redirect via proxy to grab the final marketplace URL
            try {
                const redirectJson = await fetchViaProxy(redirectUrl);
                if (redirectJson.finalUrl) {
                    return redirectJson.finalUrl;
                }
            } catch (redirErr) {
                console.warn("Falha ao seguir redirecionamento final do marketplace:", redirErr);
            }
            return redirectUrl;
        }
        
        // Fallback: search for direct shop links in anchor tags
        const anchors = doc.querySelectorAll('a');
        for (const anchor of anchors) {
            const href = anchor.getAttribute('href');
            if (href) {
                const hrefPlatform = detectPlatform(href);
                if (hrefPlatform !== 'desconhecido') {
                    return href;
                }
            }
        }
        return resolvedUrl;
    } catch (err) {
        console.error("Erro ao resolver URL redirecionada", err);
        writeLog(`AVISO: Falha ao resolver o redirecionamento do link original (${err.message}). Certifique-se de que a extensão CORS está ativa no seu navegador.`, 'warning');
    }
    return aggregatorUrl;
}

async function autoPublishToTelegram(title, imageUrl, text, affiliateUrl, platform, price) {
    const token = state.config.tgToken;
    const chatId = state.config.tgChatId;
    
    const replyMarkup = {
        inline_keyboard: [[
            { text: '🛒 COMPRAR AGORA', url: affiliateUrl || 'https://shopee.com.br' }
        ]]
    };

    let urlCall = '';
    let payload = {};
    let usingPhoto = false;

    if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        urlCall = `https://api.telegram.org/bot${token}/sendPhoto`;
        payload = {
            chat_id: chatId,
            photo: imageUrl,
            caption: text,
            parse_mode: 'HTML',
            reply_markup: JSON.stringify(replyMarkup)
        };
        usingPhoto = true;
    } else {
        urlCall = `https://api.telegram.org/bot${token}/sendMessage`;
        payload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            reply_markup: JSON.stringify(replyMarkup)
        };
    }

    try {
        let res = await fetch(urlCall, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let data = await res.json();

        // Fallback to text message if photo upload fails
        if (!data.ok && usingPhoto) {
            urlCall = `https://api.telegram.org/bot${token}/sendMessage`;
            payload = {
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                reply_markup: JSON.stringify(replyMarkup)
            };
            res = await fetch(urlCall, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            data = await res.json();
        }

        if (data.ok) {
            let tgLink = '';
            if (data.result && data.result.chat && data.result.chat.username) {
                tgLink = `https://t.me/${data.result.chat.username}/${data.result.message_id}`;
            } else if (chatId.startsWith('@')) {
                tgLink = `https://t.me/${chatId.replace('@', '')}/${data.result.message_id}`;
            }
            return { ok: true, link: tgLink };
        }
        return { ok: false, error: data.description };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function getProductUniqueKey(url, platform) {
    if (!url) return '';
    const lowercaseUrl = url.toLowerCase();
    
    if (platform === 'amazon') {
        const asinMatch = url.match(/(?:\/dp\/|\/gp\/product\/|\/product\/)([A-Z0-9]{10})/i);
        if (asinMatch && asinMatch[1]) {
            return `amazon:${asinMatch[1].toUpperCase()}`;
        }
    }
    else if (platform === 'mercadolivre') {
        const mlbMatch = url.match(/MLB-?(\d+)/i);
        if (mlbMatch) {
            return `mercadolivre:${mlbMatch[1]}`;
        }
        const pMatch = url.match(/\/p\/(MLB\d+)/i) || url.match(/\/p\/([a-z0-9]+)/i);
        if (pMatch) {
            return `mercadolivre:${pMatch[1].toLowerCase()}`;
        }
    }
    else if (platform === 'shopee') {
        const itemMatch = url.match(/-i\.(\d+)\.(\d+)/i) || url.match(/\/product\/(\d+)\/(\d+)/i);
        if (itemMatch) {
            return `shopee:${itemMatch[1]}_${itemMatch[2]}`;
        }
    }
    else if (platform === 'aliexpress') {
        const itemMatch = url.match(/\/item\/(\d+)\.html/i) || url.match(/\/item\/(\d+)/i);
        if (itemMatch) {
            return `aliexpress:${itemMatch[1]}`;
        }
    }
    
    // Fallback: use cleaned domain + path without query params
    try {
        const parsed = new URL(url);
        return `${platform}:${parsed.origin}${parsed.pathname}`.toLowerCase();
    } catch (e) {
        return `${platform}:${url}`.toLowerCase();
    }
}

function saveDealPostedId(id, productKey = null) {
    let updated = false;
    if (!state.automation.alreadyPostedDeals.includes(id)) {
        state.automation.alreadyPostedDeals.push(id);
        updated = true;
    }
    if (productKey && !state.automation.alreadyPostedDeals.includes(productKey)) {
        state.automation.alreadyPostedDeals.push(productKey);
        updated = true;
    }
    if (updated) {
        // Keep max 400 history items for duplicate checking to support keys
        if (state.automation.alreadyPostedDeals.length > 400) {
            state.automation.alreadyPostedDeals.shift();
        }
        localStorage.setItem('cfg_already_posted', JSON.stringify(state.automation.alreadyPostedDeals));
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* ==========================================================================
   INSTAGRAM REELS AI VIDEO GENERATOR & CAPTION LOGIC
   ========================================================================== */
function updateInstagramFieldsFromProduct() {
    const captionArea = document.getElementById('ig-caption-text');
    if (captionArea) {
        captionArea.value = generateInstagramCaption(state.currentProduct);
        document.getElementById('simulator-caption-txt').innerText = `🔥 ${state.currentProduct.title || 'Oferta imperdível'}...`;
    }

    // Toggle Simulator Overlays based on postType (reels vs stories) and sponsored ad status
    const isStories = state.instagram.postType === 'stories';
    const isSponsored = state.instagram.sponsored;

    const elSwipeUp = document.getElementById('simulator-swipe-up');
    const elRightActions = document.getElementById('simulator-right-actions');
    const elAudioBadge = document.getElementById('simulator-audio-badge');
    const elFollowBtn = document.getElementById('simulator-follow-btn');
    const elAdBadge = document.getElementById('simulator-ad-badge');
    const elPublishBtn = document.getElementById('btn-ig-publish');

    if (elSwipeUp) elSwipeUp.style.display = isStories ? 'flex' : 'none';
    if (elRightActions) elRightActions.style.display = isStories ? 'none' : 'flex';
    if (elAudioBadge) elAudioBadge.style.display = isStories ? 'none' : 'flex';
    if (elFollowBtn) elFollowBtn.style.display = isSponsored ? 'none' : 'inline-block';
    if (elAdBadge) elAdBadge.style.display = isSponsored ? 'inline-block' : 'none';

    if (elPublishBtn) {
        const text = isStories ? 'Publicar Stories Manual' : (state.instagram.postType === 'both' ? 'Publicar Ambos Manual' : 'Publicar Reels Manual');
        elPublishBtn.querySelector('span').innerText = text;
    }
    
    // Render the first frame of the canvas as a static preview
    const canvas = document.getElementById('reels-canvas-preview');
    if (canvas) {
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.crossOrigin = "anonymous";
        
        const imgSrc = state.currentProduct.image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=600&auto=format&fit=crop';
        
        // Try loading CORS free version if it's an online image
        if (imgSrc.startsWith('http')) {
            loadImageCORSFree(imgSrc).then(dataUrl => {
                img.src = dataUrl;
            }).catch(() => {
                img.src = imgSrc;
            });
        } else {
            img.src = imgSrc;
        }

        img.onload = () => {
            renderFrame(ctx, canvas.width, canvas.height, 0, 150, img, state.currentProduct, state.instagram.textTop, state.instagram.textBottom, state.instagram.theme);
        };
    }
}

function generateInstagramCaption(product) {
    const hasPrices = product.price && product.price !== 'Consultar' && product.price !== '0,00';
    let priceSnippet = '';
    if (hasPrices) {
        priceSnippet = `💵 Por apenas R$ ${product.price}!`;
        if (product.oldPrice) {
            priceSnippet = `💵 De: R$ ${product.oldPrice} por APENAS R$ ${product.price}!`;
        }
    }
    
    return `🔥 OFERTA: ${product.title || 'Produto em Promoção'}

${priceSnippet}

🛒 O link com o cupom/desconto está no nosso grupo de ofertas do Telegram!
👉 Link no grupo na nossa BIO para comprar agora!

#ofertas #promocao #cupom #desconto #achadinhos #tecnologia`;
}

async function loadImageCORSFree(url) {
    try {
        const res = await fetch(url);
        const blob = await res.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        try {
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
            const res = await fetch(proxyUrl);
            const json = await res.json();
            if (json.contents) {
                return json.contents;
            }
        } catch (e) {
            console.error("Failed to load image via proxy base64", e);
        }
    }
    return url;
}

let isRecording = false;

function cleanPriceForSpeech(priceStr) {
    if (!priceStr) return '';
    const num = parsePriceToFloat(priceStr);
    return Math.round(num).toString();
}

function generateSpokenScript(product) {
    const cleanTitle = (product.title || 'este produto').substring(0, 60).replace(/[^\w\s]/gi, ' ').trim();
    const hasPrices = product.price && product.price !== 'Consultar' && product.price !== '0,00';
    
    let text = `Olha essa oferta incrível! ${cleanTitle}.`;
    if (hasPrices) {
        const integerPrice = cleanPriceForSpeech(product.price);
        if (product.oldPrice) {
            const integerOldPrice = cleanPriceForSpeech(product.oldPrice);
            text += ` De ${integerOldPrice} reais por apenas ${integerPrice} reais!`;
        } else {
            text += ` Por apenas ${integerPrice} reais!`;
        }
    }
    text += ` O link de compra com desconto está no grupo do telegram na bio. Corre lá para aproveitar!`;
    return text;
}

async function getSpeechAudioStream(text, playLocally = true) {
    const ttsUrl = `https://api.streamelements.com/api/v1/speech?voice=Vitoria&text=${encodeURIComponent(text)}`;
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.src = ttsUrl;
    
    return new Promise((resolve, reject) => {
        audio.oncanplaythrough = () => {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioContextClass();
            const source = audioCtx.createMediaElementSource(audio);
            const dest = audioCtx.createMediaStreamDestination();
            
            source.connect(dest);
            if (playLocally) {
                source.connect(audioCtx.destination);
            }
            
            resolve({
                audioElement: audio,
                audioStream: dest.stream,
                audioCtx: audioCtx
            });
        };
        audio.onerror = (e) => reject(new Error("Erro ao carregar áudio de locução de IA"));
    });
}

async function startReelsRecording(product, durationSeconds, textTop, textBottom, theme) {
    if (isRecording) return;
    isRecording = true;
    
    showToast("Carregando voz da IA e gerando vídeo...", "info");
    
    const canvas = document.getElementById('reels-canvas-preview');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    
    let imgDataUrl = product.image;
    if (product.image && product.image.startsWith('http')) {
        imgDataUrl = await loadImageCORSFree(product.image);
    }
    
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgDataUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=600&auto=format&fit=crop';
    
    await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = () => {
            img.src = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=600&auto=format&fit=crop';
            resolve();
        };
    });
    
    // Load Voiceover
    let speech = null;
    let audioStream = null;
    try {
        const spokenText = generateSpokenScript(product);
        speech = await getSpeechAudioStream(spokenText, true); // Play locally
        audioStream = speech.audioStream;
    } catch (err) {
        console.warn("Falha ao gerar locução de IA:", err);
        showToast("Gerando vídeo sem áudio (locução indisponível).", "warning");
    }
    
    const fps = 30;
    const totalFrames = durationSeconds * fps;
    let currentFrame = 0;
    
    let canvasStream;
    try {
        canvasStream = canvas.captureStream(fps);
    } catch (err) {
        showToast("captureStream não suportado no navegador.", "error");
        isRecording = false;
        if (speech) speech.audioCtx.close();
        return;
    }
    
    let combinedStream = canvasStream;
    if (audioStream) {
        combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioStream.getAudioTracks()
        ]);
    }
    
    let options = { mimeType: 'video/webm;codecs=vp9' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = {};
    }
    
    const recorder = new MediaRecorder(combinedStream, options);
    const chunks = [];
    
    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
            chunks.push(e.data);
        }
    };
    
    let loopVoice = true;
    recorder.onstop = () => {
        loopVoice = false;
        if (speech) {
            speech.audioElement.pause();
            speech.audioCtx.close();
        }
        
        const videoBlob = new Blob(chunks, { type: 'video/webm' });
        state.instagram.videoBlob = videoBlob;
        
        const videoPreview = document.getElementById('reels-video-preview');
        const videoUrl = URL.createObjectURL(videoBlob);
        videoPreview.src = videoUrl;
        videoPreview.style.display = 'block';
        canvas.style.display = 'none';
        
        document.getElementById('btn-ig-download').disabled = false;
        
        const hasIgCreds = state.instagram.token && state.instagram.businessId;
        document.getElementById('btn-ig-publish').disabled = !hasIgCreds;
        
        showToast("Vídeo gerado com sucesso!", "success");
        isRecording = false;
    };
    
    recorder.start();
    
    if (speech) {
        speech.audioElement.play();
        speech.audioElement.onended = () => {
            if (loopVoice && isRecording) {
                setTimeout(() => {
                    if (isRecording && loopVoice) {
                        speech.audioElement.currentTime = 0;
                        speech.audioElement.play();
                    }
                }, 3000); // Repeat after 3 seconds gap
            }
        };
    }
    
    function drawFrame() {
        if (currentFrame >= totalFrames) {
            loopVoice = false;
            recorder.stop();
            return;
        }
        
        renderFrame(ctx, canvas.width, canvas.height, currentFrame, totalFrames, img, product, textTop, textBottom, theme);
        currentFrame++;
        
        requestAnimationFrame(drawFrame);
    }
    
    document.getElementById('reels-video-preview').style.display = 'none';
    canvas.style.display = 'block';
    
    drawFrame();
}

function downloadReelsVideo() {
    if (!state.instagram.videoBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(state.instagram.videoBlob);
    a.download = `reels_oferta_${Date.now()}.webm`;
    a.click();
    showToast("Vídeo baixado!", "success");
}

async function uploadVideoToTempHost(blob) {
    const formData = new FormData();
    formData.append('file', blob, 'video.webm');
    
    const response = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) throw new Error("Falha no upload do vídeo temporário");
    const json = await response.json();
    
    if (json.status === 'success' && json.data && json.data.url) {
        const directUrl = json.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
        return directUrl;
    }
    throw new Error("URL de download não encontrada no retorno do host temporário");
}

async function publishToInstagramMedia(videoUrl, caption, type = 'reels') {
    const accessToken = state.instagram.token;
    const businessId = state.instagram.businessId;
    
    if (!accessToken || !businessId) {
        throw new Error("Credenciais do Instagram não configuradas.");
    }
    
    if (type === 'both') {
        writeLog("Publicação dupla ativada: enviando para Reels e Stories...", "info");
        const reelsId = await publishToInstagramMedia(videoUrl, caption, 'reels');
        await sleep(5000); // 5 seconds pause between uploads
        const storiesId = await publishToInstagramMedia(videoUrl, caption, 'stories');
        return `Reels: ${reelsId}, Stories: ${storiesId}`;
    }
    
    const containerUrl = `https://graph.facebook.com/v19.0/${businessId}/media`;
    
    const paramsObj = {
        media_type: type.toUpperCase(),
        video_url: videoUrl,
        access_token: accessToken
    };
    
    if (type === 'reels') {
        paramsObj.caption = caption;
        paramsObj.share_to_feed = 'true';
    }
    
    const containerParams = new URLSearchParams(paramsObj);
    
    writeLog(`Solicitando criação do container de ${type.toUpperCase()} no Instagram...`, "info");
    
    const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(containerUrl + '?' + containerParams.toString())}`, {
        method: 'POST'
    });
    
    if (!response.ok) throw new Error("Erro de conexão com a API do Instagram");
    const containerData = await response.json();
    
    if (containerData.error) {
        throw new Error(`Erro Instagram: ${containerData.error.message}`);
    }
    
    const creationId = containerData.id;
    writeLog(`Container de ${type.toUpperCase()} criado! ID: ${creationId}. Aguardando processamento do Instagram...`, "info");
    
    let status = 'IN_PROGRESS';
    let attempts = 0;
    const maxAttempts = 15;
    
    while (status !== 'FINISHED' && status !== 'READY' && attempts < maxAttempts) {
        await sleep(5000);
        attempts++;
        writeLog(`Verificando status (tentativa ${attempts})...`, "info");
        
        const statusUrl = `https://graph.facebook.com/v19.0/${creationId}`;
        const statusParams = new URLSearchParams({
            fields: 'status_code',
            access_token: accessToken
        });
        
        const statusRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(statusUrl + '?' + statusParams.toString())}`);
        const statusData = await statusRes.json();
        
        if (statusData.error) {
            throw new Error(`Erro de status do Instagram: ${statusData.error.message}`);
        }
        
        status = statusData.status_code;
        writeLog(`Status do container: ${status}`, "info");
        
        if (status === 'ERROR') {
            throw new Error("O Instagram falhou ao processar o arquivo de vídeo.");
        }
    }
    
    if (status !== 'FINISHED' && status !== 'READY') {
        throw new Error("Tempo limite esgotado para o processamento do vídeo no Instagram.");
    }
    
    writeLog(`Publicando ${type.toUpperCase()} no Instagram...`, "info");
    const publishUrl = `https://graph.facebook.com/v19.0/${businessId}/media_publish`;
    const publishParams = new URLSearchParams({
        creation_id: creationId,
        access_token: accessToken
    });
    
    const publishRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(publishUrl + '?' + publishParams.toString())}`, {
        method: 'POST'
    });
    
    const publishData = await publishRes.json();
    if (publishData.error) {
        throw new Error(`Falha na publicação: ${publishData.error.message}`);
    }
    
    return publishData.id;
}

function renderFrame(ctx, w, h, frame, totalFrames, img, product, textTop, textBottom, theme) {
    ctx.clearRect(0, 0, w, h);
    
    const angle = (frame / totalFrames) * Math.PI * 2;
    const x1 = w / 2 + Math.cos(angle) * w;
    const y1 = h / 2 + Math.sin(angle) * h;
    const x2 = w / 2 - Math.cos(angle) * w;
    const y2 = h / 2 - Math.sin(angle) * h;
    
    let grad = ctx.createLinearGradient(x1, y1, x2, y2);
    
    if (theme === 'instagram') {
        grad.addColorStop(0, '#f09433');
        grad.addColorStop(0.25, '#e6683c');
        grad.addColorStop(0.5, '#dc2743');
        grad.addColorStop(0.75, '#cc2366');
        grad.addColorStop(1, '#bc1888');
    } else if (theme === 'dark') {
        grad.addColorStop(0, '#000000');
        grad.addColorStop(0.5, '#151515');
        grad.addColorStop(1, '#050505');
    } else if (theme === 'fire') {
        grad.addColorStop(0, '#e65c00');
        grad.addColorStop(0.5, '#f9d423');
        grad.addColorStop(1, '#ff0000');
    } else if (theme === 'cyber') {
        grad.addColorStop(0, '#00f2fe');
        grad.addColorStop(1, '#4facfe');
    }
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    
    // Draw Sponsored ad banner at the top if sponsored option is checked
    if (state.instagram.sponsored) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(w / 2 - 140, 60, 280, 50, 15) : ctx.rect(w / 2 - 140, 60, 280, 50);
        ctx.fill();
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 24px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PATROCINADO', w / 2, 93);
        ctx.restore();
    }
    
    if (theme === 'cyber') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 2;
        const gridSpacing = 80;
        const offset = (frame % 30) * (gridSpacing / 30);
        for (let x = offset; x < w; x += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = offset; y < h; y += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
    } else if (theme === 'dark') {
        const pulseBorder = 25 + 5 * Math.sin(frame * 0.1);
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.3)';
        ctx.lineWidth = pulseBorder;
        ctx.strokeRect(pulseBorder/2, pulseBorder/2, w - pulseBorder, h - pulseBorder);
    }
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    for (let i = 0; i < 5; i++) {
        const cx = (w / 6) * (i + 1) + Math.sin(frame * 0.05 + i) * 50;
        const cy = h / 2 + Math.cos(frame * 0.03 + i) * 300;
        const r = 150 + Math.sin(frame * 0.07 + i) * 50;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }
    
    const textPulse = 1 + 0.04 * Math.sin(frame * 0.12);
    ctx.save();
    ctx.translate(w / 2, 220);
    ctx.scale(textPulse, textPulse);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    
    ctx.font = '900 80px Outfit, Inter, sans-serif';
    ctx.fillText(textTop.toUpperCase(), 0, 0);
    ctx.restore();
    
    const cardX = 80;
    const cardY = 320;
    const cardW = w - 160;
    const cardH = 1150;
    const radius = 40;
    
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 15;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 3;
    
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(cardX, cardY, cardW, cardH, radius) : ctx.rect(cardX, cardY, cardW, cardH);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    
    const imgPulse = 1 + 0.02 * Math.sin(frame * 0.08);
    const imgYOffset = Math.sin(frame * 0.04) * 15;
    
    const maxImgW = cardW - 120;
    const maxImgH = 550;
    
    let imgW = img.width || 600;
    let imgH = img.height || 600;
    const ratio = Math.min(maxImgW / imgW, maxImgH / imgH);
    imgW *= ratio * imgPulse;
    imgH *= ratio * imgPulse;
    
    const imgX = cardX + (cardW - imgW) / 2;
    const imgY = cardY + 80 + (maxImgH - imgH) / 2 + imgYOffset;
    
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(imgX - 10, imgY - 10, imgW + 20, imgH + 20, 20) : ctx.rect(imgX - 10, imgY - 10, imgW + 20, imgH + 20);
    ctx.fill();
    ctx.restore();
    
    ctx.drawImage(img, imgX, imgY, imgW, imgH);
    
    const textYStart = cardY + maxImgH + 160;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    
    ctx.font = '600 48px Inter, sans-serif';
    const cleanTitleText = product.title || 'Produto Novo';
    wrapText(ctx, cleanTitleText.toUpperCase(), w / 2, textYStart, cardW - 80, 58);
    
    const hasPrices = product.price && product.price !== 'Consultar' && product.price !== '0,00';
    if (hasPrices && product.oldPrice) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '400 36px Inter, sans-serif';
        ctx.fillText(`De: R$ ${product.oldPrice}`, w / 2, textYStart + 160);
        
        const oldPriceTextWidth = ctx.measureText(`De: R$ ${product.oldPrice}`).width;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(w / 2 - oldPriceTextWidth / 2, textYStart + 148);
        ctx.lineTo(w / 2 + oldPriceTextWidth / 2, textYStart + 148);
        ctx.stroke();
    }
    
    const priceText = hasPrices ? `R$ ${product.price}` : 'Consultar Valor';
    const pricePulse = 1 + 0.03 * Math.abs(Math.sin(frame * 0.1));
    ctx.save();
    ctx.translate(w / 2, textYStart + (product.oldPrice ? 250 : 200));
    ctx.scale(pricePulse, pricePulse);
    ctx.fillStyle = '#ccff00'; 
    ctx.font = '900 75px Outfit, Inter, sans-serif';
    ctx.shadowColor = 'rgba(204, 255, 0, 0.4)';
    ctx.shadowBlur = 10;
    ctx.fillText(priceText, 0, 0);
    ctx.restore();
    
    const ctaY = h - 260;
    const ctaPulse = 1 + 0.05 * Math.abs(Math.sin(frame * 0.07));
    
    ctx.save();
    ctx.translate(w / 2, ctaY);
    ctx.scale(ctaPulse, ctaPulse);
    
    ctx.fillStyle = theme === 'instagram' ? '#ff007f' : '#d4af37';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-300, -50, 600, 100, 30) : ctx.rect(-300, -50, 600, 100);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '700 36px Inter, sans-serif';
    ctx.fillText(textBottom.toUpperCase(), 0, 12);
    ctx.restore();
    
    const arrowOffset = Math.sin(frame * 0.15) * 15;
    ctx.fillStyle = '#ffffff';
    ctx.font = '50px Inter, sans-serif';
    ctx.fillText('👇', w / 2, ctaY - 90 + arrowOffset);
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let testLine = '';
    let lineCount = 0;

    for (let n = 0; n < words.length; n++) {
        testLine = line + words[n] + ' ';
        const metrics = context.measureText(testLine);
        const testWidth = metrics.width;
        
        if (testWidth > maxWidth && n > 0) {
            context.fillText(line.trim(), x, y + lineCount * lineHeight);
            line = words[n] + ' ';
            lineCount++;
            if (lineCount >= 2) return;
        } else {
            line = testLine;
        }
    }
    context.fillText(line.trim(), x, y + lineCount * lineHeight);
}

async function generateVideoBlobInBackground(product, textTop, textBottom, theme, durationSeconds) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    
    let imgDataUrl = product.image;
    if (product.image && product.image.startsWith('http')) {
        imgDataUrl = await loadImageCORSFree(product.image);
    }
    
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgDataUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=600&auto=format&fit=crop';
    
    await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = () => {
            img.src = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=600&auto=format&fit=crop';
            resolve();
        };
    });
    
    let speech = null;
    let audioStream = null;
    try {
        const spokenText = generateSpokenScript(product);
        speech = await getSpeechAudioStream(spokenText, false); // SILENT
        audioStream = speech.audioStream;
    } catch (err) {
        console.warn("Falha ao gerar locução de IA em background:", err);
    }
    
    const fps = 30;
    const totalFrames = durationSeconds * fps;
    
    let canvasStream = canvas.captureStream(fps);
    let combinedStream = canvasStream;
    if (audioStream) {
        combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioStream.getAudioTracks()
        ]);
    }
    
    let options = { mimeType: 'video/webm;codecs=vp9' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = {};
    }
    
    const recorder = new MediaRecorder(combinedStream, options);
    const chunks = [];
    
    return new Promise((resolve, reject) => {
        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        
        let loopVoice = true;
        recorder.onstop = () => {
            loopVoice = false;
            if (speech) {
                speech.audioElement.pause();
                speech.audioCtx.close();
            }
            const blob = new Blob(chunks, { type: 'video/webm' });
            resolve(blob);
        };
        
        recorder.onerror = reject;
        recorder.start();
        
        if (speech) {
            speech.audioElement.play();
            speech.audioElement.onended = () => {
                if (loopVoice) {
                    setTimeout(() => {
                        if (loopVoice) {
                            speech.audioElement.currentTime = 0;
                            speech.audioElement.play();
                        }
                    }, 3000);
                }
            };
        }
        
        let frame = 0;
        function next() {
            if (frame >= totalFrames) {
                loopVoice = false;
                recorder.stop();
                return;
            }
            renderFrame(ctx, canvas.width, canvas.height, frame, totalFrames, img, product, textTop, textBottom, theme);
            frame++;
            setTimeout(next, 1000 / fps);
        }
        next();
    });
}

/* ==========================================================================
   FACEBOOK PAGE PUBLISHING ENGINE
   ========================================================================== */
async function publishToFacebookPage(imageUrl, text, affiliateUrl) {
    const accessToken = state.config.fbToken;
    const pageId = state.config.fbPageId;
    
    if (!accessToken || !pageId) {
        throw new Error("Credenciais do Facebook não configuradas nas 'Configurações'.");
    }
    
    let urlCall = '';
    let paramsObj = {
        access_token: accessToken
    };
    
    // Strip HTML tags for clean Facebook raw text formatting
    let fbText = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[a-z][a-z0-9]*[^<>]*>/gi, '');
    
    if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        urlCall = `https://graph.facebook.com/v19.0/${pageId}/photos`;
        paramsObj.url = imageUrl;
        paramsObj.caption = fbText;
    } else {
        urlCall = `https://graph.facebook.com/v19.0/${pageId}/feed`;
        paramsObj.message = fbText;
        if (affiliateUrl) {
            paramsObj.link = affiliateUrl;
        }
    }
    
    const containerParams = new URLSearchParams(paramsObj);
    
    const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(urlCall + '?' + containerParams.toString())}`, {
        method: 'POST'
    });
    
    if (!response.ok) throw new Error("Erro de conexão com a API do Facebook (Meta)");
    const data = await response.json();
    
    if (data.error) {
        throw new Error(`Erro Facebook API: ${data.error.message}`);
    }
    
    return data.post_id || data.id;
}

async function handlePostFacebook() {
    const text = document.getElementById('message-content').value;
    const imageUrl = document.getElementById('prod-image').value.trim();
    const affUrl = document.getElementById('prod-aff-url').value.trim();
    
    if (!text) {
        showToast('Não há conteúdo no post para enviar ao Facebook.', 'warning');
        return;
    }
    
    const token = state.config.fbToken;
    const pageId = state.config.fbPageId;
    
    if (!token || !pageId) {
        showToast('Configure as credenciais do Facebook nas "Configurações" primeiro.', 'error');
        document.getElementById('btn-tab-config').click();
        return;
    }
    
    const btn = document.getElementById('btn-post-facebook');
    btn.disabled = true;
    btn.innerHTML = '<span>Postando...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
    
    try {
        showToast('Enviando post para o Facebook...', 'info');
        const postId = await publishToFacebookPage(imageUrl, text, affUrl);
        showToast('Oferta enviada com sucesso para a Página do Facebook!', 'success');
        writeLog(`[Manual] Post enviado para Facebook Page! ID: ${postId}`, 'success');
    } catch (err) {
        showToast(`Falha no Facebook: ${err.message}`, 'error');
        writeLog(`Erro ao enviar post manual para o Facebook: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Postar no Facebook</span> <i class="fa-brands fa-facebook"></i>';
    }
}


