const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// ROTA: Página principal (Se não bater com nenhum arquivo estático, envia index.html)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`   Servidor OfertasBot Ativo na Porta ${PORT}`);
    console.log(`   Local: http://localhost:${PORT}/`);
    console.log(`=============================================`);
});
