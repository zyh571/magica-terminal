# Magica Terminal shell integration (bash). Sourced from ~/.bashrc; does nothing outside Magica Terminal.

# magica-terminal: the pane's character replaces the user in the prompt; the "device" is always magica.
# Typing a character's name (madoka, homura, sayaka, mami, kyoko) switches this pane to her (and clears it, if it actually changed);
# `kyubey` asks for your sudo password, then turns the pane into Kyubey with a root shell until you exit it.
if [ -n "$MAGICA_CHAR" ]; then
  _magica_prompt() {
    # each character has her own palette slots (colors.sh); prompt lines point at them, so earlier lines
    # keep her colours after a switch, and light/dark mode recolours them
    local status=$?   # handed on unchanged, so later PROMPT_COMMAND parts (Ubuntu's vte.sh) see the command's exit code
    [ -r ~/.config/magica-terminal/colors.sh ] && . ~/.config/magica-terminal/colors.sh
    local n t p
    eval "n=\${_mc_${MAGICA_CHAR}_name:-100} t=\${_mc_${MAGICA_CHAR}_text:-101} p=\${_mc_${MAGICA_CHAR}_path:-102}"
    PS1='\[\e]0;'"$MAGICA_CHAR"'@magica: \w\a\]${debian_chroot:+($debian_chroot)}\[\e[1;38;5;'"$n"'m\]'"$MAGICA_CHAR"'@magica\[\e[0m\]:\[\e[1;38;5;'"$p"'m\]\w\[\e[0m\]\$ \[\e[38;5;'"$t"'m\]'
    return $status
  }
  # tell the terminal when a command starts (PS0) and how it ended (OSC 666 termprops), so a failure or a long run can show on her figure
  _magica_done() { local s=$?; printf '\e]666;vte.shell.postexec=%d\e\\' "$s"; return $s; }
  # a folder's .env: in a folder with a .env, its KEY=value lines are set (after asking once per folder); leaving the
  # folder (into a subfolder, too) puts every key back as it was. The file is read, never run; answers are remembered
  # in ~/.config/magica-terminal/env-trust ("y<tab>folder" / "n<tab>folder"; delete a line to be asked again).
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
    local f=~/.config/magica-terminal/env-trust a d r=
    [ -r "$f" ] || return 0
    while IFS=$'\t' read -r a d; do [ "$d" = "$1" ] && r=$a; done < "$f"
    printf '%s' "$r"
  }
  _magica_env() {
    local status=$? d=$PWD f=$PWD/.env sig= ans t
    [ -f "$f" ] && [ -r "$f" ] && sig=$(stat -c '%Y.%s.%i' -- "$f" 2>/dev/null)
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
        mkdir -p ~/.config/magica-terminal && printf '%s\t%s\n' "$t" "$d" >> ~/.config/magica-terminal/env-trust
      fi
      [ "$t" = y ] || return $status
    fi
    _magica_env_load "$d" "$sig" loaded
    return $status
  }
  PROMPT_COMMAND="_magica_done; _magica_env; _magica_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
  PS0=$'\e[0m\e]666;vte.shell.preexec!\e\\\\'   # (VTE needs ESC \ after OSC 666, not BEL) typed command is in her text colour; output goes back to the normal colour
  _magica_prompt
  for _magica_c in madoka homura sayaka mami kyoko; do
    eval "$_magica_c() { [ \"\$MAGICA_CHAR\" = $_magica_c ] && return; MAGICA_CHAR=$_magica_c; _magica_prompt; printf '\033]0;magica:set:%s\007' $_magica_c; sleep 0.1; clear; }"
  done
  unset _magica_c
  # `pair` (Madoka | Homura) / `magica` (all five): this pane becomes Madoka and the terminal builds the layout around it
  for _magica_l in pair magica; do
    eval "$_magica_l() { MAGICA_CHAR=madoka; _magica_prompt; printf '\033]0;magica:layout:%s\007' $_magica_l; sleep 0.1; clear; }"
  done
  unset _magica_l
  # `crush`: a match-3 game with the soul gems, in this pane (Esc / q comes back to the prompt)
  crush() { printf '\033]0;magica:crush\007'; sleep 0.1; }   # (the sleep lets the terminal see the title before the prompt resets it)
  # `note`: the notepad, in this pane (Esc comes back to the prompt). `note buy milk` adds "buy milk" as a line at the
  # end of it without opening it. The note is a plain-text file, ~/.config/magica-terminal/note.txt.
  note() {
    if [ $# -eq 0 ]; then printf '\033]0;magica:note\007'; sleep 0.1; return; fi
    local f=~/.config/magica-terminal/note.txt n
    mkdir -p "${f%/*}" || return
    if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then printf '\n' >> "$f"; fi   # (it didn't end with a newline)
    printf '%s\n' "$*" >> "$f" || return
    eval "n=\${_mc_${MAGICA_CHAR}_name:-100}"
    printf '\e[38;5;%smnoted\e[0m\n' "$n"
  }
  # `browser [address or search]`: a web page in this pane (✕ or Ctrl+Shift+W comes back to the prompt)
  browser() { printf '\033]0;magica:browser:%s\007' "$(printf '%s' "$*" | tr -d '\000-\037')"; sleep 0.1; }
  # `space [folder]`: what takes up the disk there, in this pane (Esc / q comes back; C cds into the folder on show)
  space() {
    local d; d=$(cd -- "${1:-.}" 2>/dev/null && pwd -P) || { echo "space: no such folder: $1" >&2; return 1; }
    printf '\033]0;magica:space:%s\007' "$d"; sleep 0.1
  }
  # `kyubey`: this pane becomes Kyubey and runs a root shell in place; `exit` brings her back
  kyubey() {
    sudo -v || return            # ask for the password first; no switch (and no clear) if it fails
    printf '\033]0;magica:set:kyubey\007'; sleep 0.1; clear
    sudo -i
    printf '\033]0;magica:set:%s\007' "$MAGICA_CHAR"; sleep 0.1; clear
  }
fi
