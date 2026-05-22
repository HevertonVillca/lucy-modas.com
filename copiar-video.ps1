# Execute uma vez: copia o video para a pasta do site
$origem = 'c:\Users\hever\Videos\Captures\IMG_9592.MOV'
$destino = Join-Path $PSScriptRoot 'videos\loja.mov'
New-Item -ItemType Directory -Path (Split-Path $destino) -Force | Out-Null
if (-not (Test-Path $origem)) {
  Write-Host "Arquivo nao encontrado: $origem"
  exit 1
}
Copy-Item -LiteralPath $origem -Destination $destino -Force
Write-Host "Video copiado para: $destino"
Write-Host "Tamanho:" (Get-Item $destino).Length "bytes"
