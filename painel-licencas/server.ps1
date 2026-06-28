$ErrorActionPreference = 'Continue'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8200/")

# CONFIGURAÇÃO DE SENHA DO ADMIN (Alterado para a sua senha)
$global:AdminPassword = "22780505@@Liz"

# Sessões do Administrador em Memória
$global:AdminSessions = @{} # token -> expiration (DateTime)

# Obter o diretorio atual do script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = Get-Location }
$keysFile = Join-Path $scriptDir "keys.json"

# Helper: Carregar Licenças
function Get-KeysDb {
    if (Test-Path $keysFile) {
        try {
            $content = Get-Content $keysFile -Raw -ErrorAction Stop
            return $content | ConvertFrom-Json
        } catch {
            return @{}
        }
    }
    return @{}
}

# Helper: Salvar Licenças
function Save-KeysDb($keys) {
    try {
        # Converter para formato JSON bonito e compacto
        $json = $keys | ConvertTo-Json -Depth 5 -Compress
        Set-Content -Path $keysFile -Value $json -Encoding UTF8 -ErrorAction Stop
        return $true
    } catch {
        Write-Host "Erro ao salvar keys.json: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Helper: Gerar chave aleatória
function Generate-LicenseKey {
    $parts = @()
    for ($i=0; $i -lt 3; $i++) {
        $part = -join ((65..90) + (48..57) | Get-Random -Count 5 | ForEach-Object {[char]$_})
        $parts += $part
    }
    return "OFT-" + ($parts -join "-")
}

# Helper: Responder com JSON
function Send-JsonResponse($response, $statusCode, $object) {
    $response.StatusCode = $statusCode
    $response.ContentType = "application/json; charset=utf-8"
    $json = $object | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.Close()
}

# Helper: Validar Autenticação do Admin
function Is-AdminAuthorized($authToken) {
    if ([string]::IsNullOrEmpty($authToken)) { return $false }
    if ($global:AdminSessions.ContainsKey($authToken)) {
        $expiry = $global:AdminSessions[$authToken]
        if ($expiry -gt (Get-Date)) {
            # Estender a sessão do admin por mais 2 horas
            $global:AdminSessions[$authToken] = (Get-Date).AddHours(2)
            return $true
        } else {
            $global:AdminSessions.Remove($authToken)
        }
    }
    return $false
}

try {
    $listener.Start()
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "   Servidor do Painel de Licencas Ativo" -ForegroundColor Green
    Write-Host "   Acesse no navegador: http://localhost:8200/admin" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "Mantenha esta janela aberta para validar as licenças do bot."
    Write-Host "Pressione Ctrl+C para encerrar."
    Write-Host ""

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        # Habilitar CORS
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization")
        
        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }
        
        $rawPath = $request.Url.LocalPath
        
        # Extrair token de autorização
        $authHeader = $request.Headers.Get("Authorization")
        $authToken = $null
        if ($authHeader -and $authHeader -like "Bearer *") {
            $authToken = $authHeader.Substring(7).Trim()
        }
        
        # =======================================================
        # ROTAS PÚBLICAS (Acessadas pelos Bots dos Clientes)
        # =======================================================
        
        # ROTA: Validar Licença do Cliente
        if ($rawPath -eq "/api/validate") {
            $keyParam = $request.QueryString["key"]
            if ([string]::IsNullOrEmpty($keyParam)) {
                Send-JsonResponse $response 400 @{ error = "Parametro 'key' ausente." }
                continue
            }
            
            $db = Get-KeysDb
            # Converter objeto db em hashtable para fácil consulta
            $keysHash = @{}
            if ($db) {
                foreach ($prop in $db.PSObject.Properties) {
                    $keysHash[$prop.Name] = $prop.Value
                }
            }
            
            if ($keysHash.ContainsKey($keyParam)) {
                $expiryDateStr = $keysHash[$keyParam]
                $expiryDate = [DateTime]::Parse($expiryDateStr)
                $now = Get-Date
                
                if ($expiryDate -gt $now) {
                    $daysLeft = [Math]::Ceiling(($expiryDate - $now).TotalDays)
                    Send-JsonResponse $response 200 @{
                        valid = $true
                        expiresAt = $expiryDateStr
                        daysLeft = $daysLeft
                    }
                } else {
                    Send-JsonResponse $response 200 @{
                        valid = $false
                        error = "A assinatura expirou em $($expiryDateStr.Split('T')[0])."
                    }
                }
            } else {
                Send-JsonResponse $response 200 @{
                    valid = $false
                    error = "Chave de licenca invalida ou nao cadastrada."
                }
            }
            continue
        }
        
        # =======================================================
        # ROTAS ADMINISTRATIVAS (Painel de Controle do Dono)
        # =======================================================
        
        # ROTA: Login do Admin
        elseif ($rawPath -eq "/api/admin/login" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream)
            $body = $reader.ReadToEnd()
            $reader.Close()
            
            try {
                $data = $body | ConvertFrom-Json
                if ($data.password -eq $global:AdminPassword) {
                    $token = [System.Guid]::NewGuid().ToString()
                    $global:AdminSessions[$token] = (Get-Date).AddHours(2) # Sessão de 2 horas
                    Send-JsonResponse $response 200 @{ success = $true; token = $token }
                } else {
                    Send-JsonResponse $response 401 @{ error = "Senha incorreta." }
                }
            } catch {
                Send-JsonResponse $response 400 @{ error = "Dados de login invalidos." }
            }
            continue
        }
        
        # ROTA: Listar todas as chaves
        elseif ($rawPath -eq "/api/admin/keys" -and $request.HttpMethod -eq "GET") {
            if (-not (Is-AdminAuthorized $authToken)) {
                Send-JsonResponse $response 401 @{ error = "Nao autorizado" }
                continue
            }
            
            $db = Get-KeysDb
            $list = @()
            $now = Get-Date
            
            if ($db) {
                foreach ($prop in $db.PSObject.Properties) {
                    $expiryDate = [DateTime]::Parse($prop.Value)
                    $daysLeft = [Math]::Ceiling(($expiryDate - $now).TotalDays)
                    if ($daysLeft -lt 0) { $daysLeft = 0 }
                    
                    $list += @{
                        key = $prop.Name
                        expiresAt = $prop.Value
                        daysLeft = $daysLeft
                        expired = ($expiryDate -le $now)
                    }
                }
            }
            
            Send-JsonResponse $response 200 $list
            continue
        }
        
        # ROTA: Criar nova chave de licença
        elseif ($rawPath -eq "/api/admin/keys" -and $request.HttpMethod -eq "POST") {
            if (-not (Is-AdminAuthorized $authToken)) {
                Send-JsonResponse $response 401 @{ error = "Nao autorizado" }
                continue
            }
            
            $reader = New-Object System.IO.StreamReader($request.InputStream)
            $body = $reader.ReadToEnd()
            $reader.Close()
            
            $days = 30
            try {
                $data = $body | ConvertFrom-Json
                if ($data -and $data.days) { $days = [int]$data.days }
            } catch {}
            
            $newKey = Generate-LicenseKey
            $expiryDate = (Get-Date).AddDays($days)
            $expiryString = $expiryDate.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            
            # Carregar banco, adicionar chave e salvar
            $db = Get-KeysDb
            
            # Recriar como hashtable para adicionar
            $newDb = @{}
            if ($db) {
                foreach ($prop in $db.PSObject.Properties) {
                    $newDb[$prop.Name] = $prop.Value
                }
            }
            $newDb[$newKey] = $expiryString
            
            if (Save-KeysDb $newDb) {
                Send-JsonResponse $response 200 @{ success = $true; key = $newKey; expiresAt = $expiryString }
            } else {
                Send-JsonResponse $response 500 @{ error = "Falha ao salvar licenca no banco." }
            }
            continue
        }
        
        # ROTA: Estender chave (Adicionar Dias)
        elseif ($rawPath -eq "/api/admin/keys/extend" -and $request.HttpMethod -eq "POST") {
            if (-not (Is-AdminAuthorized $authToken)) {
                Send-JsonResponse $response 401 @{ error = "Nao autorizado" }
                continue
            }
            
            $reader = New-Object System.IO.StreamReader($request.InputStream)
            $body = $reader.ReadToEnd()
            $reader.Close()
            
            try {
                $data = $body | ConvertFrom-Json
                $key = $data.key
                $days = [int]$data.days
                
                if ([string]::IsNullOrEmpty($key) -or $days -le 0) {
                    Send-JsonResponse $response 400 @{ error = "Chave e numero de dias sao obrigatorios." }
                    continue
                }
                
                $db = Get-KeysDb
                $newDb = @{}
                $keyExists = $false
                if ($db) {
                    foreach ($prop in $db.PSObject.Properties) {
                        $newDb[$prop.Name] = $prop.Value
                        if ($prop.Name -eq $key) { $keyExists = $true }
                    }
                }
                
                if (-not $keyExists) {
                    Send-JsonResponse $response 404 @{ error = "Chave de licenca nao encontrada." }
                    continue
                }
                
                $currentExpiry = [DateTime]::Parse($newDb[$key])
                $now = Get-Date
                
                # Definir base de cálculo (se já expirou, conta a partir de hoje)
                $baseDate = $now
                if ($currentExpiry -gt $now) { $baseDate = $currentExpiry }
                
                $newExpiry = $baseDate.AddDays($days)
                $newExpiryString = $newExpiry.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                $newDb[$key] = $newExpiryString
                
                if (Save-KeysDb $newDb) {
                    Send-JsonResponse $response 200 @{ success = $true; key = $key; expiresAt = $newExpiryString }
                } else {
                    Send-JsonResponse $response 500 @{ error = "Erro ao salvar no banco." }
                }
            } catch {
                Send-JsonResponse $response 400 @{ error = "Dados invalidos recebidos: $($_.Exception.Message)" }
            }
            continue
        }
        
        # ROTA: Bloquear / Excluir Chave
        elseif ($rawPath.StartsWith("/api/admin/keys/") -and $request.HttpMethod -eq "DELETE") {
            if (-not (Is-AdminAuthorized $authToken)) {
                Send-JsonResponse $response 401 @{ error = "Nao autorizado" }
                continue
            }
            
            $keyToDelete = $rawPath.Substring(16).Trim()
            
            $db = Get-KeysDb
            $newDb = @{}
            $found = $false
            if ($db) {
                foreach ($prop in $db.PSObject.Properties) {
                    if ($prop.Name -ne $keyToDelete) {
                        $newDb[$prop.Name] = $prop.Value
                    } else {
                        $found = $true
                    }
                }
            }
            
            if (-not $found) {
                Send-JsonResponse $response 404 @{ error = "Chave de licenca nao encontrada." }
                continue
            }
            
            if (Save-KeysDb $newDb) {
                Send-JsonResponse $response 200 @{ success = $true }
            } else {
                Send-JsonResponse $response 500 @{ error = "Erro ao salvar exclusao no banco." }
            }
            continue
        }
        
        # ROTA: Servir Arquivos Estáticos da Interface Admin
        else {
            $filename = $rawPath
            if ($filename -eq "/" -or $filename -eq "" -or $filename -eq "/admin") {
                $filename = "/index.html"
            }
            
            $filePath = Join-Path $scriptDir $filename
            if (Test-Path $filePath -PathType Leaf) {
                $contentType = "text/plain"
                if ($filePath.EndsWith(".html")) { $contentType = "text/html; charset=utf-8" }
                elseif ($filePath.EndsWith(".css")) { $contentType = "text/css" }
                elseif ($filePath.EndsWith(".js")) { $contentType = "application/javascript" }
                elseif ($filePath.EndsWith(".png")) { $contentType = "image/png" }
                elseif ($filePath.EndsWith(".jpg") -or $filePath.EndsWith(".jpeg")) { $contentType = "image/jpeg" }
                elseif ($filePath.EndsWith(".svg")) { $contentType = "image/svg+xml" }
                
                try {
                    $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
                    $response.StatusCode = 200
                    $response.ContentType = $contentType
                    $response.ContentLength64 = $fileBytes.Length
                    $response.OutputStream.Write($fileBytes, 0, $fileBytes.Length)
                } catch {
                    $response.StatusCode = 500
                    $response.ContentType = "text/plain; charset=utf-8"
                    $writer = New-Object System.IO.StreamWriter($response.OutputStream)
                    $writer.Write("Erro ao ler arquivo: $($_.Exception.Message)")
                    $writer.Close()
                }
            } else {
                $response.StatusCode = 404
                $response.ContentType = "text/plain; charset=utf-8"
                $writer = New-Object System.IO.StreamWriter($response.OutputStream)
                $writer.Write("Arquivo nao encontrado: $filename")
                $writer.Close()
            }
            $response.Close()
        }
    }
} catch {
    Write-Host "Erro ao iniciar o listener de licenças: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($listener -and $listener.IsListening) {
        $listener.Stop()
    }
}
