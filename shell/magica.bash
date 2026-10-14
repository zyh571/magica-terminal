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
  PROMPT_COMMAND="_magica_done; _magica_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
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
  # `kyubey`: this pane becomes Kyubey and runs a root shell in place; `exit` brings her back
  kyubey() {
    sudo -v || return            # ask for the password first; no switch (and no clear) if it fails
    printf '\033]0;magica:set:kyubey\007'; sleep 0.1; clear
    sudo -i
    printf '\033]0;magica:set:%s\007' "$MAGICA_CHAR"; sleep 0.1; clear
  }
fi
