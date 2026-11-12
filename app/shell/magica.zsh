# Magica Terminal shell integration (zsh). Magica Terminal loads this itself when it starts zsh (after ~/.zshrc); it
# does nothing anywhere else. Same protocol and commands as magica.bash (see there).
if [[ $MAGICA_APP == tauri && -n $MAGICA_CHAR ]]; then
  zmodload zsh/parameter 2>/dev/null
  autoload -Uz add-zsh-hook
  typeset -g _mc_madoka_name=100 _mc_madoka_text=101 _mc_madoka_path=102 _mc_homura_name=103 _mc_homura_text=104
  typeset -g _mc_homura_path=105 _mc_sayaka_name=106 _mc_sayaka_text=107 _mc_sayaka_path=108 _mc_mami_name=109
  typeset -g _mc_mami_text=110 _mc_mami_path=111 _mc_kyoko_name=112 _mc_kyoko_text=113 _mc_kyoko_path=114
  typeset -g _mc_kyubey_name=115 _mc_kyubey_text=116 _mc_kyubey_path=117 _mc_red=118
  _magica_osc() { printf '\e]%s\e\\' "$1"; }
  _magica_slot() { local v="_mc_${MAGICA_CHAR}_$1"; print -rn -- "${(P)v:-$2}"; }
  _magica_prompt() {
    local n=$(_magica_slot name 100) t=$(_magica_slot text 101) p=$(_magica_slot path 102)
    if [[ $MAGICA_CHAR == kyubey ]]; then
      PROMPT=$'%{\e]133;A\e\\\e]0;kyubey@magica: %~\a%}%{\e[1;38;5;'"$n"$'m%}kyubey%{\e[1;38;5;118m%}@magica%{\e[0m%}:%{\e[1;38;5;'"$p"$'m%}%~%{\e[1;38;5;118m%}#%{\e[0m%} %{\e]133;B\e\\\e[38;5;'"$t"$'m%}'
    else
      PROMPT=$'%{\e]133;A\e\\\e]0;'"$MAGICA_CHAR"$'@magica: %~\a%}%{\e[1;38;5;'"$n"$'m%}'"$MAGICA_CHAR"$'@magica%{\e[0m%}:%{\e[1;38;5;'"$p"$'m%}%~%{\e[0m%}$ %{\e]133;B\e\\\e[38;5;'"$t"$'m%}'
    fi
  }
  _magica_osc7() {
    emulate -L zsh
    local LC_ALL=C p=$PWD out= c i
    for (( i = 1; i <= ${#p}; i++ )); do
      c=${p[i]}
      case $c in
        [a-zA-Z0-9/._~-]) out+=$c ;;
        *) printf -v c '%%%02X' "'$c"; out+=${c[-3,-1]} ;;
      esac
    done
    printf '\e]7;file://%s%s\e\\' "${HOST:-}" "$out"
  }
  # a folder's .env (see magica.bash for the rules; the two behave the same)
  typeset -gA _magica_env_old _magica_env_set
  typeset -g _magica_env_dir= _magica_env_sig= _magica_env_asked=
  typeset -ga _magica_env_keys _magica_env_k _magica_env_v
  _magica_env_say() { printf '\e[38;5;%sm%s\e[0m\n' "$(_magica_slot name 100)" "$*"; }
  _magica_env_parse() {
    emulate -L zsh
    setopt extendedglob
    _magica_env_k=() _magica_env_v=()
    local line k v out i c
    while IFS= read -r line || [[ -n $line ]]; do
      line=${line%$'\r'}; line=${line##[[:space:]]#}
      [[ -z $line || $line == \#* ]] && continue
      [[ $line =~ '^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$' ]] || continue
      k=$match[2] v=$match[3]
      [[ $k == _magica* || $k == MAGICA_CHAR || $k == PWD || $k == OLDPWD ]] && continue
      if [[ $v == \'* ]]; then
        [[ $v =~ "^'([^']*)'" ]] || continue; v=$match[1]
      elif [[ $v == \"* ]]; then
        out= i=1
        while (( i < ${#v} )); do
          c=${v:$i:1}
          if [[ $c == '\' ]]; then
            (( i++ )); c=${v:$i:1}
            case $c in n) out+=$'\n' ;; t) out+=$'\t' ;; *) out+=$c ;; esac
          elif [[ $c == '"' ]]; then break
          else out+=$c; fi
          (( i++ ))
        done
        (( i < ${#v} )) || continue   # no closing quote
        v=$out
      else
        v=${v%%[[:space:]]\#*}; v=${v%%[[:space:]]##}
      fi
      _magica_env_k+=("$k") _magica_env_v+=("$v")
    done < "$1"
  }
  _magica_env_unload() {   # $1 = quiet
    emulate -L zsh
    local k
    for k in $_magica_env_keys; do
      if (( ${+_magica_env_set[$k]} )); then
        if [[ $_magica_env_set[$k] == x ]]; then export "$k=$_magica_env_old[$k]"
        else typeset -g +x "$k=$_magica_env_old[$k]"; fi
      else
        unset "$k"
      fi
    done
    _magica_env_old=() _magica_env_set=() _magica_env_keys=() _magica_env_dir= _magica_env_sig=
    [[ -n $1 ]] || _magica_env_say "unloaded .env"
  }
  _magica_env_load() {   # $1 = dir, $2 = signature, $3 = word for the message
    emulate -L zsh
    local i k names= seen=" " kind
    for (( i = 1; i <= ${#_magica_env_k}; i++ )); do
      k=$_magica_env_k[i]
      if [[ $seen == *" $k "* ]]; then export "$k=$_magica_env_v[i]"; continue; fi   # (a key twice: the last one wins)
      kind=${parameters[$k]}
      if [[ -n $kind ]]; then
        _magica_env_old[$k]=${(P)k}
        [[ $kind == *export* ]] && _magica_env_set[$k]=x || _magica_env_set[$k]=-
      fi
      if [[ $kind == *readonly* ]]; then unset "_magica_env_old[$k]" "_magica_env_set[$k]"; continue; fi
      export "$k=$_magica_env_v[i]"
      _magica_env_keys+=("$k") seen+="$k " names+="${names:+, }$k"
    done
    _magica_env_dir=$1 _magica_env_sig=$2
    [[ -n $names ]] && _magica_env_say "$3 .env: $names"
  }
  _magica_env_trust() {   # prints y / n / nothing for folder $1
    local f="$MAGICA_CONFIG/env-trust" a d r=
    [[ -r $f ]] || return 0
    while IFS=$'\t' read -r a d; do [[ $d == "$1" ]] && r=$a; done < "$f"
    print -rn -- "$r"
  }
  _magica_env() {
    local s=$? d=$PWD f=$PWD/.env sig= ans t
    [[ $MAGICA_CHAR == kyubey ]] && return $s   # (not in the root shell)
    [[ -f $f && -r $f ]] && sig=$(stat -c '%Y.%s.%i' -- "$f" 2>/dev/null || stat -f '%m.%z.%i' -- "$f" 2>/dev/null)
    if [[ -n $_magica_env_dir ]]; then
      if [[ $_magica_env_dir == "$d" && -n $sig ]]; then
        [[ $sig == "$_magica_env_sig" ]] && return $s
        _magica_env_unload quiet; _magica_env_parse "$f"; _magica_env_load "$d" "$sig" reloaded   # edited while here
        return $s
      fi
      _magica_env_unload
    fi
    [[ $d == "$_magica_env_asked" ]] && return $s   # said neither y nor n here; ask again after leaving and coming back
    _magica_env_asked=
    [[ -n $sig ]] || return $s
    t=$(_magica_env_trust "$d")
    [[ $t == n ]] && return $s
    _magica_env_parse "$f"
    (( ${#_magica_env_k} )) || return $s
    if [[ $t != y ]]; then
      local names= k
      for k in $_magica_env_k; do [[ ", $names, " == *", $k, "* ]] || names+="${names:+, }$k"; done
      _magica_env_say "load .env here? ($names) [y/n]"
      read -r ans || ans=
      case $ans in
        [yY]*) t=y ;;
        [nN]*) t=n ;;
        *) _magica_env_asked=$d; return $s ;;
      esac
      if [[ $d != *$'\n'* ]]; then
        mkdir -p "$MAGICA_CONFIG" && printf '%s\t%s\n' "$t" "$d" >> "$MAGICA_CONFIG/env-trust"
      fi
      [[ $t == y ]] || return $s
    fi
    _magica_env_load "$d" "$sig" loaded
    return $s
  }
  # a restored pane's coding agent, started again at the first prompt (see magica.bash)
  _magica_resume() {
    local s=$? r=$MAGICA_RESUME
    local -a cmd
    unset MAGICA_RESUME
    case $r in
      claude:*) [[ ${r#claude:} =~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' ]] &&
                  cmd=(claude --resume "${r#claude:}") ;;
      codex) cmd=(codex resume --last) ;;
      opencode) cmd=(opencode --continue) ;;
    esac
    (( ${#cmd} )) && (( ${+commands[$cmd[1]]} )) || return $s
    print -s -- "${(j: :)cmd}"   # (Up brings it back)
    "${cmd[@]}"
    return $s
  }
  _magica_precmd() {
    local s=$?
    _magica_osc "133;D;$s"
    _magica_osc7
    (exit $s); _magica_env
    _magica_prompt
    (exit $s); _magica_resume
    return $s
  }
  _magica_preexec() { printf '\e[0m\e]133;C\e\\'; }
  precmd_functions=(_magica_precmd ${precmd_functions:#_magica_precmd})
  add-zsh-hook preexec _magica_preexec
  _magica_prompt
  if [[ $MAGICA_CHAR != kyubey ]]; then
    for _magica_c in madoka homura sayaka mami kyoko; do
      eval "$_magica_c() { [[ \$MAGICA_CHAR == $_magica_c ]] && return; MAGICA_CHAR=$_magica_c; _magica_prompt; _magica_osc '9973;set;$_magica_c'; clear; }"
    done
    unset _magica_c
    for _magica_l in pair magica; do
      eval "$_magica_l() { MAGICA_CHAR=madoka; _magica_prompt; _magica_osc '9973;layout;$_magica_l'; clear; }"
    done
    unset _magica_l
    crush() { _magica_osc '9973;crush'; }
    note() {
      if (( $# == 0 )); then _magica_osc '9973;note'; return; fi
      local f="$MAGICA_CONFIG/note.txt"
      mkdir -p "$MAGICA_CONFIG" || return
      if [[ -s $f && -n $(tail -c 1 "$f") ]]; then printf '\n' >> "$f"; fi   # (it didn't end with a newline)
      printf '%s\n' "$*" >> "$f" || return
      printf '\e[38;5;%smnoted\e[0m\n' "$(_magica_slot name 100)"
    }
    space() {
      local d; d=$(cd -- "${1:-.}" 2>/dev/null && pwd -P) || { echo "space: no such folder: $1" >&2; return 1; }
      _magica_osc "9973;space;$(printf '%s' "$d" | tr -d '\000-\037')"
    }
    kyubey() {
      sudo -v || return            # ask for the password first; no switch (and no clear) if it fails
      _magica_osc '9973;set;kyubey'; clear
      sudo -H env MAGICA_APP=tauri MAGICA_CHAR=kyubey MAGICA_SHELL_DIR="$MAGICA_SHELL_DIR" MAGICA_CONFIG="$MAGICA_CONFIG" \
        TERM="$TERM" COLORTERM="$COLORTERM" ZDOTDIR="$MAGICA_SHELL_DIR/zsh" zsh -i
      _magica_osc "9973;set;$MAGICA_CHAR"; clear
    }
  fi
fi
