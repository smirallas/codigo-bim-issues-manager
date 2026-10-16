$ErrorActionPreference = 'Stop'
$originalEnvironment = @{
    UV_CACHE_DIR = $env:UV_CACHE_DIR
    PYTHONDONTWRITEBYTECODE = $env:PYTHONDONTWRITEBYTECODE
    TEMP = $env:TEMP
    TMP = $env:TMP
}
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $env:UV_CACHE_DIR = Join-Path (Get-Location) '.cache/uv'
    $env:PYTHONDONTWRITEBYTECODE = '1'
    New-Item -ItemType Directory -Force -Path '.cache/tmp' | Out-Null
    $env:TEMP = Join-Path (Get-Location) '.cache/tmp'
    $env:TMP = $env:TEMP
    foreach ($task in @('format:check', 'lint', 'typecheck', 'test', 'build')) {
        & pnpm $task
        if ($LASTEXITCODE -ne 0) { throw "pnpm $task failed" }
    }
    & uv run --frozen ruff format --check apps/api scripts
    if ($LASTEXITCODE -ne 0) { throw 'ruff format failed' }
    & uv run --frozen ruff check apps/api scripts
    if ($LASTEXITCODE -ne 0) { throw 'ruff check failed' }
    & uv run --frozen --directory apps/api mypy --config-file ../../pyproject.toml app
    if ($LASTEXITCODE -ne 0) { throw 'mypy failed' }
    & uv run --frozen --directory apps/api pytest
    if ($LASTEXITCODE -ne 0) { throw 'pytest failed' }
    & uv run --frozen python -m compileall -q apps/api/app
    if ($LASTEXITCODE -ne 0) { throw 'Python compilation failed' }
} finally {
    foreach ($entry in $originalEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
    Pop-Location
}
