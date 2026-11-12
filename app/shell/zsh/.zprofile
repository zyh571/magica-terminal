_magica_zdot=$ZDOTDIR ZDOTDIR=$MAGICA_USER_ZDOTDIR
[[ -r $ZDOTDIR/.zprofile ]] && . $ZDOTDIR/.zprofile
MAGICA_USER_ZDOTDIR=$ZDOTDIR ZDOTDIR=$_magica_zdot
