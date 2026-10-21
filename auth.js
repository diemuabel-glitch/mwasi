const buttons = [...document.querySelectorAll('[data-auth-provider]')];
const status = document.getElementById('auth-status');
const signOutButton = document.getElementById('auth-signout');
const accountLabel = document.getElementById('profile-button-label');
const accountAvatar = document.getElementById('profile-avatar');
const config = window.MWASI_SUPABASE_CONFIG;

function showStatus(message, state = '') {
  status.textContent = message;
  status.dataset.state = state;
}

function renderAccount(user) {
  if (!user) {
    accountLabel.textContent = 'Créer un compte';
    accountAvatar.textContent = '＋';
    signOutButton.hidden = true;
    return;
  }

  const name = user.user_metadata?.full_name
    || user.user_metadata?.name
    || user.user_metadata?.display_name
    || user.email
    || 'Mon compte';
  accountLabel.textContent = 'Mon compte';
  accountAvatar.textContent = name.trim().charAt(0).toLocaleUpperCase('fr-FR');
  signOutButton.hidden = false;
  showStatus(`Connecté : ${name}. Vos données de cycle restent sur cet appareil.`, 'success');
}

if (!config?.url || !config?.anonKey) {
  showStatus('À configurer : ajoutez l’URL et la clé publique anon du projet Supabase dans supabase-config.js.');
  buttons.forEach((button) => {
    button.disabled = true;
    button.title = 'Configuration Supabase requise';
  });
} else {
  const enabledProviders = buttons.filter((button) => config.providers?.[button.dataset.authProvider]);
  buttons.forEach((button) => {
    button.disabled = !config.providers?.[button.dataset.authProvider];
    if (button.disabled) {
      button.title = 'Activez et configurez ce fournisseur dans Supabase avant de l’utiliser.';
    }
  });
  if (enabledProviders.length === 0) {
    showStatus('Projet Supabase connecté. Activez et configurez Google, Facebook et TikTok dans le tableau de bord avant d’autoriser la connexion.');
  }
  void initializeAuth();
}

async function initializeAuth() {
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(config.url, config.anonKey);

    buttons.forEach((button) => {
      if (!config.providers?.[button.dataset.authProvider]) return;
      button.addEventListener('click', async () => {
        buttons.forEach((providerButton) => {
          if (config.providers?.[providerButton.dataset.authProvider]) {
            providerButton.disabled = true;
          }
        });
        showStatus('Redirection vers le fournisseur de connexion…');

        const redirectTo = navigator.userAgent.includes('MwasiAndroidApp')
          ? 'mwasi://login-callback'
          : window.location.href.split(/[?#]/, 1)[0];

        try {
          const { error } = await supabase.auth.signInWithOAuth({
            provider: button.dataset.authProvider,
            options: { redirectTo }
          });
          if (error) throw error;
        } catch (error) {
          showStatus(`Connexion impossible : ${error.message}`, 'error');
          buttons.forEach((providerButton) => {
            providerButton.disabled = !config.providers?.[providerButton.dataset.authProvider];
          });
        }
      });
    });

    signOutButton.addEventListener('click', async () => {
      signOutButton.disabled = true;
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        renderAccount(null);
        showStatus('Vous êtes déconnecté de votre compte Mwasi.');
      } catch (error) {
        showStatus(`Déconnexion impossible : ${error.message}`, 'error');
      } finally {
        signOutButton.disabled = false;
      }
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      renderAccount(session?.user || null);
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        showStatus(`Impossible de vérifier la session : ${error.message}`, 'error');
        return;
      }
      renderAccount(data.session?.user || null);
    });
  } catch (error) {
    showStatus(`Impossible de charger le service de connexion : ${error.message}`, 'error');
  }
}

const callbackUrl = new URL(window.location.href);
const authError = callbackUrl.searchParams.get('error_description')
  || callbackUrl.searchParams.get('error');
if (authError) {
  showStatus(`Connexion refusée : ${authError}`, 'error');
  callbackUrl.searchParams.delete('error_description');
  callbackUrl.searchParams.delete('error');
  callbackUrl.searchParams.delete('error_code');
  window.history.replaceState({}, document.title, callbackUrl);
}
