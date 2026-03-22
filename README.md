# bot-ksc-extractor

Bot de scraping para extração de relatórios do Kaspersky Security Center e sincronização com PostgreSQL.

## Setup

### Local (Windows)

```bash
npm install
cp .env.example .env
```

Edite `.env` com suas credenciais e execute:

```bash
node scraper.js
node db_sync.js
```

### Docker

```bash
cp .env.example .env
```

Edite `.env` com credenciais e configure `DB_HOST=postgres-db` e `DB_PORT=5432` para uso no Docker.

```bash
docker-compose up -d
docker exec -it bot_ksc_playwright bash
node scraper.js
node db_sync.js
```

## Estrutura

- `scraper.js`: extração via Playwright
- `db_sync.js`: sincronização CSV → PostgreSQL
- `relatorios/`: CSVs baixados
- `rag_docs/`: documentação técnica

## Configuração

### Variáveis Obrigatórias

- `KSC_USER`: email de login
- `KSC_PASSWORD`: senha
- `KSC_WORKSPACE`: nome do workspace
- `DB_*`: credenciais PostgreSQL

### Variáveis Opcionais

- `KSC_CATEGORIAS`: categorias alvo (padrão: "Servers - Linux,Servers - Windows")
- `KSC_PASTA_RELATORIOS`: pasta destino (padrão: "relatorios")
- `KSC_HEADLESS`: modo headless (padrão: "false")

## Uso

### Scraper Individual (Um Servidor Específico)

Busca e baixa o relatório de apenas um servidor:

```bash
node scraper_single.js "NOME_DO_SERVIDOR"
```

**Exemplos:**
```bash
node scraper_single.js "pdaw-airwb01"
node scraper_single.js "SRVBILDWEB01"
```

**Características:**
- Busca automática em Linux e Windows
- Para no primeiro servidor encontrado
- Valida se arquivo contém dados
- Notificações detalhadas de cada etapa
- Ideal para reprocessamento ou verificação pontual

### Extração Completa (Todos os Servidores)
```bash
node scraper.js
```

### Sincronização
```bash
node db_sync.js
node db_sync.js --all
```

## Ambiente

O sistema usa `.env` para todas as configurações. Ajuste `DB_HOST` e `DB_PORT` conforme o ambiente (localhost:5442 para host, postgres-db:5432 para Docker).

## Automação

### Execução Manual

```bash
node run.js
```

Executa scraper.js seguido de db_sync.js em sequência.

### Execução Agendada

O sistema está configurado para executar automaticamente às **04:00 (horário de São Paulo)** todos os dias.

**Como funciona:**
- `scheduler.js`: agendador com node-cron
- `run.js`: orquestrador que executa scraper → db_sync
- Logs salvos em `logs/execution-YYYY-MM-DD.log`
- Timezone: America/Sao_Paulo (configurado nos containers)

**Iniciar scheduler:**

```bash
docker-compose up -d
```

O scheduler inicia automaticamente e aguarda o horário agendado.

**Verificar logs:**

```bash
docker logs -f bot_ksc_playwright
```

**Testar execução imediata:**

```bash
docker exec -it bot_ksc_playwright node run.js
```

## Notificações WhatsApp

O sistema envia notificações automáticas via WhatsApp para monitoramento em tempo real.

### Configuração

Adicione a chave de API no `.env`:

```bash
X_API_KEY="sua_chave_api_n8n"
```

### Eventos Notificados

- **Container**: startup com informações do ambiente (IP, hostname, memória, etc)
- **Scheduler**: início com próxima execução agendada
- **Scraper**: início, sucesso e erros na extração
- **DB Sync**: início, sucesso e erros na sincronização
- **Orchestrator**: status geral do processo

### Formato das Mensagens

```
[INFO] bot-ksc-container: Container iniciado com sucesso
Hostname: bot_ksc_playwright
IP: 172.18.0.3
Plataforma: linux (x64)
Node: v20.11.0
Memoria: 2.5GB livre de 8GB
Timezone: America/Sao_Paulo
Hora atual: 22/03/2026 17:48:30
KSC_HEADLESS: true
Proximo agendamento: 04:00 (America/Sao_Paulo)

[INFO] bot-ksc-scheduler: Scheduler iniciado e agendado com sucesso. Proxima execucao: 23/03/2026 04:00:00

[ERRO] bot-ksc-container: Container iniciado com sucesso
...
KSC_HEADLESS: false

*** ATENCAO: KSC_HEADLESS=false ***
Container Docker requer KSC_HEADLESS=true para funcionar!
Altere no .env e reinicie o container.

[INFO] bot-ksc-scraper: Iniciando extracao de relatorios

[INFO] bot-ksc-db_sync: Iniciando sincronizacao de CSVs para PostgreSQL

Database: ksc_dados
Host: postgres-db:5432
Tabela: aplicativos_kaspersky
Semana de referencia: 3_16_2026-3_23_2026
Modo: Apenas semana atual

[INFO] bot-ksc-db_sync: Encontrados 5 arquivo(s) CSV para processar na semana 3_16_2026-3_23_2026

[OK] bot-ksc-db_sync: Sincronizacao finalizada com sucesso!

Database: ksc_dados@postgres-db
Tabela: aplicativos_kaspersky
Semana: 3_16_2026-3_23_2026

ARQUIVOS:
- Total encontrado: 5
- Processados com sucesso: 4
- Vazios (sem dados): 1
- Com erro: 0

REGISTROS:
- Inseridos: 247
- Soft-deleted: 198
- Total no banco: 247

[ERRO] bot-ksc-orchestrator: FALHA CRITICA: Connection timeout
```

### Desabilitar Notificações

Deixe `X_API_KEY` vazio no `.env`. O sistema continuará funcionando normalmente com logs locais.

## Sistema de Retry Automático

O sistema detecta automaticamente arquivos CSV vazios **da semana atual** e tenta reprocessá-los após 15 minutos.

### Como Funciona

1. **db_sync** detecta arquivo vazio da semana atual
2. Servidor é adicionado à fila de retry (`retry_queue.json`)
3. A cada **15 minutos**, o sistema tenta reprocessar
4. Usa `scraper_single.js` para baixar apenas aquele servidor
5. **Apenas 1 tentativa** por servidor
6. Se falhar, será tentado novamente no próximo dia

### Proteções

- ✅ **Apenas semana atual**: arquivos de semanas anteriores são ignorados
- ✅ **Limite de tentativas**: máximo 1 retry por servidor
- ✅ **Sem duplicatas**: não adiciona servidor já na fila
- ✅ **Notificações detalhadas**: informa sucesso ou falha

### Arquivos

- `retry_queue.json`: fila de servidores para retry
- `retry_empty_files.js`: processa fila automaticamente

### Uso no Windows Host

O sistema de retry **funciona perfeitamente no Windows**:

**Executar manualmente:**
```powershell
node retry_empty_files.js
```

**Agendar com Task Scheduler:**
- Criar tarefa que executa `node retry_empty_files.js`
- Repetir a cada 15 minutos
- Iniciar em: `C:\Desenvolvimento\Infra\bot-ksc-extractor`

**Notificações:**
- ✅ Quando servidor entra na fila (imediato)
- ✅ Quando retry inicia (a cada 15 min)
- ✅ Resultado de cada tentativa

Ver documentação completa em `rag_docs/retry-windows.md`

## Métricas do Banco de Dados

As métricas são **enviadas automaticamente** após cada sincronização bem-sucedida do `db_sync.js`.

### Executar Métricas Manualmente

Você também pode consultar métricas detalhadas do banco a qualquer momento:

```powershell
node db_metrics.js
```

**Informações fornecidas:**
- Total de registros (ativos vs soft-deleted com percentuais)
- Tamanho da tabela em disco (formatado automaticamente em MB/GB)
- Total de arquivos CSV fonte
- Distribuição por sistema operacional
- Histórico de atualizações da última semana
- Data/hora da última atualização

**No Docker:**
```bash
docker exec -it bot_ksc_playwright node db_metrics.js
```
