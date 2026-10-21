# Mwasi

Mwasi est une application web simple de suivi du cycle menstruel, en français.
Le logo de marque est fourni dans `mwasi-logo.png`; l’image originale est conservée dans `mwasi-logo.jfif`.

## Ouvrir l’application

Ouvrez `index.html` dans un navigateur récent. Aucune installation ni connexion Internet n’est nécessaire.

Pour installer l’application sur Android, téléchargez `Mwasi.apk` depuis le bouton de l’écran d’accueil, puis ouvrez le fichier sur votre appareil. Android peut demander d’autoriser l’installation depuis cette source.

## Fonctionnalités

- Création d’un profil personnel local avec nom d’affichage, sans mot de passe ni synchronisation en ligne.
- Préparation de la création de compte et de la connexion Supabase avec Google, Facebook et TikTok. Les fournisseurs doivent être configurés avant d’activer la connexion.
- Estimation de la date des prochaines règles à partir du dernier début enregistré et de la durée habituelle du cycle.
- Calendrier avec règles et fenêtre fertile estimées.
- Personnalisation de l’affichage: thème clair, sombre ou système, contraste renforcé et animations réduites.
- Rappel quotidien configurable avec notification du navigateur lorsque celui-ci l’autorise.
- Historique des débuts de règles et mise à jour de la moyenne du cycle à partir des dates enregistrées.
- Journal quotidien d’humeur, de symptômes, de douleur et de notes privées avec un résumé descriptif sur 7 jours.
- Image botanique locale pour garder l’interface illustrée même hors connexion.
- Enregistrement des repères dans le stockage local du navigateur.
- Suppression des données depuis l’application.
- Animations légères, désactivées par le réglage système de réduction des mouvements.

Les dates sont des estimations informatives. Les cycles peuvent varier; l’ovulation et la fenêtre fertile ne peuvent pas être prédites avec certitude par ce calcul et ne constituent pas un moyen de contraception. Mwasi ne remplace pas l’avis d’un professionnel de santé.

Le nom du profil, les repères du cycle, les rappels et les notes du journal restent dans le navigateur utilisé et ne sont pas synchronisés entre appareils. La connexion Supabase sert uniquement à authentifier le compte; Mwasi n’envoie pas les données du cycle ou du journal à Supabase. Effacer les données de navigation peut supprimer les informations locales.

Les notifications sont vérifiées lorsque Mwasi est ouvert et que le navigateur autorise les notifications. Dans cette version locale, les rappels ne peuvent pas être envoyés lorsque l’application est fermée.

## Configuration de la connexion Supabase

Les boutons de connexion d’un fournisseur restent désactivés tant que celui-ci n’est pas configuré et activé dans Supabase. L’URL et la clé publique du projet Mwasi sont déjà renseignées dans `supabase-config.js`.

1. Le projet Supabase **Mwasi** utilise l’offre gratuite et une région européenne. Si vous recréez le projet, copiez son URL et sa clé publique `anon` (ou `publishable`) dans `supabase-config.js`. Ne mettez jamais une clé `service_role` ni un secret OAuth dans ce fichier.
2. Dans Supabase, activez Google et Facebook et configurez leurs identifiants client et secrets dans **Authentication > Sign In / Providers**.
3. Configurez TikTok comme fournisseur OAuth personnalisé Supabase avec l’identifiant `custom:tiktok`. Suivez les paramètres OAuth demandés par Supabase et TikTok; placez le secret client uniquement dans le tableau de bord Supabase.
4. L’URL du site Supabase Auth est définie sur `https://diemuabel-glitch.github.io/mwasi/`; les URL de retour du site et de l’application Android (`mwasi://login-callback`) sont autorisées.
5. Configurez comme URL de rappel OAuth l’adresse affichée par Supabase; pour les fournisseurs intégrés, elle est de la forme `https://<référence-du-projet>.supabase.co/auth/v1/callback`.
6. Après avoir activé un fournisseur dans Supabase, passez sa valeur correspondante à `true` dans `providers` dans `supabase-config.js`. Laissez-la à `false` tant que ses identifiants ne sont pas configurés.
7. Déployez `supabase-config.js`, `auth.js` et `index.html` ensemble. Reconstruisez l’APK Android après chaque modification de configuration de l’application.

La première connexion Google, Facebook ou TikTok crée le compte Supabase si nécessaire; les connexions suivantes ouvrent le même compte du fournisseur. Google et Facebook utilisent les fournisseurs intégrés de Supabase. TikTok nécessite un fournisseur personnalisé, configuré séparément dans le tableau de bord.

Crédit développeur : Abel Diemu. Contact : [+243 84 232 2495](tel:+243842322495).
