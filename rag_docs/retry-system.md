# Sistema de Retry Automático

## Visão Geral

Sistema automático que detecta arquivos CSV vazios da **semana atual** e tenta reprocessá-los automaticamente após 15 minutos, evitando dados perdidos por falhas temporárias.

## Funcionamento

### 1. Detecção (db_sync.js)

Quando o `db_sync.js` encontra um arquivo vazio:

**Arquivo da Semana Atual:**
- ✅ Adiciona à fila de retry (`retry_queue.json`)
- ✅ Notifica que será tentado novamente em 15 minutos
- ✅ Extrai nome do servidor do arquivo

**Arquivo de Semana Anterior:**
- ❌ **NÃO** adiciona à fila
- ❌ **NÃO** tenta reprocessar
- ✅ Notifica que é de semana anterior e será ignorado

### 2. Fila de Retry (retry_queue.json)

Arquivo JSON que armazena servidores para retry:

```json
[
  {
    "servidor": "PDOC-KSCWB01",
    "arquivo": "3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv",
    "semana": "3_22_2026-3_29_2026",
    "tentativas": 0,
    "adicionadoEm": "2026-03-22T18:05:30.123Z"
  }
]
```

**Campos:**
- `servidor`: nome do servidor extraído do arquivo
- `arquivo`: nome completo do arquivo vazio
- `semana`: semana de referência
- `tentativas`: contador de tentativas (máximo 1)
- `adicionadoEm`: timestamp de quando foi adicionado

### 3. Processamento (retry_empty_files.js)

Executado automaticamente a cada **15 minutos** pelo scheduler.

**Fluxo:**
1. Lê `retry_queue.json`
2. Filtra apenas itens da semana atual com `tentativas < 1`
3. Para cada servidor:
   - Executa `scraper_single.js` com nome do servidor
   - Aguarda conclusão (timeout 5 minutos)
   - Verifica se novo arquivo foi criado
   - Valida se arquivo tem dados
4. Atualiza fila conforme resultado

### 4. Agendamento (scheduler.js)

Cron job adicional que roda a cada 15 minutos:

```javascript
cron.schedule('*/15 * * * *', () => {
    exec('node retry_empty_files.js');
}, {
    timezone: "America/Sao_Paulo"
});
```

## Resultados Possíveis

### ✅ Retry Bem-Sucedido

Arquivo agora tem dados:

```
[OK] bot-ksc-retry: RETRY BEM-SUCEDIDO!

Servidor: PDOC-KSCWB01
Arquivo: 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv
Linhas de dados: 42
Status: Servidor agora tem dados
```

**Ação:** Servidor removido da fila

### ❌ Retry Falhou - Arquivo Ainda Vazio

Arquivo continua sem dados após 1 tentativa:

```
[ERRO] bot-ksc-retry: RETRY FALHOU - Tentativas esgotadas

Servidor: PDOC-KSCWB01
Tentativas: 1/1
Status: Servidor continua sem dados
Acao: Removido da fila, sera tentado novamente amanha
```

**Ação:** Servidor removido da fila (será detectado novamente no próximo scraping completo)

### ❌ Retry Falhou - Arquivo Não Encontrado

Scraper não conseguiu baixar:

```
[ERRO] bot-ksc-retry: RETRY FALHOU - Arquivo nao encontrado

Servidor: PDOC-KSCWB01
Tentativas: 1/1
Status: Scraper nao conseguiu baixar arquivo
Acao: Removido da fila
```

**Ação:** Servidor removido da fila

### ❌ Retry Falhou - Erro no Scraper

Erro durante execução:

```
[ERRO] bot-ksc-retry: RETRY FALHOU - Erro no scraper

Servidor: PDOC-KSCWB01
Erro: Timeout exceeded
Tentativas: 1/1
Acao: Removido da fila
```

**Ação:** Servidor removido da fila

## Proteções Implementadas

### 1. Apenas Semana Atual

```javascript
if (arquivo.startsWith(prefixoSemana)) {
    // Adiciona à fila
} else {
    // Ignora (semana anterior)
}
```

**Por quê?**
- Evita reprocessar dados antigos
- Previne sobrescrita de dados corretos
- Mantém integridade histórica

### 2. Limite de Tentativas

Apenas **1 tentativa** por servidor:

```javascript
if (item.tentativas >= 1) {
    // Remove da fila
}
```

**Por quê?**
- Evita loops infinitos
- Reduz carga no sistema
- Servidor será tentado novamente no próximo dia

### 3. Validação de Duplicatas

```javascript
const jaExiste = retryQueue.find(item => 
    item.servidor === servidor && item.semana === semanaAtual
);

if (!jaExiste) {
    // Adiciona
}
```

**Por quê?**
- Evita múltiplas entradas do mesmo servidor
- Previne tentativas duplicadas

### 4. Validação de Semana

```javascript
const itensParaProcessar = retryQueue.filter(item => 
    item.semana === semanaAtual && item.tentativas < 1
);
```

**Por quê?**
- Processa apenas itens da semana atual
- Ignora itens de semanas passadas que ficaram na fila

## Notificações

### Detecção de Arquivo Vazio (Semana Atual)

```
[INFO] bot-ksc-db_sync: AVISO: Arquivo vazio detectado da SEMANA ATUAL

Arquivo: 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv
Servidor: PDOC-KSCWB01
Acao: Adicionado a fila de retry (tentativa em 15 minutos)
```

### Detecção de Arquivo Vazio (Semana Anterior)

```
[INFO] bot-ksc-db_sync: AVISO: Arquivo vazio detectado de SEMANA ANTERIOR

Arquivo: 3_15_2026-3_22_2026_Bild_windows_SERVIDOR_aplicativos.csv
Status: Sem dados para processar
Acao: Arquivo ignorado (nao e da semana atual)
```

### Início do Retry

```
[INFO] bot-ksc-retry: Iniciando retry de arquivos vazios

Servidores na fila: 1
Semana: 3_22_2026-3_29_2026
```

### Tentativa de Reprocessamento

```
[INFO] bot-ksc-retry: Tentando reprocessar servidor

Servidor: PDOC-KSCWB01
Tentativa: 1/1
Arquivo anterior: 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv
```

### Fila Atualizada

```
[INFO] bot-ksc-retry: Fila de retry atualizada

Servidores restantes: 0
Proxima tentativa: Em 15 minutos
```

## Fluxo Completo

### Cenário 1: Servidor Temporariamente Offline

**04:00** - Scraping completo
- Servidor PDOC-KSCWB01 offline
- Arquivo baixado vazio
- db_sync detecta e adiciona à fila

**04:15** - Primeiro retry (15 min depois)
- Servidor ainda offline
- Arquivo ainda vazio
- Tentativas: 1/1
- Removido da fila com notificação de falha

**Próximo dia 04:00** - Novo scraping completo
- Se servidor continuar offline, processo se repete
- Se servidor voltar, arquivo terá dados

### Cenário 2: Servidor Volta Online

**04:00** - Scraping completo
- Servidor PDOC-KSCWB01 offline
- Arquivo baixado vazio
- db_sync detecta e adiciona à fila

**04:15** - Primeiro retry (15 min depois)
- Servidor voltou online
- Arquivo baixado com 42 linhas
- Notificação de sucesso
- Removido da fila

**04:30** - Próximo ciclo de retry
- Fila vazia, nada a processar

## Arquivos Envolvidos

1. **retry_queue.json**: Fila de servidores para retry
2. **db_sync.js**: Detecta arquivos vazios e adiciona à fila
3. **retry_empty_files.js**: Processa fila de retry
4. **scraper_single.js**: Baixa arquivo de servidor específico
5. **scheduler.js**: Agenda retry a cada 15 minutos

## Logs Console

```
[22/03/2026, 18:05:30] Processando arquivo: 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv
AVISO: Arquivo 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv esta vazio (sem dados).
Servidor PDOC-KSCWB01 adicionado a fila de retry (semana atual).

[22/03/2026, 18:15:00] Verificando fila de retry (a cada 15 minutos)
Processando 1 servidor(es) da fila de retry...

Tentando reprocessar: PDOC-KSCWB01
Executando: node scraper_single.js "PDOC-KSCWB01"
Sucesso! Arquivo 3_22_2026-3_29_2026_Bild_windows_PDOC-KSCWB01_aplicativos.csv tem 42 linhas de dados.

Processamento da fila de retry finalizado.
```

## Manutenção

### Limpar Fila Manualmente

```bash
echo "[]" > retry_queue.json
```

### Ver Fila Atual

```bash
cat retry_queue.json
```

Ou no Windows:
```powershell
Get-Content retry_queue.json
```

### Executar Retry Manualmente

```bash
node retry_empty_files.js
```

### Desabilitar Retry

Comentar o cron job no `scheduler.js`:

```javascript
// cron.schedule('*/15 * * * *', () => {
//     exec('node retry_empty_files.js');
// });
```

## Limitações

1. **Apenas 1 tentativa**: Não tenta múltiplas vezes no mesmo dia
2. **Apenas semana atual**: Não reprocessa semanas anteriores
3. **Timeout de 5 minutos**: Scraper individual tem limite de tempo
4. **Sem priorização**: Todos os servidores são tratados igualmente

## Benefícios

✅ **Recuperação automática** de falhas temporárias
✅ **Sem intervenção manual** necessária
✅ **Proteção de dados** (não reprocessa semanas antigas)
✅ **Notificações detalhadas** de cada etapa
✅ **Baixo impacto** (apenas 1 tentativa)
✅ **Visibilidade total** do processo
