# Magica Terminal shell integration (bash 4+). Magica Terminal loads this itself when it starts bash (after ~/.bashrc);
# it does nothing anywhere else. It talks to the terminal with escape sequences (app/src/protocol.ts):
#   OSC 9973;set;<name> / layout;<pair|magica> / crush / note / space;<folder>   OSC 133;A|B|C|D;<status>   OSC 7;file://…
# Typing a character's name (madoka, homura, sayaka, mami, kyoko) switches this pane to her; `kyubey` asks for your sudo
# password, then turns the pane into Kyubey with a root shell until you exit it.
if [ "$MAGICA_APP" = tauri ] && [ -n "$MAGICA_CHAR" ] && [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
  # each character's palette slots (name, text, path), so earlier lines keep her colours after a switch and
  # light/dark recolours them; 118 is Kyubey's accent
  _mc_madoka_name=100 _mc_madoka_text=101 _mc_madoka_path=102 _mc_homura_name=103 _mc_homura_text=104 _mc_homura_path=105
  _mc_sayaka_name=106 _mc_sayaka_text=107 _mc_sayaka_path=108 _mc_mami_name=109 _mc_mami_text=110 _mc_mami_path=111
  _mc_kyoko_name=112 _mc_kyoko_text=113 _mc_kyoko_path=114 _mc_kyubey_name=115 _mc_kyubey_text=116 _mc_kyubey_path=117
  _mc_red=118
  _magica_osc() { printf '\e]%s\e\\' "$1"; }
  _magica_prompt() {
    local status=$?   # handed on unchanged, so later PROMPT_COMMAND parts see the command's exit code
    local n t p
    eval "n=\${_mc_${MAGICA_CHAR}_name:-100} t=\${_mc_${MAGICA_CHAR}_text:-101} p=\${_mc_${MAGICA_CHAR}_path:-102}"
    if [ "$MAGICA_CHAR" = kyubey ]; then   # Kyubey's root prompt: white/grey/black, with a grey accent
      PS1='\[\e]133;A\e\\\e]0;kyubey@magica: \w\a\]\[\e[1;38;5;'"$n"'m\]kyubey\[\e[1;38;5;118m\]@magica\[\e[0m\]:\[\e[1;38;5;'"$p"'m\]\w\[\e[1;38;5;118m\]#\[\e[0m\] \[\e]133;B\e\\\e[38;5;'"$t"'m\]'
    else
      PS1='\[\e]133;A\e\\\e]0;'"$MAGICA_CHAR"'@magica: \w\a\]${debian_chroot:+($debian_chroot)}\[\e[1;38;5;'"$n"'m\]'"$MAGICA_CHAR"'@magica\[\e[0m\]:\[\e[1;38;5;'"$p"'m\]\w\[\e[0m\]\$ \[\e]133;B\e\\\e[38;5;'"$t"'m\]'
    fi
    return $status
  }
  # how the last command ended (OSC 133;D) and where the shell is (OSC 7, percent-encoded)
  _magica_done() {
    local s=$? LC_ALL=C path=$PWD out= c i
    _magica_osc "133;D;$s"
    for ((i = 0; i < ${#path}; i++)); do
      c=${path:i:1}
      case $c in [a-zA-Z0-9/._~-]) out+=$c ;; *) printf -v c '%%%02X' "'$c"; out+=${c: -3} ;; esac
    done
    printf '\e]7;file://%s%s\e\\' "${HOSTNAME:-}" "$out"
    return $s
  }
  # a folder's .env: in a folder with a .env, its KEY=value lines are set (after asking once per folder); leaving the
  # folder (into a subfolder, too) puts every key back as it was. The file is read, never run; answers are remembered
  # in "$MAGICA_CONFIG/env-trust" ("y<tab>folder" / "n<tab>folder"; delete a line to be asked again).
  declare -gA _magica_env_old=() _magica_env_set=()   # key → value before loading / key → "x" if it was exported, "-" if only a shell variable
  _magica_env_dir= _magica_env_sig= _magica_env_asked= _magica_env_keys=() _magica_env_k=() _magica_env_v=()
  _magica_env_say() { local n; eval "n=\${_mc_${MAGICA_CHAR}_name:-100}"; printf '\e[38;5;%sm%s\e[0m\n' "$n" "$*"; }
  # parse $1 into _magica_env_k / _magica_env_v: KEY=value, optional `export`, '…' literal, "…" with \n \" \\, # comments
  _magica_env_parse() {
    _magica_env_k=() _magica_env_v=()
    local line k v out i c
    while IFS= read -r line || [ -n "$line" ]; do
      line=${line%$'\r'}; line=${line#"${line%%[![:space:]]*}"}
      [[ -z $line || $line == \#* ]] && continue
      [[ $line =~ ^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
      k=${BASH_REMATCH[2]} v=${BASH_REMATCH[3]}
      [[ $k == _magica* || $k == MAGICA_CHAR || $k == PWD || $k == OLDPWD ]] && continue
      if [[ $v == \'* ]]; then
        [[ $v =~ ^\'([^\']*)\' ]] || continue; v=${BASH_REMATCH[1]}
      elif [[ $v == \"* ]]; then
        out= i=1
        while (( i < ${#v} )); do
          c=${v:i:1}
          if [ "$c" = '\' ]; then
            ((i++)); c=${v:i:1}
            case $c in n) out+=$'\n' ;; t) out+=$'\t' ;; *) out+=$c ;; esac
          elif [ "$c" = '"' ]; then break
          else out+=$c; fi
          ((i++))
        done
        (( i < ${#v} )) || continue   # no closing quote
        v=$out
      else
        v=${v%%[[:space:]]#*}; v=${v%"${v##*[![:space:]]}"}
      fi
      _magica_env_k+=("$k") _magica_env_v+=("$v")
    done < "$1"
  }
  _magica_env_unload() {   # $1 = quiet
    local k
    for k in "${_magica_env_keys[@]}"; do
      if [ -n "${_magica_env_set[$k]+1}" ]; then
        printf -v "$k" '%s' "${_magica_env_old[$k]}"
        [ "${_magica_env_set[$k]}" = x ] || export -n "$k"
      else
        unset "$k"
      fi
    done
    _magica_env_old=() _magica_env_set=() _magica_env_keys=() _magica_env_dir= _magica_env_sig=
    [ -n "$1" ] || _magica_env_say "unloaded .env"
  }
  _magica_env_load() {   # $1 = dir, $2 = signature, $3 = word for the message
    local i k a names= seen=" "
    for i in "${!_magica_env_k[@]}"; do
      k=${_magica_env_k[i]}
      if [[ $seen == *" $k "* ]]; then export "$k=${_magica_env_v[i]}"; continue; fi   # (a key twice: the last one wins)
      [ -n "${!k+1}" ] && { a=${!k@a}; _magica_env_old[$k]=${!k}; [[ $a == *x* ]] && _magica_env_set[$k]=x || _magica_env_set[$k]=-; }
      export "$k=${_magica_env_v[i]}" 2>/dev/null || { unset "_magica_env_old[$k]" "_magica_env_set[$k]"; continue; }   # (readonly)
      _magica_env_keys+=("$k") seen+="$k " names+="${names:+, }$k"
    done
    _magica_env_dir=$1 _magica_env_sig=$2
    [ -n "$names" ] && _magica_env_say "$3 .env: $names"
  }
  _magica_env_trust() {   # prints y / n / nothing for folder $1
    local f="$MAGICA_CONFIG/env-trust" a d r=
    [ -r "$f" ] || return 0
    while IFS=$'\t' read -r a d; do [ "$d" = "$1" ] && r=$a; done < "$f"
    printf '%s' "$r"
  }
  _magica_env() {
    local status=$? d=$PWD f=$PWD/.env sig= ans t
    [ "$MAGICA_CHAR" = kyubey ] && return $status   # (not in the root shell)
    [ -f "$f" ] && [ -r "$f" ] && sig=$(stat -c '%Y.%s.%i' -- "$f" 2>/dev/null || stat -f '%m.%z.%i' -- "$f" 2>/dev/null)
    if [ -n "$_magica_env_dir" ]; then
      if [ "$_magica_env_dir" = "$d" ] && [ -n "$sig" ]; then
        [ "$sig" = "$_magica_env_sig" ] && return $status
        _magica_env_unload quiet; _magica_env_parse "$f"; _magica_env_load "$d" "$sig" reloaded   # edited while here
        return $status
      fi
      _magica_env_unload
    fi
    [ "$d" = "$_magica_env_asked" ] && return $status   # said neither y nor n here; ask again after leaving and coming back
    _magica_env_asked=
    [ -n "$sig" ] || return $status
    t=$(_magica_env_trust "$d")
    [ "$t" = n ] && return $status
    _magica_env_parse "$f"
    (( ${#_magica_env_k[@]} )) || return $status
    if [ "$t" != y ]; then
      local names= k
      for k in "${_magica_env_k[@]}"; do [[ ", $names, " == *", $k, "* ]] || names+="${names:+, }$k"; done
      _magica_env_say "load .env here? ($names) [y/n]"
      read -r ans || ans=
      case $ans in
        [yY]*) t=y ;;
        [nN]*) t=n ;;
        *) _magica_env_asked=$d; return $status ;;
      esac
      if [[ $d != *$'\n'* ]]; then
        mkdir -p "$MAGICA_CONFIG" && printf '%s\t%s\n' "$t" "$d" >> "$MAGICA_CONFIG/env-trust"
      fi
      [ "$t" = y ] || return $status
    fi
    _magica_env_load "$d" "$sig" loaded
    return $status
  }
  # a pane restored from the session that had a coding agent running gets it back (MAGICA_RESUME: "claude:<session id>",
  # "codex" or "opencode", for that folder's latest one) at the first prompt: after ~/.bashrc and the .env question, and
  # quitting it leaves you in this shell
  _magica_resume() {
    local status=$? r="$MAGICA_RESUME" cmd
    unset MAGICA_RESUME
    case "$r" in
      claude:*) [[ ${r#claude:} =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] &&
                  cmd=(claude --resume "${r#claude:}") ;;
      codex) cmd=(codex resume --last) ;;
      opencode) cmd=(opencode --continue) ;;
    esac
    [ -n "${cmd[*]}" ] && command -v "${cmd[0]}" >/dev/null || return $status
    history -s "${cmd[*]}"   # (Up brings it back)
    "${cmd[@]}"
    return $status
  }
  PROMPT_COMMAND="_magica_done; _magica_env; _magica_prompt; _magica_resume${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
  PS0=$'\e[0m\e]133;C\e\\'   # the typed command is in her text colour; its output goes back to the normal colour
  _magica_prompt
  if [ "$MAGICA_CHAR" != kyubey ]; then
    for _magica_c in madoka homura sayaka mami kyoko; do
      eval "$_magica_c() { [ \"\$MAGICA_CHAR\" = $_magica_c ] && return; MAGICA_CHAR=$_magica_c; _magica_prompt; _magica_osc '9973;set;$_magica_c'; clear; }"
    done
    unset _magica_c
    # `pair` (Madoka | Homura) / `magica` (all five): this pane becomes Madoka and the terminal builds the layout around it
    for _magica_l in pair magica; do
      eval "$_magica_l() { MAGICA_CHAR=madoka; _magica_prompt; _magica_osc '9973;layout;$_magica_l'; clear; }"
    done
    unset _magica_l
    # `crush`: a match-3 game with the soul gems, in this pane (Esc / q comes back to the prompt)
    crush() { _magica_osc '9973;crush'; }
    # `note`: the notepad, in this pane (Esc comes back). `note buy milk` adds "buy milk" as a line at its end without
    # opening it. The note is a plain-text file, note.txt in the config folder.
    note() {
      if [ $# -eq 0 ]; then _magica_osc '9973;note'; return; fi
      local f="$MAGICA_CONFIG/note.txt" n
      mkdir -p "$MAGICA_CONFIG" || return
      if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then printf '\n' >> "$f"; fi   # (it didn't end with a newline)
      printf '%s\n' "$*" >> "$f" || return
      eval "n=\${_mc_${MAGICA_CHAR}_name:-100}"
      printf '\e[38;5;%smnoted\e[0m\n' "$n"
    }
    # `space [folder]`: what takes up the disk there, in this pane (Esc / q comes back; C cds into the folder on show)
    space() {
      local d; d=$(cd -- "${1:-.}" 2>/dev/null && pwd -P) || { echo "space: no such folder: $1" >&2; return 1; }
      _magica_osc "9973;space;$(printf '%s' "$d" | tr -d '\000-\037')"
    }
    # `kyubey`: this pane becomes Kyubey and runs a root shell in place; `exit` brings her back
    kyubey() {
      sudo -v || return            # ask for the password first; no switch (and no clear) if it fails
      _magica_osc '9973;set;kyubey'; clear
      sudo -H env MAGICA_APP=tauri MAGICA_CHAR=kyubey MAGICA_SHELL_DIR="$MAGICA_SHELL_DIR" MAGICA_CONFIG="$MAGICA_CONFIG" \
        TERM="$TERM" COLORTERM="$COLORTERM" bash --rcfile "$MAGICA_SHELL_DIR/bash/rc" -i
      _magica_osc "9973;set;$MAGICA_CHAR"; clear
    }
  fi
fi
