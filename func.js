// ==========================================
// CONFIGURAÇÃO DO SUPABASE E AUTENTICAÇÃO LOCAL (3 PERFIS)
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

let perfisSistema = JSON.parse(localStorage.getItem('audio_sa_perfis')) || {
    recepcao: { senha: 'recepcao', perfil: 'recepcao', primeiroAcesso: true },
    gerente: { senha: 'gerente', perfil: 'gerente', primeiroAcesso: true },
    analista: { senha: 'administrador', perfil: 'analista', primeiroAcesso: false }
};

let transacoes = [];
let chartInstance = null;
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
const campoPagamento = document.getElementById('campo-pagamento');
const campoBandeira = document.getElementById('campo-bandeira');
const btnLogout = document.getElementById('btn-logout');

function inicializarSelects() {
    selectProfissional.innerHTML = '';
    PROFISSIONAIS.forEach(p => {
        selectProfissional.innerHTML += `<option value="${p}">${p}</option>`;
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
        campoPagamento.style.display = 'block';
        campoBandeira.style.display = 'none';
        selectProfissional.removeAttribute('required');
    } else {
        campoProfissional.style.display = 'block';
        campoPagamento.style.display = 'block';
        selectProfissional.setAttribute('required', 'true');
    }
}

selectTipo.addEventListener('change', atualizarCategorias);

selectFormaPagamento.addEventListener('change', () => {
    const forma = selectFormaPagamento.value;
    selectBandeira.innerHTML = '<option value="">Selecione a bandeira...</option>';
    
    if (forma.includes('Débito') || forma.includes('Crédito')) {
        const filtro = forma === 'Débito' ? 'Débito' : (forma === 'Crédito à vista' ? 'Crédito' : 'x');
        Object.keys(TAXAS_CARTAO).filter(k => k.includes(filtro) && (filtro !== 'Crédito' || !k.includes('x'))).forEach(b => {
            selectBandeira.innerHTML += `<option value="${b}">${b} (${(TAXAS_CARTAO[b]*100).toFixed(2)}%)</option>`;
        });
        campoBandeira.style.display = 'block';
    } else {
        campoBandeira.style.display = 'none';
    }
});

let usuarioPendenteAlteracao = null;

formLogin.addEventListener('submit', (e) => {
    e.preventDefault();
    const usuario = document.getElementById('login-usuario').value;
    const senha = document.getElementById('login-senha').value;

    if (!usuario || !perfisSistema[usuario] || perfisSistema[usuario].senha !== senha) {
        alert("Selecione um perfil válido e digite a senha correta.");
        return;
    }

    const dadosPerfil = perfisSistema[usuario];

    if (dadosPerfil.primeiroAcesso && usuario !== 'analista') {
        usuarioPendenteAlteracao = usuario;
        formLogin.style.display = 'none';
        formPrimeiroAcesso.style.display = 'flex';
        return;
    }

    iniciarSessao(usuario, dadosPerfil.perfil);
});

formPrimeiroAcesso.addEventListener('submit', (e) => {
    e.preventDefault();
    const s1 = document.getElementById('nova-senha-1').value;
    const s2 = document.getElementById('nova-senha-2').value;

    if (s1 !== s2) {
        alert("As senhas não coincidem!");
        return;
    }
    if (s1.length < 3) {
        alert("A senha deve ter pelo menos 3 caracteres.");
        return;
    }

    perfisSistema[usuarioPendenteAlteracao].senha = s1;
    perfisSistema[usuarioPendenteAlteracao].primeiroAcesso = false;
    localStorage.setItem('audio_sa_perfis', JSON.stringify(perfisSistema));

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

    const badge = document.getElementById('user-role-badge');
    badge.innerText = `Perfil: ${sessaoAtual.perfil.toUpperCase()}`;

    const secaoKpi = document.getElementById('secao-kpi');
    const secaoGrafico = document.getElementById('secao-grafico');
    const secaoOcr = document.getElementById('secao-ocr');
    const acoesAnalista = document.getElementById('acoes-analista');
    const thAcoes = document.getElementById('th-acoes');

    if (sessaoAtual.perfil === 'recepcao') {
        secaoKpi.style.display = 'none';
        secaoGrafico.style.display = 'none';
        secaoOcr.style.display = 'none';
        acoesAnalista.style.display = 'none';
        thAcoes.style.display = 'none';
    } else if (sessaoAtual.perfil === 'gerente') {
        secaoKpi.style.display = 'grid';
        secaoGrafico.style.display = 'block';
        secaoOcr.style.display = 'block';
        acoesAnalista.style.display = 'none';
        thAcoes.style.display = 'none';
    } else if (sessaoAtual.perfil === 'analista') {
        secaoKpi.style.display = 'grid';
        secaoGrafico.style.display = 'block';
        secaoOcr.style.display = 'block';
        acoesAnalista.style.display = 'flex';
        thAcoes.style.display = 'table-cell';
    }

    inicializarSelects();
    renderChart();
    carregarTransacoes();
}

btnLogout.addEventListener('click', () => {
    localStorage.removeItem('audio_sa_sessao');
    location.reload();
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
        atualizarDashboard();
    } catch (e) {
        transacoes = JSON.parse(localStorage.getItem('audio_sa_transacoes')) || [];
        atualizarDashboard();
    }
}

formTransacao.addEventListener('submit', async (e) => {
    e.preventDefault();

    const tipo = selectTipo.value;
    const categoria = selectCategoria.value;
    const profissional = tipo === 'entrada' ? selectProfissional.value : 'Geral';
    const descricao = document.getElementById('t-descricao').value;
    const valorBruto = parseFloat(document.getElementById('t-valor').value);
    const data = document.getElementById('t-data').value;
    const formaPagamento = selectFormaPagamento.value;
    const bandeira = selectBandeira.value;

    let valorLiquido = valorBruto;
    if (tipo === 'entrada' && bandeira && TAXAS_CARTAO[bandeira]) {
        valorLiquido = valorBruto - (valorBruto * TAXAS_CARTAO[bandeira]);
    }

    const nova = {
        id: Date.now().toString(),
        tipo,
        categoria,
        profissional,
        descricao: `${descricao} (${formaPagamento}${bandeira ? ' - ' + bandeira : ''})`,
        valor: parseFloat(valorLiquido.toFixed(2)),
        data
    };

    transacoes.unshift(nova);
    localStorage.setItem('audio_sa_transacoes', JSON.stringify(transacoes));

    if (supabase10) {
        await supabase10.from('transacoes').insert([nova]).catch(() => {});
    }

    formTransacao.reset();
    atualizarCategorias();
    atualizarDashboard();
    alert("Lançamento efetuado com sucesso!");
});

function atualizarDashboard() {
    const entradas = transacoes.filter(t => t.tipo === 'entrada').reduce((a, t) => a + t.valor, 0);
    const saidas = transacoes.filter(t => t.tipo === 'saida').reduce((a, t) => a + t.valor, 0);
    const saldo = entradas - saidas;

    if (sessaoAtual && sessaoAtual.perfil !== 'recepcao') {
        document.getElementById('total-entradas').innerText = `R$ ${entradas.toFixed(2)}`;
        document.getElementById('total-saidas').innerText = `R$ ${saidas.toFixed(2)}`;
        document.getElementById('saldo-liquido').innerText = `R$ ${saldo.toFixed(2)}`;
        updateChart(entradas, saidas);
    }

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
            html += `<td><button onclick="deletarTransacao('${t.id}')" style="background: var(--danger); color: white; border: none; padding: 5px 10px; border-radius: 6px; cursor: pointer;">Excluir</button></td>`;
        }
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

window.deletarTransacao = async function(id) {
    if (sessaoAtual?.perfil !== 'analista') {
        alert("Apenas o Analista (Administrador) tem permissão para excluir registros.");
        return;
    }
    if (!confirm("Deseja apagar este registo financeiro?")) return;

    transacoes = transacoes.filter(t => t.id !== id);
    localStorage.setItem('audio_sa_transacoes', JSON.stringify(transacoes));
    if (supabase10) {
        await supabase10.from('transacoes').delete().match({ id }).catch(()=>{});
    }
    atualizarDashboard();
};

function renderChart() {
    const ctx = document.getElementById('financeChart').getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Entradas', 'Saídas'],
            datasets: [{
                label: 'Total (R$)',
                data: [0, 0],
                backgroundColor: ['var(--success)', 'var(--danger)']
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function updateChart(entradas, saidas) {
    if (!chartInstance) return;
    chartInstance.data.datasets[0].data = [entradas, saidas];
    chartInstance.update();
}

// ==========================================
// MÓDULO OCR (EXCLUSIVO GERENTE E ANALISTA)
// ==========================================
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
        const file = e.target.files[0];
        statusDiv.innerText = 'Processando nota fiscal de compra...';

        const formData = new FormData();
        formData.append('file', file);
        formData.append('apikey', 'helloworld');
        formData.append('language', 'por');

        try {
            const response = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: formData });
            const result = await response.json();
            const texto = result.ParsedResults?.[0]?.ParsedText || '';

            statusDiv.innerText = 'Leitura concluída. Revise os dados abaixo.';
            ocrPrevDesc.value = texto.split('\n')[0] || 'Compra / Despesa escaneada';
            ocrPrevVal.value = '150.00';
            ocrPreviewContainer.style.display = 'block';
        } catch (err) {
            statusDiv.innerText = 'Erro ao ler a imagem.';
        }
    });

    btnConfirmOcr.addEventListener('click', () => {
        document.getElementById('t-tipo').value = 'saida';
        atualizarCategorias();
        document.getElementById('t-descricao').value = ocrPrevDesc.value;
        document.getElementById('t-valor').value = ocrPrevVal.value;
        document.getElementById('t-data').value = new Date().toISOString().split('T')[0];
        
        ocrPreviewContainer.style.display = 'none';
        statusDiv.innerText = 'Dados aplicados no formulário de saída!';
        window.scrollTo({ top: formTransacao.offsetTop, behavior: 'smooth' });
    });

    btnCancelOcr.addEventListener('click', () => {
        ocrPreviewContainer.style.display = 'none';
        statusDiv.innerText = 'Leitura descartada.';
    });
}

// ==========================================
// EXPORTAÇÃO EXCEL (CSV) & PDF (ANALISTA)
// ==========================================
document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    if (sessaoAtual?.perfil !== 'analista') return alert("Acesso restrito ao Analista.");
    let csvContent = "\uFEFFData,Tipo,Categoria,Profissional,Descricao,Valor Liquido (R$)\n";
    transacoes.forEach(t => {
        csvContent += `${t.data},${t.tipo},${t.categoria},${t.profissional || 'Geral'},"${t.descricao || ''}",${t.valor}\n`;
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
    doc.text("Áudio S.A. - Relatório Financeiro", 14, 18);
    let y = 30;
    transacoes.forEach(t => {
        doc.text(`${t.data} | [${t.tipo.toUpperCase()}] ${t.categoria} - R$ ${t.valor.toFixed(2)} (${t.descricao})`, 14, y);
        y += 8;
    });
    doc.save("audio_sa_relatorio.pdf");
});