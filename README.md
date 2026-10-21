# Mwasi

Mwasi est une application web simple de suivi du cycle menstruel, en français.
Le logo de marque est fourni dans `mwasi-logo.png`; l’image originale est conservée dans `mwasi-logo.jfif`.

## Ouvrir l’application

Ouvrez `index.html` dans un navigateur récent. Aucune installation ni connexion Internet n’est nécessaire.

Pour installer l’application sur Android, téléchargez `Mwasi.apk` depuis le bouton de l’écran d’accueil, puis ouvrez le fichier sur votre appareil. Android peut demander d’autoriser l’installation depuis cette source.

## Fonctionnalités

- Création d’un compte en ligne par pseudo, adresse e-mail et mot de passe, avec confirmation de l’adresse e-mail selon le réglage Supabase.
- Recherche facultative de pseudos et demandes de contact à accepter avant toute conversation privée.
- Chat privé avec blocage et signalement. Les messages sont stockés dans Supabase; les données du cycle et le journal restent locaux.
- Création d’un profil personnel local avec nom d’affichage, indépendant du pseudo du compte.
- Préparation de la connexion Supabase avec Google, Facebook et TikTok. Ces fournisseurs restent désactivés tant que leurs identifiants OAuth ne sont pas configurés.
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

Le nom du profil local, les repères du cycle, les rappels et les notes du journal restent dans le navigateur utilisé et ne sont pas synchronisés entre appareils. Le compte Supabase conserve l’adresse e-mail pour l’authentification, le pseudo et les préférences de visibilité. Les pseudo, demandes, messages, blocages et signalements de chat sont stockés en ligne. Les autres utilisateurs ne peuvent pas lire l’adresse e-mail ou les données de cycle. Un signalement peut être examiné par le propriétaire du projet depuis le tableau de bord Supabase. Effacer les données de navigation peut supprimer les informations locales, mais ne supprime pas le compte ni les messages en ligne.

Les notifications sont vérifiées lorsque Mwasi est ouvert et que le navigateur autorise les notifications. Dans cette version locale, les rappels ne peuvent pas être envoyés lorsque l’application est fermée.

## Configuration du compte et du chat Supabase

L’URL et la clé publique du projet Mwasi sont déjà renseignées dans `supabase-config.js`. Le compte e-mail et le chat requièrent une connexion Internet. Avant de les utiliser sur un projet Supabase, exécutez une fois le script `supabase/migrations/20261021100000_profiles_and_private_chat.sql` dans **SQL Editor** du tableau de bord du projet. Ce script crée les tables, les politiques d’accès et les fonctions nécessaires au profil, aux demandes, au chat, au blocage et aux signalements. Vérifiez que son exécution s’est terminée sans erreur avant de créer des comptes.

1. Le projet Supabase **Mwasi** utilise l’offre gratuite et une région européenne. Si vous recréez le projet, copiez son URL et sa clé publique `anon` (ou `publishable`) dans `supabase-config.js`. Ne mettez jamais une clé `service_role` ni un secret OAuth dans ce fichier.
2. Dans **Authentication > URL Configuration**, conservez l’URL du site `https://diemuabel-glitch.github.io/mwasi/` et les URL de retour nécessaires. La confirmation d’e-mail est définie dans les paramètres d’authentification Supabase.
3. Pour activer ultérieurement Google, Facebook ou TikTok, configurez les identifiants OAuth dans Supabase, autorisez les URL de retour du site et de l’application Android (`mwasi://login-callback`), puis activez uniquement le fournisseur configuré dans `supabase-config.js`. TikTok nécessite une configuration personnalisée Supabase.
4. Déployez ensemble `supabase-config.js`, `auth.js` et `index.html`. Reconstruisez l’APK Android après chaque modification de l’application.

Un pseudo n’est trouvable que si son propriétaire active **Me rendre trouvable**. La demande doit être acceptée avant de commencer à envoyer des messages. Les utilisateurs peuvent bloquer un compte ou signaler une conversation; les signalements sont conservés dans `chat_reports` pour examen par le propriétaire du projet. Google, Facebook et TikTok ne sont pas activés par défaut.

Crédit développeur : Abel Diemu. Contact : [+243 84 232 2495](tel:+243842322495).
