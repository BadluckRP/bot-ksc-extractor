const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { notificar } = require('./notifier');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

function getWeekRange() {
    const today = new Date();
    const firstDayOfWeek = new Date(today);
    firstDayOfWeek.setDate(today.getDate() - today.getDay());
    
    const lastDayOfWeek = new Date(firstDayOfWeek);
    lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 7);

    const format = (d) => `${d.getMonth() + 1}_${d.getDate()}_${d.getFullYear()}`;
    return `${format(firstDayOfWeek)}-${format(lastDayOfWeek)}`;
}

async function processarFilaRetry() {
    const retryQueuePath = path.join(__dirname, 'retry_queue.json');
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    
    console.log(`[${timestamp}] Sistema de retry verificando fila...`);
    
    if (!fs.existsSync(retryQueuePath)) {
        console.log('Fila de retry vazia ou nao existe.');
        return;
    }
    
    const retryQueue = JSON.parse(fs.readFileSync(retryQueuePath, 'utf-8'));
    
    if (retryQueue.length === 0) {
        console.log('Nenhum servidor na fila de retry.');
        return;
    }
    
    const semanaAtual = getWeekRange();
    const itensParaProcessar = retryQueue.filter(item => item.semana === semanaAtual && item.tentativas < 1);
    
    if (itensParaProcessar.length === 0) {
        console.log('Nenhum servidor elegivel para retry na semana atual.');
        return;
    }
    
    console.log(`Processando ${itensParaProcessar.length} servidor(es) da fila de retry...`);
    await notificar('bot-ksc-retry', `Iniciando processamento de retry\n\nServidores na fila: ${itensParaProcessar.length}\nSemana: ${semanaAtual}\nTentativas permitidas: 1 por servidor`, 'INFO');
    
    for (const item of itensParaProcessar) {
        console.log(`\nTentando reprocessar: ${item.servidor}`);
        await notificar('bot-ksc-retry', `Tentando reprocessar servidor\n\nServidor: ${item.servidor}\nTentativa: ${item.tentativas + 1}/1\nArquivo anterior: ${item.arquivo}`, 'INFO');
        
        try {
            const comando = `node scraper_single.js "${item.servidor}"`;
            console.log(`Executando: ${comando}`);
            
            const { stdout, stderr } = await execPromise(comando, {
                cwd: __dirname,
                timeout: 300000
            });
            
            console.log('Saida do scraper:', stdout);
            if (stderr) console.error('Erros:', stderr);
            
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const dirRelatorios = path.join(__dirname, process.env.KSC_PASTA_RELATORIOS || 'relatorios');
            const arquivos = fs.readdirSync(dirRelatorios).filter(f => 
                f.includes(item.servidor) && f.startsWith(semanaAtual)
            );
            
            if (arquivos.length > 0) {
                const arquivoNovo = arquivos[0];
                const caminhoCompleto = path.join(dirRelatorios, arquivoNovo);
                const conteudo = fs.readFileSync(caminhoCompleto, 'utf-8');
                const linhas = conteudo.split('\n').filter(l => l.trim().length > 0);
                
                if (linhas.length > 1) {
                    console.log(`Sucesso! Arquivo ${arquivoNovo} tem ${linhas.length - 1} linhas de dados.`);
                    await notificar('bot-ksc-retry', `RETRY BEM-SUCEDIDO!\n\nServidor: ${item.servidor}\nArquivo: ${arquivoNovo}\nLinhas de dados: ${linhas.length - 1}\nStatus: Servidor agora tem dados`, 'SUCESSO');
                    
                    const index = retryQueue.findIndex(i => i.servidor === item.servidor && i.semana === semanaAtual);
                    if (index !== -1) {
                        retryQueue.splice(index, 1);
                    }
                } else {
                    console.log(`Arquivo ainda vazio: ${arquivoNovo}`);
                    item.tentativas++;
                    
                    if (item.tentativas >= 1) {
                        await notificar('bot-ksc-retry', `RETRY FALHOU - Tentativas esgotadas\n\nServidor: ${item.servidor}\nTentativas: ${item.tentativas}/1\nStatus: Servidor continua sem dados\nAcao: Removido da fila, sera tentado novamente amanha`, 'ERRO');
                        
                        const index = retryQueue.findIndex(i => i.servidor === item.servidor && i.semana === semanaAtual);
                        if (index !== -1) {
                            retryQueue.splice(index, 1);
                        }
                    }
                }
            } else {
                console.log(`Nenhum arquivo encontrado para ${item.servidor}`);
                item.tentativas++;
                
                if (item.tentativas >= 1) {
                    await notificar('bot-ksc-retry', `RETRY FALHOU - Arquivo nao encontrado\n\nServidor: ${item.servidor}\nTentativas: ${item.tentativas}/1\nStatus: Scraper nao conseguiu baixar arquivo\nAcao: Removido da fila`, 'ERRO');
                    
                    const index = retryQueue.findIndex(i => i.servidor === item.servidor && i.semana === semanaAtual);
                    if (index !== -1) {
                        retryQueue.splice(index, 1);
                    }
                }
            }
            
        } catch (erro) {
            console.error(`Erro ao processar ${item.servidor}:`, erro.message);
            item.tentativas++;
            
            if (item.tentativas >= 1) {
                await notificar('bot-ksc-retry', `RETRY FALHOU - Erro no scraper\n\nServidor: ${item.servidor}\nErro: ${erro.message}\nTentativas: ${item.tentativas}/1\nAcao: Removido da fila`, 'ERRO');
                
                const index = retryQueue.findIndex(i => i.servidor === item.servidor && i.semana === semanaAtual);
                if (index !== -1) {
                    retryQueue.splice(index, 1);
                }
            }
        }
    }
    
    fs.writeFileSync(retryQueuePath, JSON.stringify(retryQueue, null, 2));
    console.log('\nProcessamento da fila de retry finalizado.');
    
    const itensRestantes = retryQueue.filter(item => item.semana === semanaAtual);
    if (itensRestantes.length > 0) {
        await notificar('bot-ksc-retry', `Fila de retry atualizada\n\nServidores restantes: ${itensRestantes.length}\nProxima tentativa: Em 15 minutos`, 'INFO');
    }
}

processarFilaRetry().catch(async (erro) => {
    console.error('Erro fatal no processamento de retry:', erro);
    await notificar('bot-ksc-retry', `ERRO FATAL no retry\n\nErro: ${erro.message}`, 'ERRO');
    process.exit(1);
});
