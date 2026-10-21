# KOZ

KOZ est un réseau social en français qui rassemble un fil de publications, des vidéos courtes, des profils, des abonnements, une messagerie privée et des appels audio/vidéo.

## Lancer le projet en local

Depuis PowerShell, démarrez un serveur HTTP dans le dossier `Mwasi` :

```powershell
py -m http.server 8000
```

Ouvrez ensuite `http://localhost:8000` dans un navigateur récent. Ne lancez pas `index.html` directement depuis le système de fichiers : l’application charge son module JavaScript et la bibliothèque Supabase par HTTP. La connexion, le partage de contenus et les appels nécessitent une connexion Internet et le projet Supabase configuré dans `supabase-config.js`. Les appels et l’accès au micro et à la caméra exigent HTTPS ou `localhost`.

## Fonctionnalités

- Création de compte avec nom, adresse e-mail, téléphone, mot de passe et photo de profil; connexion et vérification du téléphone par code SMS; inscription ou connexion avec Google, Facebook, TikTok et X.
- Publications textuelles et téléversement de photos ou vidéos, avec réactions et commentaires.
- Fil de la communauté, vue dédiée aux vidéos et profils personnels.
- Recherche de membres, abonnements, demandes et conversations privées.
- Appels audio ou vidéo entre participants d’une conversation acceptée, avec WebRTC et signalisation Supabase Realtime.
- Permissions micro/caméra demandées à l’utilisateur dans le navigateur et l’application Android.

Les publications et médias partagés sont visibles par les membres connectés; les fichiers du stockage KOZ utilisent des URL publiques. Évite de publier des informations personnelles ou sensibles. Les appels sont chiffrés par WebRTC lorsqu’une connexion directe est établie; un service TURN peut relayer le trafic lorsque les réseaux ne permettent pas une connexion directe.

## Configuration Supabase

Le fichier `supabase-config.js` contient l’URL du projet et sa clé publique (publishable). Il ne doit jamais contenir de clé `service_role`, de mot de passe ni de secret TURN. `iceServers` configure les serveurs ICE/WebRTC; le serveur STUN fourni est un réglage de départ. Pour une connexion fiable entre réseaux restrictifs, configure des serveurs TURN privés avec des identifiants temporaires appropriés.

Dans **SQL Editor** du tableau de bord Supabase, exécute les migrations dans l’ordre :

1. `supabase/migrations/20261021100000_profiles_and_private_chat.sql`
2. `supabase/migrations/20261021123000_koz_social_and_calls.sql`
3. `supabase/migrations/20261021140000_profile_avatars.sql`

La première crée les profils et le chat privé; la seconde crée les tables sociales, le stockage des médias, les permissions d’accès et les fonctions de signalisation d’appel; la troisième ajoute le champ de photo de profil. Vérifie que chacune s’exécute sans erreur. Dans **Authentication > URL Configuration**, ajoute les URL de retour de ton site. L’inscription peut demander une confirmation par e-mail selon les réglages du projet.

Pour la confirmation par téléphone, active le fournisseur **Phone** et configure un fournisseur SMS dans **Authentication > Providers**. La personne connectée demande un code depuis **Mon profil**, puis le saisit pour vérifier son numéro. Le téléphone est conservé dans Supabase Auth; il n’est pas ajouté aux profils publics. Les photos de profil utilisent le bucket `koz-media` existant et sont publiques, comme les autres médias du site.

Les boutons Google, Facebook et X utilisent les fournisseurs OAuth intégrés de Supabase (**Google**, **Facebook** et **X / Twitter OAuth 2.0**). Crée une application développeur pour chacun, puis active le fournisseur et ajoute son Client ID et son secret dans **Authentication > Providers**. Enregistre l’URL de callback affichée par Supabase chez chaque fournisseur. Dans **Authentication > URL Configuration**, autorise `https://diemuabel-glitch.github.io/mwasi/`, `mwasi://login-callback` pour l’application Android et l’URL locale utilisée pour le test. Le bouton TikTok utilise l’identifiant de fournisseur personnalisé `custom:tiktok`; il faut d’abord l’ajouter dans Supabase **Authentication > Providers > New Provider** et le raccorder au Login Kit TikTok. TikTok exige une URL de redirection HTTPS enregistrée dans son portail; son protocole d’échange de code utilise `client_key`, il faut donc un adaptateur OAuth serveur compatible si le fournisseur personnalisé ne prend pas ce paramètre en charge. Ne place jamais de secret TikTok dans le JavaScript du navigateur.

Pour les appels, active **Realtime** pour les tables `koz_call_sessions` et `koz_call_signals` (la migration tente de les ajouter à la publication `supabase_realtime`). Les utilisateurs ne peuvent s’appeler qu’après acceptation d’une demande de conversation.

## Application Android

Le répertoire `android` contient l’application WebView. Elle charge la version hébergée à l’adresse indiquée dans `android/app/src/main/java/com/abeldiemu/mwasi/MainActivity.java`. La caméra et le microphone sont demandés à l’utilisateur lors du premier appel. Pour compiler l’APK debug depuis Windows :

```powershell
cd android
.\gradlew.bat assembleDebug
```

L’APK de sortie se trouve dans `android/app/build/outputs/apk/debug/app-debug.apk`. Les changements web doivent également être déployés sur le site hébergé pour apparaître dans l’APK.
Le fichier `Mwasi.apk` à la racine est également reconstruit pour conserver le nom de téléchargement déjà utilisé par le site; l’application installée s’affiche sous le nom KOZ.
Le bouton **Télécharger l’APK Android** sur la page d’accueil propose ce fichier. Sur Android, ouvre le fichier téléchargé et autorise l’installation si le système le demande. Le logo horizontal recadré `koz-brand.png` et l’icône `koz-icon.png` sont dérivés de `koz-logo.jfif`; reconstruis l’APK pour appliquer l’icône à une nouvelle installation.

Crédit développeur : Abel Diemu. Contact : [+243 84 232 2495](tel:+243842322495).
