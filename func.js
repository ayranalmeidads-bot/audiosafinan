/* =========================================================
   ÁUDIO S.A. — SISTEMA FINANCEIRO
   Autenticação: exclusivamente Supabase Auth.
   Perfis: app_metadata.perfil = recepcao | gerente | analista.
   A autorização real dos dados é aplicada pelas políticas RLS.
   ========================================================= */

(() => {
    'use strict';

    // Configuração pública do projeto Supabase.
    // Nunca coloque a chave service_role no frontend.
    const SUPABASE_URL = 'https://zqkdnkpttbazajqkeqac.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_fLbyK3eMhdn9LozmBSJL5A_ITUloIZ6';

    const CATEGORIAS = {
        entrada: ['Consulta', 'Procedimento/Exame PAC', 'Terapia/Treinamento Auditivo', 'Aparelho Auditivo', 'Outros'],
        saida: ['Custo fixo', 'Insumos/Procedimentos', 'Aparelhos/Produtos', 'Pessoal/Comissões', 'Taxas/Impostos', 'Outros/Excepcionais']
    };

    const PROFISSIONAIS = ['Dra Amanda', 'Dra Eleonora', 'Dra Márcia', 'Dra Simone', 'Outro'];

    const TAXAS_CARTAO = {
        'Visa Débito': 0.0128, 'Visa Crédito': 0.0241, 'Visa 2x a 6x': 0.0318, 'Visa 7x a 12x': 0.0411,
        'Master Débito': 0.0101, 'Master Crédito': 0.0231, 'Master 2x a 6x': 0.0320, 'Master 7x a 12x': 0.0386,
        'Elo Débito': 0.0143, 'Elo Crédito': 0.0267, 'Elo 2x a 6x': 0.0373, 'Elo 7x a 12x': 0.0441,
        'Amex Crédito': 0.0339, 'Amex 2x a 6x': 0.0423, 'Amex 7x a 12x': 0.0455,
        'Hipercard Crédito': 0.0220, 'Hipercard 2x a 6x': 0.0371, 'Hipercard 7x a 12x': 0.0435
    };

    const PERFIS_VALIDOS = ['recepcao', 'gerente', 'analista'];

    const TITULOS_ABAS = {
        dashboard: ['Dashboard Executivo', 'Visão geral dos indicadores financeiros da clínica.'],
        lancamento: ['Novo Lançamento', 'Registre uma entrada ou saída financeira.'],
        historico: ['Histórico & Gestão', 'Consulte, filtre e exporte os lançamentos.'],
        usuarios: ['Gerenciar Usuários', 'Área administrativa exclusiva do Analista.'],
        logs: ['Logs de Auditoria', 'Rastreabilidade das operações do sistema.']
    };

    let supabaseClient = null;
    let sessaoAtual = null;
    let transacoes = [];
    let barChartInstance = null;
    let pieChartInstance = null;
    let carregando = false;
    let monitorInatividade = null;

    const $ = (id) => document.getElementById(id);

    const money = (value) =>
        Number(value || 0).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });

    const escapeCSV = (value) => {
        const s = String(value ?? '');
        const safe = /^[\s]*[=+\-@]/.test(s) ? `'${s}` : s;
        return `"${safe.replace(/"/g, '""')}"`;
    };

    function dataLocalHoje() {
        const agora = new Date();
        const ano = agora.getFullYear();
        const mes = String(agora.getMonth() + 1).padStart(2, '0');
        const dia = String(agora.getDate()).padStart(2, '0');
        return `${ano}-${mes}-${dia}`;
    }

    function mostrarMensagem(elemento, mensagem, tipo = 'info') {
        if (!elemento) return;

        elemento.textContent = mensagem;
        elemento.classList.remove('hidden', 'success', 'error', 'warning');

        if (tipo === 'success') elemento.classList.add('success');
        if (tipo === 'error') elemento.classList.add('error');
        if (tipo === 'warning') elemento.classList.add('warning');
    }

    function ocultarMensagem(elemento) {
        if (!elemento) return;

        elemento.textContent = '';
        elemento.classList.add('hidden');
        elemento.classList.remove('success', 'error', 'warning');
    }

    function feedbackGlobal(mensagem, tipo = 'info') {
        const box = $('global-feedback');
        if (!box) return;
        mostrarMensagem(box, mensagem, tipo);
    }

    function exigirPerfil(perfis) {
        return Boolean(sessaoAtual && perfis.includes(sessaoAtual.perfil));
    }

    function exigirAnalista(acao) {
        if (!exigirPerfil(['analista'])) {
            feedbackGlobal(`Acesso negado: somente o Analista pode ${acao}.`, 'error');
            return false;
        }
        return true;
    }

    function definirVisibilidade(elemento, visivel, display = '') {
        if (!elemento) return;

        elemento.classList.toggle('hidden', !visivel);
        elemento.style.display = visivel ? display : 'none';
    }

    function configurarSupabase() {
        if (!window.supabase?.createClient) {
            throw new Error(
                'A biblioteca do Supabase não foi carregada. Verifique a conexão e o script CDN.'
            );
        }

        supabaseClient = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_KEY,
            {
                auth: {
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: true
                }
            }
        );
    }

    function configurarSelects() {
        const profissional = $('t-profissional');
        const bandeira = $('t-bandeira');

        if (profissional) {
            profissional.replaceChildren();

            PROFISSIONAIS.forEach(nome => {
                const option = document.createElement('option');
                option.value = nome;
                option.textContent = nome;
                profissional.appendChild(option);
            });
        }

        if (bandeira) {
            bandeira.replaceChildren();

            const vazio = document.createElement('option');
            vazio.value = '';
            vazio.textContent = 'Sem taxa de cartão / Outros';
            bandeira.appendChild(vazio);

            Object.entries(TAXAS_CARTAO).forEach(([nome, taxa]) => {
                const option = document.createElement('option');
                option.value = nome;
                option.textContent = `${nome} (${(taxa * 100).toFixed(2)}%)`;
                bandeira.appendChild(option);
            });
        }

        atualizarCategorias();
    }

    function atualizarCategorias() {
        const tipo = $('t-tipo')?.value || 'entrada';
        const categoria = $('t-categoria');

        if (!categoria) return;

        categoria.replaceChildren();

        (CATEGORIAS[tipo] || []).forEach(nome => {
            const option = document.createElement('option');
            option.value = nome;
            option.textContent = nome;
            categoria.appendChild(option);
        });

        const entrada = tipo === 'entrada';

        definirVisibilidade($('campo-profissional'), entrada, 'block');
        definirVisibilidade($('campo-bandeira'), entrada, 'block');

        const profissional = $('t-profissional');
        if (profissional) profissional.required = entrada;

        const pagamento = $('t-forma-pagamento');
        if (pagamento) pagamento.required = entrada;

        definirVisibilidade($('campo-pagamento'), entrada, 'block');
    }

    function aplicarPermissoesPerfil() {
        if (!sessaoAtual) return;

        const perfil = sessaoAtual.perfil;
        const recepcao = perfil === 'recepcao';
        const gerente = perfil === 'gerente';
        const analista = perfil === 'analista';
        const podeVerFinanceiro = gerente || analista;

        $('auth-screen')?.classList.add('hidden');
        $('app-dashboard')?.classList.remove('hidden');

        if ($('user-role-badge')) {
            $('user-role-badge').textContent = `Perfil: ${perfil.toUpperCase()}`;
        }

        if ($('user-name-display')) {
            $('user-name-display').textContent =
                sessaoAtual.nome || sessaoAtual.email || 'Usuário';
        }

        definirVisibilidade($('nav-btn-dashboard'), podeVerFinanceiro);
        definirVisibilidade($('nav-btn-lancamento'), true);
        definirVisibilidade($('nav-btn-historico'), podeVerFinanceiro);
        definirVisibilidade($('nav-btn-usuarios'), analista);
        definirVisibilidade($('nav-btn-logs'), analista);

        // OCR ainda é apenas demonstrativo.
        definirVisibilidade($('secao-ocr'), podeVerFinanceiro, 'block');
        definirVisibilidade($('acoes-analista'), podeVerFinanceiro, 'flex');
        definirVisibilidade($('th-acoes'), analista, 'table-cell');

        configurarSelects();

        if (recepcao) {
            // A recepção não mantém dados consolidados na interface.
            transacoes = [];
            limparDashboard();
            renderTabela();
            mudarAba('lancamento');
        } else {
            mudarAba('dashboard');
            carregarTransacoes();
        }
    }

    function limparDashboard() {
        ['total-entradas', 'total-saidas', 'saldo-liquido'].forEach(id => {
            if ($(id)) $(id).textContent = money(0);
        });

        if (barChartInstance) {
            barChartInstance.data.datasets[0].data = [0, 0];
            barChartInstance.update();
        }

        if (pieChartInstance) {
            pieChartInstance.data.labels = [];
            pieChartInstance.data.datasets[0].data = [];
            pieChartInstance.update();
        }
    }

    async function autenticarUsuario(email, senha) {
        const { data, error } =
            await supabaseClient.auth.signInWithPassword({
                email,
                password: senha
            });

        if (error) throw error;

        if (!data.user) {
            throw new Error('O Supabase não retornou um usuário autenticado.');
        }

        const perfil = data.user.app_metadata?.perfil;

        if (!PERFIS_VALIDOS.includes(perfil)) {
            await supabaseClient.auth.signOut();

            throw new Error(
                'Este usuário não possui um perfil válido em app_metadata.perfil. Solicite ao administrador a correção no Supabase.'
            );
        }

        sessaoAtual = {
            id: data.user.id,
            email: data.user.email,
            nome:
                data.user.user_metadata?.nome ||
                data.user.app_metadata?.nome ||
                data.user.email,
            perfil
        };

        aplicarPermissoesPerfil();
        feedbackGlobal(`Acesso autorizado: ${perfil}.`, 'success');
    }

    async function encerrarSessao() {
        try {
            if (monitorInatividade) clearTimeout(monitorInatividade);

            const { error } = await supabaseClient.auth.signOut();
            if (error) throw error;

            sessaoAtual = null;
            transacoes = [];
            location.reload();
        } catch (error) {
            feedbackGlobal(
                `Não foi possível encerrar a sessão: ${error.message}`,
                'error'
            );
        }
    }

    async function sincronizarSessao() {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;

        const user = data.session?.user;

        if (!user) {
            sessaoAtual = null;
            $('auth-screen')?.classList.remove('hidden');
            $('app-dashboard')?.classList.add('hidden');
            return;
        }

        const perfil = user.app_metadata?.perfil;

        if (!PERFIS_VALIDOS.includes(perfil)) {
            await supabaseClient.auth.signOut();
            throw new Error('Perfil ausente ou inválido em app_metadata.perfil.');
        }

        sessaoAtual = {
            id: user.id,
            email: user.email,
            nome:
                user.user_metadata?.nome ||
                user.app_metadata?.nome ||
                user.email,
            perfil
        };

        aplicarPermissoesPerfil();
    }

    async function carregarTransacoes() {
        if (!exigirPerfil(['gerente', 'analista'])) {
            transacoes = [];
            renderTabela();
            limparDashboard();
            return;
        }

        try {
            const { data, error } = await supabaseClient
                .from('transacoes')
                .select('id,tipo,categoria,profissional,descricao,valor,data,created_at')
                .order('data', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;

            transacoes = (data || []).map(t => ({
                ...t,
                valor: Number(t.valor) || 0
            }));

            atualizarDashboardVisual();
        } catch (error) {
            transacoes = [];
            atualizarDashboardVisual();

            feedbackGlobal(
                `Erro ao carregar transações do Supabase: ${error.message}`,
                'error'
            );
        }

        renderTabela();
    }
    
        function atualizarDashboardVisual() {
        if (!exigirPerfil(['gerente', 'analista'])) return limparDashboard();

        const entradas = transacoes.filter(t => t.tipo === 'entrada').reduce((soma, t) => soma + Number(t.valor || 0), 0);
        const saidas = transacoes.filter(t => t.tipo === 'saida').reduce((soma, t) => soma + Number(t.valor || 0), 0);
        $('total-entradas').textContent = money(entradas);
        $('total-saidas').textContent = money(saidas);
        $('saldo-liquido').textContent = money(entradas - saidas);
        updateCharts(entradas, saidas);
        renderTabela();
    }

    function renderTabela() {
        const tbody = $('transacoes-list');
        if (!tbody) return;
        tbody.replaceChildren();

        if (!exigirPerfil(['gerente', 'analista'])) return;

        const busca = ($('filtro-busca')?.value || '').trim().toLocaleLowerCase('pt-BR');
        const tipoFiltro = $('filtro-tipo')?.value || 'todos';
        const lista = transacoes.filter(t => {
            const texto = `${t.categoria || ''} ${t.descricao || ''} ${t.profissional || ''}`.toLocaleLowerCase('pt-BR');
            return (tipoFiltro === 'todos' || t.tipo === tipoFiltro) && (!busca || texto.includes(busca));
        });

        if (!lista.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = sessaoAtual?.perfil === 'analista' ? 6 : 5;
            td.textContent = 'Nenhum lançamento encontrado.';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        lista.forEach(t => {
            const tr = document.createElement('tr');
            const valores = [
                t.data || '',
                (t.tipo || '').toUpperCase(),
                t.categoria || '',
                t.descricao || '',
                money(t.valor)
            ];
            valores.forEach((valor, index) => {
                const td = document.createElement('td');
                if (index === 1) {
                    const strong = document.createElement('strong');
                    strong.textContent = valor;
                    strong.style.color = t.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)';
                    td.appendChild(strong);
                } else {
                    td.textContent = valor;
                }
                tr.appendChild(td);
            });

            if (sessaoAtual?.perfil === 'analista') {
                const td = document.createElement('td');
                const editar = document.createElement('button');
                editar.type = 'button';
                editar.textContent = 'Editar';
                editar.className = 'btn-outline';
                editar.addEventListener('click', () => editarTransacao(t.id));
                const excluir = document.createElement('button');
                excluir.type = 'button';
                excluir.textContent = 'Excluir';
                excluir.className = 'btn-outline';
                excluir.addEventListener('click', () => deletarTransacao(t.id));
                td.append(editar, excluir);
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        });
    }

    function filtrarHistorico() {
        if (!exigirPerfil(['gerente', 'analista'])) return;
        renderTabela();
    }

    function montarDescricao(descricao, formaPagamento, bandeira) {
        const detalhe = formaPagamento ? ` (${formaPagamento}${bandeira ? ` - ${bandeira}` : ''})` : '';
        return `${descricao.trim()}${detalhe}`;
    }

    function extrairDescricaoBase(descricao) {
        return String(descricao || '').replace(/\s+\((PIX|Débito|Crédito à vista|Crédito Parcelado)(?:\s+-\s+[^)]+)?\)\s*$/, '');
    }

    async function salvarTransacao(evento) {
        evento.preventDefault();
        if (!exigirPerfil(['recepcao', 'gerente', 'analista'])) {
            feedbackGlobal('Seu perfil não pode cadastrar lançamentos.', 'error');
            return;
        }
        if (carregando) return;

        const editId = $('t-edit-id').value.trim();
        const editando = Boolean(editId);
        if (editando && !exigirAnalista('editar lançamentos')) return;

        const tipo = $('t-tipo').value;
        const categoria = $('t-categoria').value;
        const profissional = tipo === 'entrada' ? $('t-profissional').value : 'Geral';
        const descricaoBase = $('t-descricao').value.trim();
        const valorInformado = Number($('t-valor').value);
        const data = $('t-data').value;
        const formaPagamento = tipo === 'entrada' ? $('t-forma-pagamento').value : '';
        const bandeira = tipo === 'entrada' ? $('t-bandeira').value : '';

        if (!descricaoBase || !categoria || !data || !Number.isFinite(valorInformado) || valorInformado <= 0) {
            feedbackGlobal('Preencha todos os campos obrigatórios com valores válidos.', 'error');
            return;
        }

        // No modo edição o valor já é líquido no banco. Não descontar taxa novamente.
        let valorFinal = valorInformado;
        let descricaoFinal = descricaoBase;
        if (!editando && tipo === 'entrada' && bandeira && TAXAS_CARTAO[bandeira]) {
            valorFinal = valorInformado * (1 - TAXAS_CARTAO[bandeira]);
        }
        if (tipo === 'entrada') {
            descricaoFinal = montarDescricao(descricaoBase, formaPagamento, bandeira);
        }

        const payload = {
            tipo,
            categoria,
            profissional,
            descricao: descricaoFinal,
            valor: Number(valorFinal.toFixed(2)),
            data
        };

        carregando = true;
        const botao = $('btn-submit-transacao');
        const textoOriginal = botao.textContent;
        botao.disabled = true;
        botao.textContent = editando ? 'Atualizando...' : 'Salvando...';

        try {
            let resultado;
            if (editando) {
                resultado = await supabaseClient.from('transacoes').update(payload).eq('id', editId).select('id').single();
            } else {
                payload.id = (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
                resultado = await supabaseClient.from('transacoes').insert(payload).select('id').single();
            }
            if (resultado.error) throw resultado.error;
            if (!resultado.data) throw new Error('O banco não confirmou a gravação.');

            $('form-transacao').reset();
            cancelarEdicao();
            atualizarCategorias();

            if (sessaoAtual.perfil === 'recepcao') {
                feedbackGlobal('Lançamento salvo com sucesso.', 'success');
                $('t-data').value = dataLocalHoje();
                mudarAba('lancamento');
            } else {
                await carregarTransacoes();
                feedbackGlobal(editando ? 'Lançamento atualizado com sucesso.' : 'Lançamento salvo com sucesso.', 'success');
                mudarAba(editando ? 'historico' : 'historico');
            }
        } catch (error) {
            feedbackGlobal(`Não foi possível salvar o lançamento: ${error.message}`, 'error');
        } finally {
            carregando = false;
            botao.disabled = false;
            botao.textContent = textoOriginal;
        }
    }

    function editarTransacao(id) {
        if (!exigirAnalista('editar lançamentos')) return;
        const transacao = transacoes.find(t => String(t.id) === String(id));
        if (!transacao) return feedbackGlobal('Lançamento não encontrado na lista atual.', 'error');

        mudarAba('lancamento');
        $('t-edit-id').value = transacao.id;
        $('t-tipo').value = transacao.tipo;
        atualizarCategorias();
        $('t-categoria').value = transacao.categoria;
        $('t-profissional').value = transacao.profissional || PROFISSIONAIS[0];
        $('t-descricao').value = extrairDescricaoBase(transacao.descricao);
        $('t-valor').value = Number(transacao.valor).toFixed(2);
        $('t-data').value = transacao.data;
        $('label-valor').textContent = 'Valor Líquido já registrado (R$) *';
        $('form-titulo-modo').textContent = 'Editar Lançamento Financeiro';
        $('btn-submit-transacao').textContent = 'Atualizar Lançamento';
        $('btn-cancelar-edicao').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        feedbackGlobal('Edição: o valor exibido é o valor líquido já gravado. A taxa não será aplicada novamente.', 'warning');
    }

    async function deletarTransacao(id) {
        if (!exigirAnalista('excluir lançamentos')) return;
        if (!confirm('Deseja realmente excluir este lançamento? Esta ação não pode ser desfeita.')) return;
        try {
            const { error } = await supabaseClient.from('transacoes').delete().eq('id', id);
            if (error) throw error;
            await carregarTransacoes();
            feedbackGlobal('Lançamento excluído com sucesso.', 'success');
        } catch (error) {
            feedbackGlobal(`Não foi possível excluir o lançamento: ${error.message}`, 'error');
        }
    }

    function cancelarEdicao() {
        $('t-edit-id').value = '';
        $('form-titulo-modo').textContent = 'Novo Lançamento Financeiro';
        $('btn-submit-transacao').textContent = '💾 Salvar Lançamento';
        $('label-valor').textContent = 'Valor Bruto (R$) *';
        $('btn-cancelar-edicao').classList.add('hidden');
        $('form-transacao').reset();
        atualizarCategorias();
        $('t-data').value = dataLocalHoje();
    }

    function mudarAba(aba) {
        if (!sessaoAtual) return;
        const permitidas = {
            recepcao: ['lancamento'],
            gerente: ['dashboard', 'lancamento', 'historico'],
            analista: ['dashboard', 'lancamento', 'historico', 'usuarios', 'logs']
        };
        if (!permitidas[sessaoAtual.perfil]?.includes(aba)) {
            feedbackGlobal('Seu perfil não tem permissão para acessar esta área.', 'error');
            aba = sessaoAtual.perfil === 'recepcao' ? 'lancamento' : 'dashboard';
        }

        Object.keys(TITULOS_ABAS).forEach(nome => {
            const secao = $(`aba-${nome}`);
            if (secao) {
                secao.classList.toggle('hidden', nome !== aba);
                secao.classList.toggle('active-tab', nome === aba);
            }
            const botao = $(`nav-btn-${nome}`);
            if (botao) botao.classList.toggle('active', nome === aba);
        });

        $('page-current-title').textContent = TITULOS_ABAS[aba][0];
        $('page-current-subtitle').textContent = TITULOS_ABAS[aba][1];
        $('main-sidebar')?.classList.remove('mobile-open');
        $('mobile-sidebar-overlay')?.classList.add('hidden');

        if (aba === 'dashboard') setTimeout(() => {
            barChartInstance?.resize();
            pieChartInstance?.resize();
        }, 100);
        if (aba === 'historico') renderTabela();
    }

        function renderCharts() {
        if (!window.Chart) return;
        const canvasBar = $('financeBarChart');
        const canvasPie = $('financePieChart');
        if (!canvasBar || !canvasPie) return;

        barChartInstance?.destroy();
        pieChartInstance?.destroy();

        barChartInstance = new Chart(canvasBar.getContext('2d'), {
            type: 'bar',
            data: { labels: ['Entradas', 'Saídas'], datasets: [{ label: 'Total (R$)', data: [0, 0], backgroundColor: ['#10b981', '#ef4444'] }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
        pieChartInstance = new Chart(canvasPie.getContext('2d'), {
            type: 'doughnut',
            data: { labels: [], datasets: [{ data: [], backgroundColor: ['#2c8c9e', '#10b981', '#ef4444', '#8ab6c1', '#64748b', '#f59e0b'] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    function updateCharts(entradas, saidas) {
        if (barChartInstance) {
            barChartInstance.data.datasets[0].data = [entradas, saidas];
            barChartInstance.update();
        }
        if (pieChartInstance) {
            const agrupado = new Map();
            transacoes.forEach(t => {
                const chave = `${t.tipo === 'entrada' ? 'Entrada' : 'Saída'} — ${t.categoria || 'Sem categoria'}`;
                agrupado.set(chave, (agrupado.get(chave) || 0) + Number(t.valor || 0));
            });
            pieChartInstance.data.labels = [...agrupado.keys()];
            pieChartInstance.data.datasets[0].data = [...agrupado.values()];
            pieChartInstance.update();
        }
    }

    function exportarCSV() {
        if (!exigirPerfil(['gerente', 'analista'])) return;
        const linhas = [
            ['Data', 'Tipo', 'Categoria', 'Profissional', 'Descrição', 'Valor líquido (R$)'],
            ...transacoes.map(t => [t.data, t.tipo, t.categoria, t.profissional || 'Geral', t.descricao, Number(t.valor).toFixed(2)])
        ];
        const csv = '\uFEFF' + linhas.map(linha => linha.map(escapeCSV).join(';')).join('\r\n');
        baixarArquivo(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'audio_sa_relatorio_financeiro.csv');
    }

    function exportarPDF() {
        if (!exigirPerfil(['gerente', 'analista'])) return;
        if (!window.jspdf?.jsPDF) return feedbackGlobal('A biblioteca jsPDF não foi carregada.', 'error');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const margem = 14;
        const largura = 182;
        let y = 18;

        doc.setFontSize(15);
        doc.text('Áudio S.A. — Relatório Financeiro', margem, y);
        y += 10;
        doc.setFontSize(9);
        doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, margem, y);
        y += 9;

        transacoes.forEach(t => {
            const linha = `${t.data} | ${(t.tipo || '').toUpperCase()} | ${t.categoria || ''} | ${money(t.valor)} | ${t.descricao || ''}`;
            const linhasTexto = doc.splitTextToSize(linha, largura);
            const altura = linhasTexto.length * 5;
            if (y + altura > 282) {
                doc.addPage();
                y = 18;
            }
            doc.text(linhasTexto, margem, y);
            y += altura + 3;
        });
        doc.save('audio_sa_relatorio_financeiro.pdf');
    }

    function baixarArquivo(blob, nome) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = nome;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function alterarSenha(evento) {
        evento.preventDefault();
        if (!sessaoAtual) return;
        const alertBox = $('modal-senha-alert');
        const atual = $('modal-senha-atual').value;
        const nova = $('modal-senha-nova').value;
        const confirma = $('modal-senha-confirma').value;

        if (nova.length < 8) return mostrarMensagem(alertBox, 'A nova senha precisa ter pelo menos 8 caracteres.', 'error');
        if (nova !== confirma) return mostrarMensagem(alertBox, 'A confirmação da nova senha não confere.', 'error');
        if (nova === atual) return mostrarMensagem(alertBox, 'Escolha uma senha diferente da atual.', 'error');

        try {
            // Reautentica para validar a senha atual e depois atualiza a senha no Auth.
            const { error: loginError } = await supabaseClient.auth.signInWithPassword({
                email: sessaoAtual.email,
                password: atual
            });
            if (loginError) throw new Error('A senha atual está incorreta.');

            const { error } = await supabaseClient.auth.updateUser({ password: nova });
            if (error) throw error;

            mostrarMensagem(alertBox, 'Senha atualizada com sucesso no Supabase Auth.', 'success');
            $('form-modal-senha').reset();
            setTimeout(fecharModalSenha, 900);
        } catch (error) {
            mostrarMensagem(alertBox, `Não foi possível atualizar a senha: ${error.message}`, 'error');
        }
    }

    function fecharModalSenha() {
        $('modal-senha')?.classList.add('hidden');
        $('form-modal-senha')?.reset();
        ocultarMensagem($('modal-senha-alert'));
    }

    function configurarTema() {
        const aplicar = (tema) => {
            document.documentElement.setAttribute('data-theme', tema);
            const escuro = tema === 'dark';
            if ($('theme-toggle-icon')) $('theme-toggle-icon').textContent = escuro ? '🌙' : '☀️';
            if ($('theme-toggle-text')) $('theme-toggle-text').textContent = escuro ? 'Modo Escuro' : 'Modo Claro';
            document.querySelectorAll('.btn-theme-toggle-auth .theme-icon').forEach(el => el.textContent = escuro ? '🌙' : '☀️');
        };
        const alternar = () => aplicar(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
        $('btn-theme-toggle')?.addEventListener('click', alternar);
        $('btn-theme-auth')?.addEventListener('click', alternar);
        aplicar(document.documentElement.getAttribute('data-theme') || 'light');
    }

    function configurarMenuMobile() {
        $('btn-toggle-mobile-menu')?.addEventListener('click', () => {
            $('main-sidebar')?.classList.add('mobile-open');
            $('mobile-sidebar-overlay')?.classList.remove('hidden');
        });
        const fechar = () => {
            $('main-sidebar')?.classList.remove('mobile-open');
            $('mobile-sidebar-overlay')?.classList.add('hidden');
        };
        $('btn-close-mobile-menu')?.addEventListener('click', fechar);
        $('mobile-sidebar-overlay')?.addEventListener('click', fechar);
    }

    function configurarOCRDemonstrativo() {
        const input = $('ocr-file-input');
        const status = $('ocr-status');
        $('btn-trigger-camera')?.addEventListener('click', () => {
            input?.setAttribute('capture', 'environment');
            input?.click();
        });
        $('btn-trigger-gallery')?.addEventListener('click', () => {
            input?.removeAttribute('capture');
            input?.click();
        });
        input?.addEventListener('change', () => {
            if (!input.files?.length) return;
            status.textContent = 'Arquivo selecionado. A extração OCR real ainda não está integrada; preencha os dados manualmente.';
            $('ocr-preview-container')?.classList.remove('hidden');
            $('ocr-prev-desc').value = '';
            $('ocr-prev-val').value = '';
        });
        $('btn-confirm-ocr')?.addEventListener('click', () => {
            const descricao = $('ocr-prev-desc').value.trim();
            const valor = Number($('ocr-prev-val').value);
            if (!descricao || !Number.isFinite(valor) || valor <= 0) {
                status.textContent = 'Informe uma descrição e um valor válido.';
                return;
            }
            $('t-tipo').value = 'saida';
            atualizarCategorias();
            $('t-descricao').value = descricao;
            $('t-valor').value = valor.toFixed(2);
            $('t-data').value = dataLocalHoje();
            $('ocr-preview-container').classList.add('hidden');
            status.textContent = 'Dados preenchidos. Revise o formulário e salve manualmente.';
            mudarAba('lancamento');
        });
        $('btn-cancel-ocr')?.addEventListener('click', () => {
            $('ocr-preview-container')?.classList.add('hidden');
            if (status) status.textContent = 'Pré-preenchimento descartado.';
            if (input) input.value = '';
        });
    }

    function configurarMonitorInatividade() {
        const reiniciar = () => {
            if (!sessaoAtual) return;
            if (monitorInatividade) clearTimeout(monitorInatividade);
            monitorInatividade = setTimeout(() => {
                feedbackGlobal('Sessão encerrada por inatividade.', 'warning');
                encerrarSessao();
            }, 30 * 60 * 1000);
        };
        ['click', 'keydown', 'mousemove', 'touchstart'].forEach(evento => {
            document.addEventListener(evento, reiniciar, { passive: true });
        });
        reiniciar();
    }

    function vincularEventos() {
        $('form-login')?.addEventListener('submit', async evento => {
            evento.preventDefault();
            const email = $('login-usuario').value.trim();
            const senha = $('login-senha').value;
            const botao = $('btn-login');
            const feedback = $('login-feedback');
            ocultarMensagem(feedback);
            botao.disabled = true;
            botao.textContent = 'Autenticando...';
            try {
                await autenticarUsuario(email, senha);
                $('form-login').reset();
                configurarMonitorInatividade();
            } catch (error) {
                mostrarMensagem(feedback, error.message || 'Falha ao autenticar.', 'error');
            } finally {
                botao.disabled = false;
                botao.textContent = 'Entrar no sistema';
            }
        });

        $('form-transacao')?.addEventListener('submit', salvarTransacao);
        $('t-tipo')?.addEventListener('change', atualizarCategorias);
        $('btn-logout')?.addEventListener('click', encerrarSessao);
        $('btn-abrir-modal-senha')?.addEventListener('click', () => $('modal-senha')?.classList.remove('hidden'));
        $('form-modal-senha')?.addEventListener('submit', alterarSenha);
        $('filtro-busca')?.addEventListener('input', filtrarHistorico);
        $('filtro-tipo')?.addEventListener('change', filtrarHistorico);
        $('btn-export-csv')?.addEventListener('click', exportarCSV);
        $('btn-export-pdf')?.addEventListener('click', exportarPDF);
    }

    // Compatibilidade com os onclick já presentes na navegação do HTML.
    window.mudarAba = mudarAba;
    window.cancelarEdicao = cancelarEdicao;
    window.fecharModalSenha = fecharModalSenha;
    window.editarTransacao = editarTransacao;
    window.deletarTransacao = deletarTransacao;
    window.filtrarHistorico = filtrarHistorico;

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            configurarSupabase();
            configurarTema();
            configurarMenuMobile();
            configurarSelects();
            configurarOCRDemonstrativo();
            renderCharts();
            vincularEventos();
            $('t-data').value = dataLocalHoje();

            supabaseClient.auth.onAuthStateChange((_evento, session) => {
                // O callback não faz consultas assíncronas para evitar bloqueio interno do Auth.
                if (!session) {
                    sessaoAtual = null;
                    $('app-dashboard')?.classList.add('hidden');
                    $('auth-screen')?.classList.remove('hidden');
                }
            });

            await sincronizarSessao();
            if (sessaoAtual) configurarMonitorInatividade();
        } catch (error) {
            const feedback = $('auth-global-feedback');
            mostrarMensagem(feedback, `Falha na inicialização: ${error.message}`, 'error');
        }
    });
})();

