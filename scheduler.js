const cron = require('node-cron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { notificar } = require('./notifier');

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
console.log(`[${timestamp}] Scheduler iniciado. Aguardando execucao as 04:00 (America/Sao_Paulo)...`);

const hoje = new Date();
const proximaExecucao = new Date(hoje);
proximaExecucao.setHours(4, 0, 0, 0);

if (proximaExecucao <= hoje) {
    proximaExecucao.setDate(proximaExecucao.getDate() + 1);
}

const proximaExecucaoStr = proximaExecucao.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

notificar('bot-ksc-scheduler', `Scheduler iniciado e agendado com sucesso. Proxima execucao: ${proximaExecucaoStr} (horario de Sao Paulo)`, 'INFO');

cron.schedule('*/15 * * * *', () => {
    const execTimestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log(`[${execTimestamp}] Verificando fila de retry (a cada 15 minutos)`);
    
    exec('node retry_empty_files.js', (error, stdout, stderr) => {
        if (error) {
            console.error(`Erro no retry: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(stderr);
        }
        console.log(stdout);
    });
}, {
    timezone: "America/Sao_Paulo"
});

cron.schedule('0 4 * * *', () => {
    const execTimestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const logFile = path.join(logDir, `execution-${new Date().toISOString().split('T')[0]}.log`);
    
    console.log(`[${execTimestamp}] Iniciando execucao agendada`);
    notificar('bot-ksc-scheduler', 'Execucao agendada iniciada (04:00)', 'INFO');
    
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    const child = exec('node run.js', (error, stdout, stderr) => {
        if (error) {
            console.error(`Erro: ${error.message}`);
            logStream.write(`[ERRO] ${error.message}\n`);
            logStream.end();
            return;
        }
        if (stderr) {
            console.error(stderr);
            logStream.write(`[STDERR] ${stderr}\n`);
        }
        console.log(stdout);
        logStream.write(stdout);
        logStream.end();
    });
    
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
}, {
    timezone: "America/Sao_Paulo"
});