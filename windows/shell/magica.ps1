# Magica Terminal shell integration (Windows PowerShell 5.1 and PowerShell 7). The terminal dot-sources this when it
# starts a pane (after your $PROFILE); it does nothing outside Magica Terminal.
#
# Like shell/magica.bash: the pane's character replaces the user in the prompt and the "device" is always magica.
# Typing a character's name (madoka, homura, sayaka, mami, kyoko) switches this pane to her (and clears it, if it actually
# changed); `pair` / `magica` lay out the tab; `kyubey` opens an elevated shell as Kyubey (Windows sudo) until you exit it.
if (-not $env:MAGICA_CHAR) { return }

$global:_MagicaScript = $PSCommandPath
$global:_MagicaEsc = [char]27
# palette slots per character (name / text / path), set by the terminal; 118 is the red accent (Kyubey's grey)
$global:_MagicaSlots = @{ madoka = 100; homura = 103; sayaka = 106; mami = 109; kyoko = 112; kyubey = 115 }
$global:_MagicaRed = 118
$global:_MagicaAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

# OSC 666 messages to the terminal (ESC \ terminated, like VTE's termprops in the Linux version)
function global:_MagicaOsc([string]$text) { [Console]::Write("$($global:_MagicaEsc)]666;$text$($global:_MagicaEsc)\") }

function global:_MagicaColours {
    # typed commands in her text colour (PSReadLine redraws the input line, so it is coloured here, not by the prompt)
    $e = $global:_MagicaEsc
    $t = $global:_MagicaSlots[$env:MAGICA_CHAR] + 1
    if (Get-Module PSReadLine) {
        $c = "$e[38;5;${t}m"
        Set-PSReadLineOption -Colors @{ Command = $c; Default = $c; Parameter = $c; Variable = $c; Number = $c
                                        Operator = $c; Member = $c; Type = $c; Keyword = $c; String = $c }
    }
}

function global:prompt {
    $ok = $global:?
    $code = $global:LASTEXITCODE
    # how the last command ended (the terminal ignores this if nothing ran); $LASTEXITCODE only counts if that
    # command changed it, otherwise a failed cmdlet would report an old native exit code
    $status = if ($ok) { 0 } elseif ($code -and $code -ne $global:_MagicaCodeBefore) { $code } else { 1 }
    _MagicaOsc "vte.shell.postexec=$status"
    $e = $global:_MagicaEsc
    $char = $env:MAGICA_CHAR
    $n = $global:_MagicaSlots[$char]; $p = $n + 2; $r = $global:_MagicaRed
    $loc = $ExecutionContext.SessionState.Path.CurrentLocation
    $path = "$loc"
    if ($loc.Provider.Name -eq 'FileSystem') {
        [Console]::Write("$e]9;9;`"$($loc.ProviderPath)`"$e\")   # current folder, for new splits/tabs and the session
        if ($path.StartsWith($HOME, [StringComparison]::OrdinalIgnoreCase)) { $path = '~' + $path.Substring($HOME.Length) }
    }
    [Console]::Write("$e]0;$char@magica: $path$([char]7)")   # window title
    $mark = if ($global:_MagicaAdmin) { "$e[1;38;5;${r}m#" } else { '>' }
    $at = if ($char -eq 'kyubey') { "$e[1;38;5;${r}m@magica" } else { '@magica' }
    $global:LASTEXITCODE = $code
    "$e[1;38;5;${n}m$char$at$e[0m:$e[1;38;5;${p}m$path$e[0m$mark$e[0m "
}

# tell the terminal when a command starts, so a long run can make her hop
Import-Module PSReadLine -ErrorAction SilentlyContinue
$readLine = Get-Command PSConsoleHostReadLine -CommandType Function -ErrorAction SilentlyContinue
if ($readLine) {
    $global:_MagicaReadLine = $readLine.ScriptBlock
    function global:PSConsoleHostReadLine {
        $line = & $global:_MagicaReadLine
        if ($line -and $line.Trim()) { _MagicaOsc 'vte.shell.preexec'; $global:_MagicaCodeBefore = $global:LASTEXITCODE }
        $line
    }
}
Remove-Variable readLine
_MagicaColours

function global:_MagicaSet([string]$name) {
    if ($env:MAGICA_CHAR -eq $name) { return }
    $env:MAGICA_CHAR = $name
    _MagicaColours
    _MagicaOsc "magica:set:$name"
    Start-Sleep -Milliseconds 100
    Clear-Host
}
foreach ($c in 'madoka', 'homura', 'sayaka', 'mami', 'kyoko') {
    Set-Item "function:global:$c" ([scriptblock]::Create("_MagicaSet '$c'"))
}
# `pair` (Madoka | Homura) / `magica` (all five): this pane becomes Madoka and the terminal builds the layout around it
foreach ($l in 'pair', 'magica') {
    Set-Item "function:global:$l" ([scriptblock]::Create(
        "`$env:MAGICA_CHAR = 'madoka'; _MagicaColours; _MagicaOsc 'magica:layout:$l'; Start-Sleep -Milliseconds 100; Clear-Host"))
}
Remove-Variable c, l

# `kyubey`: this pane becomes Kyubey and runs an elevated shell in place; `exit` brings her back.
# Needs Windows' sudo set to run inline (Settings > System > Advanced > Enable sudo).
function global:kyubey {
    if (-not (Get-Command sudo.exe -ErrorAction SilentlyContinue)) {
        Write-Host "kyubey needs sudo for Windows: Settings > System > Advanced > Enable sudo (Inline)"
        return
    }
    $back = $env:MAGICA_CHAR
    _MagicaOsc 'magica:set:kyubey'; Start-Sleep -Milliseconds 100; Clear-Host
    $shell = (Get-Process -Id $PID).Path
    sudo.exe $shell -NoLogo -NoExit -Command "`$env:MAGICA_CHAR='kyubey'; . '$global:_MagicaScript'"
    _MagicaOsc "magica:set:$back"; Start-Sleep -Milliseconds 100; Clear-Host
}
