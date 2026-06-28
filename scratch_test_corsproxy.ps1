$ErrorActionPreference = 'Stop'
$userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

$targets = @(
    "https://www.promobit.com.br/",
    "https://www.promobit.com.br/promocoes/informatica/"
)

foreach ($target in $targets) {
    $proxyUrl = "https://corsproxy.io/?" + [Uri]::EscapeDataString($target)
    Write-Host "Testing corsproxy.io for $target"
    try {
        $resp = Invoke-WebRequest -Uri $proxyUrl -UserAgent $userAgent -UseBasicParsing -TimeoutSec 10
        Write-Host "  Success! Length: $($resp.Content.Length)"
        if ($resp.Content -like "*oferta*" -or $resp.Content -like "*promocoes*") {
            Write-Host "  Content verified (found 'oferta'/'promocoes')."
        } else {
            Write-Host "  Warning: Content does not look like Promobit."
        }
    } catch {
        Write-Host "  Failed! Error: $($_.Exception.Message)"
    }
}
