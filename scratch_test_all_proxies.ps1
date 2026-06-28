$ErrorActionPreference = 'Stop'
$userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

$targets = @(
    "https://www.promobit.com.br/",
    "https://www.promobit.com.br/promocoes/informatica/"
)

# Define proxy test endpoints
function Test-Proxy($proxyName, $proxyUrl) {
    Write-Host " Testing proxy: $proxyName"
    try {
        $resp = Invoke-WebRequest -Uri $proxyUrl -UserAgent $userAgent -UseBasicParsing -TimeoutSec 10
        Write-Host "   Success! Length: $($resp.Content.Length)"
        # Check if the response contains promobit links
        if ($resp.Content -like "*oferta*" -or $resp.Content -like "*promocoes*") {
            Write-Host "   Target content confirmed (found 'oferta'/'promocoes' keyword)."
        } else {
            Write-Host "   Warning: Content doesn't look like Promobit."
        }
    } catch {
        Write-Host "   Failed! Error: $($_.Exception.Message)"
    }
}

foreach ($target in $targets) {
    Write-Host "`nTarget URL: $target"
    
    # AllOrigins
    $allOriginsUrl = "https://api.allorigins.win/get?url=" + [Uri]::EscapeDataString($target) + "&_=" + (Get-Date).Ticks
    Test-Proxy "AllOrigins" $allOriginsUrl
    
    # Codetabs
    $codeTabsUrl = "https://api.codetabs.com/v1/proxy?quest=" + [Uri]::EscapeDataString($target)
    Test-Proxy "Codetabs" $codeTabsUrl
    
    # ThingProxy
    $thingProxyUrl = "https://thingproxy.freeboard.io/fetch/" + $target
    Test-Proxy "ThingProxy" $thingProxyUrl
}
