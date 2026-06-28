// Estado Global
let adminToken = localStorage.getItem('admin_token') || null;

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    if (adminToken) {
        testAuthAndLoadData();
    } else {
        showLoginOverlay();
    }

    initEventListeners();
});

let listenersInitialized = false;

// Inicializar ouvintes de eventos
function initEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;
    // Formulário de Login
    document.getElementById('admin-login-form').addEventListener('submit', handleLogin);

    // Gerar Nova Chave
    document.getElementById('btn-generate-key').addEventListener('click', handleGenerateKey);

    // Botão de Logout
    document.getElementById('btn-logout').addEventListener('click', handleLogout);

    // Modal de Estender Licença
    document.getElementById('btn-cancel-extend').addEventListener('click', closeExtendModal);
    document.getElementById('btn-confirm-extend').addEventListener('click', handleConfirmExtend);
}

// Testar Autenticação e Carregar Dados do Dashboard
async function testAuthAndLoadData() {
    try {
        const res = await fetch('/api/admin/keys', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        if (res.ok) {
            const keys = await res.json();
            hideLoginOverlay();
            renderDashboard(keys);
        } else {
            // Se o token for inválido, limpa e mostra login
            handleLogout();
        }
    } catch (err) {
        console.error("Erro ao carregar dados:", err);
        showToast("Erro ao conectar com o servidor local.", "error");
    }
}

// Manipular o Login
async function handleLogin(e) {
    e.preventDefault();
    const password = document.getElementById('admin-password').value;
    
    const btn = document.getElementById('btn-login');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Verificando...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await res.json();

        if (res.ok && data.success && data.token) {
            adminToken = data.token;
            localStorage.setItem('admin_token', adminToken);
            document.getElementById('admin-password').value = '';
            showToast("Login realizado com sucesso!", "success");
            testAuthAndLoadData();
        } else {
            showToast(data.error || "Senha incorreta.", "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Erro ao tentar fazer login.", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

let isGeneratingKey = false;

// Gerar Nova Chave
async function handleGenerateKey() {
    if (isGeneratingKey) return;
    isGeneratingKey = true;

    const daysSelect = document.getElementById('new-key-days');
    const days = parseInt(daysSelect.value) || 30;

    const btn = document.getElementById('btn-generate-key');
    btn.disabled = true;

    try {
        const res = await fetch('/api/admin/keys', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({ days })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            showToast(`Chave criada com sucesso e copiada para a área de transferência!`, "success");
            copyToClipboard(data.key);
            testAuthAndLoadData(); // Recarrega
        } else {
            showToast(data.error || "Erro ao gerar chave.", "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Erro ao conectar ao servidor.", "error");
    } finally {
        btn.disabled = false;
        isGeneratingKey = false;
    }
}

// Confirmação para Estender Licença (Confirmar Dias)
async function handleConfirmExtend() {
    const key = document.getElementById('extend-key-input').value;
    const daysInput = document.getElementById('extend-days');
    const days = parseInt(daysInput.value);

    if (!key || isNaN(days) || days <= 0) {
        showToast("Insira um número de dias válido.", "warning");
        return;
    }

    try {
        const res = await fetch('/api/admin/keys/extend', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({ key, days })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            showToast(`Licença estendida com sucesso por +${days} dias!`, "success");
            closeExtendModal();
            testAuthAndLoadData();
        } else {
            showToast(data.error || "Erro ao estender licença.", "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Erro de rede ao estender chave.", "error");
    }
}

// Bloquear / Excluir Chave
async function handleDeleteKey(key) {
    if (!confirm(`Deseja realmente BLOQUEAR e EXCLUIR a chave ${key}? O bot que usa essa chave perderá o acesso na hora.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/admin/keys/${key}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        if (res.ok) {
            showToast(`Chave ${key} excluída com sucesso!`, "success");
            testAuthAndLoadData();
        } else {
            const data = await res.json();
            showToast(data.error || "Erro ao deletar chave.", "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Erro de rede ao deletar chave.", "error");
    }
}

// Renderizar Painel Admin
function renderDashboard(keys) {
    const tbody = document.getElementById('keys-tbody');
    tbody.innerHTML = '';

    // Contadores de estatísticas
    let activeCount = 0;
    let expiredCount = 0;

    if (keys.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem; color: var(--text-muted);">Nenhuma chave cadastrada ainda.</td></tr>`;
    } else {
        keys.forEach(item => {
            if (item.expired) {
                expiredCount++;
            } else {
                activeCount++;
            }

            const tr = document.createElement('tr');
            
            // Badge do status e dias
            let badgeClass = 'badge-active';
            let badgeText = `${item.daysLeft} dias restantes`;
            if (item.expired) {
                badgeClass = 'badge-expired';
                badgeText = 'Expirado';
            } else if (item.daysLeft <= 7) {
                badgeClass = 'badge-warning';
                badgeText = `${item.daysLeft} dias (Crítico)`;
            }

            const formattedDate = item.expiresAt.split('T')[0].split('-').reverse().join('/');

            tr.innerHTML = `
                <td style="padding: 1.1rem 1rem;">
                    <div class="key-code">
                        <span>${item.key}</span>
                        <button class="btn-copy-key" title="Copiar Chave" onclick="copyToClipboard('${item.key}', true)">
                            <i class="fa-regular fa-copy"></i>
                        </button>
                    </div>
                    ${item.email ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;"><i class="fa-regular fa-user" style="margin-right: 4px;"></i>${item.email}</div>` : `<div style="font-size: 0.75rem; color: #22c55e; margin-top: 4px;"><i class="fa-solid fa-circle-dot" style="margin-right: 4px;"></i>Disponível</div>`}
                </td>
                <td style="padding: 1.1rem 1rem; color: var(--text-muted); font-family: monospace;">${formattedDate}</td>
                <td style="padding: 1.1rem 1rem;">
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </td>
                <td style="padding: 1.1rem 1rem; text-align: right; display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="btn-table-action extend" title="Adicionar Dias" onclick="openExtendModal('${item.key}')">
                        <i class="fa-solid fa-calendar-plus"></i> Estender
                    </button>
                    <button class="btn-table-action delete" title="Bloquear / Deletar" onclick="handleDeleteKey('${item.key}')">
                        <i class="fa-solid fa-trash-can"></i> Bloquear
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // Atualizar Contadores visuais
    document.getElementById('stat-total').innerText = keys.length;
    document.getElementById('stat-active').innerText = activeCount;
    document.getElementById('stat-expired').innerText = expiredCount;
}

// Modal de renovação / dias adicionais
function openExtendModal(key) {
    document.getElementById('extend-key-input').value = key;
    document.getElementById('extend-modal-subtitle').innerText = `Chave selecionada: ${key}`;
    document.getElementById('extend-days').value = '30';
    document.getElementById('extend-modal').style.display = 'flex';
}

function closeExtendModal() {
    document.getElementById('extend-modal').style.display = 'none';
}

// Helpers do Overlay de Login
function showLoginOverlay() {
    document.getElementById('auth-overlay').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
}

function hideLoginOverlay() {
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
}

// Logout
function handleLogout() {
    adminToken = null;
    localStorage.removeItem('admin_token');
    showLoginOverlay();
}

// Copiar para clipboard
function copyToClipboard(text, notify = false) {
    navigator.clipboard.writeText(text).then(() => {
        if (notify) {
            showToast("Chave copiada para a área de transferência!", "success");
        }
    }).catch(err => {
        console.error("Erro ao copiar:", err);
    });
}

// Helper: Mostrar Toasts
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '<i class="fa-solid fa-info-circle"></i>';
    if (type === 'success') icon = '<i class="fa-solid fa-check-circle"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
    if (type === 'warning') icon = '<i class="fa-solid fa-circle-exclamation"></i>';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    // Auto remover após 3.5 segundos
    setTimeout(() => {
        toast.style.animation = 'toastIn 0.3s ease reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
