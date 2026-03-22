const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const csv = require('csv-parser');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { notificar } = require('./notifier');

const dirRelatorios = path.join(__dirname, 'relatorios');

function getWeekRange() {
    const today = new Date();
    const firstDayOfWeek = new Date(today);
    firstDayOfWeek.setDate(today.getDate() - today.getDay());
    
    const lastDayOfWeek = new Date(firstDayOfWeek);
    lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 7);

    const format = (d) => `${d.getMonth() + 1}_${d.getDate()}_${d.getFullYear()}`;
    return `${format(firstDayOfWeek)}-${format(lastDayOfWeek)}`;
}

const reprocessarTudo = process.argv.includes('--all');
const prefixoSemana = getWeekRange();

const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function processarCSVs() {
    const dbInfo = `Database: ${process.env.DB_NAME}
Host: ${process.env.DB_HOST}:${process.env.DB_PORT}
Tabela: aplicativos_kaspersky
Semana de referencia: ${prefixoSemana}
Modo: ${reprocessarTudo ? 'Reprocessar TODOS' : 'Apenas semana atual'}`;
    
    await notificar('bot-ksc-db_sync', `Iniciando sincronizacao de CSVs para PostgreSQL\n\n${dbInfo}`, 'INFO');
    
    await client.connect();

    await client.query(`
        CREATE TABLE IF NOT EXISTS aplicativos_kaspersky (
            id SERIAL PRIMARY KEY,
            nome TEXT,
            versao TEXT,
            fornecedor TEXT,
            atualizacoes TEXT,
            arquivo_origem TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP WITH TIME ZONE
        );
    `);

    if (!fs.existsSync(dirRelatorios)) {
        console.log("Pasta de relatorios nao encontrada.");
        process.exit(1);
    }

    let arquivos = fs.readdirSync(dirRelatorios).filter(file => file.endsWith('.csv'));

    if (!reprocessarTudo) {
        arquivos = arquivos.filter(file => file.startsWith(prefixoSemana));
        console.log(`Modo padrao: Processando apenas arquivos da semana (${prefixoSemana}).`);
    } else {
        console.log("Modo forçado: Processando TODOS os arquivos da pasta.");
    }

    if (arquivos.length === 0) {
        console.log("Nenhum arquivo encontrado para processamento.");
        await notificar('bot-ksc-db_sync', `Nenhum arquivo CSV encontrado para a semana ${prefixoSemana}`, 'INFO');
        process.exit(0);
    }
    
    await notificar('bot-ksc-db_sync', `Encontrados ${arquivos.length} arquivo(s) CSV para processar na semana ${prefixoSemana}`, 'INFO');

    let totalRegistrosInseridos = 0;
    let totalRegistrosDeletados = 0;
    let arquivosProcessadosComSucesso = 0;
    let arquivosComErro = 0;
    let arquivosVazios = 0;
    
    for (const arquivo of arquivos) {
        console.log(`Processando arquivo: ${arquivo}`);
        const caminhoCompleto = path.join(dirRelatorios, arquivo);
        const resultados = [];

        await new Promise((resolve, reject) => {
            fs.createReadStream(caminhoCompleto)
                .pipe(csv({
                    mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, '')
                }))
                .on('data', (data) => resultados.push(data))
                .on('end', resolve)
                .on('error', reject);
        });
        
        if (resultados.length === 0) {
            console.log(`AVISO: Arquivo ${arquivo} esta vazio (sem dados).`);
            arquivosVazios++;
            
            if (arquivo.startsWith(prefixoSemana)) {
                const nomeServidor = arquivo.replace(prefixoSemana + '_', '').replace('_aplicativos.csv', '');
                const partes = nomeServidor.split('_');
                const servidor = partes.slice(2).join('_');
                
                const retryQueue = JSON.parse(fs.readFileSync(path.join(__dirname, 'retry_queue.json'), 'utf-8'));
                const jaExiste = retryQueue.find(item => item.servidor === servidor && item.semana === prefixoSemana);
                
                if (!jaExiste) {
                    retryQueue.push({
                        servidor: servidor,
                        arquivo: arquivo,
                        semana: prefixoSemana,
                        tentativas: 0,
                        adicionadoEm: new Date().toISOString()
                    });
                    fs.writeFileSync(path.join(__dirname, 'retry_queue.json'), JSON.stringify(retryQueue, null, 2));
                    console.log(`Servidor ${servidor} adicionado a fila de retry (semana atual).`);
                    await notificar('bot-ksc-db_sync', `AVISO: Arquivo vazio detectado da SEMANA ATUAL\n\nArquivo: ${arquivo}\nServidor: ${servidor}\nAcao: Adicionado a fila de retry (tentativa em 15 minutos)`, 'INFO');
                } else {
                    await notificar('bot-ksc-db_sync', `AVISO: Arquivo vazio detectado\n\nArquivo: ${arquivo}\nStatus: Sem dados para processar\nAcao: Arquivo ignorado (ja na fila de retry)`, 'INFO');
                }
            } else {
                await notificar('bot-ksc-db_sync', `AVISO: Arquivo vazio detectado de SEMANA ANTERIOR\n\nArquivo: ${arquivo}\nStatus: Sem dados para processar\nAcao: Arquivo ignorado (nao e da semana atual)`, 'INFO');
            }
            
            continue;
        }

        await client.query('BEGIN');

        try {
            const deleteResult = await client.query(
                `UPDATE aplicativos_kaspersky 
                 SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
                 WHERE arquivo_origem = $1 AND deleted_at IS NULL`,
                [arquivo]
            );
            
            totalRegistrosDeletados += deleteResult.rowCount;

            for (const linha of resultados) {
                const nome = linha['Nome'] || '';
                const versao = linha['Versão'] || '';
                const fornecedor = linha['Fornecedor'] || '';
                const atualizacoes = linha['Atualizações'] || '';

                await client.query(
                    `INSERT INTO aplicativos_kaspersky (nome, versao, fornecedor, atualizacoes, arquivo_origem) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [nome, versao, fornecedor, atualizacoes, arquivo]
                );
            }

            await client.query('COMMIT');
            console.log(`Arquivo ${arquivo} inserido com sucesso.`);
            
            totalRegistrosInseridos += resultados.length;
            arquivosProcessadosComSucesso++;
        } catch (erro) {
            await client.query('ROLLBACK');
            console.log(`Falha ao processar o arquivo ${arquivo}. Transacao revertida. Erro: ${erro.message}`);
            
            arquivosComErro++;
            await notificar('bot-ksc-db_sync', `ERRO ao processar ${arquivo}: ${erro.message}`, 'ERRO');
        }
    }

    await client.end();
    console.log("Sincronizacao finalizada.");
    
    const analytics = `Sincronizacao finalizada com sucesso!

Database: ${process.env.DB_NAME}@${process.env.DB_HOST}
Tabela: aplicativos_kaspersky
Semana: ${prefixoSemana}

ARQUIVOS:
- Total encontrado: ${arquivos.length}
- Processados com sucesso: ${arquivosProcessadosComSucesso}
- Vazios (sem dados): ${arquivosVazios}
- Com erro: ${arquivosComErro}

REGISTROS:
- Inseridos: ${totalRegistrosInseridos}
- Soft-deleted: ${totalRegistrosDeletados}
- Total no banco: ${totalRegistrosInseridos}`;
    
    await notificar('bot-ksc-db_sync', analytics, 'SUCESSO');
    
    console.log('Coletando metricas do banco...');
    const { enviarMetricas } = require('./db_metrics');
    await enviarMetricas();
}

processarCSVs().catch(async (erro) => {
    console.error('Erro fatal na sincronizacao:', erro);
    await notificar('bot-ksc-db_sync', `ERRO FATAL: ${erro.message}`, 'ERRO');
    process.exit(1);
});