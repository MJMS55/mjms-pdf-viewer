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

## 1.1.8 — 2026-10-12
- Ajout du renommage du PDF actif sur la base de l’archive 1.1.5 fournie.
- Conservation de la page courante et mise à jour des chemins de navigation.
- Refus des noms invalides et des doublons ; gestion des fichiers verrouillés et des droits insuffisants.
- Bouton Vignettes : commandes placées au-dessus du titre pour éviter son interception des clics ; bascule explicite avec état accessible.

## 1.1.9 — 2026-10-12
- Formulaire de renommage dans une popup avec gestion du focus et annulation.
- Rafraîchissement automatique de la page du dossier après fermeture du visionneur si un fichier a été renommé.

## 1.1.10 — 2026-10-12
- Surveillance de la fermeture par le composant Vue natif sans écrire dans les propriétés en lecture seule de l’API publique du Viewer.
- Popup centrée horizontalement et verticalement dans la fenêtre.

## 1.1.11 — 2026-10-12
- Interface, messages et libellés d’accessibilité traduits en anglais, français et polonais.
- Résumé et description de la fiche App Store disponibles dans les trois langues.
