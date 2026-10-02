# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

## [Unreleased]

## 1.1.3 - 2026-10-02
### Fixed
- Cadre et ombre autour de la page PDF, sur un fond de travail distinct.
- Suppression de la marge inférieure du viewer uniquement pour ce handler ; hauteur du composant alignée sur son conteneur.
- Bandeau Nextcloud adapté au thème courant.
### Added
- Boutons PDF précédent / PDF suivant dans la barre supérieure, reliés à la navigation du viewer Nextcloud.

## 1.1.2 - 2026-10-02
### Fixed
- Styles du viewer inclus dans le JavaScript avec le nonce CSP Nextcloud 30+ ; le rendu ne dépend plus du chargement de la feuille CSS externe.
- Vignettes dans une colonne à gauche, avec défilement indépendant, y compris sur petit écran.
- Fond opaque et dimensions du viewer adaptés à la fenêtre Nextcloud.
- Version augmentée pour renouveler le cache des ressources de l’application.

## 1.0.0 - 2026-09-27
### Added
- Affichage des fichiers PDF dans le Viewer de Nextcloud, via PDF.js
- Navigation page suivante / page précédente au sein d'un document
- Navigation fichier suivant / fichier précédent entre les PDF d'un même dossier, via le Viewer natif
