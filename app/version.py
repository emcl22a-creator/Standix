#!/usr/bin/env python3
"""
Met à jour les numéros de version de app.js et style.css dans index.html.

    python3 version.py

À LANCER AVANT CHAQUE DÉPLOIEMENT, depuis le dossier `app/`.

─── POURQUOI ────────────────────────────────────────────────────────────────

Safari garde les fichiers en cache et les ressert sans demander s'ils ont
changé. On obtient alors un HTML neuf piloté par un script ancien — la
combinaison la plus trompeuse qui soit, parce que chaque moitié est correcte.

C'est ce qui s'est produit au passage de quatre à trois onglets : le balisage
neuf affichait « Procédures, Analyse, Réglages », le script en cache pointait
encore vers l'ancienne liste, et chaque onglet ouvrait la page précédente.

Le numéro est l'empreinte du contenu : il ne change QUE si le fichier change.
Le cache reste donc utile entre deux déploiements, et devient caduc dès qu'il
ne doit plus servir.

⚠ CE SCRIPT NE DEVINE RIEN. Si vous modifiez app.js sans le relancer,
  index.html gardera l'ancien numéro et le cache reprendra la main. C'est le
  seul geste à ne pas oublier.
"""

import hashlib
import pathlib
import re
import sys

ICI = pathlib.Path(__file__).parent
INDEX = ICI / 'index.html'

# Les fichiers à versionner, et le motif qui les cite dans index.html.
CIBLES = [
    ('app.js',    r'(src=")app\.js(\?v=[0-9a-f]+)?(")'),
    ('style.css', r'(href=")style\.css(\?v=[0-9a-f]+)?(")'),
]


def empreinte(chemin):
    """Les huit premiers caractères du SHA-1 : assez pour distinguer deux
    versions, assez court pour rester lisible dans l'adresse."""
    return hashlib.sha1(chemin.read_bytes()).hexdigest()[:8]


def main():
    if not INDEX.exists():
        print(f'index.html introuvable dans {ICI}', file=sys.stderr)
        return 1

    html = INDEX.read_text(encoding='utf-8')
    change = False

    for nom, motif in CIBLES:
        fichier = ICI / nom
        if not fichier.exists():
            print(f'  {nom:12s} absent — ignoré')
            continue

        v = empreinte(fichier)
        neuf, n = re.subn(motif, rf'\g<1>{nom}?v={v}\g<3>', html)

        if n == 0:
            # ⚠ ON LE DIT PLUTÔT QUE DE L'IGNORER. Une balise renommée ferait
            #   échouer le remplacement en silence, et le cache reviendrait
            #   sans qu'on sache pourquoi.
            print(f'  {nom:12s} NON TROUVÉ dans index.html — vérifiez la balise')
            continue

        if neuf != html:
            change = True
            print(f'  {nom:12s} -> ?v={v}')
        else:
            print(f'  {nom:12s} inchangé (?v={v})')

        html = neuf

    if change:
        INDEX.write_text(html, encoding='utf-8')
        print('\nindex.html mis à jour. Déployez les trois fichiers ensemble.')
    else:
        print('\nRien à changer.')

    # ⚠ LES TROIS FICHIERS PARTENT ENSEMBLE. Déployer app.js sans index.html
    #   laisse l'ancien numéro en place : le navigateur croit avoir la bonne
    #   version et ne la redemande pas.
    return 0


if __name__ == '__main__':
    sys.exit(main())
