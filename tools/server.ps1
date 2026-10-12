# 秦小皇音乐 - 零安装本地静态服务
# 仅绑定 127.0.0.1，不访问外网；关闭窗口即停止。
param(
    [int]$StartPort = 8765,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# 应用根目录 = tools 的上一级
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')

$Mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.webp' = 'image/webp'
    '.mp3'  = 'audio/mpeg'
    '.flac' = 'audio/flac'
    '.ogg'  = 'audio/ogg'
    '.oga'  = 'audio/ogg'
    '.wav'  = 'audio/wav'
    '.m4a'  = 'audio/mp4'
    '.aac'  = 'audio/aac'
    '.woff2'= 'font/woff2'
    '.woff' = 'font/woff'
    '.txt'  = 'text/plain; charset=utf-8'
}

# ---------- 找可用端口并启动 TcpListener（无需管理员权限） ----------
$listener = $null
$port = 0
foreach ($p in $StartPort..($StartPort + 5)) {
    try {
        $candidate = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
        $candidate.Start()
        $listener = $candidate
        $port = $p
        break
    } catch {
        $candidate = $null
    }
}
if (-not $listener) {
    Write-Host '[错误] 端口 8765-8770 均被占用，请关闭占用程序后重试。'
    exit 1
}

$baseUrl = "http://127.0.0.1:$port/"
Write-Host ''
Write-Host '  秦小皇音乐 · 本地服务已启动'
Write-Host "  访问地址：$baseUrl"
Write-Host '  关闭本黑色窗口即停止服务。'
Write-Host ''

if (-not $NoBrowser) {
    try { Start-Process $baseUrl } catch {}
}

function Send-Response {
    param($Stream, [int]$Status, [string]$ContentType, [byte[]]$Body)
    if (-not $Body) { $Body = [byte[]]@() }
    $reason = @{ 200 = 'OK'; 403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed'; 400 = 'Bad Request' }[$Status]
    if (-not $reason) { $reason = 'OK' }
    $headerText = "HTTP/1.1 $Status $reason`r`n" +
                  "Content-Type: $ContentType`r`n" +
                  "Content-Length: $($Body.Length)`r`n" +
                  "Connection: close`r`n" +
                  "Cache-Control: no-store`r`n" +
                  "Access-Control-Allow-Origin: http://127.0.0.1:$port`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.NoDelay = $true
            $client.ReceiveTimeout = 8000
            $client.SendTimeout = 8000
            $stream = $client.GetStream()

            # 读取请求头（到 \r\n\r\n 为止）
            $ms = New-Object System.IO.MemoryStream
            $buf = New-Object byte[] 8192
            $headerLen = -1
            while ($ms.Length -lt 65536) {
                $n = $stream.Read($buf, 0, $buf.Length)
                if ($n -le 0) { break }
                $ms.Write($buf, 0, $n)
                $all = $ms.ToArray()
                $max = $all.Length - 4
                for ($i = 0; $i -le $max; $i++) {
                    if ($all[$i] -eq 13 -and $all[$i + 1] -eq 10 -and $all[$i + 2] -eq 13 -and $all[$i + 3] -eq 10) {
                        $headerLen = $i + 4
                    }
                }
                if ($headerLen -ge 0) { break }
            }
            if ($headerLen -lt 0) {
                Send-Response $stream 400 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('bad request'))
                continue
            }

            $raw = $ms.ToArray()
            $headerAscii = [System.Text.Encoding]::ASCII.GetString($raw, 0, $headerLen)
            $lines = $headerAscii -split "`r`n"
            $parts = $lines[0].Split(' ')
            if ($parts.Length -lt 2) {
                Send-Response $stream 400 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('bad request'))
                continue
            }
            $method = $parts[0]
            $target = $parts[1]

            if ($method -ne 'GET' -and $method -ne 'HEAD') {
                Send-Response $stream 405 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('method not allowed'))
                continue
            }

            $pathOnly = $target.Split('?')[0]
            $rel = [System.Uri]::UnescapeDataString($pathOnly).TrimStart('/')
            if ($rel -eq '') { $rel = 'index.html' }
            # 统一为 Windows 路径分隔
            $rel = $rel -replace '/', '\'
            # 拒绝反斜手段、空字节、盘符
            if ($rel.Contains('\\') -or $rel.Contains([char]0) -or ($rel -match '^[A-Za-z]:')) {
                Send-Response $stream 403 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('forbidden'))
                continue
            }

            $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))
            $allowed = $full.Equals($Root, [System.StringComparison]::OrdinalIgnoreCase) -or
                       $full.StartsWith($Root + '\', [System.StringComparison]::OrdinalIgnoreCase)
            if (-not $allowed) {
                Send-Response $stream 403 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('forbidden'))
                continue
            }

            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                Send-Response $stream 404 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('not found'))
                continue
            }

            $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
            $ctype = $Mime[$ext]
            if (-not $ctype) { $ctype = 'application/octet-stream' }
            $body = [System.IO.File]::ReadAllBytes($full)
            Send-Response $stream 200 $ctype $body
        } catch {
            # 单个请求出错不能拖垮整个服务
            try {
                $errBytes = [Text.Encoding]::UTF8.GetBytes('server error')
                Send-Response $stream 500 'text/plain; charset=utf-8' $errBytes
            } catch {}
        } finally {
            try { $stream.Close() } catch {}
            try { $client.Close() } catch {}
        }
    }
} finally {
    try { $listener.Stop() } catch {}
}
