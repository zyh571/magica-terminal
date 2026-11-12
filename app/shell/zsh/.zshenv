# Magica Terminal starts zsh with ZDOTDIR pointing here, so it can load its script after the user's own startup
# files. Each file here reads the user's own one (from their ZDOTDIR) and points ZDOTDIR back here for the next.
_magica_zdot=${ZDOTDIR}
ZDOTDIR=${MAGICA_USER_ZDOTDIR:-$HOME}
[[ -r $ZDOTDIR/.zshenv ]] && . $ZDOTDIR/.zshenv
MAGICA_USER_ZDOTDIR=$ZDOTDIR ZDOTDIR=$_magica_zdot
