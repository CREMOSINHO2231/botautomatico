$ErrorActionPreference = 'Stop'
$userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
$url = "https://www.promobit.com.br/oferta/apple-iphone-15-128gb/"

Write-Host "Fetching URL: $url"
$resp = Invoke-WebRequest -Uri $url -UserAgent $userAgent -UseBasicParsing

$nextDataMatches = [regex]::Matches($resp.Content, '<script[^>]+__NEXT_DATA__[^>]*>(.*?)</script>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if ($nextDataMatches.Count -gt 0) {
    $json = ConvertFrom-Json $nextDataMatches[0].Groups[1].Value
    $serverOffer = $json.props.pageProps.serverOffer
    Write-Host "serverOffer properties:"
    $serverOffer | Get-Member -MemberType NoteProperty | ForEach-Object {
        $val = $serverOffer.$($_.Name)
        if ($val -is [System.Management.Automation.PSCustomObject]) {
            Write-Host "  $($_.Name): (object)"
        } else {
            Write-Host "  $($_.Name): $val"
        }
    }
}
