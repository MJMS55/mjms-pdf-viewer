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

## 1.1.12 — 16 novembre 2026

- Renommage direct : prise en charge des réponses vides, HTML et des erreurs HTTP sans erreur de décodage JSON.
- Jeton CSRF lu depuis la page Nextcloud, avec repli sur OC.requestToken.
- Incrément de version pour permettre la mise à jour des routes Nextcloud.
- Champ de renommage : largeur minimale préservée après rechargement dans l’en-tête Nextcloud.

## 1.1.13 — 16 novembre 2026

- Accès direct à MJMS-PDF-Manager en début de barre.
- État Manager fourni par Nextcloud dès le chargement ; une panne temporaire de la vérification ne masque plus le lien confirmé actif.

## 1.1.14 — 16 novembre 2026

- Suppression du remplacement de Viewer.onClose, incompatible avec les propriétés en lecture seule.
- Barre de commandes conservée dans le composant pour stabiliser la navigation entre PDF et les composants préchargés.
- Rechargement explicite après renommage, regroupé avec les changements d’URL pour éviter les doubles chargements.
- Remplacement des métadonnées du fichier sans affectation aux propriétés natives en lecture seule.

## 1.1.15 — 16 novembre 2026

- Erreurs de renommage dans un bandeau contrasté avec focus accessible, sans codes HTTP.
- Titre natif du PDF masqué, nom conservé dans le champ de renommage.
- Rechargement du dossier à la fermeture du lecteur après un renommage réussi, même après navigation entre PDF, sans modifier onClose.

## 1.1.16 — 16 novembre 2026

- Commandes PDF et boutons natifs Nextcloud alignés sur une seule ligne, sans déplacement des éléments Vue.
- Espace réservé à droite pour les actions natives ; commandes PDF défilantes horizontalement sur écran étroit.

## 1.1.17 — 16 novembre 2026

- Actualisation du dossier uniquement quand le Viewer libère son fichier courant, sans dépendre des transitions visuelles.
- Nouveau nom et nouvelle URL conservés pour les PDF préchargés après renommage et retour au document.

## 1.1.18 — 17 novembre 2026

- Synchronisation du cache Fichiers Nextcloud après renommage via les événements natifs moved, updated et renamed, avant la navigation.
- État des PDF renommés réactif pour les composants préchargés avant le renommage.
- Préservation explicite du type MIME et de l’identifiant des métadonnées à accesseurs.
- Test avec les méthodes de navigation amont de Nextcloud 35 et résolution du chemin par le cache du dossier.
