const config = window.MWASI_SUPABASE_CONFIG;
const authButtons = [...document.querySelectorAll('[data-auth-provider]')];
const authStatus = document.getElementById('auth-status');
const authForm = document.getElementById('auth-form');
const chatStatus = document.getElementById('chat-status');
const chatWorkspace = document.getElementById('chat-workspace');
const chatAuthRequired = document.getElementById('chat-auth-required');
const chatMessages = document.getElementById('chat-messages');
let supabase = null;
let currentUser = null;
let currentConversation = null;
let currentPeer = null;
let activeConversationChannel = null;
let authMode = 'signup';
let chatRefreshTimer = null;

function showAuthStatus(message, state = '') {
  authStatus.textContent = message;
  authStatus.dataset.state = state;
}

function showChatStatus(message, state = '') {
  chatStatus.textContent = message;
  chatStatus.dataset.state = state;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function setAuthMode(mode) {
  authMode = mode;
  const signingUp = mode === 'signup';
  document.getElementById('auth-signup-fields').hidden = !signingUp;
  document.getElementById('auth-confirm-field').hidden = !signingUp;
  document.getElementById('auth-display-name').required = signingUp;
  document.getElementById('auth-password-confirm').required = signingUp;
  document.getElementById('auth-password').autocomplete = signingUp ? 'new-password' : 'current-password';
  document.getElementById('auth-password-confirm').disabled = !signingUp;
  document.getElementById('auth-submit').textContent = signingUp ? 'Créer mon compte' : 'Me connecter';
  document.getElementById('auth-mode-toggle').textContent = signingUp
    ? 'J’ai déjà un compte : me connecter'
    : 'Créer un nouveau compte';
}

function clearChatView() {
  if (activeConversationChannel && supabase) {
    void supabase.removeChannel(activeConversationChannel);
    activeConversationChannel = null;
  }
  currentConversation = null;
  currentPeer = null;
  document.getElementById('chat-thread-title').textContent = 'Choisissez une conversation';
  document.getElementById('chat-thread-actions').hidden = true;
  document.getElementById('chat-send').disabled = true;
  document.getElementById('chat-message-input').disabled = true;
  document.getElementById('chat-report-form').hidden = true;
  chatMessages.replaceChildren(element('p', 'chat-empty', 'Vos messages privés apparaîtront ici.'));
}

function renderAccount(user) {
  currentUser = user;
  const accountLabel = document.getElementById('profile-button-label');
  const accountAvatar = document.getElementById('profile-avatar');
  const accountDetails = document.getElementById('auth-account-details');
  const signOutButton = document.getElementById('auth-signout');
  authForm.hidden = Boolean(user);
  document.getElementById('auth-mode-toggle').hidden = Boolean(user);
  document.querySelector('.auth-consent').hidden = Boolean(user);
  document.querySelector('.auth-providers').hidden = Boolean(user);

  if (!user) {
    accountLabel.textContent = 'Créer un compte';
    accountAvatar.textContent = '＋';
    accountDetails.hidden = true;
    signOutButton.hidden = true;
    chatAuthRequired.hidden = false;
    chatWorkspace.hidden = true;
    clearChatView();
    if (chatRefreshTimer) {
      window.clearInterval(chatRefreshTimer);
      chatRefreshTimer = null;
    }
    return;
  }

  const email = user.email || '';
  const name = user.user_metadata?.display_name
    || user.user_metadata?.full_name
    || user.user_metadata?.name
    || email.split('@')[0]
    || 'Mon compte';
  accountLabel.textContent = 'Mon compte';
  accountAvatar.textContent = name.trim().charAt(0).toLocaleUpperCase('fr-FR');
  document.getElementById('auth-account-name').textContent = name;
  document.getElementById('auth-account-email').textContent = email;
  accountDetails.hidden = false;
  signOutButton.hidden = false;
  document.getElementById('profile-description').textContent =
    'Votre compte est connecté. Le pseudo en ligne et le nom enregistré localement sont indépendants.';
  chatAuthRequired.hidden = true;
  chatWorkspace.hidden = false;
  showAuthStatus(`Connecté : ${name}. Vos données de cycle restent sur cet appareil.`, 'success');
  void loadChatData();
  if (!chatRefreshTimer) {
    chatRefreshTimer = window.setInterval(() => {
      if (currentUser && document.visibilityState === 'visible') {
        void loadChatLists();
      }
    }, 20000);
  }
}

async function ensureUserProfile(user, preferredName = '') {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, display_name, discoverable')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const metadataName = user.user_metadata?.display_name
    || user.user_metadata?.full_name
    || user.user_metadata?.name
    || user.email?.split('@')[0]
    || '';
  const displayName = (preferredName || metadataName).trim().slice(0, 40);
  if (displayName.length < 2) {
    throw new Error('Choisissez un pseudo avant de créer votre profil.');
  }

  const { data: profile, error: insertError } = await supabase
    .from('user_profiles')
    .upsert({ user_id: user.id, display_name: displayName, discoverable: false })
    .select('user_id, display_name, discoverable')
    .single();
  if (insertError) throw insertError;
  return profile;
}

function renderList(container, emptyMessage, rows, renderRow) {
  container.replaceChildren();
  const empty = document.getElementById(emptyMessage);
  empty.hidden = rows.length > 0;
  rows.forEach((row) => container.append(renderRow(row)));
}

async function loadChatData() {
  if (!supabase || !currentUser) return;

  try {
    const profile = await ensureUserProfile(currentUser);
    document.getElementById('chat-discoverable').checked = profile.discoverable;
    await loadChatLists();
  } catch (error) {
    showChatStatus(`Impossible de charger le profil de discussion : ${error.message}`, 'error');
  }
}

async function loadChatLists() {
  if (!supabase || !currentUser) return;

  try {
    const { data: requests, error: requestError } = await supabase
      .from('chat_requests')
      .select('id, sender_id, recipient_id, status, created_at')
      .eq('recipient_id', currentUser.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);
    if (requestError) throw requestError;

    const senderIds = [...new Set((requests || []).map((request) => request.sender_id))];
    let senders = [];
    if (senderIds.length) {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('user_id, display_name')
        .in('user_id', senderIds);
      if (error) throw error;
      senders = data || [];
    }
    const senderNames = new Map(senders.map((sender) => [sender.user_id, sender.display_name]));
    renderList(
      document.getElementById('chat-requests-list'),
      'chat-requests-empty',
      requests || [],
      (request) => {
        const item = element('li', 'chat-list-item');
        item.append(element('span', '', senderNames.get(request.sender_id) || 'Membre Mwasi'));
        const actions = element('div', 'chat-list-actions');
        const accept = element('button', 'chat-list-button', 'Accepter');
        accept.type = 'button';
        accept.dataset.requestAction = 'accept';
        accept.dataset.requestId = request.id;
        const decline = element('button', 'chat-list-button danger', 'Refuser');
        decline.type = 'button';
        decline.dataset.requestAction = 'decline';
        decline.dataset.requestId = request.id;
        actions.append(accept, decline);
        item.append(actions);
        return item;
      }
    );

    const { data: conversations, error: conversationError } = await supabase
      .from('chat_conversations')
      .select('id, user_one, user_two, last_activity_at')
      .or(`user_one.eq.${currentUser.id},user_two.eq.${currentUser.id}`)
      .order('last_activity_at', { ascending: false })
      .limit(50);
    if (conversationError) throw conversationError;

    const peerIds = [...new Set((conversations || []).map((conversation) =>
      conversation.user_one === currentUser.id ? conversation.user_two : conversation.user_one
    ))];
    let peers = [];
    if (peerIds.length) {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('user_id, display_name')
        .in('user_id', peerIds);
      if (error) throw error;
      peers = data || [];
    }
    const peerNames = new Map(peers.map((peer) => [peer.user_id, peer.display_name]));
    renderList(
      document.getElementById('chat-conversations-list'),
      'chat-conversations-empty',
      conversations || [],
      (conversation) => {
        const peerId = conversation.user_one === currentUser.id
          ? conversation.user_two
          : conversation.user_one;
        const item = element('li', 'chat-list-item');
        const name = peerNames.get(peerId) || 'Membre Mwasi';
        const open = element('button', 'chat-list-button', name);
        open.type = 'button';
        open.dataset.conversationId = conversation.id;
        open.dataset.peerId = peerId;
        open.dataset.peerName = name;
        item.append(open);
        return item;
      }
    );
    showChatStatus('');
  } catch (error) {
    showChatStatus(`Impossible de charger les demandes ou conversations : ${error.message}`, 'error');
  }
}

async function openConversation(conversationId, peerId, peerName) {
  if (!supabase || !currentUser) return;

  currentConversation = conversationId;
  currentPeer = { id: peerId, name: peerName };
  document.getElementById('chat-thread-title').textContent = peerName;
  document.getElementById('chat-thread-actions').hidden = false;
  document.getElementById('chat-send').disabled = false;
  document.getElementById('chat-message-input').disabled = false;
  document.getElementById('chat-message-input').focus();
  document.getElementById('chat-report-form').hidden = true;
  await refreshBlockButton();
  await loadMessages();

  if (activeConversationChannel) {
    await supabase.removeChannel(activeConversationChannel);
  }
  activeConversationChannel = supabase
    .channel(`messages-${conversationId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'chat_messages',
      filter: `conversation_id=eq.${conversationId}`
    }, () => {
      void loadMessages();
    })
    .subscribe((state) => {
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        showChatStatus('La connexion instantanée est indisponible ; les nouveaux messages seront vérifiés périodiquement.', 'error');
      }
    });
}

async function refreshBlockButton() {
  if (!currentUser || !currentPeer) return;
  const { data, error } = await supabase
    .from('chat_blocks')
    .select('blocked_id')
    .eq('blocker_id', currentUser.id)
    .eq('blocked_id', currentPeer.id)
    .maybeSingle();
  if (error) throw error;
  const button = document.getElementById('chat-block');
  button.textContent = data ? 'Débloquer' : 'Bloquer';
  button.dataset.blocked = String(Boolean(data));
}

async function loadMessages() {
  if (!currentConversation) return;

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender_id, body, created_at')
    .eq('conversation_id', currentConversation)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    showChatStatus(`Impossible de charger les messages : ${error.message}`, 'error');
    return;
  }

  const messages = [...(data || [])].reverse();
  chatMessages.replaceChildren();
  if (messages.length === 0) {
    chatMessages.append(element('p', 'chat-empty', 'Aucun message pour le moment.'));
    return;
  }
  messages.forEach((message) => {
    const bubble = element('p', `chat-message${message.sender_id === currentUser.id ? ' own' : ''}`);
    bubble.append(document.createTextNode(message.body));
    const time = element('time', '', new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(message.created_at)));
    bubble.append(time);
    chatMessages.append(bubble);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function requestChat(profileId, displayName, button) {
  button.disabled = true;
  try {
    const { error } = await supabase.from('chat_requests').insert({
      sender_id: currentUser.id,
      recipient_id: profileId
    });
    if (error) throw error;
    showChatStatus(`Demande envoyée à ${displayName}. Elle devra l’accepter avant de pouvoir discuter.`, 'success');
  } catch (error) {
    showChatStatus(`Impossible d’envoyer la demande : ${error.message}`, 'error');
    button.disabled = false;
  }
}

if (!config?.url || !config?.anonKey) {
  showAuthStatus('À configurer : ajoutez l’URL et la clé publique anon du projet Supabase dans supabase-config.js.');
  authForm.querySelectorAll('input, button').forEach((control) => {
    control.disabled = true;
  });
  authButtons.forEach((button) => {
    button.disabled = true;
    button.title = 'Configuration Supabase requise';
  });
} else {
  const enabledProviders = authButtons.filter((button) => config.providers?.[button.dataset.authProvider]);
  authButtons.forEach((button) => {
    button.disabled = !config.providers?.[button.dataset.authProvider];
    if (button.disabled) {
      button.title = 'Activez et configurez ce fournisseur dans Supabase avant de l’utiliser.';
    }
  });
  if (enabledProviders.length === 0) {
    showAuthStatus('La création de compte par e-mail est disponible. Google, Facebook et TikTok devront être configurés dans Supabase avant activation.');
  }
  void initializeAuth();
}

async function initializeAuth() {
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabase = createClient(config.url, config.anonKey);

    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const displayName = document.getElementById('auth-display-name').value.trim();
      const submitButton = document.getElementById('auth-submit');
      submitButton.disabled = true;

      try {
        if (authMode === 'signup') {
          if (password !== document.getElementById('auth-password-confirm').value) {
            throw new Error('Les mots de passe ne correspondent pas.');
          }
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { display_name: displayName },
              emailRedirectTo: window.location.href.split(/[?#]/, 1)[0]
            }
          });
          if (error) throw error;
          if (data.session && data.user) {
            await ensureUserProfile(data.user, displayName);
            renderAccount(data.user);
            showAuthStatus('Votre compte Mwasi est créé et connecté.', 'success');
          } else {
            showAuthStatus('Compte créé. Vérifiez votre adresse e-mail pour confirmer l’inscription avant de vous connecter.', 'success');
          }
        } else {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          if (!data.user) throw new Error('La connexion n’a retourné aucun compte.');
          await ensureUserProfile(data.user);
          renderAccount(data.user);
        }
      } catch (error) {
        showAuthStatus(`Impossible de traiter le compte : ${error.message}`, 'error');
      } finally {
        submitButton.disabled = false;
      }
    });

    document.getElementById('auth-mode-toggle').addEventListener('click', () => {
      setAuthMode(authMode === 'signup' ? 'login' : 'signup');
      showAuthStatus(authMode === 'signup'
        ? 'Saisissez votre pseudo, votre adresse e-mail et un mot de passe d’au moins 8 caractères.'
        : 'Saisissez l’adresse e-mail et le mot de passe de votre compte.');
    });
    setAuthMode('signup');

    authButtons.forEach((button) => {
      if (!config.providers?.[button.dataset.authProvider]) return;
      button.addEventListener('click', async () => {
        authButtons.forEach((providerButton) => {
          if (config.providers?.[providerButton.dataset.authProvider]) providerButton.disabled = true;
        });
        showAuthStatus('Redirection vers le fournisseur de connexion…');

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
          showAuthStatus(`Connexion impossible : ${error.message}`, 'error');
          authButtons.forEach((providerButton) => {
            providerButton.disabled = !config.providers?.[providerButton.dataset.authProvider];
          });
        }
      });
    });

    document.getElementById('auth-signout').addEventListener('click', async () => {
      const signOutButton = document.getElementById('auth-signout');
      signOutButton.disabled = true;
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        renderAccount(null);
        showAuthStatus('Vous êtes déconnecté de votre compte Mwasi.');
      } catch (error) {
        showAuthStatus(`Déconnexion impossible : ${error.message}`, 'error');
      } finally {
        signOutButton.disabled = false;
      }
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        if (session?.user) {
          void ensureUserProfile(session.user)
            .then(() => renderAccount(session.user))
            .catch((error) => showAuthStatus(`Impossible de charger le profil : ${error.message}`, 'error'));
        } else {
          renderAccount(null);
        }
      }, 0);
    });

    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user) {
      await ensureUserProfile(data.session.user);
      renderAccount(data.session.user);
    }

    document.getElementById('chat-discoverable').addEventListener('change', async (event) => {
      if (!currentUser) return;
      event.target.disabled = true;
      try {
        const { error } = await supabase
          .from('user_profiles')
          .update({ discoverable: event.target.checked, updated_at: new Date().toISOString() })
          .eq('user_id', currentUser.id);
        if (error) throw error;
        showChatStatus(event.target.checked
          ? 'Votre pseudo est maintenant visible dans la recherche des membres.'
          : 'Votre pseudo n’apparaît plus dans les nouvelles recherches.', 'success');
      } catch (error) {
        event.target.checked = !event.target.checked;
        showChatStatus(`Impossible de modifier la visibilité : ${error.message}`, 'error');
      } finally {
        event.target.disabled = false;
      }
    });

    document.getElementById('chat-search-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const term = document.getElementById('chat-search').value.trim();
      const resultsList = document.getElementById('chat-search-results');
      resultsList.replaceChildren();
      document.getElementById('chat-search-empty').hidden = true;
      showChatStatus('Recherche des pseudos visibles…');

      try {
        const { data: profiles, error } = await supabase.rpc('search_chat_profiles', { search_term: term });
        if (error) throw error;
        renderList(resultsList, 'chat-search-empty', profiles || [], (profile) => {
          const item = element('li', 'chat-list-item');
          item.append(element('span', '', profile.display_name));
          const request = element('button', 'chat-list-button', 'Demander');
          request.type = 'button';
          request.addEventListener('click', () => {
            void requestChat(profile.profile_id, profile.display_name, request);
          });
          item.append(request);
          return item;
        });
        showChatStatus(profiles?.length ? 'Choisissez un pseudo pour envoyer une demande.' : 'Aucun membre trouvable avec ce pseudo.');
      } catch (error) {
        showChatStatus(`Recherche impossible : ${error.message}`, 'error');
      }
    });

    document.getElementById('chat-requests-list').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-request-action]');
      if (!button) return;
      button.disabled = true;
      try {
        if (button.dataset.requestAction === 'accept') {
          const { error } = await supabase.rpc('accept_chat_request', { p_request_id: button.dataset.requestId });
          if (error) throw error;
          showChatStatus('Demande acceptée. La conversation privée est ouverte.', 'success');
        } else {
          const { error } = await supabase.rpc('decline_chat_request', { p_request_id: button.dataset.requestId });
          if (error) throw error;
          showChatStatus('Demande refusée.', 'success');
        }
        await loadChatLists();
      } catch (error) {
        showChatStatus(`Impossible de traiter la demande : ${error.message}`, 'error');
        button.disabled = false;
      }
    });

    document.getElementById('chat-conversations-list').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-conversation-id]');
      if (!button) return;
      try {
        await openConversation(button.dataset.conversationId, button.dataset.peerId, button.dataset.peerName);
      } catch (error) {
        showChatStatus(`Impossible d’ouvrir la conversation : ${error.message}`, 'error');
      }
    });

    document.getElementById('chat-send-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('chat-message-input');
      const body = input.value.trim();
      if (!body || !currentConversation || !currentUser) return;
      const sendButton = document.getElementById('chat-send');
      sendButton.disabled = true;
      try {
        const { error } = await supabase.from('chat_messages').insert({
          conversation_id: currentConversation,
          sender_id: currentUser.id,
          body
        });
        if (error) throw error;
        input.value = '';
        await loadMessages();
        await loadChatLists();
        showChatStatus('');
      } catch (error) {
        showChatStatus(`Message non envoyé : ${error.message}`, 'error');
      } finally {
        sendButton.disabled = false;
      }
    });

    document.getElementById('chat-block').addEventListener('click', async () => {
      if (!currentUser || !currentPeer) return;
      const button = document.getElementById('chat-block');
      const isBlocked = button.dataset.blocked === 'true';
      const message = isBlocked
        ? `Débloquer ${currentPeer.name} ? La conversation pourra reprendre.`
        : `Bloquer ${currentPeer.name} ? Cette personne ne pourra plus vous écrire ni trouver votre pseudo.`;
      if (!window.confirm(message)) return;

      button.disabled = true;
      try {
        if (isBlocked) {
          const { error } = await supabase
            .from('chat_blocks')
            .delete()
            .eq('blocker_id', currentUser.id)
            .eq('blocked_id', currentPeer.id);
          if (error) throw error;
          showChatStatus('Compte débloqué.', 'success');
        } else {
          const { error } = await supabase.from('chat_blocks').insert({
            blocker_id: currentUser.id,
            blocked_id: currentPeer.id
          });
          if (error) throw error;
          showChatStatus('Compte bloqué. Les messages de cette conversation sont masqués tant que le blocage est actif.', 'success');
        }
        await refreshBlockButton();
        if (isBlocked) await loadMessages();
        else chatMessages.replaceChildren(element('p', 'chat-empty', 'Conversation masquée pendant le blocage.'));
        await loadChatLists();
      } catch (error) {
        showChatStatus(`Impossible de modifier le blocage : ${error.message}`, 'error');
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById('chat-report-toggle').addEventListener('click', () => {
      const reportForm = document.getElementById('chat-report-form');
      reportForm.hidden = !reportForm.hidden;
      if (!reportForm.hidden) document.getElementById('chat-report-reason').focus();
    });

    document.getElementById('chat-report-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentUser || !currentPeer || !currentConversation) return;
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        const { error } = await supabase.from('chat_reports').insert({
          reporter_id: currentUser.id,
          reported_user_id: currentPeer.id,
          conversation_id: currentConversation,
          reason: document.getElementById('chat-report-reason').value,
          details: document.getElementById('chat-report-details').value.trim()
        });
        if (error) throw error;
        event.currentTarget.reset();
        event.currentTarget.hidden = true;
        showChatStatus('Signalement enregistré. Le responsable Mwasi pourra le vérifier dans Supabase.', 'success');
      } catch (error) {
        showChatStatus(`Impossible d’envoyer le signalement : ${error.message}`, 'error');
      } finally {
        submitButton.disabled = false;
      }
    });

  } catch (error) {
    showAuthStatus(`Impossible de charger les services du compte : ${error.message}`, 'error');
    showChatStatus(`Le chat n’est pas disponible : ${error.message}`, 'error');
  }
}

document.getElementById('chat-auth-open').addEventListener('click', () => {
  document.getElementById('profile-trigger').click();
});

const callbackUrl = new URL(window.location.href);
const authError = callbackUrl.searchParams.get('error_description')
  || callbackUrl.searchParams.get('error');
if (authError) {
  showAuthStatus(`Connexion refusée : ${authError}`, 'error');
  callbackUrl.searchParams.delete('error_description');
  callbackUrl.searchParams.delete('error');
  callbackUrl.searchParams.delete('error_code');
  window.history.replaceState({}, document.title, callbackUrl);
}
