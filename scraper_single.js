const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const { notificar } = require('./notifier');

function getWeekRange() {
    const today = new Date();
    const firstDayOfWeek = new Date(today);
    firstDayOfWeek.setDate(today.getDate() - today.getDay());
    
    const lastDayOfWeek = new Date(firstDayOfWeek);
    lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 7);

    const format = (d) => `${d.getMonth() + 1}_${d.getDate()}_${d.getFullYear()}`;
    return `${format(firstDayOfWeek)}-${format(lastDayOfWeek)}`;
}

async function validarArquivoCSV(caminhoArquivo) {
    return new Promise((resolve) => {
        let linhasComDados = 0;
        
        fs.createReadStream(caminhoArquivo)
            .pipe(csv({
                mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, '')
            }))
            .on('data', () => {
                linhasComDados++;
            })
            .on('end', () => {
                resolve(linhasComDados);
            })
            .on('error', () => {
                resolve(0);
            });
    });
}

const nomeServidor = process.argv[2];

if (!nomeServidor) {
    console.error('ERRO: Nome do servidor nao fornecido.');
    console.log('Uso: node scraper_single.js "NOME_DO_SERVIDOR"');
    console.log('Exemplo: node scraper_single.js "pdaw-airwb01"');
    process.exit(1);
}

const nomePastaRelatorios = process.env.KSC_PASTA_RELATORIOS || 'relatorios';
const dirRelatorios = path.join(__dirname, nomePastaRelatorios);

if (!fs.existsSync(dirRelatorios)){
    fs.mkdirSync(dirRelatorios);
}

const isHeadless = process.env.KSC_HEADLESS ? process.env.KSC_HEADLESS === 'true' : false;

(async () => {
  await notificar('bot-ksc-scraper-single', `Iniciando busca do servidor: ${nomeServidor}`, 'INFO');
  
  const browser = await chromium.launch({ headless: isHeadless }); 
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  console.log("Iniciando login no KSC...");
  await notificar('bot-ksc-scraper-single', `Fazendo login no Kaspersky Security Center`, 'INFO');
  
  await page.goto('https://ksc.kaspersky.com/login');
  await page.getByTestId('signIn').click();
  
  await page.locator('[data-test-id="signin-login"]').click();
  await page.locator('[data-test-id="signin-login"]').fill(process.env.KSC_USER);
  await page.locator('[data-test-id="signin-password"]').click();
  await page.locator('[data-test-id="signin-password"]').fill(process.env.KSC_PASSWORD);
  await page.locator('[data-test-id="signin-proceed"]').click();

  console.log("Acessando o Workspace...");
  await notificar('bot-ksc-scraper-single', `Acessando workspace: ${process.env.KSC_WORKSPACE}`, 'INFO');
  
  try {
    await page.goto('https://ksc.kaspersky.com/?ui_locales=pt-br#/dashboard');
  } catch (e) {
  }
  
  let tentativasWorkspace = 3;
  while (tentativasWorkspace > 0) {
      try {
          await page.getByText(process.env.KSC_WORKSPACE).click({ timeout: 60000 });
          await page.getByTestId('openWorkspaceLink').click({ timeout: 60000 });
          await page.getByRole('button', { name: 'OK' }).click({ timeout: 60000 });
          break;
      } catch (erro) {
          tentativasWorkspace--;
          if (tentativasWorkspace === 0) {
              throw erro;
          }
          console.log(`Falha ao acessar workspace. Recarregando pagina. Tentativas restantes: ${tentativasWorkspace}`);
          await page.reload();
          await page.waitForTimeout(30000);
      }
  }

  console.log("Navegando ate Ativos (dispositivos)...");
  await page.getByText('Ativos (dispositivos)').first().click({ timeout: 60000 });
  await page.locator('.ant-tree-switcher.ant-tree-switcher_close').click();

  const weekRange = getWeekRange();
  const categorias = ['Servers - Linux', 'Servers - Windows'];
  
  let servidorEncontrado = false;
  let categoriaEncontrada = null;
  let arquivoBaixado = null;

  await notificar('bot-ksc-scraper-single', `Procurando servidor "${nomeServidor}" em Linux e Windows...`, 'INFO');

  for (const categoria of categorias) {
    console.log(`\nBuscando em: ${categoria}`);
    
    await page.getByTestId('hierarchy-tree-body').getByText(categoria, { exact: true }).click();
    await page.waitForTimeout(3000); 

    const servidoresNaCategoria = await page.evaluate(() => {
        const linhas = document.querySelectorAll('.ant-table-tbody tr');
        let nomes = [];
        
        linhas.forEach(linha => {
            const link = linha.querySelector('a'); 
            if (link && link.innerText.trim() !== '>>' && link.innerText.trim().length > 3) {
                nomes.push(link.innerText.trim());
            }
        });
        
        return [...new Set(nomes)];
    });

    console.log(`Encontrados ${servidoresNaCategoria.length} servidores em ${categoria}.`);
    
    const servidorNaLista = servidoresNaCategoria.find(s => 
        s.toLowerCase().includes(nomeServidor.toLowerCase()) || 
        nomeServidor.toLowerCase().includes(s.toLowerCase())
    );

    if (servidorNaLista) {
        servidorEncontrado = true;
        categoriaEncontrada = categoria;
        
        console.log(`ENCONTRADO: ${servidorNaLista} em ${categoria}`);
        await notificar('bot-ksc-scraper-single', `Servidor encontrado!\n\nNome: ${servidorNaLista}\nCategoria: ${categoria}\nIniciando download do relatorio...`, 'INFO');
        
        try {
            await page.getByRole('link', { name: servidorNaLista }).click();
            await page.locator('a').filter({ hasText: 'Avançado' }).click();

            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('button', { name: ' Exportar para CSV' }).click();
            const download = await downloadPromise;

            const nomeCliente = process.env.KSC_WORKSPACE.split(' ')[0]; 
            const tipoServidor = categoria.split(' - ')[1].toLowerCase(); 
            const nomeArquivo = `${weekRange}_${nomeCliente}_${tipoServidor}_${servidorNaLista}_aplicativos.csv`;
            
            const caminhoArquivo = path.join(dirRelatorios, nomeArquivo);
            await download.saveAs(caminhoArquivo);
            arquivoBaixado = nomeArquivo;
            
            console.log(`Arquivo salvo: ${nomeArquivo}`);
            console.log('Validando conteudo do arquivo...');
            
            await page.waitForTimeout(2000);
            
            const linhasComDados = await validarArquivoCSV(caminhoArquivo);
            
            if (linhasComDados === 0) {
                await notificar('bot-ksc-scraper-single', `AVISO: Arquivo baixado esta VAZIO\n\nServidor: ${servidorNaLista}\nArquivo: ${nomeArquivo}\nLinhas de dados: 0\nStatus: Servidor sem aplicativos instalados ou sem dados`, 'INFO');
                console.log('AVISO: Arquivo CSV esta vazio (sem dados).');
            } else {
                await notificar('bot-ksc-scraper-single', `Download concluido com SUCESSO!\n\nServidor: ${servidorNaLista}\nCategoria: ${categoria}\nArquivo: ${nomeArquivo}\nLinhas de dados: ${linhasComDados}\nStatus: Arquivo valido com dados`, 'SUCESSO');
                console.log(`Arquivo valido com ${linhasComDados} linhas de dados.`);
            }

            await page.getByRole('button', { name: 'Cancelar' }).click();

        } catch (erro) {
            console.log(`Erro ao baixar relatorio: ${erro.message}`);
            await notificar('bot-ksc-scraper-single', `ERRO ao baixar relatorio\n\nServidor: ${servidorNaLista}\nErro: ${erro.message}`, 'ERRO');
            try { await page.getByRole('button', { name: 'Cancelar' }).click(); } catch(e) {}
        }
        
        break;
    }
  }

  await browser.close();

  if (!servidorEncontrado) {
    console.log(`\nServidor "${nomeServidor}" NAO ENCONTRADO em nenhuma categoria.`);
    await notificar('bot-ksc-scraper-single', `Servidor NAO encontrado\n\nBusca: ${nomeServidor}\nCategorias pesquisadas: Linux e Windows\nResultado: Servidor nao existe ou nome incorreto`, 'ERRO');
    process.exit(1);
  } else {
    console.log(`\nProcesso finalizado com sucesso!`);
  }
  
})().catch(async (erro) => {
  console.error('Erro fatal no scraper:', erro.message);
  await notificar('bot-ksc-scraper-single', `ERRO FATAL no processo\n\nServidor buscado: ${nomeServidor}\nErro: ${erro.message}`, 'ERRO');
  process.exit(1);
});
