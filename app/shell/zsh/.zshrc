_magica_zdot=$ZDOTDIR ZDOTDIR=$MAGICA_USER_ZDOTDIR
[[ -r $ZDOTDIR/.zshrc ]] && . $ZDOTDIR/.zshrc
MAGICA_USER_ZDOTDIR=$ZDOTDIR ZDOTDIR=$_magica_zdot
. "$MAGICA_SHELL_DIR/magica.zsh"
[[ -o login ]] || { ZDOTDIR=$MAGICA_USER_ZDOTDIR; unset _magica_zdot; }   # (.zlogin does this for login shells)
