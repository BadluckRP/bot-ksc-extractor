# Sistema de Retry no Windows Host

## Funcionamento no Windows

O sistema de retry **funciona perfeitamente no Windows host**, não é exclusivo para containers Docker.

## Como Usar no Windows

### Opção 1: Agendamento Automático com Task Scheduler

Para ter o retry automático a cada 15 minutos no Windows, use o **Agendador de Tarefas** (Task Scheduler):

#### Passo a Passo

1. **Abrir Task Scheduler**
   - Pressione `Win + R`
   - Digite `taskschd.msc`
   - Pressione Enter

2. **Criar Nova Tarefa**
   - Clique em "Criar Tarefa Básica"
   - Nome: `KSC Retry Empty Files`
   - Descrição: `Tenta reprocessar arquivos vazios a cada 15 minutos`

3. **Configurar Gatilho**
   - Quando: "Diariamente"
   - Hora de início: `00:00` (meia-noite)
   - Repetir tarefa a cada: `15 minutos`
   - Por um período de: `1 dia`
   - Marcar: "Habilitado"

4. **Configurar Ação**
   - Ação: "Iniciar um programa"
   - Programa/script: `node`
   - Adicionar argumentos: `retry_empty_files.js`
   - Iniciar em: `C:\Desenvolvimento\Infra\bot-ksc-extractor`

5. **Configurações Adicionais**
   - ✅ Executar se o usuário estiver conectado ou não
   - ✅ Executar com privilégios mais altos (se necessário)
   - ✅ Configurar para: Windows 10

6. **Salvar**
   - Pode pedir senha do usuário
   - Tarefa será executada automaticamente

### Opção 2: Executar Manualmente

Você pode executar o retry manualmente a qualquer momento:

```powershell
cd C:\Desenvolvimento\Infra\bot-ksc-extractor
node retry_empty_files.js
```

### Opção 3: Script PowerShell com Loop

Criar um script que fica rodando em background:

**Arquivo: `start_retry_loop.ps1`**

```powershell
# Loop infinito que executa retry a cada 15 minutos
while ($true) {
    $timestamp = Get-Date -Format "dd/MM/yyyy HH:mm:ss"
    Write-Host "[$timestamp] Executando retry..."
    
    node retry_empty_files.js
    
    Write-Host "[$timestamp] Aguardando 15 minutos..."
    Start-Sleep -Seconds 900  # 15 minutos
}
```

**Executar:**
```powershell
.\start_retry_loop.ps1
```

## Notificações do Sistema de Retry

### 1. Quando Retry Inicia (a cada 15 minutos)

```
[INFO] bot-ksc-retry: Sistema de retry iniciado

Horario: 22/03/2026 18:15:00
Verificando fila de servidores vazios...
```

### 2. Quando Encontra Servidores na Fila

```
[INFO] bot-ksc-retry: Iniciando processamento de retry

Servidores na fila: 2
Semana: 3_22_2026-3_29_2026
Tentativas permitidas: 1 por servidor
```

### 3. Quando Servidor é Adicionado à Fila (db_sync)

```
[INFO] bot-ksc-db_sync: AVISO: Arquivo vazio detectado da SEMANA ATUAL

Arquivo: 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv
Servidor: PDOC-KSCWB01
Acao: Adicionado a fila de retry (tentativa em 15 minutos)
```

**Você recebe notificação IMEDIATAMENTE quando servidor entra na fila!**

### 4. Tentativa de Reprocessamento

```
[INFO] bot-ksc-retry: Tentando reprocessar servidor

Servidor: PDOC-KSCWB01
Tentativa: 1/1
Arquivo anterior: 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv
```

### 5. Resultado do Retry

**Sucesso:**
```
[OK] bot-ksc-retry: RETRY BEM-SUCEDIDO!

Servidor: PDOC-KSCWB01
Arquivo: 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv
Linhas de dados: 42
Status: Servidor agora tem dados
```

**Falha:**
```
[ERRO] bot-ksc-retry: RETRY FALHOU - Tentativas esgotadas

Servidor: PDOC-KSCWB01
Tentativas: 1/1
Status: Servidor continua sem dados
Acao: Removido da fila, sera tentado novamente amanha
```

## Diferenças: Windows Host vs Docker Container

| Aspecto | Windows Host | Docker Container |
|---------|--------------|------------------|
| **Funcionamento** | ✅ Funciona perfeitamente | ✅ Funciona perfeitamente |
| **Agendamento** | Task Scheduler ou script PS | Cron job no scheduler.js |
| **Execução manual** | `node retry_empty_files.js` | `docker exec -it bot_ksc_playwright node retry_empty_files.js` |
| **Notificações** | ✅ Todas as notificações | ✅ Todas as notificações |
| **Fila** | `retry_queue.json` local | `retry_queue.json` no container |
| **Logs** | Console do PowerShell | Logs do container |

## Fluxo Completo no Windows Host

### Cenário: Servidor Vazio Detectado

**1. Execução do db_sync (manual ou agendado)**
```powershell
PS C:\Desenvolvimento\Infra\bot-ksc-extractor> node db_sync.js
```

**Saída:**
```
Processando arquivo: 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv
AVISO: Arquivo 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv esta vazio (sem dados).
Servidor PDOC-KSCWB01 adicionado a fila de retry (semana atual).
```

**Notificação WhatsApp recebida imediatamente:**
```
[INFO] bot-ksc-db_sync: AVISO: Arquivo vazio detectado da SEMANA ATUAL

Arquivo: 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv
Servidor: PDOC-KSCWB01
Acao: Adicionado a fila de retry (tentativa em 15 minutos)
```

**2. Após 15 minutos (Task Scheduler ou manual)**
```powershell
PS C:\Desenvolvimento\Infra\bot-ksc-extractor> node retry_empty_files.js
```

**Notificação WhatsApp:**
```
[INFO] bot-ksc-retry: Sistema de retry iniciado

Horario: 22/03/2026 18:15:00
Verificando fila de servidores vazios...
```

**Depois:**
```
[INFO] bot-ksc-retry: Iniciando processamento de retry

Servidores na fila: 1
Semana: 3_22_2026-3_29_2026
Tentativas permitidas: 1 por servidor
```

**3. Processamento**

O script executa:
```
node scraper_single.js "PDOC-KSCWB01"
```

**4. Resultado**

Se sucesso:
```
[OK] bot-ksc-retry: RETRY BEM-SUCEDIDO!
...
```

Se falha:
```
[ERRO] bot-ksc-retry: RETRY FALHOU - Tentativas esgotadas
...
```

## Verificar Fila Atual

```powershell
Get-Content retry_queue.json | ConvertFrom-Json | Format-Table
```

**Exemplo de saída:**
```
servidor        arquivo                                                semana              tentativas adicionadoEm
--------        -------                                                ------              ---------- ------------
PDOC-KSCWB01    3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_apli... 3_22_2026-3_29_2026 0          2026-03-22T18:05:30.123Z
```

## Limpar Fila Manualmente

```powershell
echo "[]" > retry_queue.json
```

## Testar Sistema de Retry

### 1. Simular Arquivo Vazio

Criar arquivo CSV vazio:
```powershell
echo "Nome,Versão,Fornecedor,Atualizações" > relatorios\3_22_2026-3_29_2026_Bild_windows_TESTE_aplicativos.csv
```

### 2. Executar db_sync

```powershell
node db_sync.js
```

Você receberá notificação que o arquivo foi adicionado à fila.

### 3. Executar Retry

```powershell
node retry_empty_files.js
```

Você receberá notificações do processamento.

## Logs e Monitoramento

### Ver Logs em Tempo Real

```powershell
# Executar retry com saída visível
node retry_empty_files.js
```

### Redirecionar Logs para Arquivo

```powershell
node retry_empty_files.js >> logs\retry.log 2>&1
```

### Ver Últimas Execuções

```powershell
Get-Content logs\retry.log -Tail 50
```

## Troubleshooting

### Retry não está executando

**Verificar Task Scheduler:**
1. Abrir Task Scheduler
2. Procurar tarefa "KSC Retry Empty Files"
3. Verificar "Última Execução" e "Próxima Execução"
4. Ver histórico de execuções

**Verificar manualmente:**
```powershell
node retry_empty_files.js
```

### Fila não está sendo processada

**Verificar conteúdo da fila:**
```powershell
Get-Content retry_queue.json
```

**Verificar semana atual:**
```powershell
node -e "const d = new Date(); const f = new Date(d); f.setDate(d.getDate() - d.getDay()); const l = new Date(f); l.setDate(f.getDate() + 7); const fmt = (d) => `${d.getMonth() + 1}_${d.getDate()}_${d.getFullYear()}`; console.log(`${fmt(f)}-${fmt(l)}`);"
```

### Notificações não estão chegando

**Verificar X_API_KEY no .env:**
```powershell
Get-Content .env | Select-String "X_API_KEY"
```

**Testar notificação:**
```powershell
node -e "const {notificar} = require('./notifier'); notificar('teste', 'Teste de notificacao', 'INFO');"
```

## Recomendações

### Para Uso Diário no Windows

1. **Configure Task Scheduler** para retry automático a cada 15 minutos
2. **Configure Task Scheduler** para scraping completo às 04:00
3. **Mantenha PowerShell aberto** para ver logs em tempo real (opcional)
4. **Monitore WhatsApp** para notificações

### Para Desenvolvimento/Testes

1. **Execute manualmente** quando necessário
2. **Use script PowerShell** com loop para testes prolongados
3. **Limpe a fila** entre testes se necessário

## Resumo

✅ **Funciona no Windows**: Sistema completo funciona no host Windows
✅ **Notificações imediatas**: Você é avisado quando servidor entra na fila
✅ **Notificações de início**: Você é avisado quando retry inicia (a cada 15 min)
✅ **Notificações de resultado**: Você é avisado do sucesso ou falha
✅ **Agendamento flexível**: Task Scheduler, script PS ou manual
✅ **Mesmas proteções**: Apenas semana atual, 1 tentativa, sem duplicatas

**O sistema de retry é totalmente funcional no Windows host!**
