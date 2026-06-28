$ErrorActionPreference = 'Stop'
$userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
$targetUrl = "https://www.promobit.com.br/promocoes/informatica/"

$proxies = @(
    "https://api.allorigins.win/get?url=" + [Uri]::EscapeDataString($targetUrl) + "&_=" + (Get-Date).Ticks
)

foreach ($proxyUrl in $proxies) {
    Write-Host "Fetching via Proxy: $proxyUrl"
    try {
        $resp = Invoke-WebRequest -Uri $proxyUrl -UserAgent $userAgent -UseBasicParsing
        $json = ConvertFrom-Json $resp.Content
        $contents = $json.contents
        Write-Host "Success! Contents Length: $($contents.Length)"
        
        # Check for jsonld
        $jsonLdMatches = [regex]::Matches($contents, '<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        Write-Host "Found $($jsonLdMatches.Count) JSON-LD script tags."
        
        $itemListFound = $false
        for ($i=0; $i -lt $jsonLdMatches.Count; $i++) {
            $content = $jsonLdMatches[$i].Groups[1].Value
            if ($content -like '*"@type":"ItemList"*') {
                $itemListFound = $true
                try {
                    $parsed = ConvertFrom-Json $content
                    Write-Host "Index $($i): ItemList found! Elements Count: $($parsed.itemListElement.Count)"
                } catch {
                    Write-Host "Index $($i): ItemList found but failed to parse JSON: $($_.Exception.Message)"
                }
            }
        }
        
        if (-not $itemListFound) {
            Write-Host "ItemList NOT found in any JSON-LD tag."
        }
        
        $offerMatches = [regex]::Matches($contents, 'href="(/oferta/[^"]+)"')
        Write-Host "Found $($offerMatches.Count) matches for /oferta/ anchors."
        
    } catch {
        Write-Host "Proxy failed: $($_.Exception.Message)"
    }
}
