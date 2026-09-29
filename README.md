# MJMS-PDF-Viewer

Application Nextcloud de visualisation de PDF avec navigation entre les pages et entre les fichiers d'un même dossier, via l'intégration au Viewer natif de Nextcloud.

## Fonctionnalités

- Affichage des fichiers PDF directement dans le Viewer de Nextcloud
- Navigation page suivante / page précédente au sein d'un document
- Navigation fichier suivant / fichier précédent entre les PDF d'un même dossier (via le Viewer natif)
- Rendu via [PDF.js](https://mozilla.github.io/pdf.js/)

## Prérequis

- Nextcloud 30 à 34
- Node.js et npm (pour la compilation, en développement uniquement)
- L'application officielle **PDF Viewer** (`files_pdfviewer`) doit être désactivée pour éviter tout conflit sur le mimetype `application/pdf` :
  ```bash
  php occ app:disable files_pdfviewer
  ```

## Installation

### Depuis une archive

1. Télécharger la dernière release
2. Extraire l'archive dans le dossier `apps/` de votre instance Nextcloud, sous le nom exact `mjms_pdf_viewer`
3. Activer l'application :
   ```bash
   php occ app:enable mjms_pdf_viewer
   ```

### Depuis les sources

```bash
git clone https://github.com/MJMS55/mjms-pdf-viewer.git
cd mjms-pdf-viewer
npm install
npm run build
```

Puis copier le dossier (sans `node_modules/` ni `src/`) dans `apps/mjms_pdf_viewer` sur le serveur, et activer l'application comme ci-dessus.

## Développement

```bash
npm run watch
```

Recompile automatiquement à chaque modification des fichiers sources.

## Structure du projet

```
mjms_pdf_viewer/
├── appinfo/          # Métadonnées et configuration de l'app
├── lib/              # Code PHP (backend)
├── src/               # Composants Vue (frontend)
└── js/                # Fichiers compilés (générés par npm run build)
```

## Licence

AGPL-3.0-or-later

## Auteur

MJMS — [mjms.fr](https://mjms.fr) — contact@mjms.fr

## Mise à jour 1.1.0 : ouvrir dans Manager

Installer également MJMS-PDF-Manager 0.3.0 et l’activer pour l’utilisateur. Ouvrir un PDF avec cette visionneuse, puis **Actions → Ouvrir dans MJMS-PDF-Manager**. Un nouvel onglet ouvre le PDF dans l’atelier ; aucun fichier n’est modifié à cette étape. Le lien n’est pas proposé aux visiteurs anonymes ni si Manager est désactivé.

Les styles isolés sont chargés avec l’API Nextcloud dans css/viewer.css. Le JavaScript compilé est fourni : aucune compilation nécessaire sur le serveur. Pour reproduire la compilation : npm ci --ignore-scripts puis npm run build. La configuration de compilation existante annonce Node 20/npm 9–10 ; la livraison a compilé avec Node 24.20/npm 12 avec cet avertissement de version et des avertissements de taille des ressources.

Validation locale : compilation réussie et syntaxe PHP vérifiée. Le test d’intégration dans le Viewer de votre instance Nextcloud 34 reste nécessaire. L’audit des dépendances de production signale deux alertes de faible gravité liées à Vue 2 (analyse de modèles HTML), sans correctif compatible proposé. Les modèles de cette app sont fixes et précompilés. L’outillage de développement existant signale également des alertes ; node_modules n’est pas distribué.

## Correctif 1.1.1

Le composant signale maintenant update:loaded au Viewer natif après le rendu de la première page. Les erreurs de lecture/rendu sont transmises au Viewer pour remplacer l’indicateur par une erreur. Le rendu démarre après montage du canvas ; les changements de document et la fermeture annulent les tâches précédentes. Les URL source fournies par le Viewer sont prises en charge, avec davPath en repli.

Installer cette archive dans apps/mjms_pdf_viewer, effectuer la mise à jour Nextcloud si demandée puis Ctrl+F5. Manager reste inchangé. Tests de régression : npm test. Contrat du Viewer : https://github.com/nextcloud/viewer/blob/master/src/views/Viewer.vue (loaded.sync et événement error). L’intégration sur votre serveur reste à confirmer.
