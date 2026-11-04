$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env'
$examplePath = Join-Path $projectRoot '.env.example'
if (-not (Test-Path -LiteralPath $examplePath)) { throw "找不到配置模板：$examplePath" }

# Preserve the template comments and defaults on the first run; preserve local
# values on later runs. Runtime variables override user/machine variables.
if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath $examplePath -Destination $envPath
    Write-Host '已从模板创建本机 .env。' -ForegroundColor Green
}
$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) { $lines.Add($line) }

function Get-FileEnvValue([string]$name) {
    $pattern = '^\s*' + [regex]::Escape($name) + '\s*=\s*(.*?)\s*$'
    foreach ($line in $lines) {
        if ($line -match $pattern) {
            $value = $Matches[1].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) { return $value.Substring(1, $value.Length - 2) }
            return ($value -replace '\s+#.*$', '').Trim()
        }
    }
    return ''
}
function Set-FileEnvValue([string]$name, [string]$value) {
    $escaped = $value.Replace('"', '\"')
    if ($value -match '[\s#"]') { $escaped = '"' + $escaped + '"' }
    $replacement = $name + '=' + $escaped
    $pattern = '^\s*' + [regex]::Escape($name) + '\s*='
    $found = $false
    $updated = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $lines) {
        if ($line -match $pattern) {
            if (-not $found) { $updated.Add($replacement); $found = $true }
        } else { $updated.Add($line) }
    }
    if (-not $found) { $updated.Add($replacement) }
    $lines.Clear()
    foreach ($line in $updated) { $lines.Add($line) }
}

# Use every setting represented by the checked-in template, plus FFmpeg.
$keys = @([regex]::Matches([System.IO.File]::ReadAllText($examplePath), '(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
if ($keys -notcontains 'FFMPEG_PATH') { $keys += 'FFMPEG_PATH' }
$written = [System.Collections.Generic.List[string]]::new()
$missing = [System.Collections.Generic.List[string]]::new()

foreach ($name in $keys) {
    $current = [Environment]::GetEnvironmentVariable($name, 'Process')
    $user = [Environment]::GetEnvironmentVariable($name, 'User')
    $machine = [Environment]::GetEnvironmentVariable($name, 'Machine')
    $existing = Get-FileEnvValue $name
        $value = ''
    foreach ($candidate in @($current, $user, $machine, $existing)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) { $value = [string]$candidate; break }
    }

    if ($name -eq 'FFMPEG_PATH' -and -not $value) {
        $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($ffmpeg) { $value = $ffmpeg.Source }
        if (-not $value) {
            $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
            if (Test-Path -LiteralPath $wingetPackages) {
                $ffmpeg = Get-ChildItem -LiteralPath $wingetPackages -Filter ffmpeg.exe -File -Recurse -ErrorAction SilentlyContinue |
                    Where-Object { $_.FullName -match 'Gyan\.FFmpeg' } | Select-Object -First 1
                if ($ffmpeg) { $value = $ffmpeg.FullName }
            }
        }
    }

    if ($value) {
        Set-FileEnvValue $name $value
        $written.Add($name)
    } elseif ($name -in @('DASHSCOPE_API_KEY','ALIYUN_OSS_BUCKET','ALIYUN_OSS_ACCESS_KEY_ID','ALIYUN_OSS_ACCESS_KEY_SECRET','YUNTU_APIG_APPCODE')) {
        $missing.Add($name)
    }
}

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($envPath, ($lines -join "`r`n") + "`r`n", $utf8NoBom)
Write-Host '已自动同步配置到本机 .env；没有显示密钥内容。' -ForegroundColor Green
Write-Host ('已读取/保留的配置项：' + ($written -join ', '))
if ($missing.Count) { Write-Host ('未找到以下必需项：' + ($missing -join ', ')) -ForegroundColor Yellow }
Write-Host '关闭并重启 npm start 后配置生效。 .env 已被 Git 忽略，请勿提交。' -ForegroundColor Cyan
