# Scraper Individual de Servidor

## Visão Geral

Script para buscar e baixar o relatório de aplicativos de um servidor específico no Kaspersky Security Center, sem precisar iterar por todos os servidores.

## Arquivo: scraper_single.js

### Uso

```bash
node scraper_single.js "NOME_DO_SERVIDOR"
```

**Exemplos:**
```bash
node scraper_single.js "pdaw-airwb01"
node scraper_single.js "SRVBILDWEB01"
node scraper_single.js "pdoc-gestaoti"
```

### Parâmetros

**Obrigatório:**
- Nome do servidor (argumento posicional)
- Pode ser parcial (ex: "airwb01" encontra "pdaw-airwb01")
- Case-insensitive (não diferencia maiúsculas/minúsculas)

## Funcionamento

### 1. Validação de Entrada
- Verifica se nome do servidor foi fornecido
- Exibe mensagem de erro e exemplo de uso se não fornecido

### 2. Login e Acesso ao Workspace
- Faz login no KSC com credenciais do `.env`
- Acessa o workspace configurado
- Retry automático em caso de falha (3 tentativas)

### 3. Busca Automática
Procura o servidor em ambas as categorias:
- **Servers - Linux**
- **Servers - Windows**

**Estratégia de busca:**
- Busca parcial (substring)
- Case-insensitive
- Para na primeira correspondência encontrada

### 4. Download do Relatório
Quando encontra o servidor:
- Acessa a página de detalhes
- Vai para aba "Avançado"
- Exporta para CSV
- Salva com nomenclatura padrão

### 5. Validação do Arquivo
Após download:
- Lê o arquivo CSV
- Conta linhas de dados (excluindo cabeçalho)
- Reporta se arquivo está vazio ou contém dados

### 6. Notificações

O script envia notificações em cada etapa:

#### Início
```
[INFO] bot-ksc-scraper-single: Iniciando busca do servidor: pdaw-airwb01
```

#### Login
```
[INFO] bot-ksc-scraper-single: Fazendo login no Kaspersky Security Center
```

#### Acesso ao Workspace
```
[INFO] bot-ksc-scraper-single: Acessando workspace: Bild
```

#### Busca
```
[INFO] bot-ksc-scraper-single: Procurando servidor "pdaw-airwb01" em Linux e Windows...
```

#### Servidor Encontrado
```
[INFO] bot-ksc-scraper-single: Servidor encontrado!

Nome: pdaw-airwb01
Categoria: Servers - Linux
Iniciando download do relatorio...
```

#### Sucesso com Dados
```
[OK] bot-ksc-scraper-single: Download concluido com SUCESSO!

Servidor: pdaw-airwb01
Categoria: Servers - Linux
Arquivo: 3_22_2026-3_29_2026_Bild_linux_pdaw-airwb01_aplicativos.csv
Linhas de dados: 1237
Status: Arquivo valido com dados
```

#### Arquivo Vazio
```
[INFO] bot-ksc-scraper-single: AVISO: Arquivo baixado esta VAZIO

Servidor: pdaw-airwb01
Arquivo: 3_22_2026-3_29_2026_Bild_linux_pdaw-airwb01_aplicativos.csv
Linhas de dados: 0
Status: Servidor sem aplicativos instalados ou sem dados
```

#### Servidor Não Encontrado
```
[ERRO] bot-ksc-scraper-single: Servidor NAO encontrado

Busca: servidor-inexistente
Categorias pesquisadas: Linux e Windows
Resultado: Servidor nao existe ou nome incorreto
```

#### Erro Fatal
```
[ERRO] bot-ksc-scraper-single: ERRO FATAL no processo

Servidor buscado: pdaw-airwb01
Erro: Timeout exceeded while waiting for element
```

## Nomenclatura do Arquivo

Formato: `{semana}_{cliente}_{tipo}_{servidor}_aplicativos.csv`

**Exemplo:**
```
3_22_2026-3_29_2026_Bild_linux_pdaw-airwb01_aplicativos.csv
```

Componentes:
- `3_22_2026-3_29_2026`: semana de referência
- `Bild`: cliente (primeira palavra do workspace)
- `linux`: tipo de servidor (linux/windows)
- `pdaw-airwb01`: nome do servidor
- `aplicativos.csv`: sufixo fixo

## Validação de Dados

Após o download, o script:

1. Abre o arquivo CSV
2. Faz parsing das linhas
3. Conta registros (excluindo cabeçalho)
4. Reporta resultado:
   - **0 linhas**: arquivo vazio, servidor sem aplicativos
   - **N linhas**: arquivo válido com dados

## Casos de Uso

### 1. Reprocessar Servidor Específico
Quando um servidor teve problema no scraping completo:
```bash
node scraper_single.js "PDOC-KSCWB01"
```

### 2. Atualização Urgente
Buscar dados atualizados de um servidor crítico:
```bash
node scraper_single.js "pdaw-blinkwb01"
```

### 3. Verificação Manual
Conferir se servidor tem aplicativos instalados:
```bash
node scraper_single.js "servidor-novo"
```

### 4. Busca Parcial
Quando não sabe o nome completo:
```bash
node scraper_single.js "airwb"
```
Encontrará "pdaw-airwb01", "pdaw-airwb02", etc. (primeiro match)

## Diferenças do Scraper Completo

| Característica | scraper.js | scraper_single.js |
|----------------|------------|-------------------|
| Servidores | Todos | Um específico |
| Categorias | Configurável (.env) | Ambas (Linux + Windows) |
| Busca | Itera todos | Para no primeiro match |
| Tempo | Minutos/horas | Segundos/minutos |
| Notificações | Início e fim | Cada etapa detalhada |
| Validação | Não | Sim (conta linhas) |
| Uso | Automação diária | Ad-hoc/troubleshooting |

## Variáveis de Ambiente

Usa as mesmas variáveis do scraper completo:

```bash
KSC_USER=seu.email@empresa.com.br
KSC_PASSWORD=sua_senha_aqui
KSC_WORKSPACE=Nome do Workspace
KSC_PASTA_RELATORIOS=relatorios
KSC_HEADLESS=true
X_API_KEY=sua_chave_api_n8n
```

## Exit Codes

- **0**: Sucesso (servidor encontrado e arquivo baixado)
- **1**: Erro (servidor não encontrado, erro fatal, ou parâmetro faltando)

## Logs Console

```
Iniciando login no KSC...
Acessando o Workspace...
Navegando ate Ativos (dispositivos)...

Buscando em: Servers - Linux
Encontrados 13 servidores em Servers - Linux.

Buscando em: Servers - Windows
Encontrados 22 servidores em Servers - Windows.
ENCONTRADO: SRVBILDWEB01 em Servers - Windows
Arquivo salvo: 3_22_2026-3_29_2026_Bild_windows_SRVBILDWEB01_aplicativos.csv
Validando conteudo do arquivo...
Arquivo valido com 20 linhas de dados.

Processo finalizado com sucesso!
```

## Limitações

1. **Primeiro Match**: Para no primeiro servidor que corresponde ao nome
2. **Busca Simples**: Não suporta regex ou busca avançada
3. **Uma Execução**: Processa apenas um servidor por execução
4. **Sem Retry**: Se falhar o download, não tenta novamente

## Integração com db_sync

Após baixar o arquivo, pode sincronizar imediatamente:

```bash
node scraper_single.js "pdaw-airwb01"
node db_sync.js
```

Ou processar apenas o arquivo específico editando `db_sync.js` temporariamente.

## Troubleshooting

### Servidor não encontrado
- Verifique o nome exato no KSC
- Tente busca parcial (parte do nome)
- Confirme que servidor está em Linux ou Windows

### Arquivo vazio
- Normal se servidor não tem aplicativos instalados
- Verifique no KSC se há dados na aba "Avançado"

### Timeout
- Aumente timeouts no código se necessário
- Verifique conexão com KSC
- Tente com `KSC_HEADLESS=false` para debug visual

## Exemplo Completo

```bash
# Buscar servidor específico
node scraper_single.js "pdoc-integrap01"

# Saída esperada:
# [INFO] Iniciando busca do servidor: pdoc-integrap01
# [INFO] Fazendo login no Kaspersky Security Center
# [INFO] Acessando workspace: Bild
# [INFO] Procurando servidor "pdoc-integrap01" em Linux e Windows...
# [INFO] Servidor encontrado!
#        Nome: pdoc-integrap01
#        Categoria: Servers - Linux
#        Iniciando download do relatorio...
# [OK] Download concluido com SUCESSO!
#      Servidor: pdoc-integrap01
#      Categoria: Servers - Linux
#      Arquivo: 3_22_2026-3_29_2026_Bild_linux_pdoc-integrap01_aplicativos.csv
#      Linhas de dados: 617
#      Status: Arquivo valido com dados
```
