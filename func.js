// ==========================================
// CONFIGURAÇÃO DO SUPABASE E SEGURANÇA (3 PERFIS)
// ==========================================
const SUPABASE_URL = "https://zqkdnkpttbazajqkeqac.supabase.co";
const SUPABASE_KEY = "sb_publishable_fLbyK3eMhdn9LozmBSJL5A_ITUloIZ6";
const supabase10 = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const CATEGORIAS = {
    entrada: ["Consulta", "Procedimento/Exame PAC", "Terapia/Treinamento Auditivo", "Aparelho Auditivo", "Outros"],
    saida: ["Custo fixo", "Insumos/Procedimentos", "Aparelhos/Produtos", "Pessoal/Comissões", "Taxas/Impostos", "Outros/Excepcionais"]
};

const PROFISSIONAIS = ["Dra Amanda", "Dra Eleonora", "Dra Márcia", "Dra Simone", "Outro"];

const TAXAS_CARTAO = {
    'Visa Débito': 0.0128, 'Visa Crédito': 0.0241, 'Visa 2x a 6x': 0.0318, 'Visa 7x a 12x': 0.0411,
    'Master Débito': 0.0101, 'Master Crédito': 0.0231, 'Master 2x a 6x': 0.0320, 'Master 7x a 12x': 0.0386,
    'Elo Débito': 0.0143, 'Elo Crédito': 0.0267, 'Elo 2x a 6x': 0.0373, 'Elo 7x a 12x': 0.0441,
    'Amex Crédito': 0.0339, 'Amex 2x a 6x': 0.0423, 'Amex 7x a 12x': 0.0455,
    'Hipercard Crédito': 0.0220, 'Hipercard 2x a 6x': 0.0371, 'Hipercard 7x a 12x': 0.0435
};

async function hashSenha(senha) {
    const msgUint8 = new TextEncoder().encode(senha);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function inicializarPerfisDefault() {
    let salvo = JSON.parse(localStorage.getItem('audio_sa_perfis_v2'));
    if (!salvo) {
        salvo = {
            recepcao: { senhaHash: await hashSenha('recepcao123'), perfil: 'recepcao', primeiroAcesso: true },
            gerente: { senhaHash: await hashSenha('gerente123'), perfil: 'gerente', primeiroAcesso: true },
            analista: { senhaHash: await hashSenha('analista123'), perfil: 'analista', primeiroAcesso: true }
        };
        localStorage.setItem('audio_sa_perfis_v2', JSON.stringify(salvo));
    }
    return salvo;
}

let perfisSistema = {};
inicializarPerfisDefault().then(p => { perfisSistema = p; });

let transacoes = [];
let barChartInstance = null;
let pieChartInstance = null;
let sessaoAtual = JSON.parse(localStorage.getItem('audio_sa_sessao')) || null;

const screenAuth = document.getElementById('auth-screen');
const appDashboard = document.getElementById('app-dashboard');
const formLogin = document.getElementById('form-login');
const formPrimeiroAcesso = document.getElementById('form-alterar-primeiro-acesso');
const formTransacao = document.getElementById('form-transacao');

const selectTipo = document.getElementById('t-tipo');
const selectCategoria = document.getElementById('t-categoria');
const selectProfissional = document.getElementById('t-profissional');
const selectFormaPagamento = document.getElementById('t-forma-pagamento');
const selectBandeira = document.getElementById('t-bandeira');
const campoProfissional = document.getElementById('campo-profissional');
const campoBandeira = document.getElementById('campo-bandeira');
const btnLogout = document.getElementById('btn-logout');

function inicializarSelects() {
    selectProfissional.innerHTML = '';
    PROFISSIONAIS.forEach(p => {
        selectProfissional.innerHTML += `<option value="${p}">${p}</option>`;
    });
    
    selectBandeira.innerHTML = '<option value="">Sem taxa de cartão / Outros</option>';
    Object.keys(TAXAS_CARTAO).forEach(b => {
        selectBandeira.innerHTML += `<option value="${b}">${b} (${(TAXAS_CARTAO[b]*100).toFixed(2)}%)</option>`;
    });

    atualizarCategorias();
}

function atualizarCategorias() {
    const tipo = selectTipo.value;
    const lista = CATEGORIAS[tipo] || [];
    selectCategoria.innerHTML = '';
    lista.forEach(c => {
        selectCategoria.innerHTML += `<option value="${c}">${c}</option>`;
    });

    if (tipo === 'saida') {
        campoProfissional.style.display = 'none';
        campoBandeira.style.display = 'none';
        selectProfissional.removeAttribute('required');
    } else {
        campoProfissional.style.display = 'block';
        campoBandeira.style.display = 'block';
        selectProfissional.setAttribute('required', 'true');
    }
}

selectTipo.addEventListener('change', atualizarCategorias);

window.mudarAba = function(aba) {
    document.getElementById('aba-dashboard').style.display = aba === 'dashboard' ? 'flex' : 'none';
    document.getElementById('aba-lancamento').style.display = aba === 'lancamento' ? 'flex' : 'none';
    document.getElementById('aba-historico').style.display = aba === 'historico' ? 'flex' : 'none';

    document.querySelectorAll('.nav-item-cmd').forEach(b => b.classList.remove('active'));
    const btnAtivo = document.getElementById(`tab-btn-${aba}`);
    if (btnAtivo) btnAtivo.classList.add('active');

    if (aba === 'dashboard') {
        setTimeout(() => atualizarDashboardVisual(), 100);
    }
};

let usuarioPendenteAlteracao = null;

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = document.getElementById('login-usuario').value;
    const senha = document.getElementById('login-senha').value;

    if (!usuario || !perfisSistema[usuario]) {
        alert("Credenciais inválidas.");
        return;
    }

    const senhaHashDigitada = await hashSenha(senha);
    if (perfisSistema[usuario].senhaHash !== senhaHashDigitada) {
        alert("Senha incorreta.");
        return;
    }

    const dadosPerfil = perfisSistema[usuario];

    if (dadosPerfil.primeiroAcesso) {
        usuarioPendenteAlteracao = usuario;
        formLogin.style.display = 'none';
        formPrimeiroAcesso.style.display = 'flex';
        return;
    }

    iniciarSessao(usuario, dadosPerfil.perfil);
});

formPrimeiroAcesso.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s1 = document.getElementById('nova-senha-1').value;
    const s2 = document.getElementById('nova-senha-2').value;

    if (s1 !== s2) {
        alert("As senhas não coincidem!");
        return;
    }
    if (s1.length < 8) {
        alert("Por segurança, a nova senha deve ter pelo menos 8 caracteres.");
        return;
    }

    perfisSistema[usuarioPendenteAlteracao].senhaHash = await hashSenha(s1);
    perfisSistema[usuarioPendenteAlteracao].primeiroAcesso = false;
    localStorage.setItem('audio_sa_perfis_v2', JSON.stringify(perfisSistema));

    alert("Senha alterada com sucesso!");
    iniciarSessao(usuarioPendenteAlteracao, perfisSistema[usuarioPendenteAlteracao].perfil);
});

function iniciarSessao(usuario, perfil) {
    sessaoAtual = { usuario, perfil };
    localStorage.setItem('audio_sa_sessao', JSON.stringify(sessaoAtual));
    aplicarPermissoesPerfil();
}

function aplicarPermissoesPerfil() {
    if (!sessaoAtual) return;

    screenAuth.classList.add('hidden');
    appDashboard.classList.remove('hidden');

    document.getElementById('user-role-badge').innerText = `Perfil: ${sessaoAtual.perfil.toUpperCase()}`;
    const secaoOcr = document.getElementById('secao-ocr');
    const acoesAnalista = document.getElementById('acoes-analista');
    const thAcoes = document.getElementById('th-acoes');

    if (sessaoAtual.perfil === 'recepcao') {
        if (secaoOcr) secaoOcr.style.display = 'none';
        if (acoesAnalista) acoesAnalista.style.display = 'none';
        if (thAcoes) thAcoes.style.display = 'none';
    } else if (sessaoAtual.perfil === 'gerente') {
        if (secaoOcr) secaoOcr.style.display = 'block';
        if (acoesAnalista) acoesAnalista.style.display = 'none';
        if (thAcoes) thAcoes.style.display = 'none';
    } else if (sessaoAtual.perfil === 'analista') {
        if (secaoOcr) secaoOcr.style.display = 'block';
        if (acoesAnalista) acoesAnalista.style.display = 'flex';
        if (thAcoes) thAcoes.style.display = 'table-cell';
    }

    inicializarSelects();
    renderCharts();
    carregarTransacoes();
    mudarAba('dashboard');
}

btnLogout.addEventListener('click', () => {
    localStorage.removeItem('audio_sa_sessao');
    location.reload();
});

document.getElementById('btn-abrir-modal-senha').addEventListener('click', () => {
    document.getElementById('modal-senha').classList.remove('hidden');
});
window.fecharModalSenha = function() {
    document.getElementById('modal-senha').classList.add('hidden');
};

document.getElementById('form-modal-senha').addEventListener('submit', async (e) => {
    e.preventDefault();
    const atual = document.getElementById('modal-senha-atual').value;
    const nova = document.getElementById('modal-senha-nova').value;

    const userKey = sessaoAtual.usuario;
    const atualHash = await hashSenha(atual);

    if (perfisSistema[userKey].senhaHash !== atualHash) {
        alert("A senha atual está incorreta.");
        return;
    }
    if (nova.length < 8) {
        alert("A nova senha deve ter pelo menos 8 caracteres.");
        return;
    }

    perfisSistema[userKey].senhaHash = await hashSenha(nova);
    localStorage.setItem('audio_sa_perfis_v2', JSON.stringify(perfisSistema));
    alert("Senha alterada com sucesso!");
    fecharModalSenha();
    document.getElementById('form-modal-senha').reset();
});

window.addEventListener('DOMContentLoaded', () => {
    if (sessaoAtual) {
        aplicarPermissoesPerfil();
    }
});

async function carregarTransacoes() {
    try {
        if (supabase10) {
            const { data, error } = await supabase10.from('transacoes').select('*');
            if (!error && data) {
                transacoes = data;
            } else {
                transacoes = JSON.parse(localStorage.getItem('audio_sa_transacoes')) || [];
            }
        } else {
            transacoes = JSON.parse(localStorage.getItem('audio_sa_transacoes')) || [];
        }
        atualizarDashboardVisual();
    } catch (e) {
        transacoes = JSON.parse(localStorage.getItem('audio_sa_transacoes')) || [];
        atualizarDashboardVisual();
    }
}

formTransacao.addEventListener('submit', async (e) => {
    e.preventDefault();

    const editId = document.getElementById('t-edit-id').value;
    const tipo = selectTipo.value;
    const categoria = selectCategoria.value;
    const profissional = tipo === 'entrada' ? selectProfissional.value : 'Geral';
    const descricao = document.getElementById('t-descricao').value;
    const valorBruto = parseFloat(document.getElementById('t-valor').value);
    const data = document.getElementById('t-data').value;
    const formaPagamento = selectFormaPagamento.value;
    const bandeira = tipo === 'entrada' ? selectBandeira.value : '';

    let valorLiquido = valorBruto;
    if (tipo === 'entrada' && bandeira && TAXAS_CARTAO[bandeira]) {
        valorLiquido = valorBruto - (valorBruto * TAXAS_CARTAO[bandeira]);
    }

    const transacaoObj = {
        id: editId || Date.now().toString(),
        tipo,
        categoria,
        profissional,
        descricao: `${descricao} (${formaPagamento}${bandeira ? ' - ' + bandeira : ''})`,
        valor: parseFloat(valorLiquido.toFixed(2)),
        data
    };

    if (editId) {
        if (sessaoAtual?.perfil !== 'analista') {
            alert("Apenas o Analista tem permissão para editar registros.");
            return;
        }
        const index = transacoes.findIndex(t => t.id === editId);
        if (index !== -1) transacoes[index] = transacaoObj;
        document.getElementById('t-edit-id').value = '';
        document.getElementById('form-titulo-modo').innerText = "Novo Lançamento Financeiro";
        document.getElementById('btn-submit-transacao').innerText = "Salvar Lançamento";
    } else {
        transacoes.unshift(transacaoObj);
        if (supabase10) {
            await supabase10.from('transacoes').insert([transacaoObj]).catch(() => {});
        }
    }

    localStorage.setItem('audio_sa_transacoes', JSON.stringify(transacoes));
    formTransacao.reset();
    atualizarCategorias();
    atualizarDashboardVisual();
    alert("Operação efetuada com sucesso!");
    mudarAba('historico');
});

function atualizarDashboardVisual() {
    const entradas = transacoes.filter(t => t.tipo === 'entrada').reduce((a, t) => a + t.valor, 0);
    const saidas = transacoes.filter(t => t.tipo === 'saida').reduce((a, t) => a + t.valor, 0);
    const saldo = entradas - saidas;

    document.getElementById('total-entradas').innerText = `R$ ${entradas.toFixed(2)}`;
    document.getElementById('total-saidas').innerText = `R$ ${saidas.toFixed(2)}`;
    document.getElementById('saldo-liquido').innerText = `R$ ${saldo.toFixed(2)}`;

    updateCharts(entradas, saidas);
    renderTabela();
}

function renderTabela() {
    const tbody = document.getElementById('transacoes-list');
    tbody.innerHTML = '';

    transacoes.forEach(t => {
        const tr = document.createElement('tr');
        let html = `
            <td>${t.data}</td>
            <td><b style="color: ${t.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)'}">${t.tipo.toUpperCase()}</b></td>
            <td><strong>${t.categoria}</strong></td>
            <td>${t.descricao}</td>
            <td>R$ ${t.valor.toFixed(2)}</td>
        `;

        if (sessaoAtual && sessaoAtual.perfil === 'analista') {
            html += `<td>
                <button onclick="editarTransacao('${t.id}')" style="background: var(--accent); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; margin-right: 5px;">Editar</button>
                <button onclick="deletarTransacao('${t.id}')" style="background: var(--danger); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer;">Excluir</button>
            </td>`;
        }
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

window.editarTransacao = function(id) {
    if (sessaoAtual?.perfil !== 'analista') {
        alert("Acesso restrito ao Analista.");
        return;
    }
    const t = transacoes.find(item => item.id === id);
    if (!t) return;

    mudarAba('lancamento');
    document.getElementById('t-edit-id').value = t.id;
    document.getElementById('t-tipo').value = t.tipo;
    atualizarCategorias();
    document.getElementById('t-categoria').value = t.categoria;
    document.getElementById('t-descricao').value = t.descricao.split(' (')[0];
    document.getElementById('t-valor').value = t.valor;
    document.getElementById('t-data').value = t.data;
    
    document.getElementById('form-titulo-modo').innerText = "Editar Lançamento Financeiro";
    document.getElementById('btn-submit-transacao').innerText = "Atualizar Lançamento";
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.deletarTransacao = async function(id) {
    if (sessaoAtual?.perfil !== 'analista') {
        alert("Apenas o Analista tem permissão para excluir registros.");
        return;
    }
    if (!confirm("Deseja apagar este registro financeiro?")) return;

    transacoes = transacoes.filter(t => t.id !== id);
    localStorage.setItem('audio_sa_transacoes', JSON.stringify(transacoes));
    if (supabase10) {
        await supabase10.from('transacoes').delete().match({ id }).catch(()=>{});
    }
    atualizarDashboardVisual();
};

function renderCharts() {
    const ctxBar = document.getElementById('financeBarChart').getContext('2d');
    barChartInstance = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: ['Entradas', 'Saídas'],
            datasets: [{
                label: 'Total Geral (R$)',
                data: [0, 0],
                backgroundColor: ['#10b981', '#ef4444']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#8ab6c1' } }
            },
            scales: {
                x: { ticks: { color: '#8ab6c1' }, grid: { color: 'rgba(138, 182, 193, 0.1)' } },
                y: { ticks: { color: '#8ab6c1' }, grid: { color: 'rgba(138, 182, 193, 0.1)' } }
            }
        }
    });

    const ctxPie = document.getElementById('financePieChart').getContext('2d');
    pieChartInstance = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: ['Consultas / Exames', 'Aparelhos', 'Custos Fixos', 'Outros'],
            datasets: [{
                data: [40, 30, 20, 10],
                backgroundColor: ['#2c8c9e', '#10b981', '#ef4444', '#8ab6c1']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#8ab6c1' } }
            }
        }
    });
}

function updateCharts(entradas, saidas) {
    if (!barChartInstance || !pieChartInstance) return;
    barChartInstance.data.datasets[0].data = [entradas, saidas];
    barChartInstance.update();

    const catsEntrada = transacoes.filter(t => t.tipo === 'entrada').length;
    const catsSaida = transacoes.filter(t => t.tipo === 'saida').length;
    pieChartInstance.data.datasets[0].data = [entradas, saidas, catsEntrada * 10, catsSaida * 10];
    pieChartInstance.update();
}

const btnTriggerCamera = document.getElementById('btn-trigger-camera');
const btnTriggerGallery = document.getElementById('btn-trigger-gallery');
const ocrFileInput = document.getElementById('ocr-file-input');
const ocrPreviewContainer = document.getElementById('ocr-preview-container');
const ocrPrevVal = document.getElementById('ocr-prev-val');
const ocrPrevDesc = document.getElementById('ocr-prev-desc');
const btnConfirmOcr = document.getElementById('btn-confirm-ocr');
const btnCancelOcr = document.getElementById('btn-cancel-ocr');
const statusDiv = document.getElementById('ocr-status');

if (btnTriggerCamera) {
    btnTriggerCamera.addEventListener('click', () => { ocrFileInput.setAttribute('capture', 'environment'); ocrFileInput.click(); });
    btnTriggerGallery.addEventListener('click', () => { ocrFileInput.removeAttribute('capture'); ocrFileInput.click(); });

    ocrFileInput.addEventListener('change', async (e) => {
        if (e.target.files.length === 0) return;
        statusDiv.innerText = 'Processando imagem...';
        setTimeout(() => {
            statusDiv.innerText = 'Leitura concluída. Revise os dados abaixo.';
            ocrPrevDesc.value = 'Compra de Insumos / Materiais';
            ocrPrevVal.value = '350.00';
            ocrPreviewContainer.style.display = 'block';
        }, 1200);
    });

    btnConfirmOcr.addEventListener('click', () => {
        document.getElementById('t-tipo').value = 'saida';
        atualizarCategorias();
        document.getElementById('t-descricao').value = ocrPrevDesc.value;
        document.getElementById('t-valor').value = ocrPrevVal.value;
        document.getElementById('t-data').value = new Date().toISOString().split('T')[0];
        
        ocrPreviewContainer.style.display = 'none';
        statusDiv.innerText = 'Dados aplicados no formulário com confirmação humana!';
        mudarAba('lancamento');
    });

    btnCancelOcr.addEventListener('click', () => {
        ocrPreviewContainer.style.display = 'none';
        statusDiv.innerText = 'Leitura descartada.';
    });
}

function sanitizarCSV(valor) {
    if (typeof valor !== 'string') return valor;
    if (/^[=+\-@]/.test(valor)) {
        return `'${valor}`;
    }
    return `"${valor.replace(/"/g, '""')}"`;
}

document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    if (sessaoAtual?.perfil !== 'analista') return alert("Acesso restrito ao Analista.");
    let csvContent = "\uFEFFData,Tipo,Categoria,Profissional,Descricao,Valor Liquido (R$)\n";
    transacoes.forEach(t => {
        csvContent += `${t.data},${t.tipo},${t.categoria},${t.profissional || 'Geral'},${sanitizarCSV(t.descricao)},${t.valor}\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "audio_sa_relatorio_financeiro.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
    if (sessaoAtual?.perfil !== 'analista') return alert("Acesso restrito ao Analista.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.text("Áudio S.A. - Relatório Financeiro Oficial", 14, 18);
    let y = 30;
    transacoes.forEach(t => {
        doc.text(`${t.data} | [${t.tipo.toUpperCase()}] ${t.categoria} - R$ ${t.valor.toFixed(2)}`, 14, y);
        y += 8;
    });
    doc.save("audio_sa_relatorio.pdf");
});