const config = window.KOZ_SUPABASE_CONFIG;
const byId = (id) => document.getElementById(id);
const state = {
  supabase: null,
  user: null,
  profile: null,
  authMode: 'signup',
  pendingPhone: '',
  activeConversation: null,
  activePeer: null,
  conversationChannel: null,
  inviteChannel: null,
  signalChannel: null,
  callChannel: null,
  callId: null,
  ringTimeout: null,
  callPeerName: '',
  callMode: 'video',
  callInitiator: false,
  peerConnection: null,
  localStream: null,
  remoteStream: null,
  pendingCandidates: [],
  handledSignals: new Set(),
  toastTimer: null
};

function setStatus(id, text, kind = '') {
  const node = byId(id);
  node.textContent = text;
  node.dataset.state = kind;
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showToast(message) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3800);
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signingUp = mode === 'signup';
  byId('name-field').hidden = !signingUp;
  byId('signup-phone-field').hidden = !signingUp;
  byId('phone-format-help').hidden = !signingUp;
  byId('signup-avatar-field').hidden = !signingUp;
  byId('password-confirm-field').hidden = !signingUp;
  byId('auth-name').required = signingUp;
  byId('auth-phone').required = signingUp;
  byId('auth-password-confirm').required = signingUp;
  byId('auth-password').autocomplete = signingUp ? 'new-password' : 'current-password';
  byId('auth-password-confirm').disabled = !signingUp;
  byId('auth-submit').textContent = signingUp ? 'Créer mon compte' : 'Me connecter';
  byId('auth-toggle').textContent = signingUp
    ? 'J’ai déjà un compte — me connecter'
    : 'Créer un nouveau compte';
  byId('auth-heading').textContent = signingUp ? 'Rejoins KOZ' : 'Ravi de te revoir';
}

function initials(name = '') {
  return name.trim().slice(0, 1).toLocaleUpperCase('fr-FR') || 'K';
}

function fillAvatar(node, profile) {
  node.replaceChildren();
  if (profile?.avatar_url) {
    const image = document.createElement('img');
    image.src = profile.avatar_url;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    node.append(image);
  } else {
    node.textContent = initials(profile?.display_name || '');
  }
}

async function ensureProfile(user, preferredName = '') {
  const name = (preferredName
    || user.user_metadata?.display_name
    || user.user_metadata?.full_name
    || user.email?.split('@')[0]
    || 'Membre KOZ').trim().slice(0, 40);
  const { data, error } = await state.supabase
    .from('user_profiles')
    .upsert({ user_id: user.id, display_name: name, discoverable: true }, { onConflict: 'user_id' })
    .select('user_id, display_name, discoverable, avatar_url')
    .single();
  if (error) throw error;
  state.profile = data;
  return data;
}

function switchView(name) {
  document.querySelectorAll('.view').forEach((view) => {
    view.hidden = view.id !== `${name}-view`;
  });
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.view === name);
  });
  if (name === 'feed') void loadPosts(byId('feed-list'));
  if (name === 'videos') void loadPosts(byId('videos-list'), { videosOnly: true });
  if (name === 'profile') void loadProfileView();
  if (name === 'members') void loadMembers();
}

function renderAccount(user) {
  state.user = user;
  byId('landing').hidden = Boolean(user);
  byId('app').hidden = !user;
  byId('sign-out').hidden = !user;
  byId('top-avatar').hidden = !user;
  if (!user) {
    state.profile = null;
    byId('page-footer').hidden = false;
    if (state.callId) void cleanupCall(true).catch((error) => {
      showToast(`Appel non interrompu localement : ${error.message}`);
    });
    if (state.inviteChannel) void state.supabase?.removeChannel(state.inviteChannel);
    state.inviteChannel = null;
    if (state.conversationChannel) void state.supabase?.removeChannel(state.conversationChannel);
    state.conversationChannel = null;
    return;
  }
  const name = state.profile?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Membre KOZ';
  byId('rail-name').textContent = name;
  byId('profile-name').textContent = name;
  byId('profile-email').textContent = user.email || '';
  byId('verify-phone').value = user.phone || user.user_metadata?.phone_number || '';
  byId('phone-verification-state').textContent = user.phone_confirmed_at
    ? `Numéro vérifié : ${user.phone || ''}`
    : 'Ton numéro n’est pas encore vérifié.';
  fillAvatar(byId('rail-avatar'), state.profile);
  fillAvatar(byId('composer-avatar'), state.profile);
  fillAvatar(byId('profile-avatar'), state.profile);
  fillAvatar(byId('top-avatar'), state.profile);
  byId('top-avatar').setAttribute('aria-label', `Profil de ${name}`);
  byId('page-footer').hidden = false;
  switchView('feed');
  void loadSuggestedProfiles();
  void loadMembers();
  void watchIncomingCalls().catch((error) => {
    showToast(`Appels indisponibles : ${error.message}`);
  });
}

function validPhoneNumber(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

async function uploadProfileAvatar(file) {
  if (!state.user) throw new Error('Connecte-toi pour ajouter une photo de profil.');
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choisis une image JPEG, PNG ou WebP.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('La photo ne peut pas dépasser 5 Mo.');
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  const path = `${state.user.id}/avatars/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await state.supabase.storage
    .from('koz-media')
    .upload(path, file, { contentType: file.type, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data: urlData } = state.supabase.storage.from('koz-media').getPublicUrl(path);
  const { data, error } = await state.supabase
    .from('user_profiles')
    .update({ avatar_url: urlData.publicUrl })
    .eq('user_id', state.user.id)
    .select('user_id, display_name, discoverable, avatar_url')
    .single();
  if (error) throw error;
  state.profile = data;
  fillAvatar(byId('rail-avatar'), data);
  fillAvatar(byId('composer-avatar'), data);
  fillAvatar(byId('profile-avatar'), data);
  fillAvatar(byId('top-avatar'), data);
}

async function sendPhoneVerification(phone) {
  const normalizedPhone = phone.trim();
  if (!validPhoneNumber(normalizedPhone)) {
    throw new Error('Saisis un numéro au format international, par exemple +243812345678.');
  }
  if (!state.user) throw new Error('Connecte-toi avant de vérifier ton numéro.');
  if (state.user.phone_confirmed_at && state.user.phone === normalizedPhone) {
    setStatus('phone-verification-status', 'Ce numéro est déjà vérifié.', 'success');
    return;
  }
  const { error } = await state.supabase.auth.updateUser({ phone: normalizedPhone });
  if (error) throw error;
  state.pendingPhone = normalizedPhone;
  byId('phone-code-field').hidden = false;
  byId('phone-code').required = true;
  byId('verify-phone-code').hidden = false;
  setStatus('phone-verification-status', 'Code envoyé par SMS. Saisis-le pour confirmer ton numéro.', 'success');
}

function avatarFor(profile, className = 'avatar') {
  const avatar = make('div', className);
  fillAvatar(avatar, profile);
  return avatar;
}

function escapeLikeTerm(term) {
  return term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

async function getProfiles(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await state.supabase
    .from('user_profiles')
    .select('user_id, display_name, avatar_url')
    .in('user_id', ids);
  if (error) throw error;
  return new Map((data || []).map((profile) => [profile.user_id, profile]));
}

function formatDate(value) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function loadPosts(container, options = {}) {
  if (!state.user) return;
  container.replaceChildren(make('p', 'empty-state', 'Chargement des publications…'));
  try {
    let query = state.supabase.from('koz_posts')
      .select('id, user_id, body, media_path, media_type, created_at')
      .order('created_at', { ascending: false })
      .limit(40);
    if (options.videosOnly) query = query.eq('media_type', 'video');
    if (options.authorId) query = query.eq('user_id', options.authorId);
    const { data: posts, error } = await query;
    if (error) throw error;
    if (!posts?.length) {
      container.replaceChildren();
      const empty = make('div', 'panel empty-state');
      empty.append(make('strong', '', options.videosOnly ? 'Pas encore de vidéos' : 'Ton fil est prêt à vivre'));
      empty.append(document.createTextNode(options.videosOnly
        ? 'Les vidéos courtes partagées par la communauté apparaîtront ici.'
        : 'Sois le premier à publier une photo, une vidéo ou une nouvelle.'));
      container.append(empty);
      return;
    }
    const postIds = posts.map((post) => post.id);
    const userIds = posts.map((post) => post.user_id);
    const [{ data: likes, error: likeError }, { data: comments, error: commentError }, profiles] = await Promise.all([
      state.supabase.from('koz_likes').select('post_id, user_id').in('post_id', postIds),
      state.supabase.from('koz_comments').select('id, post_id, user_id, body, created_at').in('post_id', postIds).order('created_at', { ascending: true }).limit(120),
      getProfiles(userIds)
    ]);
    if (likeError) throw likeError;
    if (commentError) throw commentError;
    const commentProfiles = await getProfiles((comments || []).map((comment) => comment.user_id));
    const likedIds = new Set((likes || []).filter((like) => like.user_id === state.user.id).map((like) => like.post_id));
    const likeCounts = new Map();
    (likes || []).forEach(({ post_id: id }) => likeCounts.set(id, (likeCounts.get(id) || 0) + 1));
    const commentsByPost = new Map();
    (comments || []).forEach((comment) => {
      if (!commentsByPost.has(comment.post_id)) commentsByPost.set(comment.post_id, []);
      commentsByPost.get(comment.post_id).push(comment);
    });
    const following = await getFollowingIds(userIds);
    const cards = posts.map((post) => buildPostCard(post, {
      profile: profiles.get(post.user_id),
      comments: commentsByPost.get(post.id) || [],
      commentProfiles,
      likes: likeCounts.get(post.id) || 0,
      liked: likedIds.has(post.id),
      following: following.has(post.user_id),
      authorId: options.authorId
    }));
    container.replaceChildren(...cards);
  } catch (error) {
    container.replaceChildren();
    const empty = make('p', 'empty-state', `Impossible de charger les publications : ${error.message}`);
    container.append(empty);
  }
}

async function getFollowingIds(userIds) {
  if (!state.user || !userIds.length) return new Set();
  const { data, error } = await state.supabase
    .from('koz_follows')
    .select('following_id')
    .eq('follower_id', state.user.id)
    .in('following_id', [...new Set(userIds)]);
  if (error) throw error;
  return new Set((data || []).map((row) => row.following_id));
}

function buildPostCard(post, context) {
  const card = make('article', 'panel post');
  const profile = context.profile || { display_name: 'Membre KOZ' };
  const head = make('div', 'post-head');
  head.append(avatarFor(profile));
  const author = make('div', 'post-author');
  author.append(make('strong', '', profile.display_name));
  const time = make('time', '', formatDate(post.created_at));
  time.dateTime = post.created_at;
  author.append(time);
  head.append(author);
  if (post.user_id !== state.user.id) {
    const follow = make('button', `small-btn${context.following ? ' following' : ''}`, context.following ? 'Suivi' : 'Suivre');
    follow.type = 'button';
    follow.addEventListener('click', () => { void toggleFollow(post.user_id, follow); });
    head.append(follow);
  }
  card.append(head);
  if (post.body) card.append(make('p', 'post-body', post.body));
  if (post.media_path) {
    const { data } = state.supabase.storage.from('koz-media').getPublicUrl(post.media_path);
    const media = post.media_type === 'video' ? document.createElement('video') : document.createElement('img');
    media.className = 'post-media';
    media.src = data.publicUrl;
    if (media instanceof HTMLVideoElement) {
      media.controls = true;
      media.playsInline = true;
      media.preload = 'metadata';
      media.muted = true;
      media.loop = true;
    } else {
      media.alt = `Publication de ${profile.display_name}`;
      media.loading = 'lazy';
    }
    card.append(media);
  }
  const count = make('div', 'post-counts');
  count.append(make('span', '', `${context.likes} j’aime`));
  count.append(make('span', '', `${context.comments.length} commentaire${context.comments.length === 1 ? '' : 's'}`));
  card.append(count);
  const actions = make('div', 'post-actions');
  const like = make('button', `post-action${context.liked ? ' liked' : ''}`, `${context.liked ? '♥' : '♡'} J’aime`);
  like.type = 'button';
  like.addEventListener('click', () => { void toggleLike(post.id, like); });
  actions.append(like);
  actions.append(make('span', 'post-action', '◷ Commenter'));
  card.append(actions);
  const commentList = make('div', 'comment-list');
  context.comments.slice(-3).forEach((comment) => {
    const item = make('p', 'comment');
    item.append(make('strong', '', commentProfilesName(context.commentProfiles, comment.user_id)));
    item.append(document.createTextNode(comment.body));
    commentList.append(item);
  });
  if (context.comments.length) card.append(commentList);
  const form = make('form', 'comment-form');
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 1000;
  input.placeholder = 'Ajouter un commentaire…';
  input.setAttribute('aria-label', 'Ajouter un commentaire');
  input.required = true;
  const submit = make('button', 'small-btn', 'Envoyer');
  submit.type = 'submit';
  form.append(input, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const { error } = await state.supabase.from('koz_comments').insert({
        post_id: post.id, user_id: state.user.id, body: input.value.trim()
      });
      if (error) throw error;
      await loadPosts(card.parentElement, {
        videosOnly: card.parentElement?.id === 'videos-list',
        authorId: context.authorId
      });
    } catch (error) {
      showToast(`Commentaire non envoyé : ${error.message}`);
      submit.disabled = false;
    }
  });
  card.append(form);
  return card;
}

function commentProfilesName(profiles, userId) {
  return profiles.get(userId)?.display_name || 'Membre KOZ';
}

async function toggleLike(postId, button) {
  button.disabled = true;
  try {
    const { error } = button.classList.contains('liked')
      ? await state.supabase.from('koz_likes').delete().eq('post_id', postId).eq('user_id', state.user.id)
      : await state.supabase.from('koz_likes').insert({ post_id: postId, user_id: state.user.id });
    if (error) throw error;
    button.classList.toggle('liked');
    button.textContent = `${button.classList.contains('liked') ? '♥' : '♡'} J’aime`;
    const count = button.closest('.post').querySelector('.post-counts span');
    const value = Number.parseInt(count.textContent, 10) || 0;
    count.textContent = `${Math.max(0, value + (button.classList.contains('liked') ? 1 : -1))} j’aime`;
  } catch (error) {
    showToast(`Impossible de modifier le j’aime : ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function toggleFollow(profileId, button) {
  button.disabled = true;
  const wasFollowing = button.classList.contains('following');
  try {
    const result = wasFollowing
      ? await state.supabase.from('koz_follows').delete().eq('follower_id', state.user.id).eq('following_id', profileId)
      : await state.supabase.from('koz_follows').insert({ follower_id: state.user.id, following_id: profileId });
    if (result.error) throw result.error;
    button.classList.toggle('following', !wasFollowing);
    button.textContent = wasFollowing ? 'Suivre' : 'Suivi';
    void loadSuggestedProfiles();
  } catch (error) {
    showToast(`Impossible de modifier l’abonnement : ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function loadSuggestedProfiles() {
  if (!state.user) return;
  const list = byId('suggested-list');
  try {
    const { data, error } = await state.supabase.from('user_profiles')
      .select('user_id, display_name, avatar_url')
      .neq('user_id', state.user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw error;
    const following = await getFollowingIds((data || []).map((profile) => profile.user_id));
    list.replaceChildren(...(data || []).map((profile) => {
      const row = make('div', 'person-row');
      row.append(avatarFor(profile));
      const copy = make('div', 'person-copy');
      copy.append(make('strong', '', profile.display_name), make('span', '', 'Membre KOZ'));
      const button = make('button', `small-btn${following.has(profile.user_id) ? ' following' : ''}`, following.has(profile.user_id) ? 'Suivi' : 'Suivre');
      button.type = 'button';
      button.addEventListener('click', () => { void toggleFollow(profile.user_id, button); });
      row.append(copy, button);
      return row;
    }));
    byId('suggested-empty').hidden = Boolean(data?.length);
  } catch (error) {
    list.replaceChildren(make('p', 'helper', `Suggestions indisponibles : ${error.message}`));
  }
}

async function publishPost(event) {
  event.preventDefault();
  const body = byId('post-body').value.trim();
  const file = byId('post-media').files[0];
  if (!body && !file) {
    setStatus('post-status', 'Ajoute un texte ou choisis une photo/vidéo.', 'error');
    return;
  }
  if (file && file.size > 50 * 1024 * 1024) {
    setStatus('post-status', 'Le fichier dépasse la limite de 50 Mo.', 'error');
    return;
  }
  if (file && !file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    setStatus('post-status', 'Choisis une image ou une vidéo prise en charge.', 'error');
    return;
  }
  const button = byId('post-submit');
  button.disabled = true;
  setStatus('post-status', file ? 'Envoi du média en cours…' : 'Publication en cours…');
  let mediaPath = null;
  let mediaType = null;
  let uploaded = false;
  try {
    if (file) {
      const extension = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || (file.type.startsWith('video/') ? 'mp4' : 'jpg');
      mediaPath = `${state.user.id}/${crypto.randomUUID()}.${extension}`;
      mediaType = file.type.startsWith('video/') ? 'video' : 'image';
      const { error: uploadError } = await state.supabase.storage.from('koz-media').upload(mediaPath, file, {
        contentType: file.type || undefined,
        upsert: false
      });
      if (uploadError) throw uploadError;
      uploaded = true;
    }
    const { error } = await state.supabase.from('koz_posts').insert({
      user_id: state.user.id, body, media_path: mediaPath, media_type: mediaType
    });
    if (error) throw error;
    byId('post-form').reset();
    byId('media-name').textContent = 'Jusqu’à 50 Mo';
    setStatus('post-status', 'Publié sur ton fil.', 'success');
    await loadPosts(byId('feed-list'));
    void loadProfileView();
  } catch (error) {
    if (uploaded && mediaPath) {
      try {
        const { error: cleanupError } = await state.supabase.storage.from('koz-media').remove([mediaPath]);
        if (cleanupError) showToast(`Le média non publié n’a pas pu être supprimé : ${cleanupError.message}`);
      } catch (cleanupError) {
        showToast(`Le média non publié n’a pas pu être supprimé : ${cleanupError.message}`);
      }
    }
    setStatus('post-status', `Publication impossible : ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

async function loadProfileView() {
  if (!state.user) return;
  try {
    const [{ count: posts, error: postsError }, { count: followers, error: followersError }, { count: following, error: followingError }] = await Promise.all([
      state.supabase.from('koz_posts').select('id', { count: 'exact', head: true }).eq('user_id', state.user.id),
      state.supabase.from('koz_follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', state.user.id),
      state.supabase.from('koz_follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', state.user.id)
    ]);
    if (postsError) throw postsError;
    if (followersError) throw followersError;
    if (followingError) throw followingError;
    byId('profile-post-count').textContent = String(posts || 0);
    byId('profile-follower-count').textContent = String(followers || 0);
    byId('profile-following-count').textContent = String(following || 0);
    await loadPosts(byId('profile-posts'), { authorId: state.user.id });
  } catch (error) {
    showToast(`Impossible de charger ton profil : ${error.message}`);
  }
}

async function searchMembers(term) {
  const escaped = escapeLikeTerm(term.trim());
  if (escaped.length < 2) return [];
  const { data, error } = await state.supabase.from('user_profiles')
    .select('user_id, display_name, avatar_url')
    .neq('user_id', state.user.id)
    .ilike('display_name', `%${escaped}%`)
    .order('display_name')
    .limit(20);
  if (error) throw error;
  return data || [];
}

async function requestConversation(profile) {
  const button = document.querySelector(`[data-message-user="${profile.user_id}"]`);
  if (button) button.disabled = true;
  try {
    const { data: conversations, error: conversationError } = await state.supabase.from('chat_conversations')
      .select('id,user_one,user_two')
      .or(`user_one.eq.${state.user.id},user_two.eq.${state.user.id}`)
      .limit(100);
    if (conversationError) throw conversationError;
    const existing = (conversations || []).find((item) =>
      item.user_one === profile.user_id || item.user_two === profile.user_id);
    if (existing) {
      await openConversation(existing.id, profile);
      return;
    }
    const { error } = await state.supabase.from('chat_requests').insert({
      sender_id: state.user.id, recipient_id: profile.user_id
    });
    if (error) throw error;
    setStatus('member-status', `Demande envoyée à ${profile.display_name}. Elle pourra accepter avant le début du chat.`, 'success');
    await loadMembers();
  } catch (error) {
    setStatus('member-status', `Conversation impossible : ${error.message}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function renderMemberCard(profile, followingIds = new Set()) {
  const row = make('div', 'member-card');
  row.append(avatarFor(profile));
  const copy = make('div', 'person-copy');
  copy.append(make('strong', '', profile.display_name), make('span', '', 'Membre KOZ'));
  const follow = make('button', `small-btn${followingIds.has(profile.user_id) ? ' following' : ''}`, followingIds.has(profile.user_id) ? 'Suivi' : 'Suivre');
  follow.type = 'button';
  follow.addEventListener('click', () => { void toggleFollow(profile.user_id, follow); });
  const message = make('button', 'small-btn', 'Message');
  message.type = 'button';
  message.dataset.messageUser = profile.user_id;
  message.addEventListener('click', () => { void requestConversation(profile); });
  row.append(copy, follow, message);
  return row;
}

async function loadMembers(searchTerm = '') {
  if (!state.user) return;
  const results = byId('member-results');
  try {
    const profiles = searchTerm ? await searchMembers(searchTerm) : [];
    const following = await getFollowingIds(profiles.map((profile) => profile.user_id));
    results.replaceChildren(...profiles.map((profile) => renderMemberCard(profile, following)));
    if (searchTerm && !profiles.length) results.append(make('p', 'helper', 'Aucun membre visible ne correspond à cette recherche.'));

    const { data: requests, error: requestsError } = await state.supabase.from('chat_requests')
      .select('id,sender_id,created_at')
      .eq('recipient_id', state.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(30);
    if (requestsError) throw requestsError;
    const requestProfiles = await getProfiles((requests || []).map((request) => request.sender_id));
    const requestList = byId('request-list');
    requestList.replaceChildren();
    for (const request of requests || []) {
      const profile = requestProfiles.get(request.sender_id) || { display_name: 'Membre KOZ', user_id: request.sender_id };
      const row = make('div', 'member-card');
      row.append(avatarFor(profile));
      const copy = make('div', 'person-copy');
      copy.append(make('strong', '', profile.display_name), make('span', '', 'Souhaite discuter'));
      const actions = make('div', 'request-actions');
      const accept = make('button', 'small-btn', 'Accepter');
      accept.type = 'button';
      accept.addEventListener('click', async () => {
        accept.disabled = true;
        try {
          const { error } = await state.supabase.rpc('accept_chat_request', { p_request_id: request.id });
          if (error) throw error;
          await loadMembers();
          await loadConversations();
        } catch (error) {
          setStatus('member-status', `Demande non acceptée : ${error.message}`, 'error');
          accept.disabled = false;
        }
      });
      const decline = make('button', 'small-btn', 'Refuser');
      decline.type = 'button';
      decline.addEventListener('click', async () => {
        decline.disabled = true;
        try {
          const { error } = await state.supabase.rpc('decline_chat_request', { p_request_id: request.id });
          if (error) throw error;
          await loadMembers();
        } catch (error) {
          setStatus('member-status', `Demande non refusée : ${error.message}`, 'error');
          decline.disabled = false;
        }
      });
      actions.append(accept, decline);
      row.append(copy, actions);
      requestList.append(row);
    }
    if (!requests?.length) requestList.append(make('p', 'helper', 'Aucune demande en attente.'));
    await loadConversations();
  } catch (error) {
    setStatus('member-status', `Chargement des membres impossible : ${error.message}`, 'error');
  }
}

async function loadConversations() {
  const list = byId('chat-list');
  if (!state.user) return;
  const { data, error } = await state.supabase.from('chat_conversations')
    .select('id,user_one,user_two,last_activity_at')
    .or(`user_one.eq.${state.user.id},user_two.eq.${state.user.id}`)
    .order('last_activity_at', { ascending: false })
    .limit(40);
  if (error) {
    list.replaceChildren(make('p', 'helper', `Conversations indisponibles : ${error.message}`));
    return;
  }
  const peers = (data || []).map((item) => item.user_one === state.user.id ? item.user_two : item.user_one);
  const profiles = await getProfiles(peers);
  list.replaceChildren();
  for (const conversation of data || []) {
    const peerId = conversation.user_one === state.user.id ? conversation.user_two : conversation.user_one;
    const profile = profiles.get(peerId) || { user_id: peerId, display_name: 'Membre KOZ' };
    const button = make('button', 'chat-row');
    button.type = 'button';
    button.append(avatarFor(profile));
    const copy = make('div', 'person-copy');
    copy.append(make('strong', '', profile.display_name), make('span', '', 'Conversation privée'));
    button.append(copy);
    button.addEventListener('click', () => { void openConversation(conversation.id, profile); });
    list.append(button);
  }
  if (!data?.length) list.append(make('p', 'helper', 'Accepte ou envoie une demande pour commencer à discuter.'));
}

async function openConversation(conversationId, profile) {
  state.activeConversation = conversationId;
  state.activePeer = profile;
  byId('chat-title').textContent = profile.display_name;
  byId('chat-panel').hidden = false;
  byId('chat-status').textContent = '';
  await loadMessages();
  if (state.conversationChannel) await state.supabase.removeChannel(state.conversationChannel);
  state.conversationChannel = state.supabase.channel(`koz-chat-${conversationId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'chat_messages',
      filter: `conversation_id=eq.${conversationId}`
    }, () => { void loadMessages(); })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setStatus('chat-status', 'Connexion instantanée indisponible. Recharge les conversations pour voir les nouveautés.', 'error');
      }
    });
}

async function loadMessages() {
  if (!state.activeConversation) return;
  const list = byId('chat-messages');
  const { data, error } = await state.supabase.from('chat_messages')
    .select('id,sender_id,body,created_at')
    .eq('conversation_id', state.activeConversation)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) {
    setStatus('chat-status', `Messages indisponibles : ${error.message}`, 'error');
    return;
  }
  list.replaceChildren();
  if (!data?.length) list.append(make('p', 'helper', 'Démarre la conversation.'));
  (data || []).forEach((message) => {
    const item = make('p', 'comment', `${message.sender_id === state.user.id ? 'Toi' : state.activePeer?.display_name || 'Membre'} · ${message.body}`);
    item.title = formatDate(message.created_at);
    list.append(item);
  });
  list.scrollTop = list.scrollHeight;
}

async function sendMessage(event) {
  event.preventDefault();
  const input = byId('message-input');
  const body = input.value.trim();
  if (!body || !state.activeConversation) return;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await state.supabase.from('chat_messages').insert({
      conversation_id: state.activeConversation, sender_id: state.user.id, body
    });
    if (error) throw error;
    input.value = '';
    await loadMessages();
  } catch (error) {
    setStatus('chat-status', `Message non envoyé : ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

async function watchIncomingCalls() {
  if (!state.user || state.inviteChannel) return;
  state.inviteChannel = state.supabase.channel(`koz-incoming-${state.user.id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'koz_call_sessions',
      filter: `callee_id=eq.${state.user.id}`
    }, (payload) => {
      if (payload.new.state === 'ringing') {
        void showIncomingCall(payload.new).catch((error) => showToast(`Appel entrant impossible : ${error.message}`));
      }
    });
  state.inviteChannel.on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'koz_call_sessions',
    filter: `callee_id=eq.${state.user.id}`
  }, (payload) => {
    if (payload.new.id === state.callId && ['ended', 'declined'].includes(payload.new.state)) {
      showToast('L’appel entrant est terminé.');
      void cleanupCall(false).catch((error) => showToast(`Nettoyage de l’appel impossible : ${error.message}`));
    }
  });
  await subscribeChannel(state.inviteChannel, (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        showToast('Les appels entrants ne sont pas joignables en temps réel. Vérifie les réglages Realtime de Supabase.');
      }
    }, 'Appels entrants indisponibles en temps réel.');
  const { data, error } = await state.supabase.from('koz_call_sessions')
    .select('id,caller_id,call_type,state')
    .eq('callee_id', state.user.id)
    .eq('state', 'ringing')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    showToast(`Vérification des appels entrants impossible : ${error.message}`);
    return;
  }
  if (data?.[0]) await showIncomingCall(data[0]);
}

async function showIncomingCall(call) {
  if (state.callId === call.id) return;
  if (state.callId) {
    try {
      const { error } = await state.supabase.rpc('finish_koz_call', { p_call_id: call.id });
      if (error) throw error;
    } catch (error) {
      showToast(`Appel entrant supplémentaire non refusé : ${error.message}`);
    }
    return;
  }
  state.callId = call.id;
  state.callMode = call.call_type;
  state.callInitiator = false;
  try {
    const profiles = await getProfiles([call.caller_id]);
    state.callPeerName = profiles.get(call.caller_id)?.display_name || 'Un membre KOZ';
    byId('incoming-title').textContent = call.call_type === 'audio' ? 'Appel audio entrant' : 'Appel vidéo entrant';
    byId('incoming-label').textContent = `${state.callPeerName} t’appelle.`;
    byId('incoming-dialog').showModal();
  } catch (error) {
    showToast(`Appel entrant impossible à afficher : ${error.message}`);
    state.callId = null;
  }
}

async function startCall(type) {
  if (!state.activeConversation || !state.activePeer) return;
  const button = type === 'audio' ? byId('audio-call') : byId('video-call');
  button.disabled = true;
  try {
    const { data, error } = await state.supabase.rpc('start_koz_call', {
      p_conversation_id: state.activeConversation,
      p_call_type: type
    });
    if (error) throw error;
    state.callId = data;
    state.callMode = type;
    state.callInitiator = true;
    state.callPeerName = state.activePeer.display_name;
    await watchCallState();
    await prepareCall();
    const offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);
    await sendSignal('offer', state.peerConnection.localDescription.toJSON());
    showCallDialog(`Appel ${type === 'audio' ? 'audio' : 'vidéo'} à ${state.callPeerName}…`);
    const callId = state.callId;
    state.ringTimeout = window.setTimeout(() => {
      if (state.callId === callId) void expireRingingCall(callId);
    }, 60000);
  } catch (error) {
    await cleanupCall(true);
    showToast(`Impossible de démarrer l’appel : ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function acceptCall() {
  byId('call-accept').disabled = true;
  try {
    const { error } = await state.supabase.rpc('respond_koz_call', {
      p_call_id: state.callId, p_accept: true
    });
    if (error) throw error;
    byId('incoming-dialog').close();
    await watchCallState();
    await prepareCall();
    showCallDialog(`En communication avec ${state.callPeerName}`);
    await loadPendingSignals();
  } catch (error) {
    showToast(`Impossible de répondre à l’appel : ${error.message}`);
    await cleanupCall(true);
  } finally {
    byId('call-accept').disabled = false;
  }
}

async function prepareCall() {
  const constraints = { audio: true, video: state.callMode === 'video' };
  state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  byId('local-video').srcObject = state.localStream;
  state.peerConnection = new RTCPeerConnection({
    iceServers: config.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  state.remoteStream = new MediaStream();
  byId('remote-video').srcObject = state.remoteStream;
  state.localStream.getTracks().forEach((track) => state.peerConnection.addTrack(track, state.localStream));
  state.peerConnection.ontrack = (event) => {
    event.streams[0]?.getTracks().forEach((track) => state.remoteStream.addTrack(track));
  };
  state.peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      void sendSignal('candidate', event.candidate.toJSON()).catch((error) => {
        setStatus('call-status', `Candidat réseau non envoyé : ${error.message}`, 'error');
      });
    }
  };
  state.peerConnection.onconnectionstatechange = () => {
    if (state.peerConnection?.connectionState === 'connected') {
      setStatus('call-status', `En communication avec ${state.callPeerName}`);
    } else if (state.peerConnection?.connectionState === 'failed') {
      setStatus('call-status', 'Connexion échouée. Vérifie le réseau ou configure un serveur TURN.');
    }
  };
  state.signalChannel = state.supabase.channel(`koz-signals-${state.callId}-${state.user.id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'koz_call_signals',
      filter: `receiver_id=eq.${state.user.id}`
    }, (payload) => {
      if (payload.new.call_id === state.callId) void handleSignal(payload.new);
    });
  await subscribeChannel(state.signalChannel, (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setStatus('call-status', 'Signalisation indisponible. Vérifie la publication Realtime de Supabase.', 'error');
      }
    }, 'Signalisation indisponible. Vérifie la publication Realtime de Supabase.');
}

async function sendSignal(kind, payload) {
  if (!state.callId || !state.user) return;
  const { data: call, error: callError } = await state.supabase.from('koz_call_sessions')
    .select('caller_id,callee_id,state')
    .eq('id', state.callId)
    .single();
  if (callError) throw callError;
  if (!['ringing', 'accepted'].includes(call.state)) return;
  const receiverId = call.caller_id === state.user.id ? call.callee_id : call.caller_id;
  const { error } = await state.supabase.from('koz_call_signals').insert({
    call_id: state.callId,
    sender_id: state.user.id,
    receiver_id: receiverId,
    kind,
    payload
  });
  if (error) throw error;
}

async function loadPendingSignals() {
  if (!state.callId || !state.user) return;
  const { data, error } = await state.supabase.from('koz_call_signals')
    .select('id,call_id,sender_id,receiver_id,kind,payload')
    .eq('call_id', state.callId)
    .eq('receiver_id', state.user.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  for (const signal of data || []) await handleSignal(signal);
}

async function handleSignal(signal) {
  if (state.handledSignals.has(signal.id) || !state.peerConnection) return;
  state.handledSignals.add(signal.id);
  const pc = state.peerConnection;
  try {
    if (signal.kind === 'offer' && !state.callInitiator) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
      await flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal('answer', pc.localDescription.toJSON());
    } else if (signal.kind === 'answer' && state.callInitiator) {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
        await flushCandidates();
      }
    } else if (signal.kind === 'candidate') {
      const candidate = new RTCIceCandidate(signal.payload);
      if (pc.remoteDescription) await pc.addIceCandidate(candidate);
      else state.pendingCandidates.push(candidate);
    }
  } catch (error) {
    showToast(`Signal d’appel non traité : ${error.message}`);
  }
}

async function flushCandidates() {
  for (const candidate of state.pendingCandidates.splice(0)) {
    await state.peerConnection.addIceCandidate(candidate);
  }
}

async function watchCallState() {
  if (!state.callId || state.callChannel) return;
  state.callChannel = state.supabase.channel(`koz-call-state-${state.callId}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'koz_call_sessions',
      filter: `id=eq.${state.callId}`
    }, (payload) => {
      if (payload.new.state === 'ended' || payload.new.state === 'declined') {
        window.clearTimeout(state.ringTimeout);
        state.ringTimeout = null;
        showToast(payload.new.state === 'declined' ? 'Appel refusé.' : 'Appel terminé.');
        void cleanupCall(false).catch((error) => showToast(`Nettoyage de l’appel impossible : ${error.message}`));
      } else if (payload.new.state === 'accepted') {
        window.clearTimeout(state.ringTimeout);
        state.ringTimeout = null;
      }
    });
  await subscribeChannel(state.callChannel, (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setStatus('call-status', 'État de l’appel indisponible en temps réel.', 'error');
      }
    }, 'État de l’appel indisponible en temps réel.');
  const { data, error } = await state.supabase.from('koz_call_sessions')
    .select('state')
    .eq('id', state.callId)
    .single();
  if (error) throw error;
  if (data.state === 'declined' || data.state === 'ended') {
    showToast(data.state === 'declined' ? 'Appel refusé.' : 'Appel terminé.');
    await cleanupCall(false);
  }
}

async function expireRingingCall(callId) {
  const { data, error } = await state.supabase.from('koz_call_sessions')
    .select('state')
    .eq('id', callId)
    .single();
  if (error) {
    showToast(`Vérification de l’appel impossible : ${error.message}`);
    return;
  }
  if (data.state !== 'ringing') return;
  const { error: finishError } = await state.supabase.rpc('finish_koz_call', { p_call_id: callId });
  if (finishError) {
    showToast(`Appel non terminé automatiquement : ${finishError.message}`);
    return;
  }
  showToast('Pas de réponse. Appel terminé.');
  if (state.callId === callId) await cleanupCall(false);
}

function subscribeChannel(channel, onStatus, errorMessage) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(errorMessage)), 10000);
    channel.subscribe((status) => {
      onStatus(status);
      if (status === 'SUBSCRIBED') {
        window.clearTimeout(timeout);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        window.clearTimeout(timeout);
        reject(new Error(errorMessage));
      }
    });
  });
}

function showCallDialog(message) {
  byId('call-status').textContent = message;
  if (!byId('call-dialog').open) byId('call-dialog').showModal();
}

async function finishCall() {
  if (!state.callId) return;
  const callId = state.callId;
  try {
    const { error } = await state.supabase.rpc('finish_koz_call', { p_call_id: callId });
    if (error) throw error;
  } catch (error) {
    showToast(`Impossible de terminer l’appel côté serveur : ${error.message}`);
  } finally {
    await cleanupCall(false);
  }
}

async function cleanupCall(notifyServer) {
  const callId = state.callId;
  const shouldNotifyServer = Boolean(notifyServer && callId);
  window.clearTimeout(state.ringTimeout);
  state.ringTimeout = null;
  if (state.peerConnection) {
    state.peerConnection.ontrack = null;
    state.peerConnection.onicecandidate = null;
    state.peerConnection.close();
  }
  state.localStream?.getTracks().forEach((track) => track.stop());
  if (state.signalChannel) await state.supabase.removeChannel(state.signalChannel);
  if (state.callChannel) await state.supabase.removeChannel(state.callChannel);
  state.peerConnection = null;
  state.localStream = null;
  state.remoteStream = null;
  state.signalChannel = null;
  state.callChannel = null;
  state.callId = null;
  state.pendingCandidates = [];
  state.handledSignals.clear();
  byId('local-video').srcObject = null;
  byId('remote-video').srcObject = null;
  if (byId('call-dialog').open) byId('call-dialog').close();
  if (byId('incoming-dialog').open) byId('incoming-dialog').close();
  if (shouldNotifyServer) {
    try {
      const { error } = await state.supabase.rpc('finish_koz_call', { p_call_id: callId });
      if (error) showToast(`Appel non terminé côté serveur : ${error.message}`);
    } catch (error) {
      showToast(`Appel non terminé côté serveur : ${error.message}`);
    }
  }
}

async function initialize() {
  if (!config?.url || !config?.anonKey) {
    setStatus('auth-status', 'Configuration requise : URL et clé publique Supabase manquantes.', 'error');
    byId('auth-form').querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
    return;
  }
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    state.supabase = createClient(config.url, config.anonKey);
    byId('auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = byId('auth-email').value.trim();
      const password = byId('auth-password').value;
      const displayName = byId('auth-name').value.trim();
      const phone = byId('auth-phone').value.trim();
      const avatarFile = byId('signup-avatar').files[0];
      byId('auth-submit').disabled = true;
      setStatus('auth-status', 'Connexion en cours…');
      try {
        if (state.authMode === 'signup') {
          if (password !== byId('auth-password-confirm').value) throw new Error('Les mots de passe ne correspondent pas.');
          if (!validPhoneNumber(phone)) throw new Error('Saisis un numéro au format international, par exemple +243812345678.');
          const { data, error } = await state.supabase.auth.signUp({
            email, password,
            options: {
              data: { display_name: displayName, phone_number: phone },
              emailRedirectTo: window.location.href.split(/[?#]/, 1)[0]
            }
          });
          if (error) throw error;
          if (data.session && data.user) {
            await ensureProfile(data.user, displayName);
            renderAccount(data.user);
            let photoError = '';
            if (avatarFile) {
              try {
                await uploadProfileAvatar(avatarFile);
              } catch (error) {
                photoError = `Photo non enregistrée : ${error.message}.`;
              }
            }
            switchView('profile');
            setStatus('phone-verification-status', 'Compte créé. Envoie un code SMS pour vérifier ton numéro.', 'success');
            if (photoError) setStatus('profile-photo-status', photoError, 'error');
          } else {
            setStatus('auth-status', 'Compte créé. Vérifie ton e-mail, puis connecte-toi pour confirmer ton téléphone et ajouter ta photo de profil.');
          }
        } else {
          const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          if (!data.user) throw new Error('La connexion n’a retourné aucun compte.');
          await ensureProfile(data.user);
          renderAccount(data.user);
          setStatus('auth-status', 'Connexion réussie.', 'success');
        }
      } catch (error) {
        setStatus('auth-status', `Connexion impossible : ${error.message}`, 'error');
      } finally {
        byId('auth-submit').disabled = false;
      }
    });
    byId('profile-photo-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = byId('profile-photo-submit');
      button.disabled = true;
      setStatus('profile-photo-status', 'Enregistrement de la photo…');
      try {
        await uploadProfileAvatar(byId('profile-avatar-file').files[0]);
        setStatus('profile-photo-status', 'Photo de profil mise à jour.', 'success');
        byId('profile-avatar-file').value = '';
      } catch (error) {
        setStatus('profile-photo-status', `Photo non enregistrée : ${error.message}`, 'error');
      } finally {
        button.disabled = false;
      }
    });
    byId('phone-verification-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = byId('send-phone-code');
      button.disabled = true;
      setStatus('phone-verification-status', 'Envoi du code SMS…');
      try {
        await sendPhoneVerification(byId('verify-phone').value);
      } catch (error) {
        setStatus('phone-verification-status', `Envoi impossible : ${error.message}`, 'error');
      } finally {
        button.disabled = false;
      }
    });
    byId('verify-phone-code').addEventListener('click', async () => {
      const token = byId('phone-code').value.trim();
      if (!state.pendingPhone || !/^\d{6}$/.test(token)) {
        setStatus('phone-verification-status', 'Saisis le code à 6 chiffres reçu par SMS.', 'error');
        return;
      }
      const button = byId('verify-phone-code');
      button.disabled = true;
      setStatus('phone-verification-status', 'Vérification du code…');
      try {
        const { data, error } = await state.supabase.auth.verifyOtp({
          phone: state.pendingPhone,
          token,
          type: 'phone_change'
        });
        if (error) throw error;
        if (!data.user) throw new Error('La validation n’a retourné aucun compte.');
        state.user = data.user;
        state.pendingPhone = '';
        byId('phone-code-field').hidden = true;
        byId('phone-code').required = false;
        byId('verify-phone-code').hidden = true;
        byId('phone-verification-state').textContent = `Numéro vérifié : ${data.user.phone || ''}`;
        setStatus('phone-verification-status', 'Numéro de téléphone vérifié.', 'success');
      } catch (error) {
        setStatus('phone-verification-status', `Code non validé : ${error.message}`, 'error');
      } finally {
        button.disabled = false;
      }
    });
    byId('auth-toggle').addEventListener('click', () => setAuthMode(state.authMode === 'signup' ? 'login' : 'signup'));
    document.querySelectorAll('[data-oauth-provider]').forEach((button) => {
      button.addEventListener('click', async () => {
        const provider = button.dataset.oauthProvider;
        const redirectTo = navigator.userAgent.includes('KOZAndroidApp')
          ? 'mwasi://login-callback'
          : window.location.href.split(/[?#]/, 1)[0];
        document.querySelectorAll('[data-oauth-provider]').forEach((socialButton) => { socialButton.disabled = true; });
        setStatus('auth-status', `Redirection vers ${button.textContent.trim()}…`);
        try {
          const { error } = await state.supabase.auth.signInWithOAuth({
            provider,
            options: { redirectTo }
          });
          if (error) throw error;
        } catch (error) {
          setStatus('auth-status', `Connexion sociale impossible : ${error.message}. Vérifie que ce fournisseur est activé dans Supabase.`, 'error');
          document.querySelectorAll('[data-oauth-provider]').forEach((socialButton) => { socialButton.disabled = false; });
        }
      });
    });
    setAuthMode('signup');
    byId('sign-out').addEventListener('click', async () => {
      byId('sign-out').disabled = true;
      try {
        if (state.callId) await finishCall();
        const { error } = await state.supabase.auth.signOut();
        if (error) throw error;
        state.profile = null;
        renderAccount(null);
      } catch (error) {
        showToast(`Déconnexion impossible : ${error.message}`);
      } finally {
        byId('sign-out').disabled = false;
      }
    });
    state.supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') renderAccount(null);
      if (event === 'SIGNED_IN' && session?.user && state.user?.id !== session.user.id) {
        void ensureProfile(session.user).then(() => renderAccount(session.user)).catch((error) => {
          showToast(`Profil KOZ inaccessible : ${error.message}`);
        });
      }
    });
    const { data, error } = await state.supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user) {
      await ensureProfile(data.session.user);
      renderAccount(data.session.user);
    }
    setStatus('auth-status', 'Crée un compte ou connecte-toi pour rejoindre KOZ.');
  } catch (error) {
    setStatus('auth-status', `Services KOZ indisponibles : ${error.message}`, 'error');
  }
}

document.querySelectorAll('.nav-link').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});
byId('top-avatar').addEventListener('click', () => switchView('profile'));
byId('new-post-focus').addEventListener('click', () => {
  switchView('feed');
  byId('post-body').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
byId('post-form').addEventListener('submit', publishPost);
byId('post-media').addEventListener('change', () => {
  const file = byId('post-media').files[0];
  byId('media-name').textContent = file ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} Mo` : 'Jusqu’à 50 Mo';
});
byId('story-add').addEventListener('click', () => {
  switchView('feed');
  byId('post-media').click();
  showToast('Choisis une photo ou une vidéo, puis publie-la sur ton fil.');
});
byId('member-search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('member-status', 'Recherche en cours…');
  try {
    await loadMembers(byId('member-search').value.trim());
    setStatus('member-status', 'Résultats des membres visibles.');
  } catch (error) {
    setStatus('member-status', `Recherche impossible : ${error.message}`, 'error');
  }
});
byId('global-search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.currentTarget.value.trim().length >= 2) {
    switchView('members');
    byId('member-search').value = event.currentTarget.value.trim();
    byId('member-search-form').requestSubmit();
  }
});
byId('message-form').addEventListener('submit', sendMessage);
byId('chat-close').addEventListener('click', () => {
  byId('chat-panel').hidden = true;
  state.activeConversation = null;
  state.activePeer = null;
  if (state.conversationChannel) void state.supabase.removeChannel(state.conversationChannel);
  state.conversationChannel = null;
});
byId('audio-call').addEventListener('click', () => { void startCall('audio'); });
byId('video-call').addEventListener('click', () => { void startCall('video'); });
byId('call-accept').addEventListener('click', () => { void acceptCall(); });
byId('call-decline').addEventListener('click', async () => {
  try {
    const { error } = await state.supabase.rpc('respond_koz_call', { p_call_id: state.callId, p_accept: false });
    if (error) throw error;
  } catch (error) {
    showToast(`Impossible de refuser l’appel : ${error.message}`);
  } finally {
    await cleanupCall(false);
  }
});
byId('call-end').addEventListener('click', () => { void finishCall(); });
byId('call-close').addEventListener('click', () => { void finishCall(); });
byId('call-dialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  void finishCall();
});
byId('incoming-dialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  byId('call-decline').click();
});
initialize();
