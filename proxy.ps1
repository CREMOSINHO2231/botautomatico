$ErrorActionPreference = 'Continue'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8123/")

# Estado Global de Autenticação em Memória
$global:Sessions = @{} # token -> expiration time (DateTime)

# Obter o diretorio atual do script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = Get-Location }
# Caminho do arquivo de configuração (no Railway usa o volume /app/data se existir)
$configDir = $scriptDir
if (Test-Path "/app/data") { $configDir = "/app/data" }
$configFile = Join-Path $configDir "config.json"

# Helper: Hash SHA-256 para salvar senhas e chaves de acesso de forma segura
function Get-Sha256Hash($string) {
    if ([string]::IsNullOrEmpty($string)) { return "" }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($string)
    $sha = New-Object System.Security.Cryptography.SHA256Managed
    $hashBytes = $sha.ComputeHash($bytes)
    $hashString = [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLower()
    return $hashString
}

# Helper: Carregar Configuração
function Get-AppConfig {
    if (Test-Path $configFile) {
        try {
            $content = Get-Content $configFile -Raw -ErrorAction Stop
            return $content | ConvertFrom-Json
        } catch {
            return $null
        }
    }
    return $null
}

# Helper: Salvar Configuração
function Save-AppConfig($config) {
    try {
        $json = $config | ConvertTo-Json -Depth 5 -Compress
        Set-Content -Path $configFile -Value $json -Encoding UTF8 -ErrorAction Stop
        return $true
    } catch {
        Write-Host "Erro ao salvar config.json: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# CONFIGURAÇÃO DO SISTEMA DE ASSINATURA/LICENÇAS
# IMPORTANTE: Altere esta URL para a URL pública do seu servidor central de licenças (ex: no Render/VPS)
$global:LicenseUrl = "https://lovely-energy-production-78fe.up.railway.app"
$global:LicenseCache = @{} # key -> @{ valid = $true/$false; error = "..."; timestamp = [DateTime] }

function Check-LicenseStatus($key, $email) {
    if ([string]::IsNullOrEmpty($key)) {
        return @{ valid = $false; error = "Chave de licença não configurada." }
    }
    
    # Bypass para testes se ainda estiver usando placeholders do GitHub
    if ($global:LicenseUrl -like "*seu-usuario*" -or $global:LicenseUrl -like "*seu-repositorio*") {
        Write-Host "[Licenca] URL padrão (placeholder) detectada. Ignorando validação online e liberando acesso local." -ForegroundColor Yellow
        return @{ valid = $true; error = "" }
    }
    
    $now = Get-Date
    if ($global:LicenseCache.ContainsKey($key)) {
        $cached = $global:LicenseCache[$key]
        if (($now - $cached.timestamp).TotalMinutes -lt 1) {
            return @{ valid = $cached.valid; error = $cached.error }
        }
    }
    
    $isLicenseValid = $false
    $licenseError = ""
    
    try {
        Write-Host "[Licenca] Verificando chave $key na API central..." -ForegroundColor Cyan
        
        # Configurar protocolo TLS seguro para requisições externas
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $urlClean = $global:LicenseUrl.TrimEnd('/')
        $validationUrl = "$urlClean/api/validate?key=$([Uri]::EscapeDataString($key))&email=$([Uri]::EscapeDataString($email))"
        $response = Invoke-RestMethod -Uri $validationUrl -Method Get -TimeoutSec 8 -ErrorAction Stop
        
        if ($response) {
            if ($response.valid) {
                $isLicenseValid = $true
                $licenseError = ""
            } else {
                $isLicenseValid = $false
                $licenseError = $response.error
            }
        } else {
            $isLicenseValid = $false
            $licenseError = "Formato de resposta inválido do servidor de licenças."
        }
    } catch {
        Write-Host "Erro ao validar licença: $($_.Exception.Message)" -ForegroundColor Red
        $isLicenseValid = $false
        $licenseError = "Não foi possível validar sua licença (Erro de Conexão)."
    }
    
    # Salvar no cache específico desta chave
    $global:LicenseCache[$key] = @{
        valid = $isLicenseValid
        error = $licenseError
        timestamp = $now
    }
    
    return @{ valid = $isLicenseValid; error = $licenseError }
}

# Helper: Resposta JSON
function Send-JsonResponse($response, $statusCode, $object) {
    $response.StatusCode = $statusCode
    $response.ContentType = "application/json; charset=utf-8"
    $json = $object | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.Close()
}

try {
    $listener.Start()
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "   Servidor & Proxy Local - OfertasBot Ativo" -ForegroundColor Green
    Write-Host "   Abra no seu navegador: http://localhost:8123/" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "Mantenha esta janela aberta enquanto utiliza o bot."
    Write-Host "Pressione Ctrl+C para encerrar."
    Write-Host ""

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        # Habilitar CORS e PNA
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization")
        $response.Headers.Add("Access-Control-Allow-Private-Network", "true")
        
        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }
        
        $rawPath = $request.Url.LocalPath
        
        # Extrair token do Header Authorization: Bearer <token>
        $authHeader = $request.Headers.Get("Authorization")
        $authToken = $null
        if ($authHeader -and $authHeader -like "Bearer *") {
            $authToken = $authHeader.Substring(7).Trim()
        }

        # Helper para validar sessões
        function Is-TokenValid($token) {
            if ([string]::IsNullOrEmpty($token)) { return $false }
            if ($global:Sessions.ContainsKey($token)) {
                $session = $global:Sessions[$token]
                $expiry = $session
                if ($session -is [hashtable]) {
                    $expiry = $session.expiry
                }
                if ($expiry -gt (Get-Date)) {
                    # Estende por mais 7 dias de atividade
                    if ($session -is [hashtable]) {
                        $session.expiry = (Get-Date).AddDays(7)
                        $global:Sessions[$token] = $session
                    } else {
                        $global:Sessions[$token] = (Get-Date).AddDays(7)
                    }
                    return $true
                } else {
                    $global:Sessions.Remove($token)
                }
            }
            return $false
        }

        # Helper para obter o e-mail da sessão
        function Get-SessionEmail($token) {
            if ([string]::IsNullOrEmpty($token)) { return $null }
            if ($global:Sessions.ContainsKey($token)) {
                $session = $global:Sessions[$token]
                if ($session -is [hashtable]) {
                    return $session.email
                }
            }
            $config = Get-AppConfig
            if ($config -and $config.admin -and $config.admin.email) {
                return $config.admin.email
            }
            return $null
        }

        # ROTA: Status de Autenticação
        if ($rawPath -eq "/api/auth/status") {
            $config = Get-AppConfig
            
            $hasUsers = $config -and (
                ($config.users -and ($config.users.PSObject.Properties.Name.Count -gt 0)) -or 
                ($config.admin -and $config.admin.email)
            )
            $setupCompleted = ($env:ADMIN_EMAIL -or $hasUsers)
            $isLoggedIn = Is-TokenValid $authToken
            
            $licenseExpired = $false
            $licenseError = ""
            
            if ($isLoggedIn) {
                $email = Get-SessionEmail $authToken
                $key = $null
                
                if ($config -and $config.users -and $config.users.$email) {
                    $key = $config.users.$email.accessKey
                } elseif ($config -and $config.admin -and $config.admin.email -eq $email -and $config.admin.accessKey) {
                    $key = $config.admin.accessKey
                } elseif ($env:ACCESS_KEY) {
                    $key = $env:ACCESS_KEY
                }
                
                if ($key) {
                    $check = Check-LicenseStatus $key $email
                    if (-not $check.valid) {
                        $licenseExpired = $true
                        $licenseError = $check.error
                    }
                } else {
                    $licenseExpired = $true
                    $licenseError = "Chave de licença/acesso não configurada no servidor."
                }
            }
            
            Send-JsonResponse $response 200 @{
                setupCompleted = [bool]$setupCompleted
                loggedIn = [bool]$isLoggedIn
                licenseExpired = [bool]$licenseExpired
                licenseError = [string]$licenseError
            }
            continue
        }
        
        # ROTA: Configuração Inicial (Setup) - Registro Multi-usuário
        elseif ($rawPath -eq "/api/auth/setup") {
            if ($request.HttpMethod -ne "POST") {
                Send-JsonResponse $response 405 @{ error = "Metodo nao permitido" }
                continue
            }
            
            $reader = New-Object System.IO.StreamReader($request.InputStream)
            $body = $reader.ReadToEnd()
            $reader.Close()
            
            try {
                $data = $body | ConvertFrom-Json
                $email = $data.email
                $password = $data.password
                $key = $data.key
                
                if ([string]::IsNullOrEmpty($email) -or [string]::IsNullOrEmpty($password) -or [string]::IsNullOrEmpty($key)) {
                    Send-JsonResponse $response 400 @{ error = "Email, senha e chave de acesso sao obrigatorios." }
                    continue
                }
                
                $emailLower = $email.ToLower().Trim()
                $config = Get-AppConfig
                if (-not $config) { $config = @{ users = @{} } }
                if (-not $config.users) { $config.users = @{} }
                
                if ($config.users.$emailLower -or ($config.admin -and $config.admin.email -eq $emailLower)) {
                    Send-JsonResponse $response 400 @{ error = "Este e-mail ja esta cadastrado. Faca login ou use outro e-mail." }
                    continue
                }
                
                $licCheck = Check-LicenseStatus $key $emailLower
                if (-not $licCheck.valid) {
                    Send-JsonResponse $response 400 @{ error = "Chave invalida ou expirada: $($licCheck.error)" }
                    continue
                }
                
                $passHash = Get-Sha256Hash $password
                $keyHash = Get-Sha256Hash $key
                
                $newUser = @{
                    email = $emailLower
                    passwordHash = $passHash
                    accessKeyHash = $keyHash
                    accessKey = $key
                }
                
                $config.users.$emailLower = $newUser
                
                if (Save-AppConfig $config) {
                    Send-JsonResponse $response 200 @{ success = $true; message = "Cadastro concluido!" }
                } else {
                    Send-JsonResponse $response 500 @{ error = "Nao foi possivel salvar localmente." }
                }
            } catch {
                Send-JsonResponse $response 400 @{ error = "Erro ao processar cadastro: $($_.Exception.Message)" }
            }
            continue
        }
        
        # ROTA: Atualizar Licença (Quando Expirada/Bloqueada)
        elseif ($rawPath -eq "/api/auth/update-license" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream)
            $body = $reader.ReadToEnd()
            $reader.Close()
            
            try {
                $data = $body | ConvertFrom-Json
                $key = $data.key
                
                if ([string]::IsNullOrEmpty($key)) {
                    Send-JsonResponse $response 400 @{ error = "A chave de acesso é obrigatória." }
                    continue
                }
                
                $global:LicenseCache.Clear()
                
                $email = Get-SessionEmail $authToken
                if (-not $email) {
                    Send-JsonResponse $response 401 @{ error = "Nao autorizado" }
                    continue
                }
                
                $licCheck = Check-LicenseStatus $key $email
                if (-not $licCheck.valid) {
                    Send-JsonResponse $response 400 @{ error = "Chave inválida ou expirada: $($licCheck.error)" }
                    continue
                }
                
                $config = Get-AppConfig
                if ($config -and $config.users -and $config.users.$email) {
                    $config.users.$email.accessKey = $key
                    $config.users.$email.accessKeyHash = Get-Sha256Hash $key
                } elseif ($config -and $config.admin -and $config.admin.email -eq $email) {
                    $config.admin.accessKey = $key
                    $config.admin.accessKeyHash = Get-Sha256Hash $key
                } else {
                    Send-JsonResponse $response 404 @{ error = "Usuário não encontrado." }
                    continue
                }
                
                if (Save-AppConfig $config) {
                    Send-JsonResponse $response 200 @{ success = $true }
                } else {
                    Send-JsonResponse $response 500 @{ error = "Falha ao salvar a nova chave no servidor." }
                }
            } catch {
                Send-JsonResponse $response 400 @{ error = "Erro ao atualizar licença: $($_.Exception.Message)" }
            }
            continue
        }
        
        # ROTA: Login Direto (Valida E-mail, Senha e Chave)
        elseif ($rawPath -eq "/api/auth/login" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream)
            $body = $reader.ReadToEnd()
            $reader.Close()
            
            try {
                $data = $body | ConvertFrom-Json
                $email = $data.email
                $password = $data.password
                $key = $data.key
                
                if ([string]::IsNullOrEmpty($email) -or [string]::IsNullOrEmpty($password) -or [string]::IsNullOrEmpty($key)) {
                    Send-JsonResponse $response 400 @{ error = "Dados incompletos para login." }
                    continue
                }
                
                $emailLower = $email.ToLower().Trim()
                $config = Get-AppConfig
                
                $user = $null
                if ($config -and $config.users -and $config.users.$emailLower) {
                    $user = $config.users.$emailLower
                } elseif ($config -and $config.admin -and $config.admin.email -eq $emailLower) {
                    $user = $config.admin
                }
                
                if (-not $user) {
                    Send-JsonResponse $response 401 @{ error = "E-mail, senha ou chave de acesso incorretos." }
                    continue
                }
                
                $licCheck = Check-LicenseStatus $key $emailLower
                if (-not $licCheck.valid) {
                    Send-JsonResponse $response 403 @{ error = "Licenca inativa: $($licCheck.error)"; licenseExpired = $true }
                    continue
                }
                
                $passHash = Get-Sha256Hash $password
                $keyHash = Get-Sha256Hash $key
                
                if ($passHash -eq $user.passwordHash -and $keyHash -eq $user.accessKeyHash) {
                    $token = [System.Guid]::NewGuid().ToString()
                    $global:Sessions[$token] = @{
                        expiry = (Get-Date).AddDays(7)
                        email = $emailLower
                    }
                    Send-JsonResponse $response 200 @{ success = $true; token = $token }
                } else {
                    Send-JsonResponse $response 401 @{ error = "E-mail, senha ou chave de acesso incorretos." }
                }
            } catch {
                Send-JsonResponse $response 400 @{ error = "Erro de processamento de login: $($_.Exception.Message)" }
            }
            continue
        }
        
        # ROTA: Logout
        elseif ($rawPath -eq "/api/auth/logout") {
            if ($authToken -and $global:Sessions.ContainsKey($authToken)) {
                $global:Sessions.Remove($authToken)
            }
            Send-JsonResponse $response 200 @{ success = $true; message = "Sessao encerrada." }
            continue
        }
        
        # ROTA: Proxy de CORS (Protegida)
        elseif ($rawPath -eq "/proxy") {
            # Validar autenticacao
            if (-not (Is-TokenValid $authToken)) {
                Send-JsonResponse $response 401 @{ error = "Nao autorizado. Faca login primeiro." }
                continue
            }
            
            # Validar se a licença está ativa
            $config = Get-AppConfig
            $email = Get-SessionEmail $authToken
            $key = $null
            
            if ($config -and $config.users -and $config.users.$email) {
                $key = $config.users.$email.accessKey
            } elseif ($config -and $config.admin -and $config.admin.email -eq $email -and $config.admin.accessKey) {
                $key = $config.admin.accessKey
            } elseif ($env:ACCESS_KEY) {
                $key = $env:ACCESS_KEY
            }
            
            if ($key) {
                $check = Check-LicenseStatus $key $email
                if (-not $check.valid) {
                    Send-JsonResponse $response 403 @{ error = "Licenca inativa ou expirada: $($check.error)" }
                    continue
                }
            } else {
                Send-JsonResponse $response 403 @{ error = "Chave de licença/acesso não configurada para este usuário." }
                continue
            }
            
            $urlParam = $request.QueryString["url"]
            if (-not $urlParam) {
                Send-JsonResponse $response 400 @{ error = "Parametro 'url' ausente." }
                continue
            }
            
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Proxying: $urlParam"
            try {
                $userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                
                # Requisitar usando Invoke-WebRequest
                $webResponse = Invoke-WebRequest -Uri $urlParam -UserAgent $userAgent -UseBasicParsing -TimeoutSec 10
                
                $response.StatusCode = 200
                $response.ContentType = "text/html; charset=utf-8"
                
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($webResponse.Content)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                Write-Host "  -> Sucesso! ($($bytes.Length) bytes)" -ForegroundColor Gray
            } catch {
                Write-Host "  -> Falha! Erro: $($_.Exception.Message)" -ForegroundColor Red
                Send-JsonResponse $response 500 @{ error = "Erro do proxy: $($_.Exception.Message)" }
            }
        }
        
        # ROTA: Arquivos Estáticos da Interface
        else {
            $filename = $rawPath
            if ($filename -eq "/" -or $filename -eq "") {
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
        }
        $response.Close()
    }
} catch {
    Write-Host "Erro ao iniciar o listener: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($listener -and $listener.IsListening) {
        $listener.Stop()
    }
}
