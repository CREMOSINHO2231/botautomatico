const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8200;

// Configurar a senha de acesso ao painel (Altere se desejar)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '22780505@@Liz';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Caminho do banco de dados (no Railway usa o volume montado em /app/data se existir)
const keysDir = fs.existsSync('/app/data') ? '/app/data' : __dirname;
const keysFile = path.join(keysDir, 'keys.json');

// Helper: Normalizar a chave para objeto { expiresAt, email } (compatibilidade com banco antigo)
function normalizeKey(value) {
    if (!value) return { expiresAt: new Date().toISOString(), email: null };
    if (typeof value === 'string') {
        return { expiresAt: value, email: null };
    }
    return {
        expiresAt: value.expiresAt,
        email: value.email || null
    };
}

// Helper: Carregar chaves do banco de dados
function loadKeys() {
    let localKeys = {};
    let backupKeys = {};
    
    if (fs.existsSync(keysFile)) {
        try {
            const data = fs.readFileSync(keysFile, 'utf8');
            localKeys = JSON.parse(data);
        } catch (e) {
            console.error("Erro ao ler keys.json local...", e);
        }
    }
    
    const backupDir = path.join(keysDir, '..', '..', 'bot-ofertas-backup');
    const backupFile = path.join(backupDir, 'keys.json');
    
    if (fs.existsSync(backupFile)) {
        try {
            const data = fs.readFileSync(backupFile, 'utf8');
            backupKeys = JSON.parse(data);
        } catch (e) {
            console.error("Erro ao ler keys.json do backup...", e);
        }
    }
    
    // Mesclar chaves do backup e locais
    const mergedKeys = Object.assign({}, backupKeys, localKeys);
    
    // Se o backup contiver mais chaves, salvamos para o arquivo local também
    if (JSON.stringify(mergedKeys) !== JSON.stringify(localKeys)) {
        saveKeys(mergedKeys);
    }
    
    return mergedKeys;
}

// Helper: Salvar chaves no banco de dados
function saveKeys(keys) {
    try {
        fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2), 'utf8');
        
        // Salvar cópia no backup
        const backupDir = path.join(keysDir, '..', '..', 'bot-ofertas-backup');
        const backupFile = path.join(backupDir, 'keys.json');
        
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        fs.writeFileSync(backupFile, JSON.stringify(keys, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Erro ao salvar keys.json:", e);
        return false;
    }
}

// Helper: Gerar chave de acesso aleatória
function generateLicenseKey() {
    const parts = [];
    for (let i = 0; i < 3; i++) {
        // Gerar bloco de 5 caracteres aleatórios (letras maiúsculas e números)
        const block = crypto.randomBytes(3)
            .toString('hex')
            .toUpperCase()
            .substring(0, 5);
        parts.push(block);
    }
    return `OFT-${parts.join('-')}`;
}

// Estado simples de sessões em memória para o administrador
const sessions = new Map();

// Helper: Middleware de autenticação simples do admin
function requireAdminAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    
    if (token && sessions.has(token)) {
        const expiry = sessions.get(token);
        if (expiry > Date.now()) {
            sessions.set(token, Date.now() + 2 * 60 * 60 * 1000); // estende sessão por mais 2h
            return next();
        } else {
            sessions.delete(token);
        }
    }
    res.status(401).json({ error: "Sessão expirada ou não autorizado. Faça login novamente." });
}

// ==========================================
// APIS PÚBLICAS (Acessadas pelos Bots)
// ==========================================

// ROTA: Validar Licença do Cliente
app.get('/api/validate', (req, res) => {
    const key = req.query.key;
    const email = req.query.email;
    
    if (!key) {
        return res.status(400).json({ error: "Parâmetro 'key' ausente." });
    }
    
    const keys = loadKeys();
    if (key in keys) {
        const norm = normalizeKey(keys[key]);
        const expiryDate = new Date(norm.expiresAt);
        const now = new Date();
        
        if (isNaN(expiryDate.getTime())) {
            return res.status(400).json({ error: "Formato de data de expiração inválido." });
        }
        
        if (expiryDate <= now) {
            return res.json({
                valid: false,
                error: `A assinatura expirou em ${norm.expiresAt.split('T')[0]}.`
            });
        }
        
        // Bloqueio de Compartilhamento: Se a chave já estiver vinculada a outro e-mail
        if (norm.email && email && norm.email.toLowerCase() !== email.toLowerCase()) {
            return res.json({
                valid: false,
                error: "Esta chave de licença já está em uso por outro usuário."
            });
        }
        
        // Vincular a chave no primeiro cadastro se o e-mail for fornecido
        if (!norm.email && email) {
            norm.email = email.toLowerCase();
            keys[key] = norm;
            saveKeys(keys);
            console.log(`[Licenças] Chave ${key} vinculada ao e-mail ${email}`);
        }
        
        res.json({
            valid: true,
            expiresAt: norm.expiresAt,
            daysLeft: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))
        });
    } else {
        res.json({
            valid: false,
            error: "Chave de licença inválida ou não registrada."
        });
    }
});

// ==========================================
// APIS ADMINISTRATIVAS (Gerenciamento)
// ==========================================

// ROTA: Login do Admin
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(16).toString('hex');
        sessions.set(token, Date.now() + 2 * 60 * 60 * 1000); // 2 horas de validade
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: "Senha incorreta." });
    }
});

// ROTA: Listar todas as chaves
app.get('/api/admin/keys', requireAdminAuth, (req, res) => {
    const keys = loadKeys();
    const list = Object.keys(keys).map(key => {
        const norm = normalizeKey(keys[key]);
        const expiryDate = new Date(norm.expiresAt);
        const now = new Date();
        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        return {
            key,
            expiresAt: norm.expiresAt,
            email: norm.email,
            daysLeft: daysLeft > 0 ? daysLeft : 0,
            expired: expiryDate <= now
        };
    });
    res.json(list);
});

// ROTA: Criar nova chave de licença
app.post('/api/admin/keys', requireAdminAuth, (req, res) => {
    const { days } = req.body;
    const daysNum = parseInt(days) || 30;
    
    const key = generateLicenseKey();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysNum);
    
    const keys = loadKeys();
    keys[key] = {
        expiresAt: expiryDate.toISOString(),
        email: null
    };
    
    if (saveKeys(keys)) {
        res.json({ success: true, key, expiresAt: keys[key].expiresAt });
    } else {
        res.status(500).json({ error: "Falha ao salvar no banco de dados." });
    }
});

// ROTA: Adicionar dias a uma chave existente (Renovação)
app.post('/api/admin/keys/extend', requireAdminAuth, (req, res) => {
    const { key, days } = req.body;
    const daysNum = parseInt(days);
    
    if (!key || isNaN(daysNum)) {
        return res.status(400).json({ error: "Chave e número de dias são obrigatórios." });
    }
    
    const keys = loadKeys();
    if (!(key in keys)) {
        return res.status(404).json({ error: "Chave de licença não encontrada." });
    }
    
    const norm = normalizeKey(keys[key]);
    const currentExpiry = new Date(norm.expiresAt);
    const now = new Date();
    
    // Se já expirou, a contagem de dias novos começa de hoje. Caso contrário, adiciona na data futura.
    const baseDate = currentExpiry > now ? currentExpiry : now;
    baseDate.setDate(baseDate.getDate() + daysNum);
    
    keys[key] = {
        expiresAt: baseDate.toISOString(),
        email: norm.email // preserva o e-mail vinculado se houver
    };
    
    if (saveKeys(keys)) {
        res.json({ success: true, key, expiresAt: keys[key].expiresAt });
    } else {
        res.status(500).json({ error: "Falha ao salvar no banco de dados." });
    }
});

// ROTA: Deletar/Bloquear chave
app.delete('/api/admin/keys/:key', requireAdminAuth, (req, res) => {
    const key = req.params.key;
    const keys = loadKeys();
    
    if (!(key in keys)) {
        return res.status(404).json({ error: "Chave não encontrada." });
    }
    
    delete keys[key];
    
    if (saveKeys(keys)) {
        res.json({ success: true });
    } else {
        res.status(500).json({ error: "Falha ao deletar do banco de dados." });
    }
});

// ROTA: Página index.html do painel admin
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`   Painel Admin de Licenças Ativo`);
    console.log(`   Acesse: http://localhost:${PORT}/admin`);
    console.log(`=============================================`);
});
