const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { notificar } = require('./notifier');

const nomeServidor = process.argv[2];

if (!nomeServidor) {
    console.error('ERRO: Nome do servidor nao fornecido.');
    console.log('Uso: node reprocess_server.js "NOME_DO_SERVIDOR"');
    process.exit(1);
}

async function reprocessarServidor() {
    console.log(`\n=== REPROCESSAMENTO COMPLETO: ${nomeServidor} ===\n`);
    await notificar('bot-ksc-reprocess', `Iniciando reprocessamento completo\n\nServidor: ${nomeServidor}\nProcesso: Scraper + DB Sync`, 'INFO');
    
    console.log('ETAPA 1: Executando scraper individual...');
    await notificar('bot-ksc-reprocess', `ETAPA 1/2: Scraper Individual\n\nServidor: ${nomeServidor}\nAcao: Baixando relatorio do KSC...`, 'INFO');
    
    try {
        const { stdout: scraperOutput } = await execPromise(`node scraper_single.js "${nomeServidor}"`, {
            cwd: __dirname,
            timeout: 300000
        });
        
        console.log('Saida do scraper:');
        console.log(scraperOutput);
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const dirRelatorios = path.join(__dirname, process.env.KSC_PASTA_RELATORIOS || 'relatorios');
        const arquivos = fs.readdirSync(dirRelatorios).filter(f => 
            f.includes(nomeServidor) && f.endsWith('.csv')
        );
        
        if (arquivos.length === 0) {
            throw new Error(`Nenhum arquivo encontrado para ${nomeServidor}`);
        }
        
        const arquivoMaisRecente = arquivos.sort((a, b) => {
            const statA = fs.statSync(path.join(dirRelatorios, a));
            const statB = fs.statSync(path.join(dirRelatorios, b));
            return statB.mtime - statA.mtime;
        })[0];
        
        console.log(`\nArquivo baixado: ${arquivoMaisRecente}`);
        
        const caminhoArquivo = path.join(dirRelatorios, arquivoMaisRecente);
        let linhasComDados = 0;
        
        await new Promise((resolve, reject) => {
            fs.createReadStream(caminhoArquivo)
                .pipe(csv({
                    mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, '')
                }))
                .on('data', () => {
                    linhasComDados++;
                })
                .on('end', resolve)
                .on('error', reject);
        });
        
        if (linhasComDados === 0) {
            await notificar('bot-ksc-reprocess', `AVISO: Arquivo continua VAZIO\n\nServidor: ${nomeServidor}\nArquivo: ${arquivoMaisRecente}\nLinhas: 0\nStatus: Servidor sem aplicativos instalados`, 'INFO');
            console.log('\nAVISO: Arquivo continua vazio. Servidor nao tem aplicativos instalados.');
            console.log('Processo finalizado (nao ha dados para sincronizar).');
            return;
        }
        
        console.log(`Arquivo valido com ${linhasComDados} linhas de dados.`);
        await notificar('bot-ksc-reprocess', `ETAPA 1/2: CONCLUIDA\n\nServidor: ${nomeServidor}\nArquivo: ${arquivoMaisRecente}\nLinhas de dados: ${linhasComDados}\nStatus: Download bem-sucedido`, 'SUCESSO');
        
        console.log('\nETAPA 2: Sincronizando com banco de dados...');
        await notificar('bot-ksc-reprocess', `ETAPA 2/2: Sincronizacao com Banco\n\nServidor: ${nomeServidor}\nArquivo: ${arquivoMaisRecente}\nAcao: Inserindo ${linhasComDados} registros no PostgreSQL...`, 'INFO');
        
        const client = new Client({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_NAME,
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT,
        });
        
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
        
        const resultados = [];
        await new Promise((resolve, reject) => {
            fs.createReadStream(caminhoArquivo)
                .pipe(csv({
                    mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, '')
                }))
                .on('data', (data) => resultados.push(data))
                .on('end', resolve)
                .on('error', reject);
        });
        
        await client.query('BEGIN');
        
        const deleteResult = await client.query(
            `UPDATE aplicativos_kaspersky 
             SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
             WHERE arquivo_origem = $1 AND deleted_at IS NULL`,
            [arquivoMaisRecente]
        );
        
        console.log(`Registros antigos marcados como deletados: ${deleteResult.rowCount}`);
        
        for (const linha of resultados) {
            const nome = linha['Nome'] || '';
            const versao = linha['Versão'] || '';
            const fornecedor = linha['Fornecedor'] || '';
            const atualizacoes = linha['Atualizações'] || '';

            await client.query(
                `INSERT INTO aplicativos_kaspersky (nome, versao, fornecedor, atualizacoes, arquivo_origem) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [nome, versao, fornecedor, atualizacoes, arquivoMaisRecente]
            );
        }
        
        await client.query('COMMIT');
        await client.end();
        
        console.log(`\nSucesso! ${resultados.length} registros inseridos no banco.`);
        
        await notificar('bot-ksc-reprocess', `REPROCESSAMENTO COMPLETO - SUCESSO!\n\nServidor: ${nomeServidor}\nArquivo: ${arquivoMaisRecente}\n\nRESULTADOS:\n- Registros soft-deleted: ${deleteResult.rowCount}\n- Registros inseridos: ${resultados.length}\n- Status: Dados sincronizados com sucesso`, 'SUCESSO');
        
        console.log('\n=== PROCESSO COMPLETO FINALIZADO COM SUCESSO ===');
        
    } catch (erro) {
        console.error('\nERRO no reprocessamento:', erro.message);
        await notificar('bot-ksc-reprocess', `ERRO no reprocessamento\n\nServidor: ${nomeServidor}\nErro: ${erro.message}`, 'ERRO');
        process.exit(1);
    }
}

reprocessarServidor();
