# Métricas do Banco de Dados

## Visão Geral

Script para coletar e enviar métricas detalhadas do banco de dados PostgreSQL via notificação WhatsApp.

**Execução:**
- Automática: chamado ao final de cada sincronização bem-sucedida (`db_sync.js`)
- Manual: pode ser executado independentemente a qualquer momento

## Arquivo: db_metrics.js

### Execução

```bash
node db_metrics.js
```

Pode ser executado a qualquer momento, independente do processo de scraping ou sincronização.

## Métricas Coletadas

### 1. Contadores de Registros

**Registros Ativos**
- Total de registros com `deleted_at IS NULL`
- Percentual em relação ao total

**Registros Soft-Deleted**
- Total de registros com `deleted_at IS NOT NULL`
- Percentual em relação ao total

**Total Geral**
- Soma de todos os registros na tabela

### 2. Tamanho da Tabela

**Tamanho Total**
- Inclui dados + índices + TOAST
- Formatado automaticamente (KB/MB/GB)

**Tamanho dos Dados**
- Apenas os dados da tabela
- Formatado automaticamente

**Bytes Totais**
- Valor bruto em bytes para cálculos

### 3. Arquivos CSV Fonte

**Total de Fontes**
- Quantidade de arquivos CSV únicos no banco

**Média de Registros**
- Média de registros por arquivo fonte

### 4. Distribuição por Sistema

**Categorias**
- Linux: arquivos contendo "linux" no nome
- Windows: arquivos contendo "windows" no nome
- Outros: demais arquivos

**Informações por Categoria**
- Total de registros
- Percentual em relação aos registros ativos

### 5. Histórico da Última Semana

Para cada dia dos últimos 7 dias com atualizações:

**Dia da Semana + Data**
- Formato: "Seg 22/03"

**Quantidade de Registros**
- Total de registros atualizados no dia

**Horários**
- Primeiro horário de atualização
- Último horário de atualização
- Formato: "04:00 - 04:15"

### 6. Última Atualização

**Data/Hora da Última Atualização**
- Maior valor de `updated_at` na tabela
- Formato brasileiro com timezone São Paulo

**Último Registro Criado**
- Maior valor de `created_at` na tabela
- Indica quando foi o último insert

## Formato da Notificação

```
[INFO] bot-ksc-db_metrics: Metricas do Banco de Dados

DATABASE: ksc_dados@172.16.10.8
TABELA: aplicativos_kaspersky

REGISTROS:
- Total: 12.876
- Ativos: 12.876 (100.00%)
- Soft-deleted: 0 (0.00%)

TAMANHO:
- Total (tabela + indices): 2.90 MB
- Dados: 2.50 MB

ARQUIVOS CSV:
- Total de fontes: 36
- Media de registros por arquivo: 357

DISTRIBUICAO POR SISTEMA:
- Windows: 7.234 registros (56.18%)
- Linux: 5.642 registros (43.82%)

HISTORICO ULTIMA SEMANA:
- Sab 22/03: 12876 registros (18:01 - 18:05)

ULTIMA ATUALIZACAO:
- Data/Hora: 22/03/2026 18:05:32
- Ultimo registro criado: 22/03/2026 18:05:32
```

## Queries SQL Utilizadas

### Registros Ativos
```sql
SELECT COUNT(*) as total 
FROM aplicativos_kaspersky 
WHERE deleted_at IS NULL
```

### Registros Deletados
```sql
SELECT COUNT(*) as total 
FROM aplicativos_kaspersky 
WHERE deleted_at IS NOT NULL
```

### Tamanho da Tabela
```sql
SELECT 
    pg_size_pretty(pg_total_relation_size('aplicativos_kaspersky')) as tamanho_total,
    pg_total_relation_size('aplicativos_kaspersky') as bytes_total,
    pg_size_pretty(pg_relation_size('aplicativos_kaspersky')) as tamanho_dados,
    pg_relation_size('aplicativos_kaspersky') as bytes_dados
```

### Histórico da Última Semana
```sql
SELECT 
    DATE(updated_at) as dia,
    COUNT(*) as registros,
    MAX(updated_at) as ultimo_horario,
    MIN(updated_at) as primeiro_horario
FROM aplicativos_kaspersky
WHERE updated_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(updated_at)
ORDER BY dia DESC
```

### Distribuição por Categoria
```sql
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
```

## Uso Recomendado

### Monitoramento Regular
Execute semanalmente para acompanhar crescimento do banco:
```bash
node db_metrics.js
```

### Após Sincronização
Verificar impacto de uma sincronização:
```bash
node db_sync.js
node db_metrics.js
```

### Troubleshooting
Investigar problemas de performance ou espaço em disco:
```bash
node db_metrics.js
```

### No Docker
```bash
docker exec -it bot_ksc_playwright node db_metrics.js
```

## Tratamento de Erros

Erros na coleta de métricas:
- Não afetam outros processos
- Geram notificação de erro
- Logados no console
- Exit code 1

## Dependências

- `pg`: cliente PostgreSQL
- `dotenv`: variáveis de ambiente
- `notifier.js`: envio de notificações

## Variáveis de Ambiente Necessárias

```bash
DB_USER=root
DB_PASSWORD=rootpassword
DB_HOST=172.16.10.8
DB_PORT=5432
DB_NAME=ksc_dados
X_API_KEY=sua_chave_api_n8n
```
