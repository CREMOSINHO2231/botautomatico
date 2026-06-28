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

// Helper: Carregar chaves do banco de dados
function loadKeys() {
    if (fs.existsSync(keysFile)) {
        try {
            const data = fs.readFileSync(keysFile, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error("Erro ao ler keys.json, resetando banco...", e);
            return {};
        }
    }
    return {};
}

// Helper: Salvar chaves no banco de dados
function saveKeys(keys) {
    try {
        fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Erro ao salvar keys.json:", e);
        return false;
    }
}

// Helper: Gerar chave aleatória no formato OFT-XXXXX-XXXXX-XXXXX
function generateLicenseKey() {
    const part = () => crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
    return `OFT-${part()}-${part()}-${part()}`;
}

// Estado simples de sessões em memória para o administrador
const activeSessions = new Set();

// Middleware: Autenticação do Administrador
function requireAdminAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    
    if (token && activeSessions.has(token)) {
        next();
    } else {
        res.status(401).json({ error: "Sessão inválida ou expirada. Faça login novamente." });
    }
}

// ==========================================
// APIS PÚBLICAS (Acessadas pelos Bots)
// ==========================================

// ROTA: Validar Licença do Cliente
app.get('/api/validate', (req, res) => {
    const key = req.query.key;
    if (!key) {
        return res.status(400).json({ error: "Parâmetro 'key' ausente." });
    }
    
    const keys = loadKeys();
    if (key in keys) {
        const expiryDateStr = keys[key];
        const expiryDate = new Date(expiryDateStr);
        const now = new Date();
        
        if (isNaN(expiryDate.getTime())) {
            return res.status(400).json({ error: "Formato de data de expiração inválido." });
        }
        
        if (expiryDate > now) {
            res.json({
                valid: true,
                expiresAt: expiryDateStr,
                daysLeft: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))
            });
        } else {
            res.json({
                valid: false,
                error: `A assinatura expirou em ${expiryDateStr.split('T')[0]}.`
            });
        }
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
        const token = crypto.randomBytes(24).toString('hex');
        activeSessions.add(token);
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: "Senha incorreta." });
    }
});

// ROTA: Listar todas as chaves
app.get('/api/admin/keys', requireAdminAuth, (req, res) => {
    const keys = loadKeys();
    const list = Object.keys(keys).map(key => {
        const expiresAt = keys[key];
        const expiryDate = new Date(expiresAt);
        const now = new Date();
        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        return {
            key,
            expiresAt,
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
    keys[key] = expiryDate.toISOString();
    
    if (saveKeys(keys)) {
        res.json({ success: true, key, expiresAt: keys[key] });
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
    
    const currentExpiry = new Date(keys[key]);
    const now = new Date();
    
    // Se já expirou, a contagem de dias novos começa de hoje. Caso contrário, adiciona na data futura.
    const baseDate = currentExpiry > now ? currentExpiry : now;
    baseDate.setDate(baseDate.getDate() + daysNum);
    
    keys[key] = baseDate.toISOString();
    
    if (saveKeys(keys)) {
        res.json({ success: true, key, expiresAt: keys[key] });
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
