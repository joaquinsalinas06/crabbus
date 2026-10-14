#!/bin/sh
# Tells whether this terminal can draw CrabBus's colors as designed (24-bit truecolor).
# Run it in the terminal where you use Claude Code: sh tools/check-terminal.sh

term_program="${TERM_PROGRAM:-unknown}"
colorterm="${COLORTERM:-}"
term="${TERM:-unknown}"

echo "Terminal:   $term_program"
echo "TERM:       $term"
echo "COLORTERM:  ${colorterm:-(vacío)}"
echo

# Print a 24-bit gradient: if it looks smooth, truecolor works; if it shows solid bands or pinks, it does not.
printf 'Degradado: '
awk 'BEGIN{for(i=0;i<60;i++){r=255-i*255/59;g=i*510/59;b=i*255/59;if(g>255)g=510-g;printf "\033[48;2;%d;%d;%dm \033[0m",r,g,b}print ""}'
echo

case "$colorterm" in
  truecolor|24bit)
    echo "OK: la terminal declara truecolor. Los cangrejos saldrán con sus colores."
    ;;
  *)
    echo "AVISO: la terminal no declara truecolor (COLORTERM vacío)."
    echo "Los cangrejos se dibujarán aproximados con 256 colores."
    echo "Prueba iTerm2, Ghostty, WezTerm o Kitty, o macOS 26 (Tahoe) con Terminal.app."
    ;;
esac
