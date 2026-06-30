const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');


const app = express();
const PORT = process.env.PORT || 8123;

app.use(express.json());

// Servir arquivos estáticos do diretório atual
app.use(express.static(__dirname));

// CONFIGURAÇÃO DO SISTEMA DE ASSINATURA/LICENÇAS
// IMPORTANTE: Altere esta URL para a URL pública do seu servidor central de licenças (ex: no Render/VPS)
const LICENSE_URL = 'https://lovely-energy-production-78fe.up.railway.app';

// Cache de validação de licenças (key -> { valid, error, timestamp })
const licenseCache = new Map();

// Helper: Validar Licença Online
async function checkLicenseStatus(key, email) {
    if (!key) {
        return { valid: false, error: "Nenhuma chave de licença configurada." };
    }
    
    // Bypass para testes se ainda estiver usando placeholders do GitHub
    if (LICENSE_URL.includes('seu-usuario') || LICENSE_URL.includes('seu-repositorio')) {
        console.warn("[Licença] URL de validação padrão (placeholder) detectada. Ignorando validação online e liberando acesso local.");
        return { valid: true, error: "" };
    }
    
    const now = Date.now();
    // Verificar cache específico desta chave (1 minuto para testes rápidos)
    const cached = licenseCache.get(key);
    if (cached && (now - cached.timestamp < 1 * 60 * 1000)) {
        return { valid: cached.valid, error: cached.error };
    }
    
    let isLicenseValid = false;
    let licenseError = "";
    
    try {
        console.log(`[Licença] Validando chave ${key} na API de licenças...`);
        const validationUrl = `${LICENSE_URL.replace(/\/$/, '')}/api/validate?key=${encodeURIComponent(key)}&email=${encodeURIComponent(email || '')}`;
        const response = await axios.get(validationUrl, { timeout: 8000 });
        const data = response.data;
        
        if (data && typeof data === 'object') {
            if (data.valid) {
                isLicenseValid = true;
                licenseError = "";
            } else {
                isLicenseValid = false;
                licenseError = data.error || "Licença inativa ou inválida.";
            }
        } else {
            isLicenseValid = false;
            licenseError = "Formato de resposta inválido do servidor de licenças.";
        }
    } catch (err) {
        console.error("[Licença] Erro ao conectar ao servidor de licenças:", err.message);
        isLicenseValid = false;
        licenseError = `Não foi possível validar sua licença (Erro de Conexão).`;
    }
    
    // Salvar no cache específico desta chave
    licenseCache.set(key, {
        valid: isLicenseValid,
        error: licenseError,
        timestamp: now
    });
    
    return { valid: isLicenseValid, error: licenseError };
}

// Helper: Obter email da sessão
function getSessionEmail(token) {
    if (!token) return null;
    const session = sessions.get(token);
    if (session && typeof session === 'object') {
        return session.email;
    }
    const config = getAppConfig();
    if (config && config.admin) {
        return config.admin.email;
    }
    return null;
}

// Middleware: Exigir Licença Ativa
async function requireLicense(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const email = getSessionEmail(token);
    
    const config = getAppConfig();
    let key = null;
    
    if (config && config.users && config.users[email]) {
        key = config.users[email].accessKey;
    } else if (config && config.admin && config.admin.email === email) {
        key = config.admin.accessKey;
    } else {
        key = process.env.ACCESS_KEY || null;
    }
    
    if (!key) {
        return res.status(403).json({ error: "Chave de acesso/licença não configurada para este usuário.", licenseExpired: true });
    }
    
    const check = await checkLicenseStatus(key, email);
    if (check.valid) {
        next();
    } else {
        res.status(403).json({ error: check.error, licenseExpired: true });
    }
}

// Estado global de sessões em memória
const sessions = new Map(); // token -> expiration timestamp

// Caminho do arquivo de configuração (no Railway usa o volume /app/data se existir)
const configDir = fs.existsSync('/app/data') ? '/app/data' : __dirname;
const configFile = path.join(configDir, 'config.json');

// Helper: SHA-256 Hash
function getSha256Hash(string) {
    if (!string) return '';
    return crypto.createHash('sha256').update(string).digest('hex');
}

// Helper: Carregar Configuração
function getAppConfig() {
    if (fs.existsSync(configFile)) {
        try {
            const content = fs.readFileSync(configFile, 'utf8');
            return JSON.parse(content);
        } catch (e) {
            return null;
        }
    }
    return null;
}

// Helper: Salvar Configuração
function saveAppConfig(config) {
    try {
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Erro ao salvar config.json:", e);
        return false;
    }
}

// Helper: Validar Token
function isTokenValid(token) {
    if (!token) return false;
    if (sessions.has(token)) {
        const session = sessions.get(token);
        const expiry = typeof session === 'object' ? session.expiry : session;
        if (expiry > Date.now()) {
            if (typeof session === 'object') {
                session.expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
                sessions.set(token, session);
            } else {
                sessions.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000);
            }
            return true;
        } else {
            sessions.delete(token);
        }
    }
    return false;
}

// Middleware de Autenticação
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (isTokenValid(token)) {
        next();
    } else {
        res.status(401).json({ error: "Não autorizado. Faça login primeiro." });
    }
}

// CORS Middleware para garantir acesso de qualquer origem
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ROTA: Status de Autenticação
app.get('/api/auth/status', async (req, res) => {
    const envEmail = process.env.ADMIN_EMAIL;
    const config = getAppConfig();
    
    const hasUsers = config && ((config.users && Object.keys(config.users).length > 0) || (config.admin && config.admin.email));
    const setupCompleted = !!(envEmail || hasUsers);
    
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const loggedIn = isTokenValid(token);
    
    let licenseExpired = false;
    let licenseError = '';
    
    if (loggedIn) {
        const email = getSessionEmail(token);
        let key = null;
        if (config && config.users && config.users[email]) {
            key = config.users[email].accessKey;
        } else if (config && config.admin && config.admin.email === email) {
            key = config.admin.accessKey;
        } else {
            key = process.env.ACCESS_KEY || null;
        }
        
        if (key) {
            const check = await checkLicenseStatus(key, email);
            if (!check.valid) {
                licenseExpired = true;
                licenseError = check.error;
            }
        } else {
            licenseExpired = true;
            licenseError = "Chave de licença/acesso não configurada no servidor.";
        }
    }
    
    res.json({ setupCompleted, loggedIn, licenseExpired, licenseError });
});

// ROTA: Configuração Inicial (Setup) - Registro Multi-usuário
app.post('/api/auth/setup', async (req, res) => {
    const { email, password, key } = req.body;
    if (!email || !password || !key) {
        return res.status(400).json({ error: "Email, senha e chave de acesso são obrigatórios." });
    }
    
    const config = getAppConfig() || { users: {} };
    if (!config.users) config.users = {};
    
    const emailLower = email.toLowerCase().trim();
    
    if (config.users[emailLower] || (config.admin && config.admin.email && config.admin.email.toLowerCase() === emailLower)) {
        return res.status(400).json({ error: "Este e-mail já está cadastrado. Faça login ou use outro e-mail." });
    }
    
    const licCheck = await checkLicenseStatus(key, emailLower);
    if (!licCheck.valid) {
        return res.status(400).json({ error: `Chave inválida ou expirada: ${licCheck.error}` });
    }
    
    const passHash = getSha256Hash(password);
    const keyHash = getSha256Hash(key);
    
    config.users[emailLower] = {
        email: emailLower,
        passwordHash: passHash,
        accessKeyHash: keyHash,
        accessKey: key
    };
    
    if (saveAppConfig(config)) {
        res.json({ success: true, message: "Cadastro realizado com sucesso!" });
    } else {
        res.status(500).json({ error: "Não foi possível salvar as configurações localmente." });
    }
});

// ROTA: Atualizar Licença (Quando Expirada/Bloqueada)
app.post('/api/auth/update-license', async (req, res) => {
    const { key } = req.body;
    if (!key) {
        return res.status(400).json({ error: "A chave de acesso é obrigatória." });
    }
    
    licenseCache.clear();
    
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const email = getSessionEmail(token);
    
    if (!email) {
        return res.status(401).json({ error: "Não autorizado." });
    }
    
    const licCheck = await checkLicenseStatus(key, email);
    if (!licCheck.valid) {
        return res.status(400).json({ error: `Chave inválida ou expirada: ${licCheck.error}` });
    }
    
    const config = getAppConfig();
    if (config && config.users && config.users[email]) {
        config.users[email].accessKey = key;
        config.users[email].accessKeyHash = getSha256Hash(key);
    } else if (config && config.admin && config.admin.email === email) {
        config.admin.accessKey = key;
        config.admin.accessKeyHash = getSha256Hash(key);
    } else {
        return res.status(404).json({ error: "Usuário não encontrado." });
    }
    
    if (saveAppConfig(config)) {
        res.json({ success: true });
    } else {
        res.status(500).json({ error: "Falha ao salvar a nova chave no servidor." });
    }
});

// ROTA: Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password, key } = req.body;
    if (!email || !password || !key) {
        return res.status(400).json({ error: "E-mail, senha e chave de acesso são obrigatórios." });
    }
    
    const emailLower = email.toLowerCase().trim();
    const config = getAppConfig();
    
    let user = null;
    if (config && config.users && config.users[emailLower]) {
        user = config.users[emailLower];
    } else if (config && config.admin && config.admin.email && config.admin.email.toLowerCase() === emailLower) {
        user = config.admin;
    }
    
    if (!user) {
        return res.status(401).json({ error: "E-mail, senha ou chave de acesso incorretos." });
    }
    
    const licCheck = await checkLicenseStatus(key, emailLower);
    if (!licCheck.valid) {
        return res.status(403).json({ error: `Licença inativa: ${licCheck.error}`, licenseExpired: true });
    }
    
    const passHash = getSha256Hash(password);
    const keyHash = getSha256Hash(key);
    
    if (passHash === user.passwordHash && keyHash === user.accessKeyHash) {
        const token = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
        sessions.set(token, {
            expiry: Date.now() + 7 * 24 * 60 * 60 * 1000,
            email: emailLower
        });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: "E-mail, senha ou chave de acesso incorretos." });
    }
});

// ROTA: Logout
app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (token) {
        sessions.delete(token);
    }
    res.json({ success: true, message: "Sessão encerrada." });
});

// ROTA: Proxy de CORS (Protegida) - Agora com requireLicense
app.get('/proxy', requireAuth, requireLicense, async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ error: "Parâmetro 'url' ausente." });
    }
    
    console.log(`[Proxy] Requisitando: ${url}`);
    try {
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
            },
            timeout: 10000
        });
        res.send(response.data);
    } catch (err) {
        console.error(`[Proxy] Falha: ${err.message}`);
        res.status(500).json({ error: `Erro do proxy: ${err.message}` });
    }
});

// ROTA: Obter Configurações e Status da Automação do Usuário
app.get('/api/settings', requireAuth, (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const email = getSessionEmail(token);
    const config = getAppConfig();
    
    let user = null;
    if (config && config.users && config.users[email]) {
        user = config.users[email];
    } else if (config && config.admin && config.admin.email === email) {
        user = config.admin;
    }
    
    if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
    }
    
    res.json({
        settings: user.settings || {},
        template: user.template || null,
        automation: user.automation || { active: false, blacklist: '', category: 'all', interval: 10, sources: { promobit: true, gatry: true } }
    });
});

// ROTA: Salvar Configurações do Usuário
app.post('/api/settings', requireAuth, (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const email = getSessionEmail(token);
    const { settings, template, automation } = req.body;
    
    const config = getAppConfig();
    let user = null;
    if (config && config.users && config.users[email]) {
        user = config.users[email];
    } else if (config && config.admin && config.admin.email === email) {
        user = config.admin;
    }
    
    if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
    }
    
    if (settings) user.settings = settings;
    if (template !== undefined) user.template = template;
    if (automation) {
        user.automation = {
            ...(user.automation || { active: false, blacklist: '', category: 'all', interval: 10, sources: { promobit: true, gatry: true } }),
            ...automation
        };
    }
    
    if (saveAppConfig(config)) {
        res.json({ success: true });
    } else {
        res.status(500).json({ error: "Erro ao salvar as configurações." });
    }
});

// ROTA: Ativar/Desativar Autopostagem
app.post('/api/automation/toggle', requireAuth, (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const email = getSessionEmail(token);
    const { active, interval } = req.body;
    
    const config = getAppConfig();
    let user = null;
    if (config && config.users && config.users[email]) {
        user = config.users[email];
    } else if (config && config.admin && config.admin.email === email) {
        user = config.admin;
    }
    
    if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
    }
    
    if (!user.automation) {
        user.automation = { active: false, blacklist: '', category: 'all', interval: 10, sources: { promobit: true, gatry: true } };
    }
    
    user.automation.active = !!active;
    if (interval) {
        user.automation.interval = parseInt(interval) || 10;
    }
    
    const statusText = user.automation.active ? "iniciada (24/7 no servidor)" : "parada pelo usuário";
    const logType = user.automation.active ? "success" : "warning";
    writeUserLog(email, `Autopostagem ${statusText}.`, logType);
    
    if (saveAppConfig(config)) {
        res.json({ success: true, active: user.automation.active });
    } else {
        res.status(500).json({ error: "Erro ao atualizar status de automação." });
    }
});

// ROTA: Obter Logs de Automação do Usuário
app.get('/api/automation/logs', requireAuth, (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const email = getSessionEmail(token);
    
    const logs = userLogs.get(email) || [];
    res.json({ logs });
});

// ROTA: Limpar Histórico de Postagens
app.post('/api/automation/clear-history', requireAuth, (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const email = getSessionEmail(token);
    
    const config = getAppConfig();
    let user = null;
    let userKey = null;
    if (config && config.users && config.users[email]) {
        user = config.users[email];
        userKey = 'users';
    } else if (config && config.admin && config.admin.email === email) {
        user = config.admin;
        userKey = 'admin';
    }
    
    if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
    }
    
    user.alreadyPostedDeals = [];
    
    if (userKey === 'users') {
        config.users[email] = user;
    } else {
        config.admin = user;
    }
    
    writeUserLog(email, "Histórico de postagens limpo pelo usuário.", "info");
    
    if (saveAppConfig(config)) {
        res.json({ success: true });
    } else {
        res.status(500).json({ error: "Erro ao limpar histórico no servidor." });
    }
});

// ROTA: Página principal (Se não bater com nenhum arquivo estático, envia index.html)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================================================
// MOTOR DE AUTOMAÇÃO E POSTAGEM DO LADO DO SERVIDOR (BACKGROUND LOOPS)
// ==========================================================================
const userLogs = new Map();
const lastScanTime = new Map();

function writeUserLog(email, message, type = 'info') {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logLine = `[${timeStr}] ${message}`;
    
    if (!userLogs.has(email)) {
        userLogs.set(email, []);
    }
    const logs = userLogs.get(email);
    logs.push(logLine);
    if (logs.length > 100) {
        logs.shift();
    }
    console.log(`[${email}] ${logLine}`);
}

async function fetchShopeeOfficialLinkServer(originUrl, appKey, appSecret) {
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
    const signature = crypto.createHash('sha256').update(rawSignatureString).digest('hex');
    
    const targetApiUrl = 'https://open-api.affiliate.shopee.com.br/api/v1/rest';
    
    const response = await axios.post(targetApiUrl, requestBody, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `SHA256 AppKey=${appKey}, Timestamp=${timestamp}, Sign=${signature}`
        }
    });
    
    const json = response.data;
    if (json.data && json.data.generateShortLink && json.data.generateShortLink.shortLink) {
        return json.data.generateShortLink.shortLink;
    }
    throw new Error(json.errors ? json.errors[0].message : "Formato de retorno Shopee inválido");
}

async function convertToAffiliateServer(url, platform, userSettings) {
    let cleanUrl = url;
    try {
        const parsed = new URL(url);
        if (platform === 'mercadolivre') {
            const cleanParams = ['click_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
            cleanParams.forEach(p => parsed.searchParams.delete(p));
            cleanUrl = parsed.toString();
        } else if (platform === 'shopee') {
            const cleanParams = ['sp_atk', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'xgids'];
            cleanParams.forEach(p => parsed.searchParams.delete(p));
            cleanUrl = parsed.toString();
        } else if (platform === 'amazon') {
            parsed.searchParams.delete('tag');
            parsed.searchParams.delete('language');
            parsed.searchParams.delete('ref_');
            cleanUrl = parsed.toString();
        }
    } catch(e) {}

    if (platform === 'amazon') {
        const tag = userSettings.amzTag || 'tag-afiliado-20';
        const asinMatch = cleanUrl.match(/(?:\/dp\/|\/gp\/product\/|\/product\/)([A-Z0-9]{10})/i);
        if (asinMatch && asinMatch[1]) {
            return `https://www.amazon.com.br/dp/${asinMatch[1]}?tag=${tag}`;
        }
        return `${cleanUrl}${cleanUrl.includes('?') ? '&' : '?'}tag=${tag}`;
    }
    else if (platform === 'mercadolivre') {
        const campaign = userSettings.mlCampaign || 'ofertasbot';
        if (campaign.includes('lomadee') || (campaign === '' && userSettings.shopeeFallback && userSettings.shopeeFallback.includes('lomadee'))) {
            const lomadeeKey = userSettings.shopeeFallback || 'suachavelomadee';
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
        if (userSettings.shopeeKey && userSettings.shopeeSecret) {
            try {
                return await fetchShopeeOfficialLinkServer(cleanUrl, userSettings.shopeeKey, userSettings.shopeeSecret);
            } catch (err) {
                console.error("Erro na API oficial da Shopee, gerando link alternativo", err.message);
            }
        }
        
        const fallback = userSettings.shopeeFallback || '';
        if (fallback.includes('lomadee')) {
            return `https://links.lomadee.com/v2/generator?key=${fallback}&sourceId=38000000&link=${encodeURIComponent(cleanUrl)}`;
        } else if (fallback.startsWith('http')) {
            return `${fallback}${fallback.includes('?') ? '&' : '?'}sub_id=ofertasbot&url=${encodeURIComponent(cleanUrl)}`;
        }
        return cleanUrl;
    }
    else if (platform === 'aliexpress') {
        const trackingId = userSettings.aliId || 'default_ali_id';
        if (trackingId.startsWith('http')) {
            return `${trackingId}${trackingId.includes('?') ? '&' : '?'}dl_target_url=${encodeURIComponent(cleanUrl)}`;
        }
        return `https://s.click.aliexpress.com/e/_${trackingId}?dl_target_url=${encodeURIComponent(cleanUrl)}`;
    }

    return cleanUrl;
}

function cleanTitleServer(title) {
    if (!title) return '';
    return title
        .replace(/🚨/g, '')
        .replace(/🔥/g, '')
        .replace(/⚡/g, '')
        .replace(/cupom:\s*[A-Z0-9]+/gi, '')
        .replace(/no pix/gi, '')
        .replace(/frete grátis/gi, '')
        .replace(/frete gratis/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function parsePriceToFloatServer(val) {
    if (!val) return 0;
    const cleanStr = String(val).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    return parseFloat(cleanStr) || 0;
}

function formatCurrencyTextServer(val) {
    let num = parseFloat(val);
    if (isNaN(num)) {
        const cleanStr = String(val).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
        num = parseFloat(cleanStr) || 0;
    }
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getLowerPriceServer(p1, p2) {
    const v1 = parsePriceToFloatServer(p1);
    const v2 = parsePriceToFloatServer(p2);
    if (v1 > 0 && v2 > 0) {
        return v1 < v2 ? p1 : p2;
    }
    return p1 || p2 || '';
}

function getHigherPriceServer(p1, p2) {
    const v1 = parsePriceToFloatServer(p1);
    const v2 = parsePriceToFloatServer(p2);
    if (v1 > 0 && v2 > 0) {
        return v1 > v2 ? p1 : p2;
    }
    return p1 || p2 || '';
}

function extractCouponFromDocServer($) {
    const promobitCoupon = $('.coupon-code, .coupon, [class*="coupon-code" i], [class*="coupon__code" i], .couponCode, .coupon_code, .voucher-code, .voucher').first();
    if (promobitCoupon && promobitCoupon.text().trim()) {
        const text = promobitCoupon.text().trim();
        if (text.length >= 3 && text.length <= 15 && !text.includes(' ')) {
            return text.toUpperCase();
        }
    }
    
    const couponInput = $('input[value*="CUPOM" i], input[id*="coupon" i], input[class*="coupon" i]').first();
    if (couponInput && couponInput.val() && couponInput.val().length >= 3 && couponInput.val().length <= 15) {
        return couponInput.val().trim().toUpperCase();
    }
    
    const bodyText = $('body').text();
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

function extractSchemaAndMetaValuesServer($) {
    let title = '';
    let image = '';
    let price = '';
    let oldPrice = '';
    let coupon = extractCouponFromDocServer($) || '';
    
    const nextDataEl = $('#__NEXT_DATA__');
    if (nextDataEl.length > 0) {
        try {
            const nextData = JSON.parse(nextDataEl.text());
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
        } catch (e) {}
    }
    
    const scripts = $('script[type="application/ld+json"]');
    scripts.each((i, script) => {
        try {
            const text = $(script).text();
            const json = JSON.parse(text);
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
    });
    
    if (!title) {
        title = $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content') || $('title').text() || '';
    }
    if (!image) {
        image = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';
    }
    
    return { title, image, price, oldPrice, coupon };
}

async function fetchViaProxyServer(url) {
    try {
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        return res.data;
    } catch (directErr) {
        try {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const res = await axios.get(proxyUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 15000
            });
            return res.data;
        } catch (proxyErr) {
            throw new Error(`Direto: ${directErr.message} | Proxy: ${proxyErr.message}`);
        }
    }
}

async function scrapeProductInfoServer(url, platform) {
    const html = await fetchViaProxyServer(url);
    const $ = cheerio.load(html);
    
    let result = { title: '', price: '', oldPrice: '', image: '' };
    const schemaData = extractSchemaAndMetaValuesServer($);

    if (platform === 'amazon') {
        const titleEl = $('#productTitle');
        if (titleEl.length > 0) result.title = titleEl.text().trim();
        
        const priceContainer = $('#corePriceDisplay_desktop_feature_div, #corePrice_desktop, #apex_desktop, #priceInsideBuyBox, #newBuyBoxPrice').first();
        const container = priceContainer.length > 0 ? priceContainer : $('body');
                               
        const priceOffscreen = container.find('.a-price .a-offscreen, .a-offscreen').first();
        const priceWhole = container.find('.a-price-whole').first();
        const priceFraction = container.find('.a-price-fraction').first();
        
        if (priceOffscreen.length > 0) {
            result.price = priceOffscreen.text().replace(/[^\d,.-]/g, '');
        } else if (priceWhole.length > 0) {
            result.price = priceWhole.text().replace(/[^\d]/g, '') + ',' + (priceFraction.length > 0 ? priceFraction.text().replace(/[^\d]/g, '') : '00');
        }

        const oldPriceEl = container.find('.basisPrice .a-offscreen, span.a-price.a-text-price span.a-offscreen, span.a-price.a-text-price, .a-line-through, .a-size-small.a-color-secondary.a-text-strike').first();
        if (oldPriceEl.length > 0) result.oldPrice = oldPriceEl.text().replace(/[^\d,.-]/g, '');

        const imgEl = $('#landingImage, #imgBlkFront').first();
        if (imgEl.length > 0) result.image = imgEl.attr('src') || imgEl.attr('data-a-dynamic-image') || result.image;
        if (result.image.startsWith('{')) {
            try { result.image = Object.keys(JSON.parse(result.image))[0]; } catch(e) {}
        }
    } 
    else if (platform === 'mercadolivre') {
        const titleEl = $('.ui-pdp-title').first();
        if (titleEl.length > 0) result.title = titleEl.text().trim();

        const mainPriceContainer = $('.ui-pdp-price__second-line, .ui-vip-core-price, .ui-pdp-price').first();
        const container = mainPriceContainer.length > 0 ? mainPriceContainer : $('body');
        const priceFraction = container.find('.andes-money-amount__fraction').first();
        const priceCents = container.find('.andes-money-amount__cents').first();
        if (priceFraction.length > 0) {
            result.price = priceFraction.text().trim() + ',' + (priceCents.length > 0 ? priceCents.text().trim() : '00');
        }

        const oldPriceContainer = $('.ui-pdp-price__original-value, .ui-pdp-price__old').first();
        const oldContainer = oldPriceContainer.length > 0 ? oldPriceContainer : $('body');
        const oldPriceFraction = oldContainer.find('.andes-money-amount__fraction').first();
        const oldPriceCents = oldContainer.find('.andes-money-amount__cents').first();
        if (oldPriceFraction.length > 0) {
            result.oldPrice = oldPriceFraction.text().trim() + ',' + (oldPriceCents.length > 0 ? oldPriceCents.text().trim() : '00');
        }

        const imgEl = $('.ui-pdp-gallery__figure__image, .ui-pdp-image').first();
        if (imgEl.length > 0) result.image = imgEl.attr('src') || imgEl.attr('data-zoom') || result.image;
    }
    else if (platform === 'shopee') {
        result.title = schemaData.title || $('meta[property="og:title"]').attr('content') || '';
        result.image = schemaData.image || $('meta[property="og:image"]').attr('content') || '';
        result.price = schemaData.price || '';
        result.oldPrice = schemaData.oldPrice || '';
    }
    else if (platform === 'aliexpress') {
        result.title = schemaData.title || $('meta[property="og:title"]').attr('content') || '';
        result.image = schemaData.image || $('meta[property="og:image"]').attr('content') || '';
        result.price = schemaData.price || '';
        result.oldPrice = schemaData.oldPrice || '';

        if (!result.title) {
            const titleEl = $('.product-title, [class*="product-title" i], h1').first();
            if (titleEl.length > 0) result.title = titleEl.text().trim();
        }
        if (!result.image) {
            const imgEl = $('.magnifier-image, [class*="magnifier" i], [class*="product-image" i] img, img[src*="item/detail"]').first();
            if (imgEl.length > 0) result.image = imgEl.attr('src');
        }
        if (!result.price) {
            const priceEl = $('.product-price-value, [class*="price-current" i], [class*="price-value" i], [class*="product-price" i]').first();
            if (priceEl.length > 0) result.price = priceEl.text().replace(/[^\d,.-]/g, '');
        }
        if (!result.oldPrice) {
            const oldPriceEl = $('.product-price-del, [class*="price-original" i], [class*="price-del" i], del').first();
            if (oldPriceEl.length > 0) result.oldPrice = oldPriceEl.text().replace(/[^\d,.-]/g, '');
        }
    }

    result.title = schemaData.title || result.title || '';
    result.image = schemaData.image || result.image || '';
    result.price = getLowerPriceServer(schemaData.price, result.price);
    result.oldPrice = getHigherPriceServer(schemaData.oldPrice, result.oldPrice);

    if (result.title) result.title = cleanTitleServer(result.title);
    if (result.price) result.price = formatCurrencyTextServer(result.price);
    if (result.oldPrice) result.oldPrice = formatCurrencyTextServer(result.oldPrice);

    return result;
}

async function fetchPromobitSingleUrl(url) {
    try {
        const html = await fetchViaProxyServer(url);
        const $ = cheerio.load(html);
        const deals = [];
        const seenUrls = new Set();

        const scriptEls = $('script[type="application/ld+json"]');
        let json = null;
        scriptEls.each((i, el) => {
            try {
                const parsed = JSON.parse($(el).text());
                if (parsed && (parsed['@type'] === 'ItemList' || parsed['type'] === 'ItemList') && parsed.itemListElement && parsed.itemListElement.length > 0) {
                    json = parsed;
                }
            } catch(e) {}
        });

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
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        const anchors = $('a[href*="/oferta/"]');
        anchors.each((i, a) => {
            const href = $(a).attr('href');
            let title = $(a).text() ? $(a).text().trim() : '';
            if (!title) {
                const img = $(a).find('img');
                if (img.length > 0) title = img.attr('alt') || '';
            }
            if (href && title && title.length > 5) {
                const link = href.startsWith('http') ? href : `https://www.promobit.com.br${href}`;
                if (!seenUrls.has(link)) {
                    seenUrls.add(link);
                    
                    let image = '';
                    let price = '';
                    
                    const card = $(a).closest('[class*="offer" i], [class*="card" i], article').first();
                    if (card.length > 0) {
                        const imgEl = card.find('img').first();
                        if (imgEl.length > 0) image = imgEl.attr('src') || imgEl.attr('data-src') || '';
                        
                        const priceEl = card.find('[class*="price" i], [class*="valor" i], [class*="amount" i]').first();
                        if (priceEl.length > 0) price = priceEl.text();
                    }
                    
                    deals.push({
                        id: link,
                        title: cleanTitleServer(title),
                        link: link,
                        source: 'promobit',
                        price: price ? price.trim() : '',
                        image: image
                    });
                }
            }
        });

        return deals;
    } catch (e) {
        console.error(`Erro ao buscar Promobit na URL ${url}:`, e.message);
        return [];
    }
}

async function fetchPromobitServer(selectedCat) {
    if (selectedCat === 'casa_eletro_pc_auto') {
        const urls = [
            'https://www.promobit.com.br/promocoes/eletrodomesticos/',
            'https://www.promobit.com.br/promocoes/moveis-e-decoracao/',
            'https://www.promobit.com.br/promocoes/informatica/',
            'https://www.promobit.com.br/promocoes/pecas-e-acessorios-para-automoveis/'
        ];
        let allDeals = [];
        const seenIds = new Set();
        for (const url of urls) {
            const deals = await fetchPromobitSingleUrl(url);
            for (const deal of deals) {
                if (!seenIds.has(deal.id)) {
                    seenIds.add(deal.id);
                    allDeals.push(deal);
                }
            }
        }
        return allDeals;
    }

    let url = 'https://www.promobit.com.br/';
    if (selectedCat === 'informatica') {
        url = 'https://www.promobit.com.br/promocoes/informatica/';
    } else if (selectedCat === 'games') {
        url = 'https://www.promobit.com.br/promocoes/games/';
    } else if (selectedCat === 'smartphones') {
        url = 'https://www.promobit.com.br/promocoes/smartphones-tablets-e-telefones/';
    } else if (selectedCat === 'automotivo') {
        url = 'https://www.promobit.com.br/promocoes/pecas-e-acessorios-para-automoveis/';
    } else if (selectedCat === 'eletrodomesticos') {
        url = 'https://www.promobit.com.br/promocoes/eletrodomesticos/';
    } else if (selectedCat === 'moveis') {
        url = 'https://www.promobit.com.br/promocoes/moveis-e-decoracao/';
    }

    return await fetchPromobitSingleUrl(url);
}

async function fetchGatryServer() {
    const html = await fetchViaProxyServer('https://gatry.com/');
    const $ = cheerio.load(html);
    const deals = [];
    $('article').each((i, article) => {
        const titleEl = $(article).find('h3 a').first();
        if (titleEl.length > 0) {
            const title = titleEl.text().trim();
            let link = titleEl.attr('href');
            if (link) {
                if (link.startsWith('/')) {
                    link = `https://gatry.com${link}`;
                }
                const priceEl = $(article).find('.price').first();
                const priceText = priceEl ? priceEl.text().replace(/[^\d,.]/g, '').trim() : '';
                const imgEl = $(article).find('.image img').first();
                const image = imgEl ? imgEl.attr('src') : '';
                deals.push({
                    id: link,
                    title: title,
                    link: link,
                    source: 'gatry',
                    price: priceText,
                    image: image
                });
            }
        }
    });
    return deals;
}

function detectPlatformServer(url) {
    if (!url) return 'desconhecido';
    const lowercaseUrl = url.toLowerCase();
    
    if (lowercaseUrl.includes('shopee.com.br') || lowercaseUrl.includes('shope.ee')) {
        return 'shopee';
    }
    if (lowercaseUrl.includes('mercadolivre.com.br') || lowercaseUrl.includes('mercadolivre.com') || lowercaseUrl.includes('mlb.sh') || lowercaseUrl.includes('mercadolibre') || lowercaseUrl.includes('mely.com.br')) {
        return 'mercadolivre';
    }
    if (lowercaseUrl.includes('aliexpress.com') || lowercaseUrl.includes('ali.onl') || lowercaseUrl.includes('aliexpress.ru')) {
        return 'aliexpress';
    }
    if (lowercaseUrl.includes('amazon.com.br') || lowercaseUrl.includes('amzn.to')) {
        return 'amazon';
    }
    return 'desconhecido';
}

function isShortlinkServer(url) {
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
           lowercaseUrl.includes('mpago.la');
}

async function resolveRedirectUrlServer(url) {
    let currentUrl = url;
    let attempts = 0;
    let cookies = [];
    
    while (attempts < 8) {
        attempts++;
        try {
            if (isShortlinkServer(currentUrl) && !currentUrl.includes('promobit.com.br') && !currentUrl.includes('gatry.com')) {
                try {
                    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(currentUrl)}&_=${Date.now()}`;
                    const res = await axios.get(proxyUrl, { timeout: 15000 });
                    if (res.data && res.data.status && res.data.status.url) {
                        currentUrl = res.data.status.url;
                        continue;
                    }
                } catch (err) {
                    // erro, continua
                }
            }
            
            const platform = detectPlatformServer(currentUrl);
            
            if (platform !== 'desconhecido') {
                const lowercaseUrl = currentUrl.toLowerCase();
                const isProduct = (
                    (platform === 'amazon' && /\/(?:dp|gp\/product|product)\/[a-z0-9]{10}/i.test(currentUrl)) ||
                    (platform === 'mercadolivre' && (lowercaseUrl.includes('/mlb-') || lowercaseUrl.includes('/p/mlb') || lowercaseUrl.includes('produto.mercadolivre.com.br') || /\/p\/[a-z0-9]+/i.test(currentUrl))) ||
                    (platform === 'shopee' && (/-i\.\d+\.\d+/i.test(currentUrl) || lowercaseUrl.includes('/product/'))) ||
                    (platform === 'aliexpress' && (lowercaseUrl.includes('/item/') || /\/item\/\d+\.html/i.test(currentUrl)))
                );
                
                if (isProduct) {
                    return currentUrl;
                }
            }
            
            const reqHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            };
            if (cookies && cookies.length > 0) {
                reqHeaders['Cookie'] = cookies.join('; ');
            }
            if (currentUrl.includes('promobit.com.br')) {
                reqHeaders['Referer'] = url;
            }

            const response = await axios.head(currentUrl, {
                headers: reqHeaders,
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400
            }).catch(async err => {
                return await axios.get(currentUrl, {
                    headers: reqHeaders,
                    maxRedirects: 0,
                    validateStatus: (status) => status >= 200 && status < 400
                });
            });
            
            if (response && response.headers && response.headers['set-cookie']) {
                const newCookies = response.headers['set-cookie'].map(c => c.split(';')[0]);
                newCookies.forEach(nc => {
                    const name = nc.split('=')[0];
                    cookies = cookies.filter(c => c.split('=')[0] !== name);
                    cookies.push(nc);
                });
            }
            
            if (response.headers.location) {
                let nextUrl = response.headers.location;
                if (nextUrl.startsWith('/')) {
                    const origin = new URL(currentUrl).origin;
                    nextUrl = origin + nextUrl;
                }
                currentUrl = nextUrl;
            } else {
                let html = response.data;
                if (!html) {
                    const getRes = await axios.get(currentUrl, {
                        headers: reqHeaders,
                        maxRedirects: 0,
                        validateStatus: (status) => status >= 200 && status < 400
                    });
                    html = getRes.data;
                }
                
                const jsRedirectMatch = html.match(/\b(?:l|location\.href)\b\s*=\s*['"]([^'"]+)['"]/i);
                if (jsRedirectMatch && jsRedirectMatch[1]) {
                    currentUrl = jsRedirectMatch[1];
                    continue;
                }
                
                const $ = cheerio.load(html);
                
                const btnPromobit = $('a[href*="/Redirect/to/" i], a[href*="/link/" i]').first();
                const btnGatry = $('a[href*="/link?" i]').first();
                const genericLink = $('.btn-go-to-store, a[class*="go-to" i], a[class*="loja" i]').first();
                
                let redirectButtonUrl = null;
                if (btnPromobit.length > 0) {
                    redirectButtonUrl = btnPromobit.attr('href');
                } else if (btnGatry.length > 0) {
                    redirectButtonUrl = btnGatry.attr('href');
                } else if (genericLink.length > 0) {
                    redirectButtonUrl = genericLink.attr('href');
                }
                
                if (redirectButtonUrl) {
                    if (redirectButtonUrl.startsWith('/')) {
                        const base = new URL(currentUrl).origin;
                        redirectButtonUrl = base + redirectButtonUrl;
                    }
                    currentUrl = redirectButtonUrl;
                    continue;
                }
                
                const metaRefresh = $('meta[http-equiv="refresh"], meta[http-equiv="Refresh"]');
                if (metaRefresh.length > 0) {
                    const content = metaRefresh.attr('content');
                    const match = content ? content.match(/url=(.+)/i) : null;
                    if (match && match[1]) {
                        let nextUrl = match[1].replace(/['"]/g, '').trim();
                        if (nextUrl.startsWith('/')) {
                            nextUrl = new URL(currentUrl).origin + nextUrl;
                        }
                        currentUrl = nextUrl;
                        continue;
                    }
                }
                
                const canonical = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content');
                if (canonical && canonical !== currentUrl && detectPlatformServer(canonical) !== 'desconhecido') {
                    currentUrl = canonical;
                    continue;
                }
                
                break;
            }
        } catch (e) {
            break;
        }
    }
    return currentUrl;
}

async function runUserScan(email, user) {
    if (!user.automation || !user.automation.active) return;
    
    const settings = user.settings || {};
    const token = settings.tgToken;
    const chatId = settings.tgChatId;
    
    if (!token || !chatId) {
        writeUserLog(email, "ERRO: Token do Telegram ou Chat ID ausente nas configurações.", "error");
        return;
    }
    
    const hasAff = settings.amzTag || settings.mlCampaign || settings.shopeeFallback || (settings.shopeeKey && settings.shopeeSecret) || settings.aliId;
    if (!hasAff) {
        writeUserLog(email, "ERRO: Nenhum ID de afiliado configurado.", "error");
        return;
    }

    const selectedCat = user.automation.category || 'all';
    const sources = user.automation.sources || { promobit: true, gatry: true };
    
    writeUserLog(email, "Buscando novas ofertas nos agregadores...", "info");
    
    let deals = [];
    
    if (sources.promobit) {
        try {
            writeUserLog(email, "Rastreando Promobit...", "info");
            const promobitDeals = await fetchPromobitServer(selectedCat);
            deals = deals.concat(promobitDeals);
            writeUserLog(email, `Promobit listou ${promobitDeals.length} ofertas.`, "info");
        } catch (err) {
            writeUserLog(email, `Erro ao carregar Promobit: ${err.message}`, "error");
        }
    }
    
    if (sources.gatry) {
        try {
            writeUserLog(email, "Rastreando Gatry...", "info");
            const gatryDeals = await fetchGatryServer();
            deals = deals.concat(gatryDeals);
            writeUserLog(email, `Gatry listou ${gatryDeals.length} ofertas.`, "info");
        } catch (err) {
            writeUserLog(email, `Erro ao carregar Gatry: ${err.message}`, "error");
        }
    }
    
    if (deals.length === 0) {
        writeUserLog(email, "Nenhuma oferta encontrada nos agregadores nesta rodada.", "info");
        return;
    }

    if (selectedCat && selectedCat !== 'all') {
        const initialCount = deals.length;
        
        // Definição de palavras-chave para categorias
        const keywordsAutomotivo = ['pneu', 'capacete', 'óleo', 'lubrificante', 'carro', 'moto', 'motociclista', 'automotivo', 'multimídia', 'alto-falante', 'retrovisor', 'calota', 'freio', 'farol', 'bateria', 'carros', 'motos', 'aditivo', 'limpador', 'macaco', 'calibrador', 'sensor de estacionamento', 'alarme'];
        const keywordsInformatica = ['notebook', 'pc', 'computador', 'monitor', 'teclado', 'mouse', 'ssd', 'hd', 'memória', 'ram', 'processador', 'ryzen', 'intel', 'geforce', 'radeon', 'gabinete', 'roteador', 'wifi', 'headset', 'placa de vídeo', 'placa de video', 'placa-mãe', 'placa mae', 'fonte', 'cooler', 'impressora'];
        const keywordsGames = ['ps5', 'playstation', 'xbox', 'nintendo', 'switch', 'console', 'game', 'jogo', 'controle', 'gamer', 'headset gamer', 'ps4'];
        const keywordsSmartphones = ['celular', 'smartphone', 'iphone', 'galaxy', 'motorola', 'xiaomi', 'redmi', 'capinha', 'película', 'carregador', 'smartwatch'];
        const keywordsEletrodomesticos = ['geladeira', 'fogão', 'fogao', 'micro-ondas', 'microondas', 'lavadora', 'máquina de lavar', 'maquina de lavar', 'lava e seca', 'secadora', 'ar condicionado', 'ar-condicionado', 'frigobar', 'frezzer', 'freezer', 'cooktop', 'coifa', 'depurador', 'forno', 'aspirador', 'batedeira', 'liquidificador', 'airfryer', 'fritadeira', 'cafeteira', 'microondas', 'eletrodoméstico', 'eletrodomestico', 'multiprocessador', 'ferro de passar', 'ventilador', 'climatizador', 'tanquinho', 'adega', 'cervejeira', 'depurador'];
        const keywordsMoveis = ['sofá', 'sofa', 'mesa', 'cadeira', 'guarda-roupa', 'guarda roupa', 'armário', 'armario', 'cama', 'colchão', 'colchao', 'cômoda', 'comoda', 'estante', 'rack', 'painel', 'poltrona', 'escrivaninha', 'aparador', 'cabeceira', 'guarda-livros', 'móvel', 'movel', 'móveis', 'moveis', 'criado-mudo', 'criado mudo', 'penteadeira', 'guarda roupa', 'estofado'];

        deals = deals.filter(deal => {
            if (deal.source === 'promobit') return true;
            const title = deal.title.toLowerCase();
            
            if (selectedCat === 'automotivo') {
                return keywordsAutomotivo.some(k => title.includes(k));
            }
            if (selectedCat === 'informatica') {
                return keywordsInformatica.some(k => title.includes(k));
            }
            if (selectedCat === 'games') {
                return keywordsGames.some(k => title.includes(k));
            }
            if (selectedCat === 'smartphones') {
                return keywordsSmartphones.some(k => title.includes(k));
            }
            if (selectedCat === 'eletrodomesticos') {
                return keywordsEletrodomesticos.some(k => title.includes(k));
            }
            if (selectedCat === 'moveis') {
                return keywordsMoveis.some(k => title.includes(k));
            }
            if (selectedCat === 'casa_eletro_pc_auto') {
                const allCustomKeywords = [
                    ...keywordsAutomotivo,
                    ...keywordsInformatica,
                    ...keywordsEletrodomesticos,
                    ...keywordsMoveis
                ];
                return allCustomKeywords.some(k => title.includes(k));
            }
            return true;
        });
        
        const filteredOut = initialCount - deals.length;
        if (filteredOut > 0) {
            writeUserLog(email, `Filtro de categoria aplicado. ${filteredOut} oferta(s) descartada(s).`, "info");
        }
    }

    const blacklistText = user.automation.blacklist || '';
    if (blacklistText.trim()) {
        const blacklist = blacklistText.toLowerCase().split(',').map(item => item.trim()).filter(item => item !== '');
        if (blacklist.length > 0) {
            const initialCount = deals.length;
            deals = deals.filter(deal => {
                const title = deal.title.toLowerCase();
                return !blacklist.some(word => title.includes(word));
            });
            const blacklistedCount = initialCount - deals.length;
            if (blacklistedCount > 0) {
                writeUserLog(email, `Filtro de Blacklist: ${blacklistedCount} oferta(s) bloqueada(s).`, "warning");
            }
        }
    }

    if (!user.alreadyPostedDeals) {
        user.alreadyPostedDeals = [];
    }
    const alreadyPosted = new Set(user.alreadyPostedDeals);
    
    let newDeals = deals.filter(deal => !alreadyPosted.has(deal.id));
    if (newDeals.length === 0) {
        writeUserLog(email, "Sem novas ofertas para postar no momento.", "info");
        return;
    }
    
    writeUserLog(email, `${newDeals.length} novas ofertas detectadas. Processando postagem...`, "info");
    
    const limit = Math.min(newDeals.length, 3);
    let postedCount = 0;

    for (let i = 0; i < limit; i++) {
        const deal = newDeals[i];
        
        writeUserLog(email, `Analisando: "${deal.title.substring(0, 30)}..."`, "info");
        
        const finalUrl = await resolveRedirectUrlServer(deal.link);
        const platform = detectPlatformServer(finalUrl);
        
        if (platform === 'desconhecido') {
            writeUserLog(email, `[Pulado] Loja final não suportada para o link: ${finalUrl.substring(0, 45)}...`, "warning");
            user.alreadyPostedDeals.push(deal.id);
            continue;
        }

        const hasStoreDetails = (
            (platform === 'amazon' && settings.amzTag) ||
            (platform === 'mercadolivre' && settings.mlCampaign) ||
            (platform === 'shopee' && (settings.shopeeFallback || settings.shopeeKey)) ||
            (platform === 'aliexpress' && settings.aliId)
        );

        if (!hasStoreDetails) {
            writeUserLog(email, `[Pulado] Credenciais para loja ${platform.toUpperCase()} não preenchidas.`, "warning");
            user.alreadyPostedDeals.push(deal.id);
            continue;
        }

        writeUserLog(email, `Link final resolvido: ${platform.toUpperCase()} - obtendo detalhes...`, "info");
        
        let scraped = { title: deal.title, price: '', oldPrice: '', image: '' };
        try {
            scraped = await scrapeProductInfoServer(finalUrl, platform);
        } catch (err) {
            writeUserLog(email, `Falha no scraping da loja final. Usando informações básicas do feed.`, "warning");
        }

        if (!scraped.title) scraped.title = cleanTitleServer(deal.title);
        if (deal.price && deal.price !== 'Consultar' && deal.price !== '0,00' && deal.price.trim() !== '') {
            scraped.price = formatCurrencyTextServer(deal.price);
        } else if (!scraped.price || scraped.price === 'Consultar' || scraped.price === '0,00' || scraped.price.trim() === '') {
            scraped.price = 'Consultar';
        }
        if (!scraped.image && deal.image) {
            scraped.image = deal.image;
        }

        const numericPrice = parsePriceToFloatServer(scraped.price);
        const hasValidPrice = scraped.price && scraped.price !== 'Consultar' && scraped.price !== '0,00' && numericPrice > 0;
        
        if (hasValidPrice) {
            const numericOldPrice = parsePriceToFloatServer(scraped.oldPrice);
            if (!scraped.oldPrice || scraped.oldPrice === '0,00' || scraped.oldPrice.trim() === '' || numericOldPrice <= numericPrice) {
                scraped.oldPrice = formatCurrencyTextServer(numericPrice * 1.25);
            }
        }

        let affiliateUrl = finalUrl;
        try {
            affiliateUrl = await convertToAffiliateServer(finalUrl, platform, settings);
        } catch(e) {
            writeUserLog(email, `Erro ao converter link para afiliado, enviando link limpo.`, "warning");
        }

        let discount = '0';
        if (hasValidPrice && scraped.oldPrice) {
            const oldVal = parsePriceToFloatServer(scraped.oldPrice);
            const newVal = parsePriceToFloatServer(scraped.price);
            if (oldVal > newVal && oldVal > 0) {
                discount = Math.round((1 - newVal / oldVal) * 100).toString();
            }
        }

        let templateText = user.template || "🔥 <b>{title}</b>\n\n💵 De: <s>R$ {oldPrice}</s>\n🤑 Por apenas: <b>R$ {price}</b> ({discount}% OFF)\n\n👉 Compre aqui: {link}";
        
        if (!hasValidPrice) {
            templateText = templateText
                .replace(/💵 De: <s>R\$ {oldPrice}<\/s>\n?/g, '')
                .replace(/🤑 Por apenas: <b>R\$ {price}<\/b>\n?/g, '')
                .replace(/💵 De: <s>R\$ {oldPrice}<\/s>\r?\n?/g, '')
                .replace(/🤑 Por apenas: <b>R\$ {price}<\/b>\r?\n?/g, '');
        } else {
            templateText = templateText.replace(/{oldPrice}/g, scraped.oldPrice);
            templateText = templateText.replace(/{price}/g, scraped.price);
            templateText = templateText.replace(/{discount}/g, discount);
        }

        const coupon = extractCouponFromDocServer(cheerio.load(scraped.title ? `<div class="coupon-code">${scraped.title}</div>` : '<div/>')) || '';
        const titleCoupon = deal.title.match(/CUPOM\s*:\s*([A-Z0-9_-]{3,15})/i);
        const finalCoupon = coupon || (titleCoupon ? titleCoupon[1].toUpperCase() : '');
        
        if (finalCoupon) {
            templateText = templateText.replace(/{coupon}/g, finalCoupon);
        } else {
            templateText = templateText
                .replace(/🎫 Cupom: <b>{coupon}<\/b>\r?\n?/g, '')
                .replace(/🎫 Cupom: {coupon}\r?\n?/g, '')
                .replace(/{coupon}/g, '');
        }

        templateText = templateText.replace(/{title}/g, scraped.title);
        templateText = templateText.replace(/{link}/g, affiliateUrl);

        let tgHtml = templateText
            .replace(/\*([^*]+)\*/g, '<b>$1</b>')
            .replace(/_([^_]+)_/g, '<i>$1</i>')
            .replace(/~([^~]+)~/g, '<s>$1</s>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');

        try {
            let sendOk = false;
            const replyMarkup = {
                inline_keyboard: [[{ text: '🛒 COMPRAR AGORA', url: affiliateUrl }]]
            };

            if (scraped.image) {
                const photoUrl = `https://api.telegram.org/bot${token}/sendPhoto`;
                const payload = {
                    chat_id: chatId,
                    photo: scraped.image,
                    caption: tgHtml,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup
                };
                
                try {
                    const sendRes = await axios.post(photoUrl, payload, { timeout: 8000 });
                    if (sendRes.data.ok) sendOk = true;
                } catch (phErr) {
                    const msgUrl = `https://api.telegram.org/bot${token}/sendMessage`;
                    const payloadMsg = {
                        chat_id: chatId,
                        text: tgHtml,
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup
                    };
                    const sendRes = await axios.post(msgUrl, payloadMsg, { timeout: 8000 });
                    if (sendRes.data.ok) sendOk = true;
                }
            } else {
                const msgUrl = `https://api.telegram.org/bot${token}/sendMessage`;
                const payloadMsg = {
                    chat_id: chatId,
                    text: tgHtml,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup
                };
                const sendRes = await axios.post(msgUrl, payloadMsg, { timeout: 8000 });
                if (sendRes.data.ok) sendOk = true;
            }

            if (sendOk) {
                writeUserLog(email, `✅ Oferta postada com sucesso: "${scraped.title.substring(0, 25)}..."`, "success");
                postedCount++;
            } else {
                writeUserLog(email, `❌ Falha ao postar oferta no Telegram.`, "error");
            }
        } catch (tgErr) {
            writeUserLog(email, `❌ Erro ao enviar para o Telegram: ${tgErr.message}`, "error");
        }

        user.alreadyPostedDeals.push(deal.id);
        if (user.alreadyPostedDeals.length > 500) {
            user.alreadyPostedDeals.shift();
        }
        
        if (i < limit - 1) {
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    const config = getAppConfig();
    if (config) {
        if (config.users && config.users[email]) {
            config.users[email].alreadyPostedDeals = user.alreadyPostedDeals;
        } else if (config.admin && config.admin.email === email) {
            config.admin.alreadyPostedDeals = user.alreadyPostedDeals;
        }
        saveAppConfig(config);
    }
}

async function runServerSideAutomation() {
    const config = getAppConfig();
    if (!config) return;

    const activeUsers = [];
    
    if (config.admin && config.admin.email && config.admin.automation && config.admin.automation.active) {
        activeUsers.push({ email: config.admin.email.toLowerCase().trim(), data: config.admin });
    }
    
    if (config.users) {
        Object.keys(config.users).forEach(email => {
            const user = config.users[email];
            if (user && user.automation && user.automation.active) {
                activeUsers.push({ email: email.toLowerCase().trim(), data: user });
            }
        });
    }

    if (activeUsers.length === 0) return;

    const now = Date.now();
    for (const activeUser of activeUsers) {
        const email = activeUser.email;
        const user = activeUser.data;
        const intervalMin = parseInt(user.automation.interval) || 10;
        const lastScan = lastScanTime.get(email) || 0;
        
        if (now - lastScan >= intervalMin * 60 * 1000) {
            lastScanTime.set(email, now);
            runUserScan(email, user).catch(err => {
                writeUserLog(email, `Erro interno na varredura: ${err.message}`, "error");
            });
        }
    }
}

// Inicia loop automático no servidor a cada 30 segundos para verificação rápida de intervalos
setInterval(runServerSideAutomation, 30 * 1000);

app.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`   Servidor OfertasBot Ativo na Porta ${PORT}`);
    console.log(`   Local: http://localhost:${PORT}/`);
    console.log(`=============================================`);
});
