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
