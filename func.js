/* =========================================================
   ÁUDIO S.A. — SISTEMA FINANCEIRO
   Autenticação: exclusivamente Supabase Auth.
   Perfis: app_metadata.perfil = recepcao | gerente | analista.
   RLS do Supabase continua sendo a autorização real dos dados.

   Manutenção incluída:
   - Taxas de cartão por bandeira e quantidade exata de parcelas.
   - Taxa manual ou declaração explícita de operação sem taxa.
   - Registro histórico de bruto, percentual, taxa e líquido.
   - OCR de imagem e PDF no navegador, com revisão antes do formulário.
   - Custos fixos recorrentes com geração idempotente no acesso financeiro.
   - Indicadores e filtros gerenciais inspirados em BI.
   ========================================================= */

(() => {
    'use strict';

    // Configuração original do projeto. A chave publishable é pública; nunca usar service_role no frontend.
    const SUPABASE_URL = 'https://zqkdnkpttbazajqkeqac.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_fLbyK3eMhdn9LozmBSJL5A_ITUloIZ6';

    const CATEGORIAS = {
        entrada: ['Consulta', 'Procedimento/Exame PAC', 'Terapia/Treinamento Auditivo', 'Aparelho Auditivo', 'Outros'],
        saida: ['Custo fixo', 'Insumos/Procedimentos', 'Aparelhos/Produtos', 'Pessoal/Comissões', 'Taxas/Impostos', 'Outros/Excepcionais']
    };

    const PROFISSIONAIS = ['Dra Amanda', 'Dra Eleonora', 'Dra Márcia', 'Dra Simone', 'Outro'];
    const PERFIS_VALIDOS = ['recepcao', 'gerente', 'analista'];
    const MAX_PAGINAS_OCR = 15;
    const MAX_OCORRENCIAS_POR_REGRA = 36;
    const MAX_BUSCA_HISTORICO_RECORRENCIA = 100000;

    // Todos os percentuais recebidos foram marcados como aproximados.
    // null representa taxa não informada; nunca deve ser interpretado como 0%.
    const TAXAS_CARTAO = {
        Mastercard: {
            debito: 1.01,
            credito_vista: 4.81,
            parcelado: { 2: 7.00, 3: 8.29, 4: 9.59, 5: 10.88, 6: 12.18, 7: 14.13, 8: 15.43, 9: 16.73, 10: 18.02, 11: null, 12: null }
        },
        Visa: {
            debito: 1.28,
            credito_vista: 4.91,
            parcelado: { 2: 6.98, 3: 8.27, 4: 9.57, 5: 10.86, 6: 12.16, 7: 14.38, 8: 15.68, 9: 16.97, 10: 18.27, 11: null, 12: null }
        },
        Elo: {
            debito: 1.43,
            credito_vista: 5.17,
            parcelado: { 2: 7.53, 3: 8.82, 4: 10.12, 5: 11.41, 6: 12.71, 7: 14.68, 8: 15.98, 9: 17.27, 10: 18.57, 11: null, 12: null }
        },
        Amex: {
            debito: null,
            credito_vista: 5.89,
            parcelado: { 2: 8.03, 3: 9.32, 4: 10.62, 5: 11.91, 6: 13.21, 7: 14.82, 8: 16.12, 9: 17.41, 10: 18.71, 11: 20.00, 12: null }
        }
    };

    const TITULOS_ABAS = {
        dashboard: ['Dashboard Executivo', 'Visão geral dos indicadores financeiros da clínica.'],
        lancamento: ['Novo Lançamento', 'Registre uma entrada ou saída financeira.'],
        historico: ['Histórico & Gestão', 'Consulte, filtre e exporte os lançamentos.'],
        usuarios: ['Gerenciar Usuários', 'Área administrativa exclusiva do Analista.'],
        logs: ['Logs de Auditoria', 'Rastreabilidade das operações do sistema.']
    };

    let canalTransacoes = null;
    let temporizadorRealtime = null;
    let supabaseClient = null;
    let sessaoAtual = null;
    let transacoes = [];
    let recorrencias = [];
    let barChartInstance = null;
    let pieChartInstance = null;
    let lineChartInstance = null;
    let cardChartInstance = null;
    let carregando = false;
    let monitorInatividade = null;
    let estadoEdicao = null;
    let suprimindoMudancaFinanceira = false;
    let recorrenciasProcessadasNaSessao = false;
    let arquivoOCRAtual = null;
    let textoOCRAtual = '';
    let assinaturaPagamentoAnterior = '';

    const $ = (id) => document.getElementById(id);
    const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const percent = (value) => `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;

    function arredondarCentavos(valor) {
        return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
    }

    function escapeCSV(value) {
        const texto = String(value ?? '');
        const seguro = /^[\s]*[=+\-@]/.test(texto) ? `'${texto}` : texto;
        return `"${seguro.replace(/"/g, '""')}"`;
    }

    function gerarId() {
        return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function dataLocalHoje() {
        const agora = new Date();
        return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
    }

    function formatarData(data) {
        if (!data) return '—';
        const partes = String(data).slice(0, 10).split('-');
        if (partes.length !== 3) return String(data);
        return `${partes[2]}/${partes[1]}/${partes[0]}`;
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
        mostrarMensagem($('global-feedback'), mensagem, tipo);
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
            throw new Error('A biblioteca do Supabase não foi carregada. Verifique a conexão e o script CDN.');
        }
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
        });
    }

    // Assina mudanças somente depois que o perfil financeiro foi autorizado.
    // A RLS continua sendo a barreira real; a assinatura apenas atualiza a interface.
    function configurarRealtimeTransacoes() {
        if (!exigirPerfil(['gerente', 'analista']) || !supabaseClient || canalTransacoes) return;

        canalTransacoes = supabaseClient
            .channel('audio-sa-transacoes-dashboard')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'transacoes'
            }, () => {
                if (temporizadorRealtime) clearTimeout(temporizadorRealtime);
                temporizadorRealtime = setTimeout(() => {
                    temporizadorRealtime = null;
                    if (exigirPerfil(['gerente', 'analista']) && !carregando) {
                        carregarTransacoes();
                    }
                }, 350);
            })
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error('Falha na assinatura Realtime de transacoes:', status);
                    feedbackGlobal('A atualização automática não está disponível. Atualize a página para buscar os dados mais recentes.', 'warning');
                }
            });
    }

    async function removerRealtimeTransacoes() {
        if (temporizadorRealtime) {
            clearTimeout(temporizadorRealtime);
            temporizadorRealtime = null;
        }
        if (canalTransacoes && supabaseClient) {
            const canal = canalTransacoes;
            canalTransacoes = null;
            try {
                await supabaseClient.removeChannel(canal);
            } catch (error) {
                console.warn('Não foi possível encerrar o canal Realtime:', error);
            }
        }
    }

    function configurarSelects() {
        const profissional = $('t-profissional');
        if (profissional) {
            profissional.replaceChildren();
            PROFISSIONAIS.forEach(nome => {
                const option = document.createElement('option');
                option.value = nome;
                option.textContent = nome;
                profissional.appendChild(option);
            });
        }
        atualizarCategorias();
    }

    function atualizarCategorias() {
        const tipo = $('t-tipo')?.value || 'entrada';
        const categoria = $('t-categoria');
        if (!categoria) return;
        const valorAnterior = categoria.value;
        categoria.replaceChildren();
        (CATEGORIAS[tipo] || []).forEach(nome => {
            const option = document.createElement('option');
            option.value = nome;
            option.textContent = nome;
            categoria.appendChild(option);
        });
        if ((CATEGORIAS[tipo] || []).includes(valorAnterior)) categoria.value = valorAnterior;

        const entrada = tipo === 'entrada';
        definirVisibilidade($('campo-profissional'), entrada, 'block');
        definirVisibilidade($('campo-pagamento'), entrada, 'block');
        const profissional = $('t-profissional');
        if (profissional) profissional.required = entrada;
        const pagamento = $('t-forma-pagamento');
        if (pagamento) pagamento.required = entrada;
        atualizarCamposPagamento({ ajustarModo: true });
        atualizarCampoRecorrencia();
    }

    function obterTaxaTabela(bandeira, forma, parcelas) {
        const cartao = TAXAS_CARTAO[bandeira];
        if (!cartao) return null;
        if (forma === 'Débito') return cartao.debito;
        if (forma === 'Crédito à vista') return cartao.credito_vista;
        if (forma === 'Crédito Parcelado') {
            if (!parcelas) return null;
            return Object.prototype.hasOwnProperty.call(cartao.parcelado, parcelas) ? cartao.parcelado[parcelas] : null;
        }
        return 0;
    }

    function obterContextoTaxa() {
        const forma = $('t-forma-pagamento')?.value || '';
        const bandeira = $('t-bandeira')?.value || '';
        const parcelas = Number($('t-parcelas')?.value || 0);
        const entradaComCartao = ['Débito', 'Crédito à vista', 'Crédito Parcelado'].includes(forma);
        if (!entradaComCartao) return { entradaComCartao: false, taxaTabela: 0, bandeira: '', parcelas: null };
        const taxaTabela = obterTaxaTabela(bandeira, forma, parcelas);
        return { entradaComCartao: true, taxaTabela, bandeira, parcelas: forma === 'Crédito Parcelado' ? parcelas : null };
    }

    function atualizarCamposPagamento({ ajustarModo = false } = {}) {
        const entrada = $('t-tipo')?.value === 'entrada';
        const forma = $('t-forma-pagamento')?.value || 'PIX';
        const cartao = entrada && ['Débito', 'Crédito à vista', 'Crédito Parcelado'].includes(forma);
        const parcelado = cartao && forma === 'Crédito Parcelado';
        const assinaturaAtual = `${entrada ? 'entrada' : 'saida'}|${forma}|${$('t-bandeira')?.value || ''}|${$('t-parcelas')?.value || ''}`;
        definirVisibilidade($('campo-bandeira'), cartao, 'block');
        definirVisibilidade($('campo-parcelas'), parcelado, 'block');
        definirVisibilidade($('campo-modo-taxa'), cartao, 'block');

        if (!cartao) {
            if ($('t-bandeira')) $('t-bandeira').value = '';
            if ($('t-parcelas')) $('t-parcelas').value = '';
            if ($('t-modo-taxa')) $('t-modo-taxa').value = 'sem_taxa';
            if ($('t-bandeira')) $('t-bandeira').required = false;
            if ($('t-parcelas')) $('t-parcelas').required = false;
            assinaturaPagamentoAnterior = assinaturaAtual;
            definirVisibilidade($('campo-taxa-manual'), false);
            definirVisibilidade($('campo-confirmacao-taxa'), false);
            atualizarPreviaFinanceira();
            return;
        }

        const contexto = obterContextoTaxa();
        const modo = $('t-modo-taxa');
        if (ajustarModo && !suprimindoMudancaFinanceira && !estadoEdicao) {
            const mudouContexto = assinaturaAtual !== assinaturaPagamentoAnterior;
            if (mudouContexto) {
                // Evita reaproveitar uma taxa manual/declaração de não cobrança de outra bandeira ou parcela.
                if ($('t-confirmar-taxa')) $('t-confirmar-taxa').checked = false;
                if ($('t-taxa-manual')) $('t-taxa-manual').value = '';
                modo.value = contexto.taxaTabela !== null ? 'tabela' : 'pendente';
            } else {
                if (contexto.taxaTabela !== null && modo.value === 'pendente') modo.value = 'tabela';
                if (contexto.taxaTabela === null && modo.value === 'tabela') modo.value = 'pendente';
                if (contexto.taxaTabela === null && !modo.value) modo.value = 'pendente';
            }
        }
        assinaturaPagamentoAnterior = assinaturaAtual;
        if ($('t-bandeira')) $('t-bandeira').required = cartao;
        if ($('t-parcelas')) $('t-parcelas').required = parcelado;
        if ($('t-modo-taxa')) $('t-modo-taxa').required = cartao;

        const modoAtual = modo?.value || 'pendente';
        const manual = modoAtual === 'manual';
        const exigeConfirmacao = manual || modoAtual === 'sem_taxa';
        definirVisibilidade($('campo-taxa-manual'), manual, 'block');
        definirVisibilidade($('campo-confirmacao-taxa'), exigeConfirmacao, 'block');
        if ($('t-taxa-manual')) $('t-taxa-manual').required = manual;
        if ($('t-confirmar-taxa')) $('t-confirmar-taxa').required = exigeConfirmacao;
        const aviso = $('aviso-responsabilidade-taxa');
        if (aviso) aviso.textContent = manual
            ? 'A taxa informada manualmente será registrada como declaração do usuário responsável pelo lançamento. Confira a taxa total junto à operadora.'
            : 'Você está declarando que esta operação não teve desconto da operadora. Essa declaração ficará registrada no lançamento.';
        atualizarPreviaFinanceira();
    }

    function atualizarCampoRecorrencia() {
        const podeCriar = exigirPerfil(['gerente', 'analista']);
        const custoFixo = $('t-tipo')?.value === 'saida' && $('t-categoria')?.value === 'Custo fixo';
        definirVisibilidade($('campo-recorrencia'), podeCriar && custoFixo && !estadoEdicao, 'block');
        if ((!custoFixo || !podeCriar || estadoEdicao) && $('t-recorrencia')) $('t-recorrencia').value = 'nenhuma';
    }

    function calcularComposicaoFinanceira(valorBruto, { permitirPendente = false } = {}) {
        const bruto = Number(valorBruto);
        if (!Number.isFinite(bruto) || bruto <= 0) return { valido: false, mensagem: 'Informe um valor bruto maior que zero.' };

        if ($('t-tipo')?.value === 'saida') {
            return { valido: true, valor_bruto: arredondarCentavos(bruto), taxa_percentual: 0, valor_taxa: 0, valor_liquido: arredondarCentavos(bruto), valor_operacional: arredondarCentavos(bruto), taxa_modo: 'sem_taxa_declarada', taxa_provisoria: false, taxa_confirmada_usuario: false, forma_pagamento: null, bandeira: null, parcelas: null };
        }

        const contexto = obterContextoTaxa();
        if (!contexto.entradaComCartao) {
            const valor = arredondarCentavos(bruto);
            return { valido: true, valor_bruto: valor, taxa_percentual: 0, valor_taxa: 0, valor_liquido: valor, valor_operacional: valor, taxa_modo: 'sem_taxa_declarada', taxa_provisoria: false, taxa_confirmada_usuario: false, forma_pagamento: $('t-forma-pagamento')?.value || 'PIX', bandeira: null, parcelas: null };
        }

        const modo = $('t-modo-taxa')?.value || 'pendente';
        let taxaPercentual = null;
        let taxaModo = '';
        let taxaProvisoria = false;
        let confirmada = false;

        if (modo === 'tabela') {
            if (contexto.taxaTabela === null) {
                return { valido: false, mensagem: 'Não existe taxa cadastrada para esta combinação. Informe uma taxa manual ou declare explicitamente que a operação não teve taxa.' };
            }
            taxaPercentual = contexto.taxaTabela;
            taxaModo = 'tabela_provisoria';
            taxaProvisoria = true;
        } else if (modo === 'manual') {
            const manual = Number($('t-taxa-manual')?.value);
            if (!Number.isFinite(manual) || manual <= 0 || manual > 100) return { valido: false, mensagem: 'Informe uma taxa manual maior que 0% e até 100%.' };
            if (!$('t-confirmar-taxa')?.checked) return { valido: false, mensagem: 'Confirme que você é responsável pela veracidade da taxa informada manualmente.' };
            taxaPercentual = manual;
            taxaModo = 'manual_usuario';
            confirmada = true;
        } else if (modo === 'sem_taxa') {
            if (!$('t-confirmar-taxa')?.checked) return { valido: false, mensagem: 'Confirme que a operação realmente não teve taxa da operadora.' };
            taxaPercentual = 0;
            taxaModo = 'sem_taxa_declarada';
            confirmada = true;
        } else if (permitirPendente) {
            return { valido: false, mensagem: 'A taxa desta combinação está pendente. Escolha taxa manual ou sem taxa.' };
        } else {
            return { valido: false, mensagem: 'Selecione como a taxa desta operação será tratada.' };
        }

        const valorTaxa = arredondarCentavos(bruto * (taxaPercentual / 100));
        const valorLiquido = arredondarCentavos(bruto - valorTaxa);
        return {
            valido: true,
            valor_bruto: arredondarCentavos(bruto),
            taxa_percentual: taxaPercentual,
            valor_taxa: valorTaxa,
            valor_liquido: valorLiquido,
            valor_operacional: valorLiquido,
            taxa_modo: taxaModo,
            taxa_provisoria: taxaProvisoria,
            taxa_confirmada_usuario: confirmada,
            forma_pagamento: $('t-forma-pagamento').value,
            bandeira: contexto.bandeira || null,
            parcelas: contexto.parcelas
        };
    }

    function composicaoDaTransacao(transacao) {
        // Em saídas antigas, o valor da despesa já é conhecido e não há desconto de cartão a reconstruir.
        if (transacao.tipo === 'saida' && transacao.valor !== null && transacao.valor !== undefined) {
            const valorSaida = Number(transacao.valor) || 0;
            return { completa: true, bruto: valorSaida, liquido: valorSaida, taxa: 0, percentual: 0 };
        }
        const bruto = transacao.valor_bruto;
        const liquido = transacao.valor_liquido;
        const taxa = transacao.valor_taxa;
        const completa = bruto !== null && bruto !== undefined && liquido !== null && liquido !== undefined && taxa !== null && taxa !== undefined;
        return { completa, bruto: completa ? Number(bruto) : null, liquido: completa ? Number(liquido) : null, taxa: completa ? Number(taxa) : null, percentual: transacao.taxa_percentual === null || transacao.taxa_percentual === undefined ? null : Number(transacao.taxa_percentual) };
    }

    function atualizarPreviaFinanceira() {
        const valor = Number($('t-valor')?.value || 0);
        const ids = ['previa-bruto', 'previa-percentual', 'previa-valor-taxa', 'previa-liquido', 'previa-operacional'];
        if (ids.some(id => !$(id))) return;

        if (estadoEdicao?.legado) {
            $('previa-bruto').textContent = 'Não disponível';
            $('previa-percentual').textContent = 'Não disponível';
            $('previa-valor-taxa').textContent = 'Não disponível';
            $('previa-liquido').textContent = 'Não disponível';
            $('previa-operacional').textContent = money(estadoEdicao.transacao.valor);
            mostrarMensagem($('taxa-status'), 'Registro antigo sem composição financeira salva. O valor operacional será preservado; não é possível reconstruir bruto e taxa com segurança.', 'warning');
            return;
        }

        if (estadoEdicao?.snapshotDisponivel && !estadoEdicao.financeDirty) {
            const c = composicaoDaTransacao(estadoEdicao.transacao);
            $('previa-bruto').textContent = money(c.bruto);
            $('previa-percentual').textContent = percent(c.percentual);
            $('previa-valor-taxa').textContent = money(c.taxa);
            $('previa-liquido').textContent = money(c.liquido);
            $('previa-operacional').textContent = money(estadoEdicao.transacao.valor);
            mostrarMensagem($('taxa-status'), 'Composição histórica original. Abrir o lançamento não recalcula nem modifica os valores.', 'success');
            return;
        }

        const calculo = calcularComposicaoFinanceira(valor);
        if (!Number.isFinite(valor) || valor <= 0) {
            $('previa-bruto').textContent = money(0);
            $('previa-percentual').textContent = '—';
            $('previa-valor-taxa').textContent = money(0);
            $('previa-liquido').textContent = money(0);
            $('previa-operacional').textContent = money(0);
            mostrarMensagem($('taxa-status'), 'Preencha o valor para visualizar a composição.', 'info');
            return;
        }
        if (!calculo.valido) {
            $('previa-bruto').textContent = money(valor);
            $('previa-percentual').textContent = 'Pendente';
            $('previa-valor-taxa').textContent = '—';
            $('previa-liquido').textContent = '—';
            $('previa-operacional').textContent = '—';
            mostrarMensagem($('taxa-status'), calculo.mensagem, 'warning');
            return;
        }
        $('previa-bruto').textContent = money(calculo.valor_bruto);
        $('previa-percentual').textContent = percent(calculo.taxa_percentual);
        $('previa-valor-taxa').textContent = money(calculo.valor_taxa);
        $('previa-liquido').textContent = money(calculo.valor_liquido);
        $('previa-operacional').textContent = money(calculo.valor_operacional);
        const texto = calculo.taxa_provisoria
            ? 'Cálculo usando percentual aproximado da tabela fornecida. Confira a taxa contratual da operadora.'
            : calculo.taxa_modo === 'manual_usuario'
                ? 'Taxa manual confirmada pelo usuário responsável.'
                : calculo.taxa_modo === 'sem_taxa_declarada'
                    ? 'Operação declarada sem desconto de taxa.'
                    : 'Operação sem taxa de cartão.';
        mostrarMensagem($('taxa-status'), texto, calculo.taxa_provisoria ? 'warning' : 'success');
    }

    function marcarAlteracaoFinanceira() {
        if (suprimindoMudancaFinanceira) return;
        if (estadoEdicao && estadoEdicao.snapshotDisponivel) estadoEdicao.financeDirty = true;
        atualizarPreviaFinanceira();
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
        if ($('user-role-badge')) $('user-role-badge').textContent = `Perfil: ${perfil.toUpperCase()}`;
        if ($('user-name-display')) $('user-name-display').textContent = sessaoAtual.nome || sessaoAtual.email || 'Usuário';

        definirVisibilidade($('nav-btn-dashboard'), podeVerFinanceiro);
        definirVisibilidade($('nav-btn-lancamento'), true);
        definirVisibilidade($('nav-btn-historico'), podeVerFinanceiro);
        definirVisibilidade($('nav-btn-usuarios'), analista);
        definirVisibilidade($('nav-btn-logs'), analista);
        // OCR é uma ferramenta de entrada de dados, não um painel consolidado; também fica disponível à recepção.
        definirVisibilidade($('secao-ocr'), true, 'block');
        definirVisibilidade($('acoes-analista'), podeVerFinanceiro, 'flex');
        definirVisibilidade($('th-acoes'), analista, 'table-cell');
        definirVisibilidade($('recorrencias-container'), podeVerFinanceiro, 'block');

        configurarSelects();
        if (recepcao) {
            transacoes = [];
            limparDashboard();
            renderTabela();
            mudarAba('lancamento');
        } else {
            mudarAba('dashboard');
            iniciarAreaFinanceira();
        }
        atualizarCampoRecorrencia();
    }

    async function iniciarAreaFinanceira() {
        if (!exigirPerfil(['gerente', 'analista'])) return;
        try {
            await processarCustosRecorrentesAoAbrir();
        } catch (error) {
            feedbackGlobal(`A geração de custos recorrentes não foi concluída: ${error.message}`, 'warning');
        }
        await carregarTransacoes();
        await carregarRecorrencias();
        configurarRealtimeTransacoes();
    }

    function limparDashboard() {
        ['total-entradas', 'total-saidas', 'saldo-liquido', 'bi-total-bruto', 'bi-total-taxas', 'bi-total-liquido', 'bi-ticket-medio'].forEach(id => {
            if ($(id)) $(id).textContent = money(0);
        });
        ['bi-taxa-efetiva'].forEach(id => { if ($(id)) $(id).textContent = '—'; });
        ['bi-quantidade', 'bi-legado-count'].forEach(id => { if ($(id)) $(id).textContent = '0'; });
        if (barChartInstance) { barChartInstance.data.datasets[0].data = [0, 0]; barChartInstance.update(); }
        if (pieChartInstance) { pieChartInstance.data.labels = []; pieChartInstance.data.datasets[0].data = []; pieChartInstance.update(); }
        if (lineChartInstance) { lineChartInstance.data.labels = []; lineChartInstance.data.datasets.forEach(dataset => { dataset.data = []; }); lineChartInstance.update(); }
        if (cardChartInstance) { cardChartInstance.data.labels = []; cardChartInstance.data.datasets[0].data = []; cardChartInstance.update(); }
    }

    async function autenticarUsuario(email, senha) {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        if (!data.user) throw new Error('O Supabase não retornou um usuário autenticado.');
        const perfil = data.user.app_metadata?.perfil;
        if (!PERFIS_VALIDOS.includes(perfil)) {
            await supabaseClient.auth.signOut();
            throw new Error('Este usuário não possui um perfil válido em app_metadata.perfil. Solicite ao administrador a correção no Supabase.');
        }
        sessaoAtual = {
            id: data.user.id,
            email: data.user.email,
            nome: data.user.user_metadata?.nome || data.user.app_metadata?.nome || data.user.email,
            perfil
        };
        recorrenciasProcessadasNaSessao = false;
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
            recorrencias = [];
            recorrenciasProcessadasNaSessao = false;
            await removerRealtimeTransacoes();
            window.location.reload();
        } catch (error) {
            feedbackGlobal(`Não foi possível encerrar a sessão: ${error.message}`, 'error');
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
            nome: user.user_metadata?.nome || user.app_metadata?.nome || user.email,
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
                .select('id,tipo,categoria,profissional,descricao,valor,data,created_at,valor_bruto,forma_pagamento,bandeira,parcelas,taxa_percentual,taxa_modo,valor_taxa,valor_liquido,taxa_confirmada_usuario,taxa_provisoria,recorrencia_id,recorrencia_data')
                .order('data', { ascending: false })
                .order('created_at', { ascending: false });
            if (error) throw error;
            transacoes = (data || []).map(t => ({ ...t, valor: Number(t.valor) || 0 }));
            atualizarOpcoesFiltrosDashboard();
            atualizarDashboardVisual();
        } catch (error) {
            transacoes = [];
            atualizarDashboardVisual();
            feedbackGlobal(`Erro ao carregar transações do Supabase. Confirme se a migração SQL dos campos financeiros foi aplicada: ${error.message}`, 'error');
        }
        renderTabela();
    }

    function obterTransacoesFiltradasDashboard() {
        const inicio = $('filtro-dashboard-inicio')?.value || '';
        const fim = $('filtro-dashboard-fim')?.value || '';
        const categoria = $('filtro-dashboard-categoria')?.value || 'todas';
        const profissional = $('filtro-dashboard-profissional')?.value || 'todos';
        const pagamento = $('filtro-dashboard-pagamento')?.value || 'todos';
        const bandeira = $('filtro-dashboard-bandeira')?.value || 'todas';
        return transacoes.filter(t => {
            const data = String(t.data || '').slice(0, 10);
            if (inicio && data < inicio) return false;
            if (fim && data > fim) return false;
            if (categoria !== 'todas' && t.categoria !== categoria) return false;
            if (profissional !== 'todos' && (t.profissional || 'Geral') !== profissional) return false;
            if (pagamento !== 'todos' && (t.forma_pagamento || '') !== pagamento) return false;
            if (bandeira !== 'todas' && (t.bandeira || '') !== bandeira) return false;
            return true;
        });
    }

    function atualizarOpcoesFiltrosDashboard() {
        const filtros = [
            { id: 'filtro-dashboard-categoria', values: [...new Set(transacoes.map(t => t.categoria).filter(Boolean))].sort(), first: ['todas', 'Todas'] },
            { id: 'filtro-dashboard-profissional', values: [...new Set(transacoes.map(t => t.profissional || 'Geral').filter(Boolean))].sort(), first: ['todos', 'Todos'] }
        ];
        filtros.forEach(filtro => {
            const select = $(filtro.id);
            if (!select) return;
            const atual = select.value;
            select.replaceChildren();
            const primeira = document.createElement('option');
            primeira.value = filtro.first[0];
            primeira.textContent = filtro.first[1];
            select.appendChild(primeira);
            filtro.values.forEach(valor => {
                const option = document.createElement('option');
                option.value = valor;
                option.textContent = valor;
                select.appendChild(option);
            });
            if ([filtro.first[0], ...filtro.values].includes(atual)) select.value = atual;
        });
    }

    function atualizarDashboardVisual() {
        if (!exigirPerfil(['gerente', 'analista'])) return limparDashboard();
        const lista = obterTransacoesFiltradasDashboard();
        const entradas = lista.filter(t => t.tipo === 'entrada');
        const saidas = lista.filter(t => t.tipo === 'saida');
        const entradasOperacionais = entradas.reduce((soma, t) => soma + Number(t.valor || 0), 0);
        const totalSaidas = saidas.reduce((soma, t) => soma + Number(t.valor || 0), 0);
        const saldoOperacional = entradasOperacionais - totalSaidas;
        const completas = entradas.filter(t => t.valor_bruto !== null && t.valor_bruto !== undefined && t.valor_liquido !== null && t.valor_liquido !== undefined && t.valor_taxa !== null && t.valor_taxa !== undefined);
        const brutoDocumentado = completas.reduce((soma, t) => soma + Number(t.valor_bruto || 0), 0);
        const taxasDocumentadas = completas.reduce((soma, t) => soma + Number(t.valor_taxa || 0), 0);
        const liquidoDocumentado = completas.reduce((soma, t) => soma + Number(t.valor_liquido || 0), 0);
        const cartoesDocumentados = completas.filter(t => ['Débito', 'Crédito à vista', 'Crédito Parcelado'].includes(t.forma_pagamento));
        const brutoCartao = cartoesDocumentados.reduce((soma, t) => soma + Number(t.valor_bruto || 0), 0);
        const taxasCartao = cartoesDocumentados.reduce((soma, t) => soma + Number(t.valor_taxa || 0), 0);
        const legado = entradas.length - completas.length;

        $('total-entradas').textContent = money(entradasOperacionais);
        $('total-saidas').textContent = money(totalSaidas);
        $('saldo-liquido').textContent = money(saldoOperacional);
        $('bi-total-bruto').textContent = money(brutoDocumentado);
        $('bi-total-taxas').textContent = money(taxasDocumentadas);
        $('bi-total-liquido').textContent = money(liquidoDocumentado);
        $('bi-taxa-efetiva').textContent = brutoCartao > 0 ? percent((taxasCartao / brutoCartao) * 100) : '—';
        $('bi-ticket-medio').textContent = entradas.length ? money(entradasOperacionais / entradas.length) : money(0);
        $('bi-quantidade').textContent = String(lista.length);
        $('bi-legado-count').textContent = String(legado);
        const aviso = $('bi-qualidade-aviso');
        if (aviso) aviso.textContent = legado > 0
            ? `${legado} entrada(s) do filtro não possuem composição financeira histórica completa. Esses registros continuam no valor operacional, mas foram excluídos dos totais documentados de bruto, taxa e líquido.`
            : 'Todos os recebimentos deste filtro possuem composição financeira registrada. Confira os percentuais aproximados da tabela antes de interpretar o custo definitivo da operadora.';
        updateCharts(lista, entradasOperacionais, totalSaidas);
    }

    function renderTabela() {
        const tbody = $('transacoes-list');
        if (!tbody) return;
        tbody.replaceChildren();
        if (!exigirPerfil(['gerente', 'analista'])) return;

        const busca = ($('filtro-busca')?.value || '').trim().toLocaleLowerCase('pt-BR');
        const tipoFiltro = $('filtro-tipo')?.value || 'todos';
        const lista = transacoes.filter(t => {
            const texto = `${t.categoria || ''} ${t.descricao || ''} ${t.profissional || ''} ${t.bandeira || ''}`.toLocaleLowerCase('pt-BR');
            return (tipoFiltro === 'todos' || t.tipo === tipoFiltro) && (!busca || texto.includes(busca));
        });

        if (!lista.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = sessaoAtual?.perfil === 'analista' ? 11 : 10;
            td.textContent = 'Nenhum lançamento encontrado.';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        lista.forEach(t => {
            const tr = document.createElement('tr');
            const c = composicaoDaTransacao(t);
            const valores = [
                formatarData(t.data),
                (t.tipo || '').toUpperCase(),
                t.categoria || '',
                t.descricao || '',
                [t.forma_pagamento, t.bandeira, t.parcelas ? `${t.parcelas}x` : ''].filter(Boolean).join(' · ') || '—',
                c.completa ? money(c.bruto) : 'Histórico indisponível',
                c.percentual === null ? '—' : percent(c.percentual),
                c.completa ? money(c.taxa) : '—',
                c.completa ? money(c.liquido) : 'Histórico indisponível',
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
                editar.type = 'button'; editar.textContent = 'Editar'; editar.className = 'btn-outline';
                editar.addEventListener('click', () => editarTransacao(t.id));
                const excluir = document.createElement('button');
                excluir.type = 'button'; excluir.textContent = 'Excluir'; excluir.className = 'btn-outline';
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

    function obterFormaTaxaDoRegistro(transacao) {
        if (transacao.taxa_modo === 'tabela_provisoria') return 'tabela';
        if (transacao.taxa_modo === 'manual_usuario') return 'manual';
        if (transacao.taxa_modo === 'sem_taxa_declarada') return 'sem_taxa';
        return 'pendente';
    }

    function editarTransacao(id) {
        if (!exigirAnalista('editar lançamentos')) return;
        const transacao = transacoes.find(t => String(t.id) === String(id));
        if (!transacao) return feedbackGlobal('Lançamento não encontrado na lista atual.', 'error');
        const composicao = composicaoDaTransacao(transacao);
        estadoEdicao = { transacao, snapshotDisponivel: composicao.completa, legado: !composicao.completa, financeDirty: false };
        suprimindoMudancaFinanceira = true;

        mudarAba('lancamento');
        $('t-edit-id').value = String(transacao.id);
        $('t-tipo').value = transacao.tipo;
        atualizarCategorias();
        $('t-categoria').value = transacao.categoria;
        $('t-profissional').value = transacao.profissional || PROFISSIONAIS[0];
        $('t-descricao').value = String(transacao.descricao || '').replace(/\s+\((PIX|Débito|Crédito à vista|Crédito Parcelado)(?:\s+-\s+[^)]+)?\)\s*$/, '');
        $('t-data').value = transacao.data;

        const camposFinanceiros = ['t-tipo', 't-valor', 't-forma-pagamento', 't-bandeira', 't-parcelas', 't-modo-taxa', 't-taxa-manual', 't-confirmar-taxa'];
        if (composicao.completa) {
            $('t-valor').value = Number(transacao.valor_bruto ?? transacao.valor).toFixed(2);
            $('label-valor').textContent = 'Valor Bruto Original (R$) *';
            $('t-forma-pagamento').value = transacao.forma_pagamento || 'PIX';
            $('t-bandeira').value = transacao.bandeira || '';
            $('t-parcelas').value = transacao.parcelas ? String(transacao.parcelas) : '';
            $('t-modo-taxa').value = obterFormaTaxaDoRegistro(transacao);
            $('t-taxa-manual').value = transacao.taxa_modo === 'manual_usuario' ? Number(transacao.taxa_percentual).toString() : '';
            $('t-confirmar-taxa').checked = Boolean(transacao.taxa_confirmada_usuario);
            camposFinanceiros.forEach(idCampo => { if ($(idCampo)) $(idCampo).disabled = false; });
            atualizarCamposPagamento({ ajustarModo: false });
            $('form-titulo-modo').textContent = 'Editar Lançamento Financeiro';
            $('btn-submit-transacao').textContent = 'Atualizar Lançamento';
            $('btn-cancelar-edicao').classList.remove('hidden');
            mostrarMensagem($('taxa-status'), 'Composição original carregada. Nenhum valor será recalculado enquanto você não alterar os campos financeiros.', 'success');
        } else {
            $('t-valor').value = Number(transacao.valor).toFixed(2);
            $('label-valor').textContent = 'Valor operacional já registrado (R$)';
            camposFinanceiros.forEach(idCampo => { if ($(idCampo)) $(idCampo).disabled = true; });
            $('t-valor').readOnly = true;
            $('form-titulo-modo').textContent = 'Editar Lançamento Histórico';
            $('btn-submit-transacao').textContent = 'Atualizar Dados do Lançamento';
            $('btn-cancelar-edicao').classList.remove('hidden');
            mostrarMensagem($('taxa-status'), 'Registro antigo sem composição financeira completa. Tipo e valor operacional foram bloqueados para impedir alteração financeira sem histórico verificável.', 'warning');
        }
        atualizarCampoRecorrencia();
        suprimindoMudancaFinanceira = false;
        atualizarPreviaFinanceira();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function obterDescricaoFinal(descricao, formaPagamento, bandeira, parcelas) {
        const detalhe = formaPagamento
            ? ` (${formaPagamento}${bandeira ? ` - ${bandeira}` : ''}${parcelas ? ` - ${parcelas}x` : ''})`
            : '';
        return `${descricao.trim()}${detalhe}`;
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
        if (!descricaoBase || !categoria || !data) {
            feedbackGlobal('Preencha a descrição, categoria e data.', 'error');
            return;
        }
        if (!editando || !estadoEdicao?.legado) {
            if (!Number.isFinite(valorInformado) || valorInformado <= 0) {
                feedbackGlobal('Informe um valor maior que zero.', 'error');
                return;
            }
        }

        let payload = {
            tipo,
            categoria,
            profissional,
            descricao: descricaoBase,
            data
        };

        if (editando && estadoEdicao?.legado) {
            // Registros antigos sem composição: só campos não financeiros são alterados.
            payload.tipo = estadoEdicao.transacao.tipo;
            payload.valor = Number(estadoEdicao.transacao.valor);
        } else if (editando && estadoEdicao?.snapshotDisponivel && !estadoEdicao.financeDirty) {
            // Abrir/editar sem tocar nos campos financeiros preserva exatamente o snapshot histórico.
            payload.valor = Number(estadoEdicao.transacao.valor);
        } else {
            const calculo = calcularComposicaoFinanceira(valorInformado);
            if (!calculo.valido) {
                feedbackGlobal(calculo.mensagem, 'error');
                atualizarPreviaFinanceira();
                return;
            }
            payload = {
                ...payload,
                valor: calculo.valor_operacional,
                valor_bruto: calculo.valor_bruto,
                forma_pagamento: calculo.forma_pagamento,
                bandeira: calculo.bandeira,
                parcelas: calculo.parcelas,
                taxa_percentual: calculo.taxa_percentual,
                taxa_modo: calculo.taxa_modo,
                valor_taxa: calculo.valor_taxa,
                valor_liquido: calculo.valor_liquido,
                taxa_confirmada_usuario: calculo.taxa_confirmada_usuario,
                taxa_provisoria: calculo.taxa_provisoria
            };
        }

        const frequencia = !editando && tipo === 'saida' && categoria === 'Custo fixo' ? ($('t-recorrencia')?.value || 'nenhuma') : 'nenhuma';
        if (frequencia !== 'nenhuma' && !exigirPerfil(['gerente', 'analista'])) {
            feedbackGlobal('Somente Gerência ou Analista pode cadastrar uma regra de custo fixo recorrente.', 'error');
            return;
        }

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
                payload.id = gerarId();
                if (frequencia !== 'nenhuma') {
                    const recorrenciaId = gerarId();
                    payload.recorrencia_id = recorrenciaId;
                    payload.recorrencia_data = data;
                    const novaRegra = {
                        id: recorrenciaId,
                        categoria,
                        profissional,
                        descricao: descricaoBase,
                        valor: Number(valorInformado.toFixed(2)),
                        data_inicio: data,
                        frequencia,
                        ativo: true
                    };
                    // A função SQL nova grava a regra e a primeira transação na mesma transação PostgreSQL.
                    const rpc = await supabaseClient.rpc('audio_sa_registrar_custo_fixo_recorrente_v1', {
                        p_transacao: payload,
                        p_regra: novaRegra
                    });
                    resultado = { data: rpc.data ? { id: rpc.data.transacao_id } : null, error: rpc.error };
                } else {
                    resultado = await supabaseClient.from('transacoes').insert(payload).select('id').single();
                }
            }
            if (resultado.error) throw resultado.error;
            if (!resultado.data) throw new Error('O banco não confirmou a gravação.');

            $('form-transacao').reset();
            cancelarEdicao();
            if (sessaoAtual.perfil === 'recepcao') {
                feedbackGlobal('Lançamento salvo com sucesso.', 'success');
                $('t-data').value = dataLocalHoje();
                mudarAba('lancamento');
            } else {
                await carregarTransacoes();
                await carregarRecorrencias();
                feedbackGlobal(editando ? 'Lançamento atualizado com sucesso.' : (frequencia !== 'nenhuma' ? 'Lançamento salvo e regra recorrente cadastrada.' : 'Lançamento salvo com sucesso.'), 'success');
                mudarAba('historico');
            }
        } catch (error) {
            feedbackGlobal(`Não foi possível concluir o lançamento: ${error.message}`, 'error');
        } finally {
            carregando = false;
            botao.disabled = false;
            botao.textContent = textoOriginal;
        }
    }

    function cancelarEdicao() {
        estadoEdicao = null;
        suprimindoMudancaFinanceira = true;
        $('t-edit-id').value = '';
        $('form-titulo-modo').textContent = 'Novo Lançamento Financeiro';
        $('btn-submit-transacao').textContent = '💾 Salvar Lançamento';
        $('label-valor').textContent = 'Valor Bruto (R$) *';
        $('btn-cancelar-edicao').classList.add('hidden');
        $('form-transacao').reset();
        ['t-tipo', 't-valor', 't-forma-pagamento', 't-bandeira', 't-parcelas', 't-modo-taxa', 't-taxa-manual', 't-confirmar-taxa'].forEach(id => {
            if ($(id)) $(id).disabled = false;
        });
        if ($('t-valor')) $('t-valor').readOnly = false;
        atualizarCategorias();
        $('t-data').value = dataLocalHoje();
        suprimindoMudancaFinanceira = false;
        atualizarPreviaFinanceira();
    }

    async function deletarTransacao(id) {
        if (!exigirAnalista('excluir lançamentos')) return;
        const registro = transacoes.find(t => String(t.id) === String(id));
        if (registro?.recorrencia_id) {
            const regra = recorrencias.find(r => String(r.id) === String(registro.recorrencia_id));
            if (regra?.ativo) {
                feedbackGlobal('Este lançamento pertence a uma regra recorrente ativa. Pause a regra em Custos fixos recorrentes antes de excluir a ocorrência, para impedir que ela seja gerada novamente.', 'warning');
                return;
            }
        }
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
            barChartInstance?.resize(); pieChartInstance?.resize(); lineChartInstance?.resize(); cardChartInstance?.resize();
        }, 100);
        if (aba === 'historico') renderTabela();
    }

    function renderCharts() {
        if (!window.Chart) return;
        const canvasBar = $('financeBarChart');
        const canvasPie = $('financePieChart');
        const canvasLine = $('financeLineChart');
        const canvasCard = $('financeCardChart');
        if (!canvasBar || !canvasPie) return;
        [barChartInstance, pieChartInstance, lineChartInstance, cardChartInstance].forEach(chart => chart?.destroy());
        barChartInstance = new Chart(canvasBar.getContext('2d'), {
            type: 'bar',
            data: { labels: ['Entradas operacionais', 'Saídas'], datasets: [{ label: 'Total (R$)', data: [0, 0], backgroundColor: ['#10b981', '#ef4444'] }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
        pieChartInstance = new Chart(canvasPie.getContext('2d'), {
            type: 'doughnut',
            data: { labels: [], datasets: [{ data: [], backgroundColor: ['#2c8c9e', '#10b981', '#ef4444', '#8ab6c1', '#64748b', '#f59e0b', '#7c3aed', '#0f766e'] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
        if (canvasLine) {
            lineChartInstance = new Chart(canvasLine.getContext('2d'), {
                type: 'line',
                data: { labels: [], datasets: [
                    { label: 'Entradas operacionais', data: [], borderColor: '#0f766e', backgroundColor: '#0f766e', tension: 0.25 },
                    { label: 'Despesas', data: [], borderColor: '#ef4444', backgroundColor: '#ef4444', tension: 0.25 }
                ] },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
            });
        }
        if (canvasCard) {
            cardChartInstance = new Chart(canvasCard.getContext('2d'), {
                type: 'bar',
                data: { labels: [], datasets: [{ label: 'Taxas registradas (R$)', data: [], backgroundColor: '#2c8c9e' }] },
                options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { beginAtZero: true } } }
            });
        }
    }

    function updateCharts(lista, entradas, saidas) {
        if (barChartInstance) {
            barChartInstance.data.datasets[0].data = [entradas, saidas];
            barChartInstance.update();
        }
        if (pieChartInstance) {
            const agrupado = new Map();
            lista.forEach(t => {
                const chave = `${t.tipo === 'entrada' ? 'Entrada' : 'Saída'} — ${t.categoria || 'Sem categoria'}`;
                agrupado.set(chave, (agrupado.get(chave) || 0) + Number(t.valor || 0));
            });
            pieChartInstance.data.labels = [...agrupado.keys()];
            pieChartInstance.data.datasets[0].data = [...agrupado.values()];
            pieChartInstance.update();
        }
        if (lineChartInstance) {
            const meses = new Map();
            lista.forEach(t => {
                const mes = String(t.data || '').slice(0, 7);
                if (!/^\d{4}-\d{2}$/.test(mes)) return;
                if (!meses.has(mes)) meses.set(mes, { entrada: 0, saida: 0 });
                const item = meses.get(mes);
                if (t.tipo === 'entrada') item.entrada += Number(t.valor || 0);
                if (t.tipo === 'saida') item.saida += Number(t.valor || 0);
            });
            const chaves = [...meses.keys()].sort();
            lineChartInstance.data.labels = chaves.map(m => `${m.slice(5, 7)}/${m.slice(0, 4)}`);
            lineChartInstance.data.datasets[0].data = chaves.map(m => arredondarCentavos(meses.get(m).entrada));
            lineChartInstance.data.datasets[1].data = chaves.map(m => arredondarCentavos(meses.get(m).saida));
            lineChartInstance.update();
        }
        if (cardChartInstance) {
            const taxas = new Map();
            lista.filter(t => t.tipo === 'entrada' && t.bandeira && t.valor_taxa !== null && t.valor_taxa !== undefined).forEach(t => {
                taxas.set(t.bandeira, (taxas.get(t.bandeira) || 0) + Number(t.valor_taxa || 0));
            });
            const bandeiras = [...taxas.keys()].sort();
            cardChartInstance.data.labels = bandeiras;
            cardChartInstance.data.datasets[0].data = bandeiras.map(b => arredondarCentavos(taxas.get(b)));
            cardChartInstance.update();
        }
    }

    function exportarCSV() {
        if (!exigirPerfil(['gerente', 'analista'])) return;
        const linhas = [[
            'Data', 'Tipo', 'Categoria', 'Profissional', 'Descrição', 'Valor bruto (R$)', 'Forma de pagamento', 'Bandeira', 'Parcelas', 'Taxa (%)', 'Taxa (R$)', 'Valor líquido (R$)', 'Valor operacional (R$)', 'Origem da taxa', 'Taxa provisória', 'Recorrência'
        ], ...transacoes.map(t => [
            t.data, t.tipo, t.categoria, t.profissional || 'Geral', t.descricao,
            t.valor_bruto ?? '', t.forma_pagamento ?? '', t.bandeira ?? '', t.parcelas ?? '',
            t.taxa_percentual ?? '', t.valor_taxa ?? '', t.valor_liquido ?? '', Number(t.valor).toFixed(2),
            t.taxa_modo ?? '', t.taxa_provisoria ? 'Sim' : 'Não', t.recorrencia_id ? `${t.recorrencia_id} / ${t.recorrencia_data || ''}` : ''
        ])];
        const csv = '\uFEFF' + linhas.map(linha => linha.map(escapeCSV).join(';')).join('\r\n');
        baixarArquivo(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'audio_sa_relatorio_financeiro.csv');
    }

    function exportarPDF() {
        if (!exigirPerfil(['gerente', 'analista'])) return;
        if (!window.jspdf?.jsPDF) return feedbackGlobal('A biblioteca jsPDF não foi carregada.', 'error');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const margem = 12;
        const largura = 186;
        let y = 16;
        doc.setFontSize(14);
        doc.text('Áudio S.A. — Relatório Financeiro', margem, y);
        y += 8;
        doc.setFontSize(8);
        doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, margem, y);
        y += 8;
        transacoes.forEach(t => {
            const c = composicaoDaTransacao(t);
            const linha = `${formatarData(t.data)} | ${String(t.tipo || '').toUpperCase()} | ${t.categoria || ''} | Bruto: ${c.completa ? money(c.bruto) : 'N/D'} | Taxa: ${c.completa ? `${percent(c.percentual)} / ${money(c.taxa)}` : 'N/D'} | Operacional: ${money(t.valor)} | ${t.descricao || ''}`;
            const linhasTexto = doc.splitTextToSize(linha, largura);
            const altura = linhasTexto.length * 4;
            if (y + altura > 282) { doc.addPage(); y = 16; }
            doc.text(linhasTexto, margem, y);
            y += altura + 2;
        });
        doc.save('audio_sa_relatorio_financeiro.pdf');
    }

    function baixarArquivo(blob, nome) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = nome;
        document.body.appendChild(link); link.click(); link.remove();
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
            const { error: loginError } = await supabaseClient.auth.signInWithPassword({ email: sessaoAtual.email, password: atual });
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

    function carregarScriptUmaVez(src, identificador) {
        return new Promise((resolve, reject) => {
            if (identificador === 'tesseract' && window.Tesseract) return resolve();
            const existente = document.querySelector(`script[data-lib="${identificador}"]`);
            if (existente) {
                existente.addEventListener('load', resolve, { once: true });
                existente.addEventListener('error', () => reject(new Error(`Não foi possível carregar ${identificador}.`)), { once: true });
                if (identificador === 'tesseract' && window.Tesseract) resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.lib = identificador;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Falha ao carregar a biblioteca ${identificador} pelo CDN.`));
            document.head.appendChild(script);
        });
    }

    async function obterWorkerOCR() {
        await carregarScriptUmaVez('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', 'tesseract');
        if (!window.Tesseract?.createWorker) throw new Error('A biblioteca OCR não disponibilizou o mecanismo de leitura.');
        return window.Tesseract.createWorker('por', 1, {
            logger: mensagem => {
                if (mensagem.status === 'recognizing text') {
                    const progresso = Math.round((mensagem.progress || 0) * 100);
                    $('ocr-status').textContent = `Reconhecendo texto em português: ${progresso}%`;
                } else if (mensagem.status) {
                    $('ocr-status').textContent = `OCR: ${mensagem.status}...`;
                }
            }
        });
    }

    async function extrairTextoPDF(file) {
        const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.mjs';
        const bytes = new Uint8Array(await file.arrayBuffer());
        const documento = await pdfjs.getDocument({ data: bytes }).promise;
        const totalPaginasOriginal = documento.numPages;
        const totalPaginas = Math.min(totalPaginasOriginal, MAX_PAGINAS_OCR);
        const textos = [];
        let worker = null;
        try {
            for (let numero = 1; numero <= totalPaginas; numero++) {
                $('ocr-status').textContent = `Lendo página ${numero} de ${totalPaginas} do PDF...`;
                const pagina = await documento.getPage(numero);
                const conteudo = await pagina.getTextContent();
                const textoNativo = (conteudo.items || []).map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
                if (textoNativo.length >= 20) {
                    textos.push(`PÁGINA ${numero}\n${textoNativo}`);
                    continue;
                }
                if (!worker) worker = await obterWorkerOCR();
                const viewport = pagina.getViewport({ scale: 1.8 });
                const canvas = document.createElement('canvas');
                const contexto = canvas.getContext('2d', { willReadFrequently: true });
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                await pagina.render({ canvasContext: contexto, canvas, viewport }).promise;
                const resultado = await worker.recognize(canvas);
                textos.push(`PÁGINA ${numero}\n${resultado.data.text || ''}`);
                canvas.width = 0;
                canvas.height = 0;
            }
        } finally {
            if (worker) await worker.terminate();
            await documento.destroy();
        }
        if (totalPaginasOriginal > MAX_PAGINAS_OCR) {
            textos.push(`\n[AVISO: o PDF possui ${totalPaginasOriginal} páginas. Foram processadas somente as primeiras ${MAX_PAGINAS_OCR}.]`);
        }
        return textos.join('\n\n').trim();
    }

    async function processarOCR(file) {
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) {
            mostrarMensagem($('ocr-status'), 'Arquivo acima de 15 MB. Reduza o tamanho e tente novamente.', 'error');
            return;
        }
        arquivoOCRAtual = file;
        $('ocr-status').textContent = 'Preparando leitura do documento...';
        $('btn-trigger-camera').disabled = true;
        $('btn-trigger-gallery').disabled = true;
        try {
            let texto = '';
            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                texto = await extrairTextoPDF(file);
            } else if (file.type.startsWith('image/')) {
                const worker = await obterWorkerOCR();
                const imagemUrl = URL.createObjectURL(file);
                try {
                    const imagem = new Image();
                    imagem.src = imagemUrl;
                    await imagem.decode();
                    const resultado = await worker.recognize(imagem);
                    texto = resultado.data.text || '';
                } finally {
                    URL.revokeObjectURL(imagemUrl);
                    await worker.terminate();
                }
            } else {
                throw new Error('Formato não suportado. Selecione PNG, JPG, WEBP ou PDF.');
            }
            textoOCRAtual = String(texto || '').trim();
            if (!textoOCRAtual) throw new Error('Nenhum texto foi reconhecido. Tente uma imagem mais nítida ou digite os dados manualmente.');
            $('ocr-text-result').value = textoOCRAtual;
            $('modal-ocr').classList.remove('hidden');
            $('ocr-status').textContent = `Leitura concluída: ${file.name}. Revise o texto na janela de confirmação.`;
        } catch (error) {
            mostrarMensagem($('ocr-status'), `Não foi possível ler o documento: ${error.message}`, 'error');
        } finally {
            $('btn-trigger-camera').disabled = false;
            $('btn-trigger-gallery').disabled = false;
            if ($('ocr-file-input')) $('ocr-file-input').value = '';
        }
    }

    async function copiarTextoOCR() {
        const texto = $('ocr-text-result')?.value || '';
        if (!texto.trim()) return mostrarMensagem($('ocr-modal-feedback'), 'Não há texto para copiar.', 'warning');
        try {
            await navigator.clipboard.writeText(texto);
            mostrarMensagem($('ocr-modal-feedback'), 'Texto completo copiado. Confira o conteúdo antes de utilizá-lo.', 'success');
        } catch (_) {
            $('ocr-text-result').focus();
            $('ocr-text-result').select();
            mostrarMensagem($('ocr-modal-feedback'), 'A cópia automática não foi autorizada pelo navegador. O texto está selecionado; use Ctrl+C.', 'warning');
        }
    }

    function confirmarTextoOCR() {
        const texto = $('ocr-text-result')?.value?.trim() || '';
        if (!texto) return mostrarMensagem($('ocr-modal-feedback'), 'Revise ou digite o texto antes de confirmar.', 'error');
        $('t-descricao').value = texto.slice(0, 4000);
        $('modal-ocr').classList.add('hidden');
        $('ocr-status').textContent = 'Texto confirmado e copiado para a descrição. Preencha os demais campos e salve manualmente.';
        $('t-descricao').focus();
        mudarAba('lancamento');
    }

    function fecharModalOCR() {
        $('modal-ocr')?.classList.add('hidden');
        arquivoOCRAtual = null;
    }

    function configurarOCR() {
        $('btn-trigger-camera')?.addEventListener('click', () => {
            $('ocr-file-input')?.setAttribute('capture', 'environment');
            $('ocr-file-input')?.click();
        });
        $('btn-trigger-gallery')?.addEventListener('click', () => {
            $('ocr-file-input')?.removeAttribute('capture');
            $('ocr-file-input')?.click();
        });
        $('ocr-file-input')?.addEventListener('change', evento => processarOCR(evento.target.files?.[0]));
        $('btn-copiar-ocr')?.addEventListener('click', copiarTextoOCR);
        $('btn-usar-ocr')?.addEventListener('click', confirmarTextoOCR);
        $('btn-fechar-modal-ocr')?.addEventListener('click', fecharModalOCR);
        $('btn-cancelar-ocr-modal')?.addEventListener('click', fecharModalOCR);
    }

    function parseDataUTC(data) {
        const [ano, mes, dia] = String(data).slice(0, 10).split('-').map(Number);
        return new Date(Date.UTC(ano, mes - 1, dia));
    }

    function dataISOUTC(data) {
        return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}-${String(data.getUTCDate()).padStart(2, '0')}`;
    }

    function adicionarIntervaloRecorrencia(dataBase, frequencia, ocorrencia) {
        const base = parseDataUTC(dataBase);
        if (frequencia === 'semanal') {
            base.setUTCDate(base.getUTCDate() + (7 * ocorrencia));
            return dataISOUTC(base);
        }
        const meses = frequencia === 'mensal' ? 1 : frequencia === 'semestral' ? 6 : frequencia === 'anual' ? 12 : 0;
        if (!meses) throw new Error(`Frequência recorrente desconhecida: ${frequencia}`);
        const diaOriginal = base.getUTCDate();
        const indiceMes = (base.getUTCFullYear() * 12) + base.getUTCMonth() + (meses * ocorrencia);
        const anoDestino = Math.floor(indiceMes / 12);
        const mesDestino = indiceMes % 12;
        const ultimoDia = new Date(Date.UTC(anoDestino, mesDestino + 1, 0)).getUTCDate();
        return dataISOUTC(new Date(Date.UTC(anoDestino, mesDestino, Math.min(diaOriginal, ultimoDia))));
    }

    function obterDatasVencidas(regra, hoje, ultimaDataGerada) {
        const datas = [];
        let limiteAtingido = false;

        // Mantém a data-base original para que meses curtos não alterem o dia das próximas ocorrências.
        for (let n = 1; n <= MAX_BUSCA_HISTORICO_RECORRENCIA; n++) {
            const data = adicionarIntervaloRecorrencia(regra.data_inicio, regra.frequencia, n);
            if (data > hoje) break;
            if (ultimaDataGerada && data <= ultimaDataGerada) continue;
            datas.push(data);
            if (datas.length >= MAX_OCORRENCIAS_POR_REGRA) {
                const proximaData = adicionarIntervaloRecorrencia(regra.data_inicio, regra.frequencia, n + 1);
                limiteAtingido = proximaData <= hoje;
                break;
            }
        }
        return { datas, limiteAtingido };
    }

    function abrirAvisoRecorrencias(geradas) {
        if (!geradas.length) return;
        const lista = $('recorrencias-geradas-list');
        lista.replaceChildren();
        geradas.forEach(item => {
            const linha = document.createElement('div');
            linha.className = 'recurrence-item';
            const texto = document.createElement('div');
            const titulo = document.createElement('strong');
            titulo.textContent = item.descricao || item.categoria || 'Custo fixo';
            const detalhe = document.createElement('small');
            detalhe.textContent = `${formatarData(item.data)} · ${item.categoria || 'Custo fixo'}`;
            texto.append(titulo, detalhe);
            const valor = document.createElement('strong');
            valor.textContent = money(item.valor);
            linha.append(texto, valor);
            lista.appendChild(linha);
        });
        $('recorrencias-alerta-texto').textContent = `${geradas.length} custo(s) fixo(s) recorrente(s) foram lançados automaticamente nesta abertura do sistema. Confira os registros no histórico.`;
        $('modal-recorrencias').classList.remove('hidden');
    }

    async function processarCustosRecorrentesAoAbrir() {
        if (recorrenciasProcessadasNaSessao || !exigirPerfil(['gerente', 'analista'])) return;
        recorrenciasProcessadasNaSessao = true;
        const { data: regras, error } = await supabaseClient
            .from('despesas_recorrentes')
            .select('id,categoria,profissional,descricao,valor,data_inicio,frequencia,ativo')
            .eq('ativo', true);
        if (error) throw new Error(`Não foi possível consultar as regras de custos fixos: ${error.message}`);

        const hoje = dataLocalHoje();
        const pendentes = [];
        let existeMaisAtraso = false;

        for (const regra of (regras || [])) {
            // Consulta a última ocorrência já gravada. Assim, se houver mais de 36 vencimentos
            // acumulados, a próxima abertura continua do ponto seguinte em vez de tentar os mesmos 36.
            const { data: ultimaOcorrencia, error: erroHistorico } = await supabaseClient
                .from('transacoes')
                .select('recorrencia_data')
                .eq('recorrencia_id', regra.id)
                .not('recorrencia_data', 'is', null)
                .order('recorrencia_data', { ascending: false })
                .limit(1);
            if (erroHistorico) throw new Error(`Não foi possível consultar o histórico da regra ${regra.descricao}: ${erroHistorico.message}`);

            const ultimaDataGerada = ultimaOcorrencia?.[0]?.recorrencia_data || regra.data_inicio;
            const resultadoDatas = obterDatasVencidas(regra, hoje, ultimaDataGerada);
            if (resultadoDatas.limiteAtingido) existeMaisAtraso = true;

            resultadoDatas.datas.forEach(data => {
                pendentes.push({
                    id: gerarId(),
                    tipo: 'saida',
                    categoria: regra.categoria,
                    profissional: regra.profissional || 'Geral',
                    descricao: regra.descricao,
                    valor: Number(regra.valor),
                    data,
                    valor_bruto: Number(regra.valor),
                    forma_pagamento: null,
                    bandeira: null,
                    parcelas: null,
                    taxa_percentual: 0,
                    taxa_modo: 'sem_taxa_declarada',
                    valor_taxa: 0,
                    valor_liquido: Number(regra.valor),
                    taxa_confirmada_usuario: false,
                    taxa_provisoria: false,
                    recorrencia_id: regra.id,
                    recorrencia_data: data
                });
            });
        }

        if (!pendentes.length) {
            if (existeMaisAtraso) feedbackGlobal('Há mais de 36 ocorrências vencidas em uma ou mais regras. O restante será processado na próxima abertura da área financeira.', 'warning');
            return;
        }
        const geradas = [];
        for (let inicio = 0; inicio < pendentes.length; inicio += 100) {
            const lote = pendentes.slice(inicio, inicio + 100);
            const { data, error: insertError } = await supabaseClient
                .from('transacoes')
                .upsert(lote, { onConflict: 'recorrencia_id,recorrencia_data', ignoreDuplicates: true })
                .select('id,descricao,categoria,valor,data');
            if (insertError) throw new Error(`Falha ao gerar custos recorrentes: ${insertError.message}`);
            geradas.push(...(data || []));
        }
        if (geradas.length) abrirAvisoRecorrencias(geradas);
        if (existeMaisAtraso) {
            feedbackGlobal('Há mais de 36 ocorrências vencidas em uma ou mais regras. O restante será processado na próxima abertura da área financeira.', 'warning');
        }
    }

    function rotuloFrequencia(frequencia) {
        return ({ semanal: 'Semanal', mensal: 'Mensal', semestral: 'Semestral', anual: 'Anual' })[frequencia] || frequencia;
    }

    function proximaDataRegra(regra) {
        const hoje = dataLocalHoje();
        for (let n = 1; n <= MAX_BUSCA_HISTORICO_RECORRENCIA; n++) {
            const data = adicionarIntervaloRecorrencia(regra.data_inicio, regra.frequencia, n);
            if (data > hoje) return data;
        }
        return 'Não calculada';
    }

    async function carregarRecorrencias() {
        if (!exigirPerfil(['gerente', 'analista'])) return;
        const container = $('recorrencias-container');
        if (!container) return;
        const { data, error } = await supabaseClient
            .from('despesas_recorrentes')
            .select('id,categoria,profissional,descricao,valor,data_inicio,frequencia,ativo,created_by,created_at')
            .order('created_at', { ascending: false });
        if (error) {
            $('recorrencias-list').textContent = `Não foi possível consultar as regras recorrentes: ${error.message}`;
            return;
        }
        recorrencias = data || [];
        renderRecorrencias();
    }

    function renderRecorrencias() {
        const lista = $('recorrencias-list');
        if (!lista) return;
        lista.replaceChildren();
        if (!recorrencias.length) {
            lista.textContent = 'Nenhuma regra de custo fixo recorrente cadastrada.';
            return;
        }
        recorrencias.forEach(regra => {
            const linha = document.createElement('div');
            linha.className = 'recurrence-item';
            const texto = document.createElement('div');
            const titulo = document.createElement('strong');
            titulo.textContent = regra.descricao || regra.categoria;
            const detalhe = document.createElement('small');
            detalhe.textContent = `${regra.categoria} · ${rotuloFrequencia(regra.frequencia)} · Próxima data prevista: ${proximaDataRegra(regra)} · ${money(regra.valor)}`;
            const status = document.createElement('small');
            status.textContent = regra.ativo ? 'Ativa' : 'Pausada';
            texto.append(titulo, detalhe, status);
            linha.appendChild(texto);
            if (sessaoAtual?.perfil === 'analista') {
                const botao = document.createElement('button');
                botao.type = 'button';
                botao.className = 'btn-outline';
                botao.textContent = regra.ativo ? 'Pausar' : 'Reativar';
                botao.addEventListener('click', () => alterarStatusRecorrencia(regra));
                linha.appendChild(botao);
            }
            lista.appendChild(linha);
        });
    }

    async function alterarStatusRecorrencia(regra) {
        if (!exigirAnalista('pausar ou reativar regras recorrentes')) return;
        try {
            const { error } = await supabaseClient.from('despesas_recorrentes').update({ ativo: !regra.ativo }).eq('id', regra.id);
            if (error) throw error;
            await carregarRecorrencias();
            feedbackGlobal(`Regra recorrente ${regra.ativo ? 'pausada' : 'reativada'} com sucesso.`, 'success');
        } catch (error) {
            feedbackGlobal(`Não foi possível alterar a regra recorrente: ${error.message}`, 'error');
        }
    }

    function fecharModalRecorrencias() {
        $('modal-recorrencias')?.classList.add('hidden');
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
        ['click', 'keydown', 'mousemove', 'touchstart'].forEach(evento => document.addEventListener(evento, reiniciar, { passive: true }));
        reiniciar();
    }

    function definirFiltrosDashboardVisiveis(visiveis) {
        const painel = $('painel-campos-filtros-dashboard');
        const botao = $('btn-toggle-filtros-dashboard');
        if (!painel || !botao) return;

        painel.classList.toggle('is-collapsed', !visiveis);
        botao.setAttribute('aria-expanded', String(visiveis));
        botao.textContent = visiveis ? 'Ocultar filtros' : 'Mostrar filtros';
        botao.setAttribute('aria-label', visiveis ? 'Ocultar filtros do dashboard' : 'Mostrar filtros do dashboard');
    }

    function configurarFiltrosDashboard() {
        ['filtro-dashboard-inicio', 'filtro-dashboard-fim', 'filtro-dashboard-categoria', 'filtro-dashboard-profissional', 'filtro-dashboard-pagamento', 'filtro-dashboard-bandeira'].forEach(id => {
            $(id)?.addEventListener('change', atualizarDashboardVisual);
        });

        $('btn-toggle-filtros-dashboard')?.addEventListener('click', () => {
            const painel = $('painel-campos-filtros-dashboard');
            const atualmenteVisiveis = !painel?.classList.contains('is-collapsed');
            definirFiltrosDashboardVisiveis(!atualmenteVisiveis);
        });

        // No celular, o dashboard abre priorizando KPIs e gráficos; no desktop os filtros permanecem visíveis.
        const celular = window.matchMedia?.('(max-width: 700px)').matches || false;
        definirFiltrosDashboardVisiveis(!celular);

        $('btn-limpar-filtros-dashboard')?.addEventListener('click', () => {
            ['filtro-dashboard-inicio', 'filtro-dashboard-fim'].forEach(id => { if ($(id)) $(id).value = ''; });
            ['filtro-dashboard-categoria', 'filtro-dashboard-profissional', 'filtro-dashboard-pagamento', 'filtro-dashboard-bandeira'].forEach(id => {
                if ($(id)) $(id).selectedIndex = 0;
            });
            atualizarDashboardVisual();
        });
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
        $('t-tipo')?.addEventListener('change', () => { atualizarCategorias(); marcarAlteracaoFinanceira(); });
        $('t-categoria')?.addEventListener('change', atualizarCampoRecorrencia);
        $('t-forma-pagamento')?.addEventListener('change', () => { atualizarCamposPagamento({ ajustarModo: true }); marcarAlteracaoFinanceira(); });
        $('t-bandeira')?.addEventListener('change', () => { atualizarCamposPagamento({ ajustarModo: true }); marcarAlteracaoFinanceira(); });
        $('t-parcelas')?.addEventListener('change', () => { atualizarCamposPagamento({ ajustarModo: true }); marcarAlteracaoFinanceira(); });
        $('t-modo-taxa')?.addEventListener('change', () => { atualizarCamposPagamento({ ajustarModo: false }); marcarAlteracaoFinanceira(); });
        ['t-valor', 't-taxa-manual', 't-confirmar-taxa'].forEach(id => {
            $(id)?.addEventListener('input', marcarAlteracaoFinanceira);
            $(id)?.addEventListener('change', marcarAlteracaoFinanceira);
        });
        $('btn-logout')?.addEventListener('click', encerrarSessao);
        $('btn-abrir-modal-senha')?.addEventListener('click', () => $('modal-senha')?.classList.remove('hidden'));
        $('form-modal-senha')?.addEventListener('submit', alterarSenha);
        $('filtro-busca')?.addEventListener('input', filtrarHistorico);
        $('filtro-tipo')?.addEventListener('change', filtrarHistorico);
        $('btn-export-csv')?.addEventListener('click', exportarCSV);
        $('btn-export-pdf')?.addEventListener('click', exportarPDF);
        configurarFiltrosDashboard();
        $('btn-fechar-modal-recorrencias')?.addEventListener('click', fecharModalRecorrencias);
        $('btn-ok-modal-recorrencias')?.addEventListener('click', fecharModalRecorrencias);
    }

    // Compatibilidade com os onclick existentes no HTML.
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
            configurarOCR();
            renderCharts();
            vincularEventos();
            $('t-data').value = dataLocalHoje();
            atualizarPreviaFinanceira();

            supabaseClient.auth.onAuthStateChange((_evento, session) => {
                if (!session) {
                    sessaoAtual = null;
                    recorrenciasProcessadasNaSessao = false;
                    removerRealtimeTransacoes();
                    transacoes = [];
                    recorrencias = [];
                    $('app-dashboard')?.classList.add('hidden');
                    $('auth-screen')?.classList.remove('hidden');
                }
            });

            await sincronizarSessao();
            if (sessaoAtual) configurarMonitorInatividade();
        } catch (error) {
            mostrarMensagem($('auth-global-feedback'), `Falha na inicialização: ${error.message}`, 'error');
        }
    });
})();

