# Gera icon.ico a partir de icon.svg usando Inkscape (se instalado)
# ou instrui o usuário a usar uma ferramenta online
#
# Uso: .\assets\generate-ico.ps1

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SvgPath   = Join-Path $ScriptDir "icon.svg"
$IcoPath   = Join-Path $ScriptDir "icon.ico"

Write-Host ""
Write-Host "=== Gerador de icon.ico ===" -ForegroundColor Cyan
Write-Host ""

# Tenta via Inkscape
$inkscape = Get-Command inkscape -ErrorAction SilentlyContinue
if ($inkscape) {
    Write-Host "Inkscape encontrado. Gerando PNGs intermediários..." -ForegroundColor Green
    $sizes = @(16, 32, 48, 64, 128, 256)
    $pngs  = @()
    foreach ($s in $sizes) {
        $out = Join-Path $ScriptDir "tmp_${s}.png"
        & inkscape --export-filename="$out" --export-width=$s --export-height=$s "$SvgPath" 2>$null
        if (Test-Path $out) { $pngs += $out }
    }
    if ($pngs.Count -gt 0) {
        Write-Host "PNGs gerados. Combinando em .ico via magick..." -ForegroundColor Green
        $magick = Get-Command magick -ErrorAction SilentlyContinue
        if ($magick) {
            & magick $pngs $IcoPath
            foreach ($p in $pngs) { Remove-Item $p -ErrorAction SilentlyContinue }
            Write-Host "icon.ico criado com sucesso em: $IcoPath" -ForegroundColor Green
        } else {
            Write-Host "ImageMagick (magick) nao encontrado. PNGs criados mas nao combinados em .ico." -ForegroundColor Yellow
            Write-Host "Instale ImageMagick: https://imagemagick.org" -ForegroundColor Yellow
        }
    }
    return
}

Write-Host "Inkscape nao encontrado." -ForegroundColor Yellow
Write-Host ""
Write-Host "Opcoes para gerar o icon.ico:" -ForegroundColor Cyan
Write-Host "  1. Instale Inkscape (https://inkscape.org) e re-execute este script."
Write-Host "  2. Use conversor online: https://convertio.co/pt/svg-ico/"
Write-Host "     - Faca upload de: $SvgPath"
Write-Host "     - Selecione tamanhos: 16, 32, 48, 128, 256"
Write-Host "     - Salve como: $IcoPath"
Write-Host "  3. Use ImageMagick: magick icon.svg -resize 256x256 icon.ico"
Write-Host ""
Write-Host "Apos gerar o icon.ico, ele sera usado automaticamente pelo electron-builder." -ForegroundColor Green
