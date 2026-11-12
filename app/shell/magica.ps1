# Magica Terminal shell integration (PowerShell 7 and Windows PowerShell 5.1). Magica Terminal dot-sources this itself
# when it starts PowerShell (after your profile); it does nothing anywhere else. Same protocol and commands as
# magica.bash (see there).
if ($env:MAGICA_APP -eq 'tauri' -and $env:MAGICA_CHAR) {
  $global:_magica_e = [char]27
  $global:_magica_slots = @{ madoka = 100; homura = 103; sayaka = 106; mami = 109; kyoko = 112; kyubey = 115 }

  function global:_magica_osc([string]$s) { [Console]::Write("$($global:_magica_e)]$s$($global:_magica_e)\") }
  function global:_magica_slot([int]$offset) {
    $base = $global:_magica_slots[$env:MAGICA_CHAR]
    if ($null -eq $base) { $base = 100 }
    $base + $offset
  }
  function global:_magica_say([string]$msg) {
    $e = $global:_magica_e
    [Console]::Out.WriteLine("$e[38;5;$(_magica_slot 0)m$msg$e[0m")
  }

  # where the shell is, as a file:// URL (OSC 7): / separators, each part percent-encoded
  function global:_magica_osc7 {
    $p = (Get-Location).ProviderPath -replace '\\', '/'
    if (-not $p.StartsWith('/')) { $p = '/' + $p }
    $enc = ($p.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_).Replace('%3A', ':') }) -join '/'
    _magica_osc "7;file://$([Environment]::MachineName)$enc"
  }

  # ── a folder's .env (the same rules as magica.bash; PowerShell has only environment variables) ──
  $global:_magica_env_dir = $null; $global:_magica_env_sig = $null; $global:_magica_env_asked = $null
  $global:_magica_env_keys = @(); $global:_magica_env_old = @{}

  function global:_magica_env_parse([string]$file) {
    $pairs = New-Object System.Collections.Generic.List[object]
    foreach ($raw in [IO.File]::ReadAllLines($file)) {
      $line = $raw.TrimEnd("`r").TrimStart()
      if ($line -eq '' -or $line.StartsWith('#')) { continue }
      $m = [regex]::Match($line, '^(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
      if (-not $m.Success) { continue }
      $k = $m.Groups[2].Value; $v = $m.Groups[3].Value
      if ($k -like '_magica*' -or $k -ceq 'MAGICA_CHAR' -or $k -ceq 'PWD' -or $k -ceq 'OLDPWD') { continue }
      if ($v.StartsWith("'")) {
        $q = [regex]::Match($v, "^'([^']*)'")
        if (-not $q.Success) { continue }
        $v = $q.Groups[1].Value
      } elseif ($v.StartsWith('"')) {
        $out = New-Object System.Text.StringBuilder
        $i = 1; $closed = $false
        while ($i -lt $v.Length) {
          $c = $v[$i]
          if ($c -eq '\') {
            $i++
            if ($i -lt $v.Length) {
              $c = $v[$i]
              if ($c -eq 'n') { [void]$out.Append("`n") } elseif ($c -eq 't') { [void]$out.Append("`t") } else { [void]$out.Append($c) }
            }
          } elseif ($c -eq '"') { $closed = $true; break }
          else { [void]$out.Append($c) }
          $i++
        }
        if (-not $closed) { continue }   # no closing quote
        $v = $out.ToString()
      } else {
        $v = [regex]::Replace($v, '\s#.*$', '').TrimEnd()
      }
      $pairs.Add(@($k, $v))
    }
    , $pairs
  }

  function global:_magica_env_unload([switch]$quiet) {
    foreach ($k in $global:_magica_env_keys) {
      [Environment]::SetEnvironmentVariable($k, $global:_magica_env_old[$k])   # ($null: unset)
    }
    $global:_magica_env_keys = @(); $global:_magica_env_old = @{}
    $global:_magica_env_dir = $null; $global:_magica_env_sig = $null
    if (-not $quiet) { _magica_say 'unloaded .env' }
  }

  function global:_magica_env_load($pairs, [string]$dir, [string]$sig, [string]$word) {
    $names = New-Object System.Collections.Generic.List[string]
    foreach ($p in $pairs) {
      $k = $p[0]; $v = $p[1]
      if (-not $names.Contains($k)) {
        $global:_magica_env_old[$k] = [Environment]::GetEnvironmentVariable($k)
        $global:_magica_env_keys += $k
        $names.Add($k)
      }
      [Environment]::SetEnvironmentVariable($k, $v)   # (a key twice: the last one wins)
    }
    $global:_magica_env_dir = $dir; $global:_magica_env_sig = $sig
    if ($names.Count) { _magica_say "$word .env: $($names -join ', ')" }
  }

  function global:_magica_env_trust([string]$dir) {
    $f = Join-Path $env:MAGICA_CONFIG 'env-trust'
    $r = ''
    if (Test-Path -LiteralPath $f) {
      foreach ($line in [IO.File]::ReadAllLines($f)) {
        $parts = $line.Split("`t", 2)
        if ($parts.Count -eq 2 -and $parts[1] -ceq $dir) { $r = $parts[0] }
      }
    }
    $r
  }

  function global:_magica_env {
    if ($env:MAGICA_CHAR -eq 'kyubey') { return }   # (not in the admin shell)
    $d = (Get-Location).ProviderPath
    $f = Join-Path $d '.env'
    $sig = $null
    if (Test-Path -LiteralPath $f -PathType Leaf) {
      $item = Get-Item -LiteralPath $f -Force
      $sig = "$($item.LastWriteTimeUtc.Ticks).$($item.Length)"
    }
    if ($global:_magica_env_dir) {
      if ($global:_magica_env_dir -ceq $d -and $sig) {
        if ($sig -eq $global:_magica_env_sig) { return }
        _magica_env_unload -quiet
        _magica_env_load (_magica_env_parse $f) $d $sig 'reloaded'   # edited while here
        return
      }
      _magica_env_unload
    }
    if ($d -ceq $global:_magica_env_asked) { return }   # said neither y nor n here; ask again after leaving and coming back
    $global:_magica_env_asked = $null
    if (-not $sig) { return }
    $t = _magica_env_trust $d
    if ($t -eq 'n') { return }
    $pairs = _magica_env_parse $f
    if (-not $pairs.Count) { return }
    if ($t -ne 'y') {
      $names = New-Object System.Collections.Generic.List[string]
      foreach ($p in $pairs) { if (-not $names.Contains($p[0])) { $names.Add($p[0]) } }
      _magica_say "load .env here? ($($names -join ', ')) [y/n]"
      $ans = [Console]::In.ReadLine()
      if ($ans -match '^[yY]') { $t = 'y' }
      elseif ($ans -match '^[nN]') { $t = 'n' }
      else { $global:_magica_env_asked = $d; return }
      if (-not $d.Contains("`n")) {
        [void](New-Item -ItemType Directory -Force -Path $env:MAGICA_CONFIG)
        [IO.File]::AppendAllText((Join-Path $env:MAGICA_CONFIG 'env-trust'), "$t`t$d`n")
      }
      if ($t -ne 'y') { return }
    }
    _magica_env_load $pairs $d $sig 'loaded'
  }

  # a restored pane's coding agent, started again at the first prompt
  function global:_magica_resume {
    $r = $env:MAGICA_RESUME
    if (-not $r) { return }
    Remove-Item Env:MAGICA_RESUME
    $cmd = $null
    if ($r -match '^claude:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$') { $cmd = @('claude', '--resume', $Matches[1]) }
    elseif ($r -eq 'codex') { $cmd = @('codex', 'resume', '--last') }
    elseif ($r -eq 'opencode') { $cmd = @('opencode', '--continue') }
    if (-not $cmd -or -not (Get-Command $cmd[0] -ErrorAction SilentlyContinue)) { return }
    try { [Microsoft.PowerShell.PSConsoleReadLine]::AddToHistory($cmd -join ' ') } catch { }
    & $cmd[0] $cmd[1..($cmd.Count - 1)]
  }

  # the prompt: how the last command ended, where the shell is, her name and folder in her colours
  if (-not $global:_magica_user_prompt) { $global:_magica_user_prompt = $function:prompt }
  function global:prompt {
    $ok = $?
    $code = $global:LASTEXITCODE
    $status = if ($ok) { 0 } elseif ($code) { $code } else { 1 }
    $e = $global:_magica_e
    _magica_osc "133;D;$status"
    _magica_osc7
    _magica_env
    _magica_resume
    $global:LASTEXITCODE = $code
    $path = (Get-Location).ProviderPath
    $home_ = [Environment]::GetFolderPath('UserProfile')
    if ($home_ -and $path.StartsWith($home_)) { $path = '~' + $path.Substring($home_.Length) }
    $name = $env:MAGICA_CHAR
    $n = _magica_slot 0; $t = _magica_slot 1; $p = _magica_slot 2
    $title = "$e]0;$name@magica: $path$([char]7)"
    if ($name -eq 'kyubey') {
      $text = "$e[1;38;5;${n}mkyubey$e[1;38;5;118m@magica$e[0m:$e[1;38;5;${p}m$path$e[1;38;5;118m#$e[0m "
    } else {
      $text = "$e[1;38;5;${n}m$name@magica$e[0m:$e[1;38;5;${p}m$path$e[0m> "
    }
    "$e]133;A$e\$title$text$e]133;B$e\"
  }

  # a command starting (OSC 133;C), when PSReadLine hands over the line
  if (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue) {
    if (-not $global:_magica_readline) { $global:_magica_readline = $function:PSConsoleHostReadLine }
    function global:PSConsoleHostReadLine {
      $line = & $global:_magica_readline
      _magica_osc '133;C'
      $line
    }
  }

  if ($env:MAGICA_CHAR -ne 'kyubey') {
    foreach ($c in 'madoka', 'homura', 'sayaka', 'mami', 'kyoko') {
      Set-Item -Path "function:global:$c" -Value ([scriptblock]::Create(
        "if (`$env:MAGICA_CHAR -ne '$c') { `$env:MAGICA_CHAR = '$c'; _magica_osc '9973;set;$c'; Clear-Host }"))
    }
    # `pair` (Madoka | Homura) / `magica` (all five): this pane becomes Madoka and the terminal builds the layout around it
    foreach ($l in 'pair', 'magica') {
      Set-Item -Path "function:global:$l" -Value ([scriptblock]::Create(
        "`$env:MAGICA_CHAR = 'madoka'; _magica_osc '9973;layout;$l'; Clear-Host"))
    }
    function global:crush { _magica_osc '9973;crush' }
    # `note`: the notepad in this pane; `note buy milk` adds a line to it without opening it
    function global:note {
      if (-not $args.Count) { _magica_osc '9973;note'; return }
      [void](New-Item -ItemType Directory -Force -Path $env:MAGICA_CONFIG)
      $f = Join-Path $env:MAGICA_CONFIG 'note.txt'
      $utf8 = New-Object System.Text.UTF8Encoding($false)
      if ((Test-Path -LiteralPath $f) -and (Get-Item -LiteralPath $f).Length -gt 0) {
        $bytes = [IO.File]::ReadAllBytes($f)
        if ($bytes[-1] -ne 10) { [IO.File]::AppendAllText($f, "`n", $utf8) }   # (it didn't end with a newline)
      }
      [IO.File]::AppendAllText($f, (($args | ForEach-Object { "$_" }) -join ' ') + "`n", $utf8)
      _magica_say 'noted'
    }
    # `space [folder]`: what takes up the disk there, in this pane
    function global:space([string]$folder = '.') {
      $d = Resolve-Path -LiteralPath $folder -ErrorAction SilentlyContinue
      if (-not $d -or -not (Test-Path -LiteralPath $d.ProviderPath -PathType Container)) {
        [Console]::Error.WriteLine("space: no such folder: $folder"); return
      }
      _magica_osc ("9973;space;" + ($d.ProviderPath -replace '[\x00-\x1f]', ''))
    }
    # `kyubey`: this pane becomes Kyubey and runs an admin shell in place; `exit` brings her back
    function global:kyubey {
      $sudo = Get-Command sudo -ErrorAction SilentlyContinue
      if (-not $sudo) { $sudo = Get-Command gsudo -ErrorAction SilentlyContinue }
      if (-not $sudo) { _magica_say "kyubey needs Windows' sudo (Settings > System > For developers) or gsudo"; return }
      $exe = (Get-Process -Id $PID).Path
      $script = Join-Path $env:MAGICA_SHELL_DIR 'magica.ps1'
      $q = { param($s) "'" + ($s -replace "'", "''") + "'" }
      $setup = "`$env:MAGICA_APP = 'tauri'; `$env:MAGICA_CHAR = 'kyubey'; `$env:MAGICA_SHELL_DIR = $(& $q $env:MAGICA_SHELL_DIR); " +
               "`$env:MAGICA_CONFIG = $(& $q $env:MAGICA_CONFIG); . $(& $q $script)"
      _magica_osc '9973;set;kyubey'; Clear-Host
      & $sudo.Source $exe -NoLogo -NoExit -Command $setup
      _magica_osc "9973;set;$env:MAGICA_CHAR"; Clear-Host
    }
  }
}
