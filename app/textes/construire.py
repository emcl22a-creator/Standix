#!/usr/bin/env python3
"""
Reconstruit le dictionnaire de l'app a partir de `interface.json`.

    python3 traduction/construire.py

`interface.json` est LA source : une phrase francaise, sa version anglaise,
sa version allemande. Ce script recopie son contenu dans `app.js`, entre les
deux reperes `DICO:DEBUT` et `DICO:FIN`, et ne touche a rien d'autre.

Pourquoi un fichier a part plutot qu'ecrire directement dans app.js :
  - app.js fait 33 000 lignes ; y chercher une traduction a corriger est
    penible et risque, on finit par casser une accolade.
  - un fichier de donnees se relit, se trie, se compare d'une version a
    l'autre. On voit en un coup d'oeil ce qui a change.
  - l'etape suivante (l'IA qui traduit les phrases nouvelles) ecrira ici,
    jamais dans le code.

Le script s'arrete avec une erreur si les reperes manquent : mieux vaut un
refus net qu'un dictionnaire colle au mauvais endroit.
"""
import io
import json
import re
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
APP = ICI.parent / 'app.js'
SOURCE = ICI / 'interface.json'

DEBUT = '/* DICO:DEBUT */'
FIN = '/* DICO:FIN */'


def cle(s):
    """Meme normalisation que `cleTexte` dans app.js : espaces uniques."""
    return re.sub(r'\s+', ' ', s).strip()


def bloc(phrases, langue):
    lignes = []
    for fr in sorted(phrases, key=str.lower):
        cible = phrases[fr].get(langue)
        # ⚠ UNE PHRASE IDENTIQUE DANS LES DEUX LANGUES RESTE DANS LE DICTIONNAIRE.
        # « 1 min » se dit pareil en anglais ; absente du dictionnaire, elle
        # serait prise pour une phrase jamais traduite et partirait a l'IA a
        # chaque session. Presente, elle dit « deja vu, c'est bon ».
        if not cible:
            continue
        lignes.append('    %s: %s,' % (json.dumps(cle(fr), ensure_ascii=False),
                                         json.dumps(cible, ensure_ascii=False)))
    return '\n'.join(lignes)


def main():
    phrases = json.loads(SOURCE.read_text(encoding='utf-8'))
    code = APP.read_text(encoding='utf-8')

    if DEBUT not in code or FIN not in code:
        sys.exit('Reperes DICO:DEBUT / DICO:FIN introuvables dans app.js — rien ecrit.')

    avant, reste = code.split(DEBUT, 1)
    _, apres = reste.split(FIN, 1)

    milieu = (DEBUT + '\n  en: {\n' + bloc(phrases, 'en') + '\n  },\n'
              '  de: {\n' + bloc(phrases, 'de') + '\n  },\n  ' + FIN)

    APP.write_text(avant + milieu + apres, encoding='utf-8')

    manque = {l: [fr for fr, v in phrases.items() if not v.get(l)] for l in ('en', 'de')}
    print(f'{len(phrases)} phrases · anglais manquant : {len(manque["en"])} · '
          f'allemand manquant : {len(manque["de"])}')
    for l, liste in manque.items():
        for fr in liste[:10]:
            print(f'   {l} ✗ {fr}')


if __name__ == '__main__':
    main()
