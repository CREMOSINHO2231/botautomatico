$userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
$url = "https://www.promobit.com.br/promocoes/smartphones-tablets-e-telefones/"

$request = [System.Net.HttpWebRequest]::Create($url)
$request.UserAgent = $userAgent
$request.AllowAutoRedirect = $true
try {
    $response = $request.GetResponse()
    Write-Host "URL: $url -> Status: $($response.StatusCode) (Success)" -ForegroundColor Green
    $response.Close()
} catch {
    Write-Host "URL: $url -> Failed: $($_.Exception.Message)" -ForegroundColor Red
}
