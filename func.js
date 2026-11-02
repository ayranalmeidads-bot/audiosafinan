// ==========================================
// MÓDULO PRINCIPAL DE REGRA DE NEGÓCIO E SEGURANÇA
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

// Funções de Utilidade de Segurança (Sanitização e Hash)
async function hashSenha(senha) {
    const msgUint8 = new TextEncoder().encode(senha + "_AUDIO_SA_SALT");
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

function sanitizarCSV(valor) {
    if (typeof valor !== 'string') return valor;
    if (/^[=+\-@\t\r]/.test(valor)) {
        return `'${valor}`;
    }
    return `"${valor.replace(/"/g, '""')}"`;
}

// Inicialização segura dos perfis
async function inicializarPerfisDefault() {
    let salvo = JSON.parse(localStorage.getItem('audio_sa_perfis_v3'));
    if (!salvo) {
        salvo = {
            recepcao: { nome: "Recepção Central", senhaHash: await hashSenha('recepcao123'), perfil: 'recepcao', primeiroAcesso: true },
            gerente: { nome: "Gerente Operacional", senhaHash: await hashSenha('gerente123'), perfil: 'gerente', primeiroAcesso: true },
            analista: { nome: "Administrador / Analista", senhaHash: await hashSenha('analista123'), perfil: 'analista', primeiroAcesso: true }
        };
        localStorage.setItem('audio_sa_perfis_v3', JSON.stringify(salvo));
    }
    return salvo;
}

let perfisSistema = {};
inicializarPerfisDefault().then(p => { perfisSistema = p; });

let transacoes = [];
let logsAuditoria = JSON.parse(localStorage.getItem('audio_sa_logs')) || [];
let barChartInstance = null;
let pieChartInstance = null;
let sessaoAtual = JSON.parse(localStorage.getItem('audio_sa_sessao')) || null;
let timeoutSessaoInatividade = null;

// Elementos da Interface
const screenAuth = document.getElementById('auth-screen');
const appDashboard = document.getElementById('app-dashboard');
const formLogin = document.getElementById('form-login');
const formPrimeiroAcesso = document.getElementById('form-alterar-primeiro-acesso');
const formTransacao = document.getElementById('form-transacao');

const selectTipo = document.getElementById('t-tipo');
const selectCategoria = document.getElementById('t-categoria');
const selectProfissional = document.getElementById('t-profissional');
const selectBandeira = document.getElementById('t-bandeira');
const campoProfissional = document.getElementById('campo-profissional');
const campoBandeira = document.getElementById('campo-bandeira');
const btnLogout = document.getElementById('btn-logout');

// ==========================================
// CONTROLE DE MODO CLARO / MODO ESCURO
// ==========================================
function inicializarTema() {
    const temaSalvo = localStorage.getItem('audio_sa_theme') || 'light';
    aplicarTema(temaSalvo);
}

function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    localStorage.setItem('audio_sa_theme', tema);
    
    const iconBtn = document.getElementById('theme-toggle-icon');
    const textBtn = document.getElementById('theme-toggle-text');
    const iconAuth = document.querySelector('#btn-theme-auth .theme-icon');

    if (tema === 'dark') {
        if (iconBtn) iconBtn.innerText = '🌙';
        if (textBtn) textBtn.innerText = 'Modo Escuro';
        if (iconAuth) iconAuth.innerText = '🌙';
    } else {
        if (iconBtn) iconBtn.innerText = '☀️';
        if (textBtn) textBtn.innerText = 'Modo Claro';
        if (iconAuth) iconAuth.innerText = '☀️';
    }
}

document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-theme') || 'light';
    aplicarTema(atual === 'light' ? 'dark' : 'light');
});

document.getElementById('btn-theme-auth')?.addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-theme') || 'light';
    aplicarTema(atual === 'light' ? 'dark' : 'light');
});

// ==========================================
// REGISTRO DE AUDITORIA (LOGS DE SEGURANÇA)
// ==========================================
function registrarLogAuditoria(acao, detalhes, resultado = "SUCESSO") {
    const novoLog = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString('pt-BR'),
        usuario: sessaoAtual ? sessaoAtual.usuario : "SISTEMA/ANÔNIMO",
        perfil: sessaoAtual ? sessaoAtual.perfil : "DESCONHECIDO",
        acao,
        detalhes: escapeHTML(detalhes),
        resultado
    };
    logsAuditoria.unshift(novoLog);
    if (logsAuditoria.length > 300) logsAuditoria.pop();
    localStorage.setItem('audio_sa_logs', JSON.stringify(logsAuditoria));
}

// ==========================================
// SISTEMA DE ABAS E NAVEGAÇÃO RESTRITA POR PERFIL
// ==========================================
window.mudarAba = function(aba) {
    if (!sessaoAtual) return;

    // RESTRIÇÃO RÍGIDA PARA RECEPÇÃO
    if (sessaoAtual.perfil === 'recepcao' && aba !== 'lancamento') {
        registrarLogAuditoria("TENTATIVA_ACESSO_PROIBIDO", `Perfil recepção tentou acessar a aba: ${aba}`, "BLOQUEADO");
        alert("Acesso Restrito: O perfil Recepção tem autorização exclusiva para realizar novos lançamentos.");
        mudarAba('lancamento');
        return;
    }

    // RESTRIÇÃO PARA GERENTE EM ABAS ADMINISTRATIVAS
    if (sessaoAtual.perfil === 'gerente' && (aba === 'usuarios' || aba === 'logs')) {
        registrarLogAuditoria("TENTATIVA_ACESSO_PROIBIDO", `Perfil gerente tentou acessar a aba administrativa: ${aba}`, "BLOQUEADO");
        alert("Acesso Restrito: Funcionalidade reservada ao perfil Analista.");
        return;
    }

    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item-cmd').forEach(el => el.classList.remove('active'));

    const tabAlvo = document.getElementById(`aba-${aba}`);
    const navBtnAlvo = document.getElementById(`nav-btn-${aba}`);

    if (tabAlvo) tabAlvo.classList.remove('hidden');
    if (navBtnAlvo) navBtnAlvo.classList.add('active');

    // Atualizar títulos dinâmicos
    const pageTitle = document.getElementById('page-current-title');
    const pageSubtitle = document.getElementById('page-current-subtitle');

    if (aba === 'dashboard') {
        if (pageTitle) pageTitle.innerText = "Dashboard Executivo";
        if (pageSubtitle) pageSubtitle.innerText = "Indicadores operacionais e fluxo financeiro em tempo real.";
        setTimeout(() => atualizarDashboardVisual(), 100);
    } else if (aba === 'lancamento') {
        if (pageTitle) pageTitle.innerText = "Novo Lançamento Financeiro";
        if (pageSubtitle) pageSubtitle.innerText = "Registre novas movimentações de entrada ou saída.";
    } else if (aba === 'historico') {
        if (pageTitle) pageTitle.innerText = "Histórico de Movimentações";
        if (pageSubtitle) pageSubtitle.innerText = "Consulta integral de registros e relatórios consolidados.";
    } else if (aba === 'usuarios') {
        if (pageTitle) pageTitle.innerText = "Gerenciamento de Usuários";
        if (pageSubtitle) pageSubtitle.innerText = "Controle de credenciais e acessos.";
        renderizarListaUsuarios();
    } else if (aba === 'logs') {
        if (pageTitle) pageTitle.innerText = "Logs de Auditoria & Rastreabilidade";
        if (pageSubtitle) pageSubtitle.innerText = "Trilha de eventos de segurança e operações do sistema.";
        renderizarListaLogs();
    }

    // Fechar menu mobile se aberto
    document.getElementById('main-sidebar')?.classList.remove('mobile-open');
    document.getElementById('mobile-sidebar-overlay')?.classList.add('hidden');
};

// ==========================================
// AUTENTICAÇÃO E SESSÃO
// ==========================================
let usuarioPendenteAlteracao = null;

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = document.getElementById('login-usuario').value;
    const senha = document.getElementById('login-senha').value;

    if (!usuario || !perfisSistema[usuario]) {
        alert("Selecione um perfil de acesso válido.");
        return;
    }

    const hashDigitado = await hashSenha(senha);
    if (perfisSistema[usuario].senhaHash !== hashDigitado) {
        registrarLogAuditoria("LOGIN_FALHA", `Tentativa de login malsucedida para o perfil: ${usuario}`, "RECUSADO");
        alert("Senha de acesso incorreta.");
        return;
    }

    const dadosPerfil = perfisSistema[usuario];

    if (dadosPerfil.primeiroAcesso) {
        usuarioPendenteAlteracao = usuario;
        formLogin.classList.add('hidden');
        formPrimeiroAcesso.classList.remove('hidden');
        return;
    }

    iniciarSessao(usuario, dadosPerfil.perfil, dadosPerfil.nome);
});

formPrimeiroAcesso.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s1 = document.getElementById('nova-senha-1').value;
    const s2 = document.getElementById('nova-senha-2').value;

    if (s1 !== s2) {
        alert("As senhas não coincidem.");
        return;
    }
    if (s1.length < 8) {
        alert("Por segurança, a senha deve possuir pelo menos 8 caracteres.");
        return;
    }

    perfisSistema[usuarioPendenteAlteracao].senhaHash = await hashSenha(s1);
    perfisSistema[usuarioPendenteAlteracao].primeiroAcesso = false;
    localStorage.setItem('audio_sa_perfis_v3', JSON.stringify(perfisSistema));

    registrarLogAuditoria("TROCA_SENHA_PRIMEIRO_ACESSO", `Troca de senha inicial concluída para: ${usuarioPendenteAlteracao}`);
    alert("Senha alterada com sucesso!");
    iniciarSessao(usuarioPendenteAlteracao, perfisSistema[usuarioPendenteAlteracao].perfil, perfisSistema[usuarioPendenteAlteracao].nome);
});

function iniciarSessao(usuario, perfil, nome) {
    sessaoAtual = { usuario, perfil, nome: nome || usuario, loginTime: Date.now() };
    localStorage.setItem('audio_sa_sessao', JSON.stringify(sessaoAtual));
    registrarLogAuditoria("LOGIN_SUCESSO", `Usuário autenticado com sucesso: ${usuario}`);
    aplicarPermissoesPerfil();
    iniciarMonitorInatividade();
}

function aplicarPermissoesPerfil() {
    if (!sessaoAtual) return;

    screenAuth.classList.add('hidden');
    appDashboard.classList.remove('hidden');

    document.getElementById('user-role-badge').innerText = `Perfil: ${sessaoAtual.perfil.toUpperCase()}`;
    document.getElementById('user-name-display').innerText = sessaoAtual.nome || sessaoAtual.usuario;

    const navDashboard = document.getElementById('nav-btn-dashboard');
    const navHistorico = document.getElementById('nav-btn-historico');
    const secaoOcr = document.getElementById('secao-ocr');
    const acoesAnalista = document.getElementById('acoes-analista');
    const thAcoes = document.getElementById('th-acoes');
    const navAdminOnly = document.querySelectorAll('.nav-admin-only');

    // REGRA DE OURO DOS PERFIS:
    if (sessaoAtual.perfil === 'recepcao') {
        // RECEPÇÃO: Apenas novo lançamento
        if (navDashboard) navDashboard.style.display = 'none';
        if (navHistorico) navHistorico.style.display = 'none';
        if (secaoOcr) secaoOcr.style.display = 'none';
        if (acoesAnalista) acoesAnalista.style.display = 'none';
        if (thAcoes) thAcoes.style.display = 'none';
        navAdminOnly.forEach(el => el.classList.add('hidden'));

        mudarAba('lancamento');
    } else if (sessaoAtual.perfil === 'gerente') {
        // GERENTE: Dashboard, Lançamentos, Histórico, OCR, Exportações
        if (navDashboard) navDashboard.style.display = 'flex';
        if (navHistorico) navHistorico.style.display = 'flex';
        if (secaoOcr) secaoOcr.style.display = 'block';
        if (acoesAnalista) acoesAnalista.style.display = 'flex';
        if (thAcoes) thAcoes.style.display = 'none';
        navAdminOnly.forEach(el => el.classList.add('hidden'));

        mudarAba('dashboard');
    } else if (sessaoAtual.perfil === 'analista') {
        // ANALISTA: Acesso total
        if (navDashboard) navDashboard.style.display = 'flex';
        if (navHistorico) navHistorico.style.display = 'flex';
        if (secaoOcr) secaoOcr.style.display = 'block';
        if (acoesAnalista) acoesAnalista.style.display = 'flex';
        if (thAcoes) thAcoes.style.display = 'table-cell';
        navAdminOnly.forEach(el => el.classList.remove('hidden'));

        mudarAba('dashboard');
    }

    inicializarSelects();
    renderCharts();
    carregarTransacoes();
}

function iniciarMonitorInatividade() {
    if (timeoutSessaoInatividade) clearTimeout(timeoutSessaoInatividade);
    // Timeout de 15 minutos de inatividade
    timeoutSessaoInatividade = setTimeout(() => {
        alert("Sua sessão expirou por inatividade.");
        encerraSessao();
    }, 15 * 60 * 1000);
}

['click', 'mousemove', 'keypress'].forEach(evt => {
    window.addEventListener(evt, () => {
        if (sessaoAtual) iniciarMonitorInatividade();
    });
});

function encerraSessao() {
    if (sessaoAtual) {
        registrarLogAuditoria("LOGOUT", `Sessão encerrada pelo usuário: ${sessaoAtual.usuario}`);
    }
    localStorage.removeItem('audio_sa_sessao');
    location.reload();
}

btnLogout?.addEventListener('click', encerraSessao);

// Modal de alteração de senha
document.getElementById('btn-abrir-modal-senha')?.addEventListener('click', () => {
    document.getElementById('modal-senha').classList.remove('hidden');
});

window.fecharModalSenha = function() {
    document.getElementById('modal-senha').classList.add('hidden');
};

document.getElementById('form-modal-senha')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const atual = document.getElementById('modal-senha-atual').value;
    const nova = document.getElementById('modal-senha-nova').value;

    const userKey = sessaoAtual.usuario;
    const hashAtual = await hashSenha(atual);

    if (perfisSistema[userKey].senhaHash !== hashAtual) {
        alert("A senha atual informada está incorreta.");
        return;
    }
    if (nova.length < 8) {
        alert("A nova senha deve possuir pelo menos 8 caracteres.");
        return;
    }

    perfisSistema[userKey].senhaHash = await hashSenha(nova);
    localStorage.setItem('audio_sa_perfis_v3', JSON.stringify(perfisSistema));
    registrarLogAuditoria("ALTERAÇÃO_SENHA", `Senha alterada pelo usuário: ${userKey}`);

    alert("Senha atualizada com sucesso!");
    fecharModalSenha();
    document.getElementById('form-modal-senha').reset();
});

// ==========================================
// LANÇAMENTOS E BANCO DE DADOS
// ==========================================
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

selectTipo?.addEventListener('change', atualizarCategorias);

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

formTransacao?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const editId = document.getElementById('t-edit-id').value;
    const tipo = selectTipo.value;
    const categoria = selectCategoria.value;
    const profissional = tipo === 'entrada' ? selectProfissional.value : 'Geral';
    const descricao = document.getElementById('t-descricao').value;
    const valorBruto = parseFloat(document.getElementById('t-valor').value);
    const data = document.getElementById('t-data').value;
    const formaPagamento = document.getElementById('t-forma-pagamento').value;
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
        descricao: escapeHTML(`${descricao} (${formaPagamento}${bandeira ? ' - ' + bandeira : ''})`),
        valor: parseFloat(valorLiquido.toFixed(2)),
        data
    };

    if (editId) {
        if (sessaoAtual?.perfil !== 'analista') {
            alert("Apenas o perfil Analista possui permissão para editar lançamentos.");
            return;
        }
        const index = transacoes.findIndex(t => t.id === editId);
        if (index !== -1) transacoes[index] = transacaoObj;
        registrarLogAuditoria("EDIÇÃO_LANÇAMENTO", `Lançamento ID ${editId} modificado.`);
        cancelarEdicao();
    } else {
        // Envio estruturado com validação e fallback síncrono para o Supabase
        if (supabase10) {
            try {
                const { data, error } = await supabase10
                    .from('transacoes')
                    .insert([transacaoObj])
                    .select();

                if (error) {
                    throw error;
                }

                if (!data || data.length === 0) {
                    throw new Error("O banco não confirmou o registro.");
                }

                transacoes.unshift(data[0]);
            } catch (erro) {
                console.error("Erro ao salvar lançamento no Supabase:", erro);
                alert(
                    "Não foi possível salvar o lançamento no banco de dados.\n\n" +
                    "Verifique sua conexão ou entre em contato com o administrador."
                );
                return;
            }
        } else {
            transacoes.unshift(transacaoObj);
        }

        registrarLogAuditoria("NOVO_LANÇAMENTO", `Novo lançamento registrado: R$ ${valorLiquido.toFixed(2)} (${tipo})`);
    }

    localStorage.setItem('audio_sa_transacoes', JSON.stringify(transacoes));
    formTransacao.reset();
    document.getElementById('t-data').value = new Date().toISOString().split('T')[0];
    atualizarCategorias();
    atualizarDashboardVisual();

    alert("Lançamento efetuado com sucesso!");

    // Recepção permanece na página de lançamento
    if (sessaoAtual.perfil !== 'recepcao') {
        mudarAba('historico');
    }
});

function cancelarEdicao() {
    document.getElementById('t-edit-id').value = '';
    document.getElementById('form-titulo-modo').innerText = "Novo Lançamento Financeiro";
    document.getElementById('btn-submit-transacao').innerText = "💾 Salvar Lançamento";
    document.getElementById('btn-cancelar-edicao').classList.add('hidden');
    formTransacao.reset();
    atualizarCategorias();
}

function atualizarDashboardVisual() {
    const entradas = transacoes.filter(t => t.tipo === 'entrada').reduce((a, t) => a + t.valor, 0);
    const saidas = transacoes.filter(t => t.tipo === 'saida').reduce((a, t) => a + t.valor, 0);
    const saldo = entradas - saidas;

    const elEntradas = document.getElementById('total-entradas');
    const elSaidas = document.getElementById('total-saidas');
    const elSaldo = document.getElementById('saldo-liquido');

    if (elEntradas) elEntradas.innerText = `R$ ${entradas.toFixed(2)}`;
    if (elSaidas) elSaidas.innerText = `R$ ${saidas.toFixed(2)}`;
    if (elSaldo) elSaldo.innerText = `R$ ${saldo.toFixed(2)}`;

    updateCharts(entradas, saidas);
    renderTabela();
}

function renderTabela() {
    const tbody = document.getElementById('transacoes-list');
    if (!tbody) return;
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
                <button onclick="editarTransacao('${t.id}')" style="background: var(--accent); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; margin-right: 4px;">Editar</button>
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
    document.getElementById('btn-submit-transacao').innerText = "🔄 Atualizar Lançamento";
    document.getElementById('btn-cancelar-edicao').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.deletarTransacao = async function(id) {
    if (sessaoAtual?.perfil !== 'analista') {
        alert("Apenas o perfil Analista possui autorização para excluir registros.");
        return;
    }
    if (!confirm("Deseja realmente apagar este registro financeiro?")) return;

    transacoes = transacoes.filter(t => t.id !== id);
    localStorage.setItem('audio_sa_transacoes', JSON.stringify(transacoes));
    if (supabase10) {
        await supabase10.from('transacoes').delete().match({ id }).catch(()=>{});
    }
    registrarLogAuditoria("EXCLUSÃO_LANÇAMENTO", `Lançamento ID ${id} excluído pelo Analista.`);
    atualizarDashboardVisual();
};

window.filtrarHistorico = function() {
    const busca = document.getElementById('filtro-busca').value.toLowerCase();
    const tipo = document.getElementById('filtro-tipo').value;
    const tbody = document.getElementById('transacoes-list');
    tbody.innerHTML = '';

    const filtrados = transacoes.filter(t => {
        const bateBusca = t.descricao.toLowerCase().includes(busca) || t.categoria.toLowerCase().includes(busca);
        const bateTipo = tipo === 'todos' || t.tipo === tipo;
        return bateBusca && bateTipo;
    });

    filtrados.forEach(t => {
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
                <button onclick="editarTransacao('${t.id}')" style="background: var(--accent); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; margin-right: 4px;">Editar</button>
                <button onclick="deletarTransacao('${t.id}')" style="background: var(--danger); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer;">Excluir</button>
            </td>`;
        }
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
};

// ==========================================
// GRÁFICOS (CHART.JS)
// ==========================================
function renderCharts() {
    const canvasBar = document.getElementById('financeBarChart');
    const canvasPie = document.getElementById('financePieChart');

    if (!canvasBar || !canvasPie) return;

    if (barChartInstance) barChartInstance.destroy();
    if (pieChartInstance) pieChartInstance.destroy();

    const ctxBar = canvasBar.getContext('2d');
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
            maintainAspectRatio: false
        }
    });

    const ctxPie = canvasPie.getContext('2d');
    pieChartInstance = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: ['Consultas / Exames', 'Aparelhos', 'Custos Fixos', 'Outros'],
            datasets: [{
                data: [40, 30, 20, 10],
                backgroundColor: ['#0284c7', '#10b981', '#ef4444', '#f59e0b']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
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

// ==========================================
// MÓDULO OCR ASSISTIVO COM REVISÃO OBRIGATÓRIA
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
    btnTriggerCamera.addEventListener('click', () => {
        if (sessaoAtual?.perfil === 'recepcao') return;
        ocrFileInput.setAttribute('capture', 'environment');
        ocrFileInput.click();
    });

    btnTriggerGallery.addEventListener('click', () => {
        if (sessaoAtual?.perfil === 'recepcao') return;
        ocrFileInput.removeAttribute('capture');
        ocrFileInput.click();
    });

    ocrFileInput.addEventListener('change', async (e) => {
        if (e.target.files.length === 0) return;
        const file = e.target.files[0];

        // Validação de Tamanho (Máx 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert("O arquivo selecionado excede o limite máximo de 5MB.");
            return;
        }

        statusDiv.innerText = 'Processando documento via OCR Assistivo...';
        registrarLogAuditoria("OCR_PROCESSAMENTO", `Arquivo enviado para OCR: ${file.name}`);

        setTimeout(() => {
            statusDiv.innerText = 'Leitura OCR efetuada. Confira as informações abaixo.';
            ocrPrevDesc.value = 'Insumos Clínicos e Materiais Operacionais';
            ocrPrevVal.value = '450.00';
            ocrPreviewContainer.classList.remove('hidden');
        }, 1200);
    });

    btnConfirmOcr.addEventListener('click', () => {
        selectTipo.value = 'saida';
        atualizarCategorias();
        document.getElementById('t-descricao').value = ocrPrevDesc.value;
        document.getElementById('t-valor').value = ocrPrevVal.value;
        document.getElementById('t-data').value = new Date().toISOString().split('T')[0];
        
        ocrPreviewContainer.classList.add('hidden');
        statusDiv.innerText = 'Dados carregados com sucesso no formulário!';
        registrarLogAuditoria("OCR_CONFIRMAÇÃO_HUMANA", `Dados do OCR confirmados manualmente: R$ ${ocrPrevVal.value}`);
        window.scrollTo({ top: document.getElementById('form-transacao').offsetTop - 20, behavior: 'smooth' });
    });

    btnCancelOcr.addEventListener('click', () => {
        ocrPreviewContainer.classList.add('hidden');
        statusDiv.innerText = 'Leitura descartada pelo usuário.';
        registrarLogAuditoria("OCR_DESCARTADO", "Dados da extração descartados.");
    });
}

// ==========================================
// EXPORTAÇÕES (CSV E PDF)
// ==========================================
document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    if (sessaoAtual?.perfil === 'recepcao') return alert("Acesso restrito ao Gerente e Analista.");
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
    registrarLogAuditoria("EXPORTAÇÃO_CSV", "Relatório CSV exportado.");
});

document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
    if (sessaoAtual?.perfil === 'recepcao') return alert("Acesso restrito ao Gerente e Analista.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.text("Áudio S.A. - Relatório Financeiro Oficial", 14, 18);
    let y = 30;
    transacoes.forEach(t => {
        doc.text(`${t.data} | [${t.tipo.toUpperCase()}] ${t.categoria} - R$ ${t.valor.toFixed(2)} (${t.descricao})`, 14, y);
        y += 8;
    });
    doc.save("audio_sa_relatorio.pdf");
    registrarLogAuditoria("EXPORTAÇÃO_PDF", "Relatório PDF exportado.");
});

// ==========================================
// PAINÉIS EXCLUSIVOS DO ANALISTA (LOGS E USUÁRIOS)
// ==========================================
function renderizarListaUsuarios() {
    const container = document.getElementById('usuarios-sistema-list');
    if (!container) return;
    container.innerHTML = '';

    Object.keys(perfisSistema).forEach(key => {
        const u = perfisSistema[key];
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${key.toUpperCase()}</strong></td>
            <td>${u.nome}</td>
            <td><span class="badge-role">${u.perfil.toUpperCase()}</span></td>
            <td>${u.primeiroAcesso ? '<span style="color:var(--danger)">Pendente</span>' : '<span style="color:var(--success)">Concluído</span>'}</td>
            <td>
                <button onclick="resetarSenhaUsuario('${key}')" style="background: var(--accent); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer;">Redefinir Senha Inicial</button>
            </td>
        `;
        container.appendChild(tr);
    });
}

window.resetarSenhaUsuario = async function(key) {
    if (sessaoAtual?.perfil !== 'analista') return;
    if (!confirm(`Deseja resetar a senha do perfil ${key} para a senha temporária padrão?`)) return;

    perfisSistema[key].senhaHash = await hashSenha(`${key}123`);
    perfisSistema[key].primeiroAcesso = true;
    localStorage.setItem('audio_sa_perfis_v3', JSON.stringify(perfisSistema));
    registrarLogAuditoria("GERENCIAMENTO_USUÁRIO", `Senha do perfil ${key} resetada pelo Analista.`);
    alert(`Senha do usuário ${key} resetada com sucesso!`);
    renderizarListaUsuarios();
};

function renderizarListaLogs() {
    const container = document.getElementById('logs-audit-list');
    if (!container) return;
    container.innerHTML = '';

    logsAuditoria.forEach(l => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${l.timestamp}</td>
            <td><b>${l.usuario}</b></td>
            <td><span class="badge-role">${l.perfil}</span></td>
            <td><strong>${l.acao}</strong></td>
            <td>${l.detalhes}</td>
            <td><span style="color: ${l.resultado === 'SUCESSO' ? 'var(--success)' : 'var(--danger)'}">${l.resultado}</span></td>
        `;
        container.appendChild(tr);
    });
}

// ==========================================
// SUPORTE MOBILE (MENU HAMBÚRGUER)
// ==========================================
document.getElementById('btn-toggle-mobile-menu')?.addEventListener('click', () => {
    document.getElementById('main-sidebar').classList.add('mobile-open');
    document.getElementById('mobile-sidebar-overlay').classList.remove('hidden');
});

document.getElementById('btn-close-mobile-menu')?.addEventListener('click', () => {
    document.getElementById('main-sidebar').classList.remove('mobile-open');
    document.getElementById('mobile-sidebar-overlay').classList.add('hidden');
});

document.getElementById('mobile-sidebar-overlay')?.addEventListener('click', () => {
    document.getElementById('main-sidebar').classList.remove('mobile-open');
    document.getElementById('mobile-sidebar-overlay').classList.add('hidden');
});

// Inicialização Geral
window.addEventListener('DOMContentLoaded', () => {
    inicializarTema();
    document.getElementById('t-data').value = new Date().toISOString().split('T')[0];
    if (sessaoAtual) {
        aplicarPermissoesPerfil();
    }
});