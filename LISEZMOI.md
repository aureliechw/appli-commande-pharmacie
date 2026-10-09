# Appli Commande — optimisation des commandes de médicaments

Application web 100 % navigateur, publiée sur GitHub Pages. Le fichier du jour est traité dans le navigateur :
il n'est envoyé à aucun serveur.

## Utilisation
1. Ouvrir le site GitHub Pages (https://aureliechw.github.io/appli-commande-pharmacie/).
2. Charger le fichier du jour (`prev_reap_phar…xlsx`), puis cliquer sur **Analyser**.
3. L'export ANSM est récupéré automatiquement (voir ci-dessous). S'il est trop ancien ou absent, un bandeau l'indique ;
   on peut alors charger l'export manuellement via « Export ANSM manuel ».
4. Ajuster les quantités (cellule « Qté à commander ») et supprimer les lignes inutiles (✕). Les coûts HT / TVA 2,1 % / TTC
   se recalculent immédiatement. Les modifications sont conservées dans le navigateur si la page est rechargée.
5. **Valider les quantités et exporter** : un fichier Excel par laboratoire + un ZIP qui les regroupe,
   enregistrés dans le dossier de téléchargements.

## Export ANSM automatique
Le site de l'ANSM refuse les requêtes venant d'une page web : l'export ne peut pas être téléchargé par le navigateur.
La tâche GitHub Actions `.github/workflows/deploy.yml` le télécharge à chaque publication et deux fois par jour
(6 h et 13 h, heure de Paris en été), puis le publie avec le site (`data/ansm_export.xls`).
En cas d'échec, l'export déjà en ligne est conservé. Lancement manuel : onglet **Actions** du dépôt →
« Mise à jour ANSM et publication » → **Run workflow**.

GitHub désactive les tâches planifiées d'un dépôt public sans activité depuis 60 jours (un e-mail prévient) :
il suffit alors de les réactiver dans l'onglet **Actions**.

## Règles appliquées
- Méthode du prompt (étapes 1 à 5) : conso prévisionnelle = max(moyenne M-1/M-2/M-3, M-11), seuil = 10 + délai (DELREA),
  fréquence selon le nombre de références du fournisseur, quantité arrondie au multiple supérieur de QTE_MIN_FOUR.
- Produits exclus : codes BLOCAGE `C`, `AUT` et commençant par `E` (modifiable dans `public/js/config.js`, clé `codesBlocageExclus`).
- QTE_MIN_FOUR à 0 ou vide : 1 est utilisé (repère « Qté min ? » sur la ligne).
- Croisement ANSM par algorithme local (marque ou DCI, forme, labo, dosage) → CONFIRME / PROBABLE / DOUTE, avec une note
  expliquant chaque critère. Il reste indicatif : vérifier les DOUTE et PROBABLE via le lien vers la fiche ANSM.

## Fichiers
- `public/` : le site publié (`app.js` pour l'interface, `js/` pour le calcul, le croisement ANSM et l'export, `vendor/` pour les bibliothèques Excel/ZIP).
- `public/js/config.js` : taux de TVA, codes blocage exclus, statuts ANSM retenus.
- `outils/telecharger-ansm.sh` : téléchargement de l'export ANSM par GitHub Actions.
- `outils/serveur-local.js` : test en local (`node outils/serveur-local.js` puis http://localhost:3000).
- Non publiés (voir `.gitignore`) : `data/`, `exports/`, fichiers `.xlsx`, `ancienne-version-serveur/`.
