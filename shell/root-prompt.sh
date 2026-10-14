# >>> magica kyubey
# Kyubey owns the root shell: kyubey@magica, colours from his palette slots (magica-terminal colors.sh): white/grey/black only
_kyubey_prompt() {
  [ -r /home/yihao/.config/magica-terminal/colors.sh ] && . /home/yihao/.config/magica-terminal/colors.sh
  local n=${_mc_kyubey_name:-115} t=${_mc_kyubey_text:-116} p=${_mc_kyubey_path:-117} r=${_mc_red:-118}
  PS1='\[\e]0;kyubey@magica: \w\a\]${debian_chroot:+($debian_chroot)}\[\e[1;38;5;'"$n"'m\]kyubey\[\e[1;38;5;'"$r"'m\]@magica\[\e[0m\]:\[\e[1;38;5;'"$p"'m\]\w\[\e[1;38;5;'"$r"'m\]#\[\e[0m\] \[\e[38;5;'"$t"'m\]'
}
PROMPT_COMMAND="_kyubey_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
PS0=$'\e[0m'
# <<< magica kyubey
