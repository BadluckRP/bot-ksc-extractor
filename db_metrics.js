const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { notificar } = require('./notifier');

const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function coletarMetricas() {
    await client.connect();
    
    const registrosAtivos = await client.query(
        'SELECT COUNT(*) as total FROM aplicativos_kaspersky WHERE deleted_at IS NULL'
    );
    
    const registrosDeletados = await client.query(
        'SELECT COUNT(*) as total FROM aplicativos_kaspersky WHERE deleted_at IS NOT NULL'
    );
    
    const totalRegistros = await client.query(
        'SELECT COUNT(*) as total FROM aplicativos_kaspersky'
    );
    
    const tamanhoTabela = await client.query(`
        SELECT 
            pg_size_pretty(pg_total_relation_size('aplicativos_kaspersky')) as tamanho_total,
            pg_total_relation_size('aplicativos_kaspersky') as bytes_total,
            pg_size_pretty(pg_relation_size('aplicativos_kaspersky')) as tamanho_dados,
            pg_relation_size('aplicativos_kaspersky') as bytes_dados,
            pg_size_pretty(pg_indexes_size('aplicativos_kaspersky')) as tamanho_indices,
            pg_indexes_size('aplicativos_kaspersky') as bytes_indices
    `);
    
    const tamanhoAtivos = await client.query(`
        SELECT 
            COUNT(*) as total_registros,
            pg_size_pretty(SUM(pg_column_size(ak.*))::bigint) as tamanho_estimado
        FROM aplicativos_kaspersky ak
        WHERE deleted_at IS NULL
    `);
    
    const tamanhoDeletados = await client.query(`
        SELECT 
            COUNT(*) as total_registros,
            pg_size_pretty(SUM(pg_column_size(ak.*))::bigint) as tamanho_estimado
        FROM aplicativos_kaspersky ak
        WHERE deleted_at IS NOT NULL
    `);
    
    const ultimaAtualizacao = await client.query(`
        SELECT 
            MAX(updated_at) as ultima_atualizacao,
            MAX(created_at) as ultimo_registro
        FROM aplicativos_kaspersky
    `);
    
    const atualizacoesSemana = await client.query(`
        SELECT 
            DATE(updated_at) as dia,
            COUNT(*) as registros,
            MAX(updated_at) as ultimo_horario,
            MIN(updated_at) as primeiro_horario
        FROM aplicativos_kaspersky
        WHERE updated_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(updated_at)
        ORDER BY dia DESC
    `);
    
    const registrosPorArquivo = await client.query(`
        SELECT 
            COUNT(DISTINCT arquivo_origem) as total_arquivos
        FROM aplicativos_kaspersky
    `);
    
    const mediaRegistros = await client.query(`
        SELECT 
            AVG(registros_por_arquivo) as media_registros
        FROM (
            SELECT arquivo_origem, COUNT(*) as registros_por_arquivo
            FROM aplicativos_kaspersky
            WHERE deleted_at IS NULL
            GROUP BY arquivo_origem
        ) as subquery
    `);
    
    const distribuicaoPorCategoria = await client.query(`
        SELECT 
            CASE 
                WHEN arquivo_origem LIKE '%linux%' THEN 'Linux'
                WHEN arquivo_origem LIKE '%windows%' THEN 'Windows'
                ELSE 'Outros'
            END as categoria,
            COUNT(*) as total
        FROM aplicativos_kaspersky
        WHERE deleted_at IS NULL
        GROUP BY categoria
        ORDER BY total DESC
    `);
    
    await client.end();
    
    return {
        ativos: parseInt(registrosAtivos.rows[0].total),
        deletados: parseInt(registrosDeletados.rows[0].total),
        total: parseInt(totalRegistros.rows[0].total),
        tamanho: tamanhoTabela.rows[0],
        tamanhoAtivos: tamanhoAtivos.rows[0],
        tamanhoDeletados: tamanhoDeletados.rows[0],
        ultimaAtualizacao: ultimaAtualizacao.rows[0],
        atualizacoesSemana: atualizacoesSemana.rows,
        totalArquivos: parseInt(registrosPorArquivo.rows[0].total_arquivos),
        mediaRegistros: parseFloat(mediaRegistros.rows[0].media_registros),
        distribuicao: distribuicaoPorCategoria.rows
    };
}

function formatarData(data) {
    if (!data) return 'N/A';
    return new Date(data).toLocaleString('pt-BR', { 
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'medium'
    });
}

function formatarDia(data) {
    if (!data) return 'N/A';
    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const d = new Date(data);
    return `${dias[d.getDay()]} ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}

function formatarTamanho(bytes) {
    if (bytes >= 1073741824) {
        return (bytes / 1073741824).toFixed(2) + ' GB';
    } else if (bytes >= 1048576) {
        return (bytes / 1048576).toFixed(2) + ' MB';
    } else if (bytes >= 1024) {
        return (bytes / 1024).toFixed(2) + ' KB';
    }
    return bytes + ' bytes';
}

async function enviarMetricas() {
    console.log('Coletando metricas do banco de dados...');
    
    const metricas = await coletarMetricas();
    
    const percentualAtivos = ((metricas.ativos / metricas.total) * 100).toFixed(2);
    const percentualDeletados = ((metricas.deletados / metricas.total) * 100).toFixed(2);
    
    let historicoSemana = '';
    if (metricas.atualizacoesSemana.length > 0) {
        historicoSemana = '\n\nHISTORICO ULTIMA SEMANA:';
        metricas.atualizacoesSemana.forEach(dia => {
            const diaFormatado = formatarDia(dia.dia);
            const primeiroHorario = new Date(dia.primeiro_horario).toLocaleTimeString('pt-BR', { 
                timeZone: 'America/Sao_Paulo',
                hour: '2-digit',
                minute: '2-digit'
            });
            const ultimoHorario = new Date(dia.ultimo_horario).toLocaleTimeString('pt-BR', { 
                timeZone: 'America/Sao_Paulo',
                hour: '2-digit',
                minute: '2-digit'
            });
            historicoSemana += `\n- ${diaFormatado}: ${dia.registros} registros (${primeiroHorario} - ${ultimoHorario})`;
        });
    } else {
        historicoSemana = '\n\nHISTORICO ULTIMA SEMANA:\n- Nenhuma atualizacao nos ultimos 7 dias';
    }
    
    let distribuicaoCategoria = '';
    if (metricas.distribuicao.length > 0) {
        distribuicaoCategoria = '\n\nDISTRIBUICAO POR SISTEMA:';
        metricas.distribuicao.forEach(cat => {
            const percentual = ((cat.total / metricas.ativos) * 100).toFixed(2);
            distribuicaoCategoria += `\n- ${cat.categoria}: ${cat.total} registros (${percentual}%)`;
        });
    }
    
    const mensagem = `Metricas do Banco de Dados

DATABASE: ${process.env.DB_NAME}@${process.env.DB_HOST}
TABELA: aplicativos_kaspersky

REGISTROS:
- Total: ${metricas.total.toLocaleString('pt-BR')}
- Ativos: ${metricas.ativos.toLocaleString('pt-BR')} (${percentualAtivos}%)
- Soft-deleted: ${metricas.deletados.toLocaleString('pt-BR')} (${percentualDeletados}%)

TAMANHO:
- Total (tabela + indices): ${formatarTamanho(metricas.tamanho.bytes_total)}
- Dados da tabela: ${formatarTamanho(metricas.tamanho.bytes_dados)}
  * Registros ativos: ${metricas.tamanhoAtivos.tamanho_estimado} (${metricas.tamanhoAtivos.total_registros.toLocaleString('pt-BR')} registros)
  * Registros soft-deleted: ${metricas.tamanhoDeletados.tamanho_estimado} (${metricas.tamanhoDeletados.total_registros.toLocaleString('pt-BR')} registros)
- Indices: ${formatarTamanho(metricas.tamanho.bytes_indices)}

ARQUIVOS CSV:
- Total de fontes: ${metricas.totalArquivos}
- Media de registros por arquivo: ${Math.round(metricas.mediaRegistros)}${distribuicaoCategoria}${historicoSemana}

ULTIMA ATUALIZACAO:
- Data/Hora: ${formatarData(metricas.ultimaAtualizacao.ultima_atualizacao)}
- Ultimo registro criado: ${formatarData(metricas.ultimaAtualizacao.ultimo_registro)}`;
    
    await notificar('bot-ksc-db_metrics', mensagem, 'INFO');
    console.log('Metricas enviadas com sucesso!');
}

if (require.main === module) {
    enviarMetricas().catch(async (erro) => {
        console.error('Erro ao coletar metricas:', erro);
        await notificar('bot-ksc-db_metrics', `ERRO ao coletar metricas: ${erro.message}`, 'ERRO');
        process.exit(1);
    });
}

module.exports = { enviarMetricas };
