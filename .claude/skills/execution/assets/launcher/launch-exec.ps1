<#
.SYNOPSIS
  Start (or resume) the /execution orchestrator session of the project in the current repository.

.DESCRIPTION
  Run from the product repository root (contract/LANES.md B08, HOOKS.md 12, CLI.md resume):
    powershell -NoProfile -ExecutionPolicy Bypass -File "<skill>/assets/launcher/launch-exec.ps1"           # start
    powershell -NoProfile -ExecutionPolicy Bypass -File "<skill>/assets/launcher/launch-exec.ps1" -Resume   # recovery
  It refuses to start without DISABLE_AUTOUPDATER (or DISABLE_UPDATES) set, or when `claude --version` is older than
  2.1.286; it exports CLAUDE_CODE_RETRY_WATCHDOG=1, CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS (the profile's
  machine.workflow_concurrency), CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH=60000, MSYS_NO_PATHCONV=1 and PYTHONUTF8=1;
  then runs `claude --remote-control "<proj>-exec" -n "<proj>-exec" --dangerously-skip-permissions`, or with -Resume
  `claude --resume "<proj>-exec" --dangerously-skip-permissions` with the same environment (the resume keeps the
  session id, so the hooks binding and the session's workflows survive).
#>
param(
  [switch]$Resume,
  [string]$Project = ""
)

$ErrorActionPreference = 'Stop'
$MinVersion = [version]'2.1.286'

function Fail([string]$Message, [int]$Code) {
  [Console]::Error.WriteLine("launch-exec: $Message")
  exit $Code
}

$root = $null
try { $root = (& git rev-parse --show-toplevel 2>$null) } catch { $root = $null }
if (-not $root) { $root = (Get-Location).Path }
Set-Location -LiteralPath $root
$stateDir = Join-Path $root '.execution'

$concurrency = $null
$profilePath = Join-Path $stateDir 'profile.json'
if (Test-Path -LiteralPath $profilePath) {
  $prof = Get-Content -LiteralPath $profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($prof.machine -and $prof.machine.workflow_concurrency) { $concurrency = [string]$prof.machine.workflow_concurrency }
  if (-not $Project -and $prof.project -and $prof.project.slug) { $Project = [string]$prof.project.slug }
}
$markerPath = Join-Path $stateDir 'local\active'
if (-not $Project -and (Test-Path -LiteralPath $markerPath)) {
  $marker = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($marker.project) { $Project = [string]$marker.project }
}
if (-not $Project) { $Project = (Split-Path -Leaf $root).ToLower() }
if ($Project -notmatch '^[a-z0-9][a-z0-9-]{1,40}$') { Fail "project name '$Project' is not a slug: pass -Project <slug>" 2 }
$name = "$Project-exec"

if (-not $env:DISABLE_AUTOUPDATER -and -not $env:DISABLE_UPDATES) {
  Fail "DISABLE_AUTOUPDATER is not set: set it as a Windows user variable (owner decision Q3), then open a new terminal" 2
}

$versionText = ''
try { $versionText = (& claude --version | Out-String) } catch { Fail "'claude --version' failed: $_" 3 }
$match = [regex]::Match($versionText, '(\d+)\.(\d+)\.(\d+)')
if (-not $match.Success) { Fail "cannot read the version from 'claude --version': $versionText" 3 }
$version = [version]$match.Value
if ($version -lt $MinVersion) { Fail "claude $version is older than $MinVersion (the pinned minimum)" 3 }

if (-not $concurrency) {
  $concurrency = '6'
  [Console]::Error.WriteLine("launch-exec: no profile.json yet: CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=6 (preflight PF-04 checks it once the profile exists)")
}
$env:CLAUDE_CODE_RETRY_WATCHDOG = '1'
$env:CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS = $concurrency
$env:CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH = '60000'
$env:MSYS_NO_PATHCONV = '1'
$env:PYTHONUTF8 = '1'

if ($Resume) {
  & claude --resume $name --dangerously-skip-permissions
} else {
  & claude --remote-control $name -n $name --dangerously-skip-permissions
}
exit $LASTEXITCODE
