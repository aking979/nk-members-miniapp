const screens = document.querySelectorAll('.screen');
const navButtons = document.querySelectorAll('.bottom-nav button');
const historyStack = ['home'];
let onboardingStepNavigation = false;
let profileEditorDirty = false;

function getActivationGateState() {
  let legal = {};
  let onboarding = {};
  try { legal = JSON.parse(localStorage.getItem('rvnwLegalAcceptances') || '{}'); } catch {}
  try { onboarding = JSON.parse(localStorage.getItem('rvnwOnboardingProgress') || '{}'); } catch {}
  const legalDocs = ['nk-legal-package'];
  const onboardingSteps = ['profile','chat','knowledge','membership','team'];
  return {
    legalComplete: legalDocs.every(id => Boolean(legal[id])),
    onboardingComplete: onboardingSteps.every(id => Boolean(onboarding[id]?.completed))
  };
}

function showScreen(id, push = true) {
  const gate = getActivationGateState();
  const onboardingScreens = new Set(['home','onboarding','account','profile-edit','profile','schedule','knowledge','membership','referral','team','support']);
  const legalScreens = new Set(['home','account','profile-edit','profile','legal','legal-terms','legal-offer','legal-privacy','legal-code','legal-data-consent','legal-media-consent','support']);

  // Activation order: onboarding first, then legal documents, then full cabinet.
  // This guarantees that the resident row/profile exists before legal acceptance
  // is written to Google Sheets / LEGAL_CONSENTS.
  if (!onboardingStepNavigation && !gate.onboardingComplete && !onboardingScreens.has(id)) {
    id = 'onboarding';
    toast('Сначала заверши онбординг — затем подпиши документы');
  } else if (!onboardingStepNavigation && gate.onboardingComplete && !gate.legalComplete && !legalScreens.has(id)) {
    id = 'legal';
    toast('Сначала подпиши документы — затем откроется весь личный кабинет');
  }

  const target = document.getElementById(id);
  if (!target) return;
  screens.forEach(s => s.classList.remove('active'));
  target.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.go === id));
  if (push && historyStack[historyStack.length - 1] !== id) historyStack.push(id);
}

document.querySelectorAll('[data-go]').forEach(el => {
  el.addEventListener('click', () => showScreen(el.dataset.go));
});

document.querySelectorAll('[data-back]').forEach(el => {
  el.addEventListener('click', () => {
    if (historyStack.length > 1) historyStack.pop();
    showScreen(historyStack[historyStack.length - 1], false);
  });
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

document.querySelectorAll('[data-copy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const code = btn.dataset.copy;
    if (!code) {
      toast('Сначала заполни профиль');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      toast(`Промокод ${code} скопирован`);
    } catch {
      toast(`Промокод: ${code}`);
    }
  });
});

document.querySelectorAll('[data-topic]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('supportTopic').value = btn.dataset.topic;
    document.getElementById('supportTopic').focus();
  });
});

document.getElementById('shareReferral').addEventListener('click', async () => {
  const generated = generatedPromoCodes(rvnwResidentProfile?.full_name || getLocalResidentProfile()?.full_name);
  const liveFriendPromo = rvnwResidentProfile?.friend_promo_code || generated.friend_promo_code || 'RVNW30';
  const text = `Присоединяйся к RVNW. Мой промокод для друзей: ${liveFriendPromo}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'RVNW', text }); }
    catch {}
  } else {
    try { await navigator.clipboard.writeText(text); } catch {}
    toast('Текст приглашения скопирован');
  }
});

// Telegram Mini App compatibility
if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}

// The bottom navigation must be visible from the very first render.
document.body.classList.remove('form-input-active');
window.addEventListener('pageshow', () => document.body.classList.remove('form-input-active'));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !document.activeElement?.matches?.('input, textarea, select')) {
    document.body.classList.remove('form-input-active');
  }
});

// Subscription management — YooKassa-ready resident controls.
// The real card token removal will be wired to the backend after YooKassa enables recurring payments.
const subscriptionPanel = document.getElementById('subscriptionPanel');
const subscriptionModal = document.getElementById('subscriptionModal');
const subscriptionAutoStatus = document.getElementById('subscriptionAutoStatus');
const subscriptionPaymentMethod = document.getElementById('subscriptionPaymentMethod');
const unlinkCardBtn = document.getElementById('unlinkCardBtn');

function openSubscriptionPanel() {
  if (!subscriptionPanel) return;
  subscriptionPanel.hidden = false;
  subscriptionPanel.scrollIntoView({behavior:'smooth', block:'start'});
}

const membershipPayBtn = document.getElementById('membershipPayBtn');

async function startNkPayment() {
  if (!membershipPayBtn) return;
  const resident = getTelegramResident();
  membershipPayBtn.disabled = true;
  const oldText = membershipPayBtn.textContent;
  membershipPayBtn.textContent = 'Создаём оплату…';
  try {
    const response = await fetch('/api/create-payment', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        telegram_id: resident?.telegram_id || '',
        username: resident?.username || ''
      })
    });
    const data = await response.json();
    if (!response.ok || !data.confirmation_url) throw new Error(data.error || 'Не удалось создать оплату');
    localStorage.setItem('nkPendingPaymentId', data.payment_id);
    window.location.href = data.confirmation_url;
  } catch (error) {
    console.error('NK payment error:', error);
    toast(error?.message || 'Не удалось открыть оплату');
    membershipPayBtn.disabled = false;
    membershipPayBtn.textContent = oldText;
  }
}

async function checkReturnedNkPayment() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment_return') !== '1') return;
  const paymentId = localStorage.getItem('nkPendingPaymentId');
  if (!paymentId) {
    toast('Возврат из оплаты получен. Проверяем статус через кабинет ЮKassa.');
    return;
  }
  try {
    const response = await fetch(`/api/payment-status?payment_id=${encodeURIComponent(paymentId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось проверить оплату');
    if (data.status === 'succeeded' && data.paid) {
      localStorage.setItem('nkLastSuccessfulPaymentId', paymentId);
      localStorage.setItem('nkPaymentMethodSaved', data.payment_method_saved ? '1' : '0');
      localStorage.removeItem('nkPendingPaymentId');
      toast(data.payment_method_saved ? 'Оплата прошла. Карта сохранена для автопродления.' : 'Оплата прошла успешно.');
      if (membershipPayBtn) membershipPayBtn.textContent = 'Оплачено — 4 900 ₽';
    } else if (data.status === 'canceled') {
      toast('Оплата не завершена');
    } else {
      toast('Платёж обрабатывается. Статус обновится после подтверждения ЮKassa.');
    }
  } catch (error) {
    console.error('NK payment status error:', error);
    toast('Не удалось проверить статус оплаты');
  } finally {
    params.delete('payment_return');
    const qs = params.toString();
    history.replaceState({}, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  }
}

membershipPayBtn?.addEventListener('click', startNkPayment);
window.addEventListener('DOMContentLoaded', checkReturnedNkPayment);

document.getElementById('membershipManageBtn')?.addEventListener('click', openSubscriptionPanel);
unlinkCardBtn?.addEventListener('click', () => { if (subscriptionModal) subscriptionModal.hidden = false; });
document.getElementById('cancelUnlinkCard')?.addEventListener('click', () => { if (subscriptionModal) subscriptionModal.hidden = true; });
subscriptionModal?.addEventListener('click', (event) => { if (event.target === subscriptionModal) subscriptionModal.hidden = true; });

document.getElementById('confirmUnlinkCard')?.addEventListener('click', async () => {
  // UI is complete for YooKassa review. Backend token deletion is intentionally not faked.
  // Once recurring payments are enabled, replace this local state transition with a secure server request
  // that deletes/invalidates the stored YooKassa payment_method_id for the authenticated resident.
  localStorage.setItem('nkAutopayDisabled', '1');
  if (subscriptionModal) subscriptionModal.hidden = true;
  if (subscriptionAutoStatus) { subscriptionAutoStatus.textContent = 'Автопродление отключено'; subscriptionAutoStatus.classList.add('off'); }
  if (subscriptionPaymentMethod) subscriptionPaymentMethod.textContent = 'Карта отвязана';
  if (unlinkCardBtn) { unlinkCardBtn.textContent = 'Карта отвязана'; unlinkCardBtn.disabled = true; }
  toast('Автопродление отключено. Доступ сохранится до конца оплаченного периода');
});

if (localStorage.getItem('nkAutopayDisabled') === '1') {
  if (subscriptionAutoStatus) { subscriptionAutoStatus.textContent = 'Автопродление отключено'; subscriptionAutoStatus.classList.add('off'); }
  if (subscriptionPaymentMethod) subscriptionPaymentMethod.textContent = 'Карта отвязана';
  if (unlinkCardBtn) { unlinkCardBtn.textContent = 'Карта отвязана'; unlinkCardBtn.disabled = true; }
}

document.querySelectorAll('[data-video-key]').forEach(el=>el.addEventListener('click',()=>{const u=window.RVNW_CONFIG?.videos?.[el.dataset.videoKey];u?window.open(u,'_blank'):toast('Ссылка на видео ещё не добавлена')}));

// V3 course interaction
function getCourseProgress() {
  try { return JSON.parse(localStorage.getItem('rvnwCourseProgress') || '{}'); }
  catch { return {}; }
}
function saveCourseProgress(data) {
  localStorage.setItem('rvnwCourseProgress', JSON.stringify(data));
}
function refreshCourseProgress() {
  const data = getCourseProgress();
  const completed = [1,2,3,4].filter(n => data[n]).length;
  const percent = completed * 25;
  const text = document.getElementById('courseProgressText');
  const pct = document.getElementById('courseProgressPercent');
  const bar = document.getElementById('courseProgressBar');
  if (text) text.textContent = `${completed} из 4 модулей завершено`;
  if (pct) pct.textContent = `${percent}%`;
  if (bar) bar.style.width = `${percent}%`;
  document.querySelectorAll('[data-module-status]').forEach(el => {
    const n = el.dataset.moduleStatus;
    el.textContent = data[n] ? 'Пройдено ✓' : 'Начать →';
  });
  document.querySelectorAll('[data-complete-module]').forEach(btn => {
    const n = btn.dataset.completeModule;
    const done = Boolean(data[n]);
    btn.classList.toggle('completed', done);
    btn.textContent = done ? 'Модуль пройден ✓' : 'Отметить модуль как пройденный';
  });
}
document.querySelectorAll('.module-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const screen = btn.closest('.course-module-screen');
    screen.querySelectorAll('.module-tab').forEach(x => x.classList.remove('active'));
    screen.querySelectorAll('.module-panel').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById(btn.dataset.tabTarget);
    if (panel) panel.classList.add('active');
  });
});
document.querySelectorAll('[data-complete-module]').forEach(btn => {
  btn.addEventListener('click', () => {
    const data = getCourseProgress();
    const n = btn.dataset.completeModule;
    data[n] = !data[n];
    saveCourseProgress(data);
    refreshCourseProgress();
    toast(data[n] ? 'Модуль отмечен как пройденный' : 'Отметка снята');
  });
});
document.querySelectorAll('.discuss-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const topic = document.getElementById('supportTopic');
    if (topic) topic.value = `Обсудить модуль: ${btn.dataset.moduleName}`;
    showScreen('support');
  });
});
refreshCourseProgress();


// Home quick contact cards reuse the existing support form and only preselect a topic.
document.querySelectorAll('[data-support-topic]').forEach(btn => {
  btn.addEventListener('click', () => {
    const topic = document.getElementById('supportTopic');
    if (topic) topic.value = btn.dataset.supportTopic || '';
  });
});

// V5 legal center
function getLegalAcceptances() {
  try { return JSON.parse(localStorage.getItem('rvnwLegalAcceptances') || '{}'); }
  catch { return {}; }
}
function refreshLegalAcceptances() {
  const data = getLegalAcceptances();
  document.querySelectorAll('[data-legal-state]').forEach(el => {
    const record = data[el.dataset.legalState];
    el.textContent = record ? `Подтверждено: ${record.date} · версия 1.0` : '';
  });
  document.querySelectorAll('[data-legal-accept]').forEach(btn => {
    const record = data[btn.dataset.legalAccept];
    if (record) {
      btn.textContent = 'Документ принят ✓';
      btn.classList.add('completed');
    }
  });
}
document.querySelectorAll('.legal-check').forEach(check => {
  check.addEventListener('change', () => {
    const btn = document.querySelector(`[data-legal-accept="${check.dataset.legalCheck}"]`);
    if (btn) btn.disabled = !check.checked;
  });
});
document.querySelectorAll('[data-legal-accept]').forEach(btn => {
  btn.addEventListener('click', () => {
    const data = getLegalAcceptances();
    data[btn.dataset.legalAccept] = {
      date: new Date().toLocaleDateString('ru-RU'),
      version: '1.0'
    };
    localStorage.setItem('rvnwLegalAcceptances', JSON.stringify(data));
    refreshLegalAcceptances();

    // Persist legal completion in the RVNW database so a new app ZIP does not
    // make the resident sign the same legal package again.
    const legalDocs = ['nk-legal-package'];
    const legalComplete = legalDocs.every(id => Boolean(data[id]));
    if (legalComplete && RVNW_LEGAL_WEBHOOK) {
      const resident = getTelegramResident();
      if (resident.telegram_id) {
        fetch(RVNW_LEGAL_WEBHOOK, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            action: 'legal_accepted',
            telegram_id: resident.telegram_id,
            telegram_username: resident.telegram_username || '',
            legal_status: 'accepted',
            legal_version: 'v1',
            legal_accepted_at: new Date().toISOString()
          })
        }).catch(error => console.error('RVNW legal webhook error', error));
      }
    }
    toast('Ознакомление подтверждено');
  });
});
document.querySelectorAll('[data-legal-question]').forEach(btn => {
  btn.addEventListener('click', () => {
    const topic = document.getElementById('supportTopic');
    if (topic) topic.value = 'Юридический вопрос';
  });
});
refreshLegalAcceptances();

// V6 fixed onboarding and activation progress
const RVNW_ONBOARDING_STEPS = ['profile','chat','knowledge','membership','team'];
const RVNW_LEGAL_DOCS = ['nk-legal-package'];

function getOnboardingProgress() {
  try { return JSON.parse(localStorage.getItem('rvnwOnboardingProgress') || '{}'); }
  catch { return {}; }
}
function saveOnboardingProgress(data) {
  localStorage.setItem('rvnwOnboardingProgress', JSON.stringify(data));
}
function markOnboardingStep(step) {
  if (!step) return;
  const data = getOnboardingProgress();
  if (!data[step]) {
    data[step] = { completed: true, date: new Date().toISOString() };
    saveOnboardingProgress(data);
    refreshActivationProgress();
    toast('Шаг онбординга выполнен ✓');
  }
}

function setOnboardingStepState(step, completed) {
  if (!step) return;
  const data = getOnboardingProgress();
  if (completed) {
    if (!data[step]?.completed) {
      data[step] = { completed: true, date: new Date().toISOString() };
    }
  } else if (data[step]) {
    delete data[step];
  }
  saveOnboardingProgress(data);
}

function isResidentProfileComplete() {
  const requiredIds = [
    'profileFullName','profileRole','profileCompany','profileNiche','profileCity',
    'profileAbout','profileUseful','profileEmail','profileTelegram','profilePhone'
  ];
  const allFieldsFilled = requiredIds.every(id => {
    const el = document.getElementById(id);
    return !!el && String(el.value || '').trim().length > 0;
  });
  const hasPhoto = !!getResidentPhoto();
  const consent = !!document.getElementById('profilePublicConsent')?.checked;
  return allFieldsFilled && hasPhoto && consent;
}

function syncProfileOnboardingCompletion({showToast=false} = {}) {
  const complete = isResidentProfileComplete();
  const before = Boolean(getOnboardingProgress().profile?.completed);
  setOnboardingStepState('profile', complete);
  refreshActivationProgress();

  if (showToast) {
    if (complete && !before) toast('Профиль заполнен — шаг онбординга выполнен ✓');
    else if (!complete) toast('Заполни все поля и добавь фотографию');
  }
  return complete;
}

function refreshActivationProgress() {
  // Profile step is never trusted blindly: if the card is incomplete, remove stale completion.
  const profileFormNow = document.getElementById('profileForm');
  if (profileFormNow) {
    const profileCompleteNow = isResidentProfileComplete();
    const stored = getOnboardingProgress();
    if (profileCompleteNow && !stored.profile?.completed) {
      stored.profile = { completed: true, date: new Date().toISOString() };
      saveOnboardingProgress(stored);
    } else if (!profileCompleteNow && stored.profile) {
      delete stored.profile;
      saveOnboardingProgress(stored);
    }
  }
  const onboarding = getOnboardingProgress();
  const legal = getLegalAcceptances();
  const onboardingCount = RVNW_ONBOARDING_STEPS.filter(step => onboarding[step]?.completed).length;
  const legalCount = RVNW_LEGAL_DOCS.filter(doc => legal[doc]).length;
  const totalDone = onboardingCount + legalCount;
  const total = RVNW_ONBOARDING_STEPS.length + RVNW_LEGAL_DOCS.length;
  const overallPercent = Math.round(totalDone / total * 100);
  const onboardingPercent = Math.round(onboardingCount / RVNW_ONBOARDING_STEPS.length * 100);

  const mainOnboarding = document.getElementById('onboardingMainStatus');
  const mainLegal = document.getElementById('legalMainStatus');
  const overallLabel = document.getElementById('activationProgressLabel');
  const overallBar = document.getElementById('activationProgressBar');
  const summary = document.getElementById('onboardingSummaryText');
  const summaryHint = document.getElementById('onboardingSummaryHint');
  const onboardingBar = document.getElementById('onboardingProgressBar');
  if (mainOnboarding) mainOnboarding.textContent = onboardingCount === 5 ? 'Все 5 шагов выполнены' : `${onboardingCount} из 5 шагов выполнено`;
  if (mainLegal) mainLegal.textContent = legalCount === 1 ? 'Юридический пакет подтверждён' : 'Документы не подтверждены';
  if (overallLabel) overallLabel.textContent = `${overallPercent}%`;
  if (overallBar) overallBar.style.width = `${overallPercent}%`;
  if (summary) summary.textContent = `${onboardingCount} из 5 шагов выполнено`;
  if (summaryHint) summaryHint.textContent = onboardingCount === 5 ? 'Онбординг полностью завершён.' : `Осталось ${5-onboardingCount} ${5-onboardingCount === 1 ? 'шаг' : 'шага'}.`;
  if (onboardingBar) onboardingBar.style.width = `${onboardingPercent}%`;

  document.querySelectorAll('[data-onboarding-step]').forEach(btn => {
    const step = btn.dataset.onboardingStep;
    const done = Boolean(onboarding[step]?.completed);
    btn.classList.toggle('done', done);
    const icon = btn.querySelector('i');
    if (icon) icon.textContent = done ? '✓' : String(RVNW_ONBOARDING_STEPS.indexOf(step)+1);
    const detail = btn.querySelector('div span');
    if (detail) {
      if (done) detail.textContent = 'Выполнено';
      else if (step === 'profile') detail.textContent = 'Заполни обязательные поля, фото и согласие';
    }
  });

  document.querySelectorAll('[data-legal-row-status]').forEach(el => {
    const signed = Boolean(legal[el.dataset.legalRowStatus]);
    el.textContent = signed ? 'Подписан' : 'Не подписан';
    el.classList.toggle('signed', signed);
  });

  const onboardingCard = document.querySelector('.activation-card[data-go="onboarding"]');
  const legalCard = document.querySelector('.activation-card[data-go="legal"]');
  onboardingCard?.classList.toggle('completed', onboardingCount === 5);
  legalCard?.classList.toggle('completed', legalCount === 1);
  const onboardingIcon = document.getElementById('onboardingCardIcon');
  const legalIcon = document.getElementById('legalCardIcon');
  if (onboardingIcon) onboardingIcon.textContent = onboardingCount === 5 ? '✓' : '1';
  if (legalIcon) legalIcon.textContent = legalCount === 1 ? '✓' : '2';

  // Access gate: onboarding first, then legal documents, then the full cabinet.
  const legalComplete = legalCount === 1;
  const onboardingComplete = onboardingCount === 5;
  const fullyActivated = legalComplete && onboardingComplete;
  if (onboardingComplete) setTimeout(persistOnboardingCompletionIfNeeded, 0);
  const homeFeatures = document.getElementById('homeFeaturesBlock');
  const homeEvents = document.getElementById('homeEventsBlock');
  const supportBanner = document.querySelector('#home .support-banner');
  [homeFeatures, homeEvents, supportBanner].forEach(el => el?.classList.toggle('cabinet-locked', !fullyActivated));
  document.querySelector('.bottom-nav')?.classList.toggle('cabinet-nav-locked', !fullyActivated);
  document.body.classList.toggle('rvnw-fully-activated', fullyActivated);

  // Legal documents unlock only after onboarding is complete.
  onboardingCard?.classList.remove('activation-stage-locked');
  legalCard?.classList.toggle('activation-stage-locked', !onboardingComplete);
}

// Onboarding actions must complete the current step first and then open the
// destination. Capture phase prevents the generic [data-go] handler from
// navigating before the step has been recorded.
document.querySelectorAll('[data-onboarding-step]').forEach(btn => {
  btn.addEventListener('click', (event) => {
    const step = btn.dataset.onboardingStep;
    if (step === 'profile') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    markOnboardingStep(step);

    if (step === 'chat') {
      const url = window.RVNW_CONFIG?.closedChatUrl;
      if (url) window.open(url, '_blank');
      else toast('Ссылка на закрытый чат пока не подключена');
      return;
    }

    const destination = btn.dataset.go;
    if (destination) {
      onboardingStepNavigation = true;
      try { showScreen(destination); } finally { onboardingStepNavigation = false; }
    }
  }, true);
});


// Ensure legal acceptance also refreshes the main dashboard.
document.querySelectorAll('[data-legal-accept]').forEach(btn => {
  btn.addEventListener('click', () => setTimeout(refreshActivationProgress, 0));
});
refreshActivationProgress();


// RVNW → Make integration
const RVNW_LEGAL_WEBHOOK = window.RVNW_CONFIG?.makeLegalWebhookUrl || '';
const RVNW_ONBOARDING_WEBHOOK = window.RVNW_CONFIG?.makeOnboardingWebhookUrl || '';
const RVNW_TRACKING_WEBHOOK = window.RVNW_CONFIG?.makeTrackingWebhookUrl || '';
const RVNW_ANALYSIS_WEBHOOK = window.RVNW_CONFIG?.makeAnalysisWebhookUrl || '';
const RVNW_QUESTIONS_WEBHOOK = window.RVNW_CONFIG?.makeQuestionsWebhookUrl || '';
const RVNW_PROFILE_WEBHOOK = window.RVNW_CONFIG?.makeProfileWebhookUrl || '';
const RVNW_PROFILE_SAVE_WEBHOOK = window.RVNW_CONFIG?.makeProfileSaveWebhookUrl || '';
const RVNW_SUBSCRIPTION_WEBHOOK = window.RVNW_CONFIG?.makeSubscriptionWebhookUrl || '';

function getTelegramResident() {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user || null;
  if (!tgUser) {
    return {
      telegram_id: '',
      telegram_username: '',
      telegram_first_name: '',
      telegram_last_name: '',
      telegram_language: '',
      resident_name: ''
    };
  }

  const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim();

  return {
    telegram_id: String(tgUser.id || ''),
    telegram_username: tgUser.username ? `@${tgUser.username}` : '',
    telegram_first_name: tgUser.first_name || '',
    telegram_last_name: tgUser.last_name || '',
    telegram_language: tgUser.language_code || '',
    resident_name: fullName
  };
}

function fillTelegramResidentName() {
  const resident = getTelegramResident();
  const input = document.getElementById('trackingName');
  if (input && resident.resident_name) input.value = resident.resident_name;
}

async function sendToMake(webhookUrl, payload, submitButton) {
  if (!webhookUrl) throw new Error('Make webhook is not configured');

  const originalText = submitButton?.textContent || '';
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Отправляем...';
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }
    return true;
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

const trackingFormLive = document.getElementById('trackingForm');
if (trackingFormLive) {
  trackingFormLive.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!trackingFormLive.reportValidity()) return;

    const fd = new FormData(trackingFormLive);
    const resident = getTelegramResident();
    const btn = trackingFormLive.querySelector('button[type="submit"]');

    const payload = {
      type: 'tracking',
      action: 'tracking_submit',
      event: 'tracking_submit',
      source: 'nk_members_miniapp',
      app_version: '42-final-polish',
      submitted_at: new Date().toISOString(),

      resident_name: fd.get('name') || resident.resident_name || '',
      telegram_id: resident.telegram_id,
      telegram_username: resident.telegram_username,
      telegram_first_name: resident.telegram_first_name,
      telegram_last_name: resident.telegram_last_name,
      telegram_language: resident.telegram_language,

      company: fd.get('company') || '',
      niche: fd.get('niche') || '',
      role: fd.get('role') || '',
      company_age: fd.get('company_age') || '',
      monthly_revenue: fd.get('monthly_revenue') || '',
      team_size: fd.get('team_size') || '',
      current_point: fd.get('current_point') || '',
      business_request: fd.get('business_request') || '',
      personal_request: fd.get('personal_request') || '',
      desired_group: fd.get('desired_group') || '',
      comment: fd.get('comment') || '',
      weekly_commitment: fd.get('weekly_commitment') === 'on',
      tracking_status: 'submitted'
    };

    try {
      await sendToMake(RVNW_TRACKING_WEBHOOK, payload, btn);
      toast('Заявка на трекинг отправлена ✓');
      trackingFormLive.reset();
      if (rvnwResidentProfile) {
        rvnwResidentProfile = {...rvnwResidentProfile, tracking_status:'submitted'};
        applyResidentProfile(rvnwResidentProfile);
      }
      else fillTelegramResidentName();
    } catch (error) {
      console.error('RVNW tracking webhook error:', error);
      toast('Не удалось отправить. Попробуй ещё раз.');
    }
  });
}

const analysisFormLive = document.getElementById('analysisForm');
if (analysisFormLive) {
  analysisFormLive.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!analysisFormLive.reportValidity()) return;
    const fd = new FormData(analysisFormLive);
    const resident = getTelegramResident();
    const btn = analysisFormLive.querySelector('button[type="submit"]');
    const payload = {
      resident_name: fd.get('name') || resident.resident_name || '',
      telegram: fd.get('telegram') || (resident.telegram_username ? '@' + resident.telegram_username.replace(/^@/, '') : ''),
      email: fd.get('email') || '',
      city: fd.get('city') || '',
      company: fd.get('company') || '',
      niche: fd.get('niche') || '',
      website: fd.get('website') || '',
      age: fd.get('age') || '',
      role: fd.get('role') || '',
      description: fd.get('description') || '',
      directions: fd.get('directions') || '',
      team: fd.get('team') || '',
      revenue: fd.get('revenue') || '',
      profit: fd.get('profit') || '',
      stage: fd.get('stage') || '',
      problem: fd.get('problem') || '',
      result: fd.get('result') || '',
      attempts: fd.get('attempts') || '',
      question: fd.get('question') || '',
      value: fd.get('value') || '',
      live: fd.get('live') || '',
      comment: fd.get('comment') || '',
      type: 'analysis',
      action: 'analysis_submit',
      event: 'analysis_submit',
      source: 'nk_members_miniapp',
      submitted_at: new Date().toISOString(),
      telegram_id: resident.telegram_id
    };
    try {
      await sendToMake(RVNW_ANALYSIS_WEBHOOK, payload, btn);
      try { localStorage.setItem('nk_analysis_request', JSON.stringify(Object.fromEntries(fd.entries()))); } catch(_) {}
      toast('Заявка на разбор отправлена ✓');
      setTimeout(() => showScreen('home'), 700);
    } catch (error) {
      console.error('NK analysis webhook error:', error);
      toast('Не удалось отправить. Попробуй ещё раз.');
    }
  });
}

const supportFormLive = document.getElementById('supportForm');
if (supportFormLive) {
  supportFormLive.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supportFormLive.reportValidity()) return;

    const fd = new FormData(supportFormLive);
    const resident = getTelegramResident();
    const btn = supportFormLive.querySelector('button[type="submit"]');

    const payload = {
      type: 'question',
      action: 'question_submit',
      event: 'question_submit',
      source: 'nk_members_miniapp',
      app_version: '42-final-polish',
      submitted_at: new Date().toISOString(),

      resident_name: resident.resident_name || '',
      telegram_id: resident.telegram_id,
      telegram_username: resident.telegram_username,
      telegram_first_name: resident.telegram_first_name,
      telegram_last_name: resident.telegram_last_name,
      telegram_language: resident.telegram_language,

      topic: fd.get('topic') || '',
      message: fd.get('message') || ''
    };

    try {
      await sendToMake(RVNW_QUESTIONS_WEBHOOK, payload, btn);
      toast('Вопрос отправлен команде NK ✓');
      supportFormLive.reset();
    } catch (error) {
      console.error('RVNW support webhook error:', error);
      toast('Не удалось отправить. Попробуй ещё раз.');
    }
  });
}

fillTelegramResidentName();

// V11 — Telegram/iPhone form UX
function applyTelegramUserToTrackingName() {
  const input = document.getElementById('trackingName');
  if (!input) return;

  const tg = window.Telegram?.WebApp;
  const user = tg?.initDataUnsafe?.user;
  if (!user) return;

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  if (fullName && !input.value.trim()) input.value = fullName;
}

function activateFormKeyboardMode(el) {
  document.body.classList.add('form-input-active');

  // Allow keyboard animation to finish, then bring the field above it.
  setTimeout(() => {
    try {
      el.scrollIntoView({behavior:'smooth', block:'center'});
    } catch {}
  }, 260);
}

function deactivateFormKeyboardMode() {
  setTimeout(() => {
    const active = document.activeElement;
    const stillEditing = active && (
      active.matches('input, textarea, select')
    );
    if (!stillEditing) document.body.classList.remove('form-input-active');
  }, 120);
}

// Hide the bottom navigation while any editable form field is active.
// Event delegation also covers forms/screens rendered later.
document.addEventListener('focusin', (event) => {
  const el = event.target;
  if (el?.matches?.('input, textarea, select')) activateFormKeyboardMode(el);
});
document.addEventListener('focusout', (event) => {
  const el = event.target;
  if (el?.matches?.('input, textarea, select')) deactivateFormKeyboardMode();
});

if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();

  // Telegram user data may become available just after initial render.
  applyTelegramUserToTrackingName();
  setTimeout(applyTelegramUserToTrackingName, 150);
  setTimeout(applyTelegramUserToTrackingName, 500);
  setTimeout(applyTelegramUserToTrackingName, 1200);
}

window.addEventListener('resize', () => {
  if (document.activeElement?.matches('input, textarea, select')) {
    document.body.classList.add('form-input-active');
  }
});

// V12 — checkbox interaction safeguard for Telegram iOS
const consentLabel = document.querySelector('.custom-consent');
if (consentLabel) {
  consentLabel.addEventListener('click', (e) => {
    const input = document.getElementById('weeklyCommitment');
    if (!input) return;

    // Browser toggles automatically when label is clicked.
    // This fallback only handles Telegram/iOS cases where label forwarding fails.
    setTimeout(() => {
      consentLabel.classList.toggle('is-checked', input.checked);
    }, 0);
  });

  const input = document.getElementById('weeklyCommitment');
  if (input) {
    input.addEventListener('change', () => {
      consentLabel.classList.toggle('is-checked', input.checked);
    });
  }
}

// V13 — synchronize custom checkbox state on Telegram/iOS
(function(){
  const cb = document.getElementById('weeklyCommitment');
  const label = document.querySelector('.custom-consent');
  if (!cb || !label) return;
  const sync = () => {
    label.classList.toggle('is-checked', !!cb.checked);
    label.setAttribute('aria-checked', cb.checked ? 'true' : 'false');
  };
  cb.addEventListener('change', sync);
  label.addEventListener('pointerup', () => setTimeout(sync, 0));
  label.addEventListener('touchend', () => setTimeout(sync, 0), {passive:true});
  sync();
})();




// V20 — unified editable resident identity / photo / dashboard
const RVNW_LOCAL_PROFILE_KEY = 'rvnwLocalResidentProfile';
const RVNW_PROFILE_PHOTO_KEY = 'rvnwResidentPhoto';

function getLocalResidentProfile() {
  try { return JSON.parse(localStorage.getItem(RVNW_LOCAL_PROFILE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function saveLocalResidentProfile(data) {
  localStorage.setItem(RVNW_LOCAL_PROFILE_KEY, JSON.stringify(data || {}));
}
function getResidentPhoto() {
  try { return localStorage.getItem(RVNW_PROFILE_PHOTO_KEY) || ''; }
  catch { return ''; }
}
function saveResidentPhoto(dataUrl) {
  try { localStorage.setItem(RVNW_PROFILE_PHOTO_KEY, dataUrl || ''); } catch {}
}

// V32 — keep profile photos small enough to sync through Make / Google Sheets.
// The compact data URL becomes a durable photo source for the shared directory.
function compressResidentPhoto(file, maxSize = 220, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('photo_read_failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('photo_decode_failed'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}
function normalizeProfileBoolean(value) {
  if (value === true || value === false) return value;
  const s = String(value ?? '').trim().toLowerCase();
  if (['true','1','yes','да'].includes(s)) return true;
  if (['false','0','no','нет'].includes(s)) return false;
  return undefined;
}

function mergeResidentProfile(serverProfile) {
  // The Google Sheets / Make record is the durable source of truth. Local
  // storage is only a fallback for fields the backend has not returned yet.
  // This makes a resident's profile survive a new ZIP/app version and another
  // device while still protecting freshly typed local data during outages.
  const local = getLocalResidentProfile();
  const server = serverProfile || {};
  const keys = [
    'full_name','role','company','niche','city','website','about','useful','looking',
    'email','telegram_username','phone','promo_code','friend_promo_code'
  ];
  const merged = {...server};
  keys.forEach(key => {
    const serverValue = server[key];
    const hasServerValue = serverValue !== undefined && serverValue !== null && String(serverValue).trim() !== '';
    if (!hasServerValue && local[key] !== undefined && local[key] !== null && String(local[key]).trim() !== '') {
      merged[key] = local[key];
    }
  });

  const serverConsent = normalizeProfileBoolean(server.public_consent);
  const localConsent = normalizeProfileBoolean(local.public_consent);
  if (serverConsent !== undefined) merged.public_consent = serverConsent;
  else if (localConsent !== undefined) merged.public_consent = localConsent;

  return merged;
}

function applyPhotoToElement(el, photo, fallbackText) {
  if (!el) return;
  if (photo) {
    el.style.backgroundImage = `url("${photo}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
    el.classList.add('has-photo');
  } else {
    el.style.backgroundImage = '';
    el.textContent = fallbackText || '—';
    el.classList.remove('has-photo');
  }
}

function syncCustomConsent(label) {
  if (!label) return;
  const input = label.querySelector('input[type="checkbox"]');
  if (!input) return;
  label.classList.toggle('is-checked', !!input.checked);
  label.setAttribute('aria-checked', input.checked ? 'true' : 'false');
}

document.querySelectorAll('.custom-consent').forEach(label => {
  const input = label.querySelector('input[type="checkbox"]');
  if (!input) return;
  const sync = () => syncCustomConsent(label);
  input.addEventListener('change', sync);
  label.addEventListener('pointerup', () => setTimeout(sync, 0));
  label.addEventListener('touchend', () => setTimeout(sync, 0), {passive:true});
  sync();
});

// V19 — live resident profile from Make / Google Sheets
let rvnwProfileRequestInFlight = false;
let rvnwResidentProfile = null;

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// Make/Sheets may return schema/header tokens for an empty field during a new
// resident lookup. Never show those technical names as user-entered values.
function cleanProfileField(value, fieldName='') {
  const text = safeText(value);
  if (!text) return '';
  const normalized = text.toLowerCase().replace(/^@/, '');
  const sentinels = new Set([
    'full_name','telegram_username','telegram_user_name','email','phone',
    'telegram_id','role','company','niche','city','website','about','useful','looking','group_tracking','photo'
  ]);
  if (sentinels.has(normalized) || (fieldName && normalized === String(fieldName).toLowerCase())) return '';
  return text;
}

function parseResidentDate(value) {
  const raw = safeText(value);
  if (!raw) return null;

  // yyyy-mm-dd / ISO
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime()) && /^\d{4}-\d{1,2}-\d{1,2}/.test(raw)) return iso;

  // dd.mm.yyyy / dd/mm/yyyy
  const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  // Google/Excel serial number, if Make returns one
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 100000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(excelEpoch.getTime() + serial * 86400000);
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatResidentDate(value) {
  const d = parseResidentDate(value);
  if (!d) return safeText(value) || '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day:'numeric', month:'long', year:'numeric'
  }).format(d);
}

function daysSince(value) {
  const d = parseResidentDate(value);
  if (!d) return null;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.floor((today - start) / 86400000));
}

function initialsFromName(name) {
  const parts = safeText(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return parts.slice(0,2).map(x => x[0]?.toUpperCase() || '').join('');
}

function normalizeStatus(status) {
  const s = safeText(status).toLowerCase();
  if (['active','активно','активен'].includes(s)) return {label:'АКТИВНО', cls:'active'};
  if (['paused','pause','приостановлено','пауза'].includes(s)) return {label:'ПАУЗА', cls:'paused'};
  if (['inactive','неактивно','не активен','expired'].includes(s)) return {label:'НЕАКТИВНО', cls:'inactive'};
  if (s === 'status') return {label:'НЕ ЗАПОЛНЕНО', cls:'unknown'};
  return {label: s ? s.toUpperCase() : 'НЕ ЗАПОЛНЕНО', cls:'unknown'};
}

function telegramDraftProfile() {
  const tg = getTelegramResident();
  return {
    telegram_id: tg.telegram_id || '',
    telegram_username: tg.telegram_username || '',
    // Prefill the onboarding identity directly from Telegram on first launch.
    full_name: tg.resident_name || '',
    telegram_first_name: tg.telegram_first_name || '',
    membership_type: '',
    status: '',
    join_date: '',
    end_date: '',
    amount: '',
    stripe_customer_id: '',
    promo_code: '',
    friend_promo_code: '',
    friend_promo_uses: '',
    referral_bonus_days: '',
    tracking_status: 'not_submitted',
    _draft: true
  };
}


function transliterateSurname(value) {
  const map = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'i',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
    'х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
  };
  return String(value || '')
    .trim()
    .toLowerCase()
    .split('')
    .map(ch => map[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .toUpperCase();
}

function surnameFromFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '';
  return parts[parts.length - 1];
}

function generatedPromoCodes(fullName) {
  const surname = transliterateSurname(surnameFromFullName(fullName));
  if (!surname) return { promo_code:'', friend_promo_code:'' };
  return { promo_code:surname, friend_promo_code:`${surname}30` };
}

function applyReferralCodes(data) {
  const fullName = safeText(data?.full_name) || safeText(getLocalResidentProfile()?.full_name);
  const generated = generatedPromoCodes(fullName);
  const personal = safeText(data?.promo_code) || generated.promo_code || '—';
  const friend = safeText(data?.friend_promo_code) || generated.friend_promo_code || '—';

  const personalEl = document.getElementById('personalPromoCode');
  const friendEl = document.getElementById('friendPromoCode');
  const personalBtn = document.getElementById('copyPersonalPromo');
  const friendBtn = document.getElementById('copyFriendPromo');

  if (personalEl) personalEl.textContent = personal;
  if (friendEl) friendEl.textContent = friend;
  if (personalBtn) {
    personalBtn.dataset.copy = personal === '—' ? '' : personal;
    personalBtn.disabled = personal === '—';
  }
  if (friendBtn) {
    friendBtn.dataset.copy = friend === '—' ? '' : friend;
    friendBtn.disabled = friend === '—';
  }

  return { promo_code: personal === '—' ? '' : personal, friend_promo_code: friend === '—' ? '' : friend };
}


function applyFriendPromoUsage(data) {
  const raw = Number.parseInt(String(data?.friend_promo_uses ?? '0'), 10);
  const uses = Number.isFinite(raw) ? Math.max(0, Math.min(5, raw)) : 0;
  const label = document.getElementById('friendPromoUsesLabel');
  if (label) label.textContent = `${uses} из 5`;
  const dots = document.querySelectorAll('#friendPromoUsageDots i');
  dots.forEach((dot, index) => dot.classList.toggle('used', index < uses));
}

function normalizeTrackingStatus(value) {
  const raw = safeText(value).toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    '': 'not_submitted',
    'not-submitted': 'not_submitted',
    'not_submitted': 'not_submitted',
    'не_отправлено': 'not_submitted',
    'неотправлено': 'not_submitted',
    'submitted': 'submitted',
    'отправлено': 'submitted',
    'review': 'review',
    'reviewing': 'review',
    'under_review': 'review',
    'рассмотрение': 'review',
    'на_рассмотрении': 'review',
    'approved': 'approved',
    'одобрено': 'approved',
    'scheduled': 'scheduled',
    'назначено': 'scheduled',
    'встреча_назначена': 'scheduled'
  };
  return aliases[raw] || 'not_submitted';
}

function applyTrackingStatus(data) {
  const status = normalizeTrackingStatus(data?.tracking_status);
  const labels = {
    not_submitted: 'Не отправлено',
    submitted: 'Отправлено',
    review: 'На рассмотрении',
    approved: 'Одобрено',
    scheduled: 'Встреча назначена'
  };
  const order = ['submitted','review','approved','scheduled'];
  const currentIndex = order.indexOf(status);
  const text = document.getElementById('trackingStatusText');
  if (text) text.textContent = labels[status];

  document.querySelectorAll('[data-tracking-stage]').forEach((stage, index) => {
    stage.classList.remove('done','active');
    const icon = stage.querySelector('i');
    if (currentIndex >= 0 && index < currentIndex) {
      stage.classList.add('done');
      if (icon) icon.textContent = '✓';
    } else if (currentIndex >= 0 && index === currentIndex) {
      stage.classList.add(status === 'scheduled' ? 'done' : 'active');
      if (icon) icon.textContent = status === 'scheduled' ? '✓' : String(index + 1);
    } else {
      if (icon) icon.textContent = String(index + 1);
    }
  });

  const form = document.getElementById('trackingForm');
  const note = document.getElementById('trackingSubmittedNote');
  const groupNote = document.getElementById('trackingGroupNote');
  const groupName = cleanProfileField(data?.group_tracking, 'group_tracking');
  const alreadySubmitted = status !== 'not_submitted';
  if (form) form.hidden = alreadySubmitted;
  if (note) note.hidden = !alreadySubmitted;
  if (groupNote) {
    const showGroup = alreadySubmitted && Boolean(groupName);
    groupNote.hidden = !showGroup;
    groupNote.textContent = showGroup ? `Вы добавлены в группу: ${groupName}` : '';
  }
}

function normalizeBackendFlag(value) {
  if (value === true) return true;
  const s = safeText(value).toLowerCase();
  return ['true','1','yes','да','accepted','complete','completed'].includes(s);
}

function hydrateActivationStateFromBackend(data) {
  if (!data || typeof data !== 'object') return;

  // Durable legal state: if Make / Google Sheets says the legal package was
  // accepted, restore all six accepted documents locally. This makes the gate
  // survive new ZIP versions, browser cache resets and device changes.
  if (safeText(data.legal_status).toLowerCase() === 'accepted') {
    const legal = getLegalAcceptances();
    const acceptedAt = safeText(data.legal_accepted_at) || new Date().toISOString();
    const version = safeText(data.legal_version) || 'v1';
    RVNW_LEGAL_DOCS.forEach(id => {
      if (!legal[id]) legal[id] = { date: acceptedAt, version };
    });
    localStorage.setItem('rvnwLegalAcceptances', JSON.stringify(legal));
  }

  // Restore onboarding only from durable states that prove it was completed.
  // In this app the legal package is locked until all 5 onboarding steps are done,
  // so an accepted legal package is also reliable proof of completed onboarding.
  // This is intentionally narrow: no UI/default-state/profile-field heuristics.
  const legalAccepted = safeText(data.legal_status).toLowerCase() === 'accepted';
  if (normalizeBackendFlag(data.onboarding_completed) || legalAccepted) {
    const onboarding = getOnboardingProgress();
    RVNW_ONBOARDING_STEPS.forEach(step => {
      if (!onboarding[step]?.completed) {
        onboarding[step] = { completed: true, date: new Date().toISOString(), source: 'backend' };
      }
    });
    saveOnboardingProgress(onboarding);
  }
}

function persistOnboardingCompletionIfNeeded() {
  if (!RVNW_ONBOARDING_WEBHOOK) return;
  const onboarding = getOnboardingProgress();
  const complete = RVNW_ONBOARDING_STEPS.every(step => onboarding[step]?.completed);
  if (!complete) return;

  const resident = getTelegramResident();
  if (!resident.telegram_id) return;
  if (normalizeBackendFlag(rvnwResidentProfile?.onboarding_completed)) return;

  const sentKey = `rvnwOnboardingCompletionSent:${resident.telegram_id}`;
  try { if (localStorage.getItem(sentKey) === '1') return; } catch {}

  fetch(RVNW_ONBOARDING_WEBHOOK, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      action: 'onboarding_complete',
      source: 'rvnw_resident_app',
      telegram_id: resident.telegram_id,
      telegram_username: resident.telegram_username || '',
      onboarding_completed: true,
      completed_at: new Date().toISOString()
    })
  }).then(response => {
    if (!response.ok) throw new Error(`Onboarding webhook returned ${response.status}`);
    try { localStorage.setItem(sentKey, '1'); } catch {}
    if (rvnwResidentProfile) rvnwResidentProfile.onboarding_completed = true;
  }).catch(error => console.error('RVNW onboarding webhook error', error));
}

function applyResidentProfile(profile, {cache=true} = {}) {
  const tg = getTelegramResident();
  const data = profile || {};
  rvnwResidentProfile = data;
  hydrateActivationStateFromBackend(data);

  const officialName = cleanProfileField(data.full_name, 'full_name');
  const telegramFirstName = safeText(tg.telegram_first_name);
  const telegramFullName = safeText(tg.resident_name);
  const displayName = officialName || telegramFullName || telegramFirstName || 'Имя и фамилия';
  const firstName = (officialName || telegramFirstName || '').split(/\s+/).filter(Boolean)[0] || 'Резидент';
  const username = cleanProfileField(data.telegram_username, 'telegram_username') || safeText(tg.telegram_username);

  // Restore the durable profile photo from Google Sheets / Make after a new ZIP
  // or on another device. Supports both data:image/...;base64 and normal URLs.
  const backendPhoto = safeText(data.photo || data.photo_url || data.avatar || data.avatar_url);
  if (backendPhoto && (backendPhoto.startsWith('data:image/') || /^https?:\/\//i.test(backendPhoto))) {
    if (backendPhoto !== getResidentPhoto()) saveResidentPhoto(backendPhoto);
  }
  const photo = getResidentPhoto();

  // Referral codes are derived from the confirmed surname unless the backend
  // already returned an assigned code.
  const referralCodes = applyReferralCodes(data);
  if (!safeText(data.promo_code) && referralCodes.promo_code) data.promo_code = referralCodes.promo_code;
  if (!safeText(data.friend_promo_code) && referralCodes.friend_promo_code) data.friend_promo_code = referralCodes.friend_promo_code;
  applyFriendPromoUsage(data);
  applyTrackingStatus(data);

  // Profile screen
  const title = document.getElementById('profileTitleName');
  const cardName = document.getElementById('profileCardName');
  const avatar = document.getElementById('profileAvatar');
  const subtitle = document.getElementById('profileCardSubtitle');
  const profileCard = document.querySelector('#profile .profile-card');
  if (title) title.textContent = displayName;
  if (cardName) cardName.textContent = displayName;
  applyPhotoToElement(avatar, photo, initialsFromName(displayName));
  if (subtitle) {
    subtitle.textContent = officialName
      ? (username || 'Резидент NK')
      : 'Подтверди данные профиля';
  }
  if (profileCard) profileCard.classList.toggle('is-draft', !officialName);

  // Profile edit form
  const fullNameInput = document.getElementById('profileFullName');
  const emailInput = document.getElementById('profileEmail');
  const telegramInput = document.getElementById('profileTelegram');
  const phoneInput = document.getElementById('profilePhone');
  const photoPreview = document.getElementById('photoPreview');
  const local = getLocalResidentProfile();
  if (fullNameInput && !fullNameInput.matches(':focus')) fullNameInput.value = officialName || telegramFullName || telegramFirstName || '';
  if (emailInput && !emailInput.matches(':focus')) emailInput.value = cleanProfileField(data.email ?? local.email, 'email');
  if (telegramInput && !telegramInput.matches(':focus')) telegramInput.value = username;
  if (phoneInput && !phoneInput.matches(':focus')) phoneInput.value = cleanProfileField(data.phone ?? local.phone, 'phone');
  const fieldMap = {
    profileRole:'role', profileCompany:'company', profileNiche:'niche',
    profileCity:'city', profileWebsite:'website', profileAbout:'about',
    profileUseful:'useful', profileLooking:'looking'
  };
  Object.entries(fieldMap).forEach(([id,key]) => {
    const el = document.getElementById(id);
    if (el && !el.matches(':focus')) el.value = safeText(data[key] ?? local[key]);
  });

  // Reuse profile data in the tracking application so residents do not have
  // to type the same identity/business fields again.
  const trackingFieldMap = {
    trackingName: 'full_name'
  };
  Object.entries(trackingFieldMap).forEach(([id,key]) => {
    const el = document.getElementById(id);
    if (el && !el.matches(':focus')) el.value = safeText(data[key] ?? local[key]) || (key === 'full_name' ? telegramFullName : '');
  });
  const trackingForm = document.getElementById('trackingForm');
  if (trackingForm) {
    ['company','niche','role'].forEach(key => {
      const el = trackingForm.elements.namedItem(key);
      if (el && !el.matches(':focus')) el.value = safeText(data[key] ?? local[key]);
    });
  }

  // Reuse every resident profile field that has a direct equivalent in the
  // personal analysis form. Residents only fill the new business context.
  const analysisForm = document.getElementById('analysisForm');
  if (analysisForm) {
    const analysisPrefill = {
      name: officialName || telegramFullName || telegramFirstName || '',
      telegram: username || '',
      email: cleanProfileField(data.email ?? local.email, 'email'),
      city: safeText(data.city ?? local.city),
      company: safeText(data.company ?? local.company),
      niche: safeText(data.niche ?? local.niche),
      website: safeText(data.website ?? local.website),
      role: safeText(data.role ?? local.role),
      description: safeText(data.about ?? local.about)
    };
    Object.entries(analysisPrefill).forEach(([name,value]) => {
      const el = analysisForm.elements.namedItem(name);
      if (el && !el.matches(':focus') && !safeText(el.value)) el.value = value;
    });
  }
  const publicConsent = document.getElementById('profilePublicConsent');
  if (publicConsent) {
    const localConsent = getLocalResidentProfile().public_consent;
    publicConsent.checked = (normalizeProfileBoolean(data.public_consent) === true || normalizeProfileBoolean(localConsent) === true);
    syncCustomConsent(publicConsent.closest('.custom-consent'));
  }
  applyPhotoToElement(photoPreview, photo, initialsFromName(displayName));

  // Home dashboard + global header
  const homeName = document.getElementById('homeResidentName');
  const homeStatus = document.getElementById('homeMembershipStatus');
  const homeType = document.getElementById('homeMembershipType');
  const headerAvatar = document.getElementById('headerAvatar');
  const headerAvatarText = document.getElementById('headerAvatarText');

  if (homeName) homeName.textContent = firstName;
  const liveStatus = normalizeStatus(data.status);
  if (homeStatus) {
    const statusText = homeStatus.querySelector('span');
    if (statusText) statusText.textContent = liveStatus.label === 'НЕ ЗАПОЛНЕНО' ? 'Не заполнено' : liveStatus.label.charAt(0) + liveStatus.label.slice(1).toLowerCase();
    homeStatus.dataset.status = liveStatus.cls;
  }
  if (homeType) homeType.textContent = 'NK MEMBERS';
  if (headerAvatar) {
    applyPhotoToElement(headerAvatar, photo, initialsFromName(displayName));
    if (headerAvatarText) headerAvatarText.textContent = photo ? '' : initialsFromName(displayName);
  }

  // Compact account screen (opened from the avatar in the top-right corner).
  const accountTitleName = document.getElementById('accountTitleName');
  const accountName = document.getElementById('accountName');
  const accountTelegram = document.getElementById('accountTelegram');
  const accountAvatar = document.getElementById('accountAvatar');
  if (accountTitleName) accountTitleName.textContent = displayName;
  if (accountName) accountName.textContent = displayName;
  if (accountTelegram) accountTelegram.textContent = safeText(data.telegram_username || tg.telegram_username) || 'Telegram не указан';
  applyPhotoToElement(accountAvatar, photo, initialsFromName(displayName));

  // Membership screen
  const membershipType = document.getElementById('membershipType');
  const membershipStatus = document.getElementById('membershipStatus');
  const membershipDays = document.getElementById('membershipDays');
  const membershipJoinDate = document.getElementById('membershipJoinDate');
  const membershipEndDate = document.getElementById('membershipEndDate');
  const note = document.getElementById('membershipDataNote');
  const membershipCard = document.getElementById('membershipCard');
  const manageBtn = document.getElementById('membershipManageBtn');
  const profileMembershipType = document.getElementById('profileMembershipType');
  const profileMembershipStatus = document.getElementById('profileMembershipStatus');
  const profileDaysCount = document.getElementById('profileDaysCount');
  const profileJoinDate = document.getElementById('profileJoinDate');
  const profileEndDate = document.getElementById('profileEndDate');
  const profileMembershipDataNote = document.getElementById('profileMembershipDataNote');
  const profileMembershipCard = document.getElementById('profileMembershipCard');

  const type = safeText(data.membership_type);
  const status = normalizeStatus(data.status);
  const join = safeText(data.join_date);
  const end = safeText(data.end_date);
  const tenure = daysSince(join);

  if (membershipType) membershipType.textContent = 'NK MEMBERS';
  if (membershipStatus) {
    membershipStatus.textContent = status.label;
    membershipStatus.dataset.status = status.cls;
  }
  if (membershipDays) membershipDays.textContent = tenure === null ? '—' : String(tenure);
  if (membershipJoinDate) membershipJoinDate.textContent = join ? formatResidentDate(join) : '—';
  if (membershipEndDate) membershipEndDate.textContent = end ? formatResidentDate(end) : '—';
  const subscriptionNextCharge = document.getElementById('subscriptionNextCharge');
  if (subscriptionNextCharge) subscriptionNextCharge.textContent = end ? formatResidentDate(end) : 'По окончании оплаченного периода';
  if (profileMembershipType) profileMembershipType.textContent = 'NK MEMBERS';
  if (profileMembershipStatus) {
    profileMembershipStatus.textContent = status.label;
    profileMembershipStatus.dataset.status = status.cls;
  }
  if (profileDaysCount) profileDaysCount.textContent = tenure === null ? '—' : String(tenure);
  if (profileJoinDate) profileJoinDate.textContent = join ? formatResidentDate(join) : '—';
  if (profileEndDate) profileEndDate.textContent = end ? formatResidentDate(end) : '—';

  const hasMembership = Boolean(type || data.status || join || end);
  if (membershipCard) membershipCard.classList.toggle('is-unconfigured', !hasMembership);
  if (profileMembershipCard) profileMembershipCard.classList.toggle('is-unconfigured', !hasMembership);
  if (profileMembershipDataNote) {
    if (!hasMembership) {
      profileMembershipDataNote.hidden = false;
      profileMembershipDataNote.textContent = officialName
        ? 'Профиль найден. Данные резидентства пока не заполнены в базе NK.'
        : 'Профиль пока не найден в базе NK.';
    } else {
      profileMembershipDataNote.hidden = true;
      profileMembershipDataNote.textContent = '';
    }
  }

  if (note) {
    if (!hasMembership) {
      note.hidden = false;
      note.textContent = officialName
        ? 'Профиль найден. Данные резидентства пока не заполнены в базе RVNW.'
        : 'Мы определили твой Telegram. Подтверди профиль — данные резидентства появятся здесь автоматически.';
    } else {
      note.hidden = true;
      note.textContent = '';
    }
  }

  if (manageBtn) {
    // The Make webhook resolves the current resident by Telegram ID and returns/redirects to Stripe Customer Portal.
    manageBtn.disabled = !safeText(getTelegramResident().telegram_id);
    manageBtn.title = manageBtn.disabled ? 'Открой приложение внутри Telegram, чтобы управлять подпиской' : '';
  }

  if (cache) {
    try { localStorage.setItem('rvnwResidentProfile', JSON.stringify(data)); } catch {}
  }
  refreshLegalAcceptances();
  refreshActivationProgress();
}

async function parseMakeProfileResponse(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    console.warn('RVNW profile response is not JSON:', text);
    return null;
  }
}

function clearResidentFormsAfterRemoval() {
  const ids = [
    'profileFullName','profileRole','profileCompany','profileNiche','profileCity',
    'profileWebsite','profileAbout','profileUseful','profileLooking','profileEmail',
    'profileTelegram','profilePhone'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const consent = document.getElementById('profilePublicConsent');
  if (consent) consent.checked = false;
  const photoPreview = document.getElementById('photoPreview');
  if (photoPreview) { photoPreview.innerHTML = ''; photoPreview.textContent = '—'; }
  const photoInput = document.getElementById('photoInput');
  if (photoInput) photoInput.value = '';
}

function resetResidentAccessAfterBackendRemoval() {
  const resident = getTelegramResident();
  // A missing resident row is a hard access reset. Remove every local marker
  // that could make onboarding or legal acceptance look completed again.
  try {
    const exactKeys = [
      'rvnwResidentProfile', RVNW_LOCAL_PROFILE_KEY, RVNW_PROFILE_PHOTO_KEY,
      'rvnwOnboardingProgress', 'rvnwLegalAcceptances', 'rvnwResidentDirectory',
      'rvnwCourseProgress', 'nk_analysis_request', 'rvnwTrackingDraft', 'rvnwQuestionsDraft'
    ];
    exactKeys.forEach(key => localStorage.removeItem(key));
    const removePrefixes = ['rvnwOnboardingCompletionSent:', 'rvnwLegal', 'rvnwOnboarding'];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i) || '';
      if (removePrefixes.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key);
    }
  } catch {}
  historyStack.splice(0, historyStack.length, 'home');
  rvnwDirectoryMembers = [];
  rvnwDirectoryLoaded = false;
  rvnwResidentProfile = null;
  const profileEditorOpen = document.getElementById('profile-edit')?.classList.contains('active');
  // If a slow backend lookup finishes while the resident is already typing,
  // never wipe the form underneath their fingers. The access state is still
  // reset; only the currently typed, unsaved UI values are left intact.
  if (!(profileEditorOpen && profileEditorDirty)) {
    clearResidentFormsAfterRemoval();
    const draft = telegramDraftProfile();
    applyResidentProfile(draft, {cache:false});
  }
  const draft = telegramDraftProfile();
  refreshActivationProgress();
  // Important: backend cleanup must NEVER navigate the resident away from the
  // screen they intentionally opened. Access state is reset here; navigation
  // happens only after an explicit user action.
  return draft;
}

async function requestResidentProfile() {
  if (!RVNW_PROFILE_WEBHOOK || rvnwProfileRequestInFlight) return rvnwResidentProfile;
  const resident = getTelegramResident();

  // Always show Telegram identity immediately, before network response.
  if (!rvnwResidentProfile) applyResidentProfile(telegramDraftProfile(), {cache:false});

  if (!resident.telegram_id) return rvnwResidentProfile;

  rvnwProfileRequestInFlight = true;
  try {
    const response = await fetch(RVNW_PROFILE_WEBHOOK, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        action: 'resident_profile_lookup',
        source: 'nk_membership',
        telegram_id: resident.telegram_id,
        telegram_username: resident.telegram_username,
        telegram_first_name: resident.telegram_first_name,
        telegram_last_name: resident.telegram_last_name,
        telegram_language: resident.telegram_language,
        resident_name: resident.resident_name
      })
    });

    if (!response.ok) throw new Error(`Profile webhook returned ${response.status}`);

    const profile = await parseMakeProfileResponse(response);
    if (profile && typeof profile === 'object') {
      const explicitlyMissing = profile.found === false || profile.exists === false ||
        profile.not_found === true || safeText(profile.status).toLowerCase() === 'not_found';
      const backendTelegramId = cleanProfileField(profile.telegram_id, 'telegram_id');
      const idMatches = Boolean(backendTelegramId && backendTelegramId === resident.telegram_id);
      const meaningfulFields = [
        ['full_name','full_name'], ['email','email'], ['company','company'],
        ['role','role'], ['niche','niche'], ['city','city'], ['photo','photo']
      ];
      const hasMeaningfulResidentData = meaningfulFields.some(([key,name]) =>
        Boolean(cleanProfileField(profile[key], name))
      );
      // Search Rows can return header/schema tokens when no row was found.
      // Never treat those placeholders as a resident. The Telegram ID must
      // match the requested resident, and at least one real profile field must exist.
      const backendHasResident = !explicitlyMissing && idMatches && hasMeaningfulResidentData;
      if (!backendHasResident) {
        return resetResidentAccessAfterBackendRemoval();
      }
      const mergedProfile = mergeResidentProfile(profile);
      applyResidentProfile(mergedProfile);
      return mergedProfile;
    }

    // Empty successful response means the resident is no longer in the source table.
    return resetResidentAccessAfterBackendRemoval();
  } catch (error) {
    console.error('RVNW profile webhook error', error);
    return rvnwResidentProfile;
  } finally {
    rvnwProfileRequestInFlight = false;
  }
}

// Restore last known profile immediately to avoid flashes of demo data.
try {
  const cached = JSON.parse(localStorage.getItem('rvnwResidentProfile') || 'null');
  if (cached) applyResidentProfile(mergeResidentProfile(cached), {cache:false});
  else applyResidentProfile(mergeResidentProfile(telegramDraftProfile()), {cache:false});
} catch {
  applyResidentProfile(mergeResidentProfile(telegramDraftProfile()), {cache:false});
}

// Refresh profile both for membership and profile screens.
document.querySelectorAll('[data-go="account"], [data-go="membership"], [data-go="profile"], [data-go="tracking"]').forEach(el => {
  el.addEventListener('click', requestResidentProfile);
});

// Bootstrap once after Telegram WebApp initializes. Wait for the backend lookup
// before deriving onboarding state so stale cached data cannot briefly mark steps
// complete or redirect/reset the UI while the resident is using it.
setTimeout(async () => {
  await requestResidentProfile();
  syncProfileOnboardingCompletion();
  refreshActivationProgress();
}, 300);



// V22 — mobile keyboard flow.
// Enter/"Next" on one-line inputs moves to the next input. On the last input it closes the keyboard.
// Textareas keep normal Enter for multi-line answers.
const RVNW_PROFILE_INPUT_FLOW = [
  'profileFullName','profileRole','profileCompany','profileNiche',
  'profileCity','profileWebsite','profileEmail','profileTelegram','profilePhone'
];

function focusNextProfileInput(currentId) {
  const idx = RVNW_PROFILE_INPUT_FLOW.indexOf(currentId);
  if (idx < 0) return;
  const nextId = RVNW_PROFILE_INPUT_FLOW[idx + 1];
  if (nextId) {
    const next = document.getElementById(nextId);
    if (next) {
      next.focus({preventScroll:true});
      setTimeout(() => next.scrollIntoView({behavior:'smooth', block:'center'}), 80);
    }
  } else {
    document.activeElement?.blur();
  }
}

RVNW_PROFILE_INPUT_FLOW.forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusNextProfileInput(id);
    }
  });
});

// Tapping outside form controls closes the iOS keyboard.
document.addEventListener('pointerdown', e => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (target.closest('input, textarea, select, button, label')) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();
});

// V20 — photo persists across profile / header / current device.
const rvnwPhotoInput = document.getElementById('photoInput');
if (rvnwPhotoInput) {
  rvnwPhotoInput.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Выбери изображение');
      return;
    }
    compressResidentPhoto(file).then(photo => {
      saveResidentPhoto(photo);

      // Important: do NOT call applyResidentProfile() here.
      // The user may have already filled the form but not saved it yet.
      // Re-applying the resident profile would overwrite those unsaved values.
      const currentName =
        safeText(document.getElementById('profileFullName')?.value) ||
        safeText(rvnwResidentProfile?.full_name) ||
        safeText(getTelegramResident()?.resident_name) ||
        safeText(getTelegramResident()?.telegram_first_name) ||
        'Резидент';

      applyPhotoToElement(document.getElementById('photoPreview'), photo, initialsFromName(currentName));
      applyPhotoToElement(document.getElementById('profileAvatar'), photo, initialsFromName(currentName));
      applyPhotoToElement(document.getElementById('headerAvatar'), photo, initialsFromName(currentName));

      const headerAvatarText = document.getElementById('headerAvatarText');
      if (headerAvatarText) headerAvatarText.textContent = '';

      setTimeout(() => syncProfileOnboardingCompletion(), 0);
    }).catch(error => {
      console.error('RVNW photo compression error:', error);
      toast('Не удалось обработать фотографию');
    });
  });
}


const RVNW_PROFILE_REQUIRED_IDS = [
  'profileFullName','profileRole','profileCompany','profileNiche','profileCity',
  'profileAbout','profileUseful','profileEmail','profileTelegram','profilePhone'
];
RVNW_PROFILE_REQUIRED_IDS.forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    const complete = isResidentProfileComplete();
    if (!complete && getOnboardingProgress().profile?.completed) {
      setOnboardingStepState('profile', false);
      refreshActivationProgress();
    }
  });
});

const rvnwProfileForm = document.getElementById('profileForm');
if (rvnwProfileForm) {
  rvnwProfileForm.addEventListener('input', () => { profileEditorDirty = true; });
  rvnwProfileForm.addEventListener('change', () => { profileEditorDirty = true; });
  rvnwProfileForm.addEventListener('submit', async e => {
    e.preventDefault();

    // Native required validation for every text field.
    if (!rvnwProfileForm.reportValidity()) {
      setOnboardingStepState('profile', false);
      refreshActivationProgress();
      toast('Заполни все обязательные поля');
      return;
    }

    const consentInput = document.getElementById('profilePublicConsent');
    if (!consentInput?.checked) {
      setOnboardingStepState('profile', false);
      refreshActivationProgress();
      const consentLabel = consentInput?.closest('.custom-consent');
      if (consentLabel) {
        consentLabel.classList.add('required-error');
        consentLabel.scrollIntoView({behavior:'smooth', block:'center'});
        setTimeout(() => consentLabel.classList.remove('required-error'), 1800);
      }
      toast('Нужно разрешить показ карточки другим резидентам');
      return;
    }

    // Photo is an equally mandatory part of the resident card.
    if (!getResidentPhoto()) {
      setOnboardingStepState('profile', false);
      refreshActivationProgress();
      const upload = document.getElementById('profilePhotoUpload');
      if (upload) {
        upload.classList.add('required-error');
        upload.scrollIntoView({behavior:'smooth', block:'center'});
        setTimeout(() => upload.classList.remove('required-error'), 1800);
      }
      toast('Добавь фотографию профиля');
      return;
    }

    const current = mergeResidentProfile(rvnwResidentProfile || telegramDraftProfile());
    const local = {
      ...getLocalResidentProfile(),
      full_name: safeText(document.getElementById('profileFullName')?.value),
      role: safeText(document.getElementById('profileRole')?.value),
      company: safeText(document.getElementById('profileCompany')?.value),
      niche: safeText(document.getElementById('profileNiche')?.value),
      city: safeText(document.getElementById('profileCity')?.value),
      website: safeText(document.getElementById('profileWebsite')?.value),
      about: safeText(document.getElementById('profileAbout')?.value),
      useful: safeText(document.getElementById('profileUseful')?.value),
      looking: safeText(document.getElementById('profileLooking')?.value),
      email: safeText(document.getElementById('profileEmail')?.value).toLowerCase(),
      telegram_username: safeText(document.getElementById('profileTelegram')?.value),
      phone: safeText(document.getElementById('profilePhone')?.value),
      public_consent: !!document.getElementById('profilePublicConsent')?.checked
    };
    const previouslySaved = !!getLocalResidentProfile().__profile_saved_once;
    const promo = generatedPromoCodes(local.full_name);
    const savedLocal = {
      ...local,
      ...promo,
      __profile_saved_once: true
    };
    saveLocalResidentProfile(savedLocal);

    // Persist the resident card to Make. Local saving remains immediate so a
    // temporary network issue never destroys what the resident just entered.
    const telegramResident = getTelegramResident();
    const savePayload = {
      telegram_id: telegramResident.telegram_id,
      telegram_username: local.telegram_username || telegramResident.telegram_username,
      phone: local.phone,
      telegram_first_name: telegramResident.telegram_first_name,
      telegram_last_name: telegramResident.telegram_last_name,
      full_name: local.full_name,
      role: local.role,
      company: local.company,
      niche: local.niche,
      city: local.city,
      website: local.website,
      about: local.about,
      useful: local.useful,
      looking: local.looking,
      email: local.email,
      public_consent: local.public_consent,
      personal_promo_code: promo.promo_code || promo.personal_promo_code || promo.personalPromo || '',
      friend_promo_code: promo.friend_promo_code || promo.friendPromo || '',
      photo_present: !!getResidentPhoto(),
      photo: getResidentPhoto(),
      source: 'nk_members_miniapp'
    };
    const submitButton = rvnwProfileForm.querySelector('button[type="submit"]');
    try {
      await sendToMake(RVNW_PROFILE_SAVE_WEBHOOK, savePayload, submitButton);
    } catch (error) {
      console.error('RVNW profile save webhook error:', error);
      toast('Профиль сохранён на устройстве. Синхронизация повторится позже.');
    }

    const updated = {...current, ...savedLocal, _draft:false};
    applyResidentProfile(updated);
    profileEditorDirty = false;

    // Only now is the onboarding profile step allowed to complete.
    syncProfileOnboardingCompletion({showToast:false});

    // During first onboarding save, return to the checklist so the resident
    // immediately continues with step 2. Later edits return to the compact account.
    if (historyStack[historyStack.length - 1] === 'profile-edit') historyStack.pop();
    const destination = previouslySaved ? 'account' : 'onboarding';
    if (historyStack[historyStack.length - 1] !== destination) historyStack.push(destination);
    showScreen(destination, false);

    setTimeout(() => toast(previouslySaved ? 'Профиль обновлён ✓' : 'Профиль сохранён — переходи к шагу 2 ✓'), 120);
  });
}



document.getElementById('profileMembershipManageBtn')?.addEventListener('click', () => {
  historyStack.push('membership');
  showScreen('membership', false);
  setTimeout(openSubscriptionPanel, 80);
});

// V31 — live resident directory from Make / Google Sheets
const RVNW_MEMBERS_WEBHOOK = window.RVNW_CONFIG?.makeMembersWebhookUrl || '';
let rvnwDirectoryMembers = [];
let rvnwDirectoryLoaded = false;
let rvnwDirectoryRequestInFlight = false;
let rvnwSelectedDirectoryMember = null;

function directoryBool(value) {
  if (typeof normalizeProfileBoolean === 'function') return normalizeProfileBoolean(value) === true;
  if (value === true || value === 1) return true;
  return ['true','1','yes','да'].includes(String(value ?? '').trim().toLowerCase());
}


function normalizeDirectoryWebsite(value) {
  const v = safeText(value).trim();
  if (!v || ['нет','no','none','null','n/a','-','—'].includes(v.toLowerCase())) return '';
  // A website must look like a domain or an explicit http(s) URL. This prevents
  // free-text values such as "Нет" from being converted into random punycode URLs.
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[\/:?#].*)?$/i.test(v)) return v;
  return '';
}

function directoryPhotoFor(member) {
  if (member?.photo) return member.photo;
  const current = getTelegramResident();
  const sameId = member?.telegram_id && current.telegram_id && String(member.telegram_id) === String(current.telegram_id);
  const sameUsername = member?.telegram_username && current.telegram_username && member.telegram_username.toLowerCase() === current.telegram_username.replace(/^@/, '').toLowerCase();
  return (sameId || sameUsername) ? getResidentPhoto() : '';
}

function normalizeDirectoryMember(raw = {}) {
  return {
    telegram_id: safeText(raw.telegram_id),
    telegram_username: safeText(raw.telegram_username).replace(/^@/, ''),
    full_name: safeText(raw.full_name),
    role: safeText(raw.role),
    company: safeText(raw.company),
    niche: safeText(raw.niche),
    city: safeText(raw.city),
    website: normalizeDirectoryWebsite(raw.website),
    photo: safeText(raw.photo || raw.photo_url || raw.avatar || raw.avatar_url),
    about: safeText(raw.about),
    useful: safeText(raw.useful),
    looking: safeText(raw.looking),
    public_consent: raw.public_consent
  };
}

function directoryMemberVisible(member) {
  // Make/Google Sheets already applies the public_consent filter before this
  // payload reaches the mini-app. The directory response intentionally does
  // not need to expose the consent flag itself, so trust the server-filtered
  // list and only require a display name here.
  return Boolean(member.full_name);
}

function directoryMeta(member) {
  return [member.niche, member.city].filter(Boolean).join(' · ') || member.company || 'Резидент NK';
}

function directoryRole(member) {
  return [member.role, member.company].filter(Boolean).join(', ') || 'Резидент NK';
}

function directorySearchText(member) {
  return [member.full_name, member.role, member.company, member.niche, member.city, member.useful, member.looking]
    .join(' ').toLowerCase();
}

function renderResidentDirectory(query = '') {
  const list = document.getElementById('membersList');
  const count = document.getElementById('membersCount');
  if (!list) return;
  const needle = safeText(query).toLowerCase();
  const allVisible = rvnwDirectoryMembers.filter(directoryMemberVisible);
  const current = getTelegramResident();
  const currentUsername = safeText(current.telegram_username).replace(/^@/, '').toLowerCase();
  const isCurrentMember = (member) => {
    const sameId = member.telegram_id && current.telegram_id && String(member.telegram_id) === String(current.telegram_id);
    const sameUsername = member.telegram_username && currentUsername && member.telegram_username.toLowerCase() === currentUsername;
    return Boolean(sameId || sameUsername);
  };

  const matching = allVisible.filter(member => !needle || directorySearchText(member).includes(needle));
  const myMember = matching.find(isCurrentMember) || (!needle ? allVisible.find(isCurrentMember) : null);
  const others = matching.filter(member => !isCurrentMember(member));
  const visible = myMember ? [myMember, ...others] : others;

  if (count) {
    const total = allVisible.length;
    count.textContent = needle ? `Найдено: ${visible.length} из ${total}` : `Резидентов в каталоге: ${total}`;
  }

  if (!visible.length) {
    list.innerHTML = `<div class="members-state">${needle ? 'По этому запросу никого не нашли.' : 'В каталоге пока нет опубликованных профилей.'}</div>`;
    return;
  }

  list.innerHTML = visible.map((member, index) => {
    const initials = initialsFromName(member.full_name || 'RV');
    const useful = member.useful ? `Может помочь: ${member.useful}` : directoryRole(member);
    const mine = isCurrentMember(member);
    const sectionLabel = mine && !needle
      ? `<div class="directory-section-label directory-my-label">МОЯ КАРТОЧКА</div>`
      : (!mine && !needle && myMember && index === 1 ? `<div class="directory-section-label">ВСЕ РЕЗИДЕНТЫ</div>` : '');
    return `${sectionLabel}<article class="member-card${mine ? ' member-card--mine' : ''}" data-directory-index="${index}">
      <div class="member-avatar" data-member-avatar="${index}">${initials}</div>
      <div><strong>${escapeHtml(member.full_name)}</strong><span>${escapeHtml(directoryMeta(member))}</span><small>${escapeHtml(useful)}</small></div>
      <button type="button" aria-label="Открыть профиль">→</button>
    </article>`;
  }).join('');

  // Apply profile photos when the directory payload contains one; for the current
  // resident we can also reuse the locally stored profile photo.
  visible.forEach((member, index) => applyPhotoToElement(list.querySelector(`[data-member-avatar=\"${index}\"]`), directoryPhotoFor(member), initialsFromName(member.full_name || 'RV')));

  // Indexes above are relative to the filtered array, so keep it for click resolution.
  list._rvnwFilteredMembers = visible;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function openDirectoryMember(member) {
  if (!member) return;
  rvnwSelectedDirectoryMember = member;
  const setText = (id, value, fallback='—') => {
    const el = document.getElementById(id);
    if (el) el.textContent = safeText(value) || fallback;
  };
  const detailAvatar = document.getElementById('directoryMemberAvatar');
  applyPhotoToElement(detailAvatar, directoryPhotoFor(member), initialsFromName(member.full_name || 'RV'));
  setText('directoryMemberName', member.full_name, 'Резидент NK');
  setText('directoryMemberRole', directoryRole(member));
  setText('directoryMemberMeta', directoryMeta(member));
  setText('directoryMemberAbout', member.about);
  setText('directoryMemberUseful', member.useful);
  setText('directoryMemberLooking', member.looking);

  [['directoryAboutSection', member.about], ['directoryUsefulSection', member.useful], ['directoryLookingSection', member.looking]].forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !safeText(value);
  });

  const tgBtn = document.getElementById('directoryTelegramBtn');
  if (tgBtn) {
    tgBtn.disabled = !member.telegram_username;
    tgBtn.textContent = member.telegram_username ? `Написать @${member.telegram_username}` : 'Telegram не указан';
  }
  const siteBtn = document.getElementById('directoryWebsiteBtn');
  if (siteBtn) {
    siteBtn.hidden = !member.website;
  }
  showScreen('member-detail');
}

async function fetchResidentDirectory({force=false} = {}) {
  if (rvnwDirectoryRequestInFlight) return;
  const list = document.getElementById('membersList');
  const count = document.getElementById('membersCount');

  if (!RVNW_MEMBERS_WEBHOOK) {
    if (list) list.innerHTML = '<div class="members-state">Каталог почти готов. Осталось подключить адрес Make.</div>';
    if (count) count.textContent = 'Каталог не подключён';
    return;
  }
  if (rvnwDirectoryLoaded && !force) {
    renderResidentDirectory(document.getElementById('membersSearch')?.value || '');
    return;
  }

  rvnwDirectoryRequestInFlight = true;
  if (list) list.innerHTML = '<div class="members-state">Загружаем резидентов…</div>';
  if (count) count.textContent = 'Обновляем каталог…';
  try {
    const resident = getTelegramResident();
    const response = await fetch(RVNW_MEMBERS_WEBHOOK, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        action:'resident_directory',
        source:'nk_members_miniapp',
        telegram_id:resident.telegram_id
      })
    });
    if (!response.ok) throw new Error(`Directory webhook returned ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (Array.isArray(payload?.residents) ? payload.residents : (Array.isArray(payload?.members) ? payload.members : []));
    rvnwDirectoryMembers = rows.map(normalizeDirectoryMember);
    rvnwDirectoryLoaded = true;
    try { localStorage.setItem('rvnwResidentDirectory', JSON.stringify(rvnwDirectoryMembers)); } catch {}
    renderResidentDirectory(document.getElementById('membersSearch')?.value || '');
  } catch (error) {
    console.error('RVNW directory webhook error', error);
    let cached = [];
    try { cached = JSON.parse(localStorage.getItem('rvnwResidentDirectory') || '[]'); } catch {}
    if (Array.isArray(cached) && cached.length) {
      rvnwDirectoryMembers = cached.map(normalizeDirectoryMember);
      renderResidentDirectory(document.getElementById('membersSearch')?.value || '');
      if (count) count.textContent += ' · сохранённая версия';
    } else {
      if (list) list.innerHTML = '<div class="members-state">Не удалось загрузить каталог. Попробуй ещё раз.</div>';
      if (count) count.textContent = 'Ошибка загрузки';
    }
  } finally {
    rvnwDirectoryRequestInFlight = false;
  }
}

document.querySelectorAll('[data-go="members"]').forEach(el => {
  el.addEventListener('click', () => fetchResidentDirectory());
});

document.getElementById('membersSearch')?.addEventListener('input', event => {
  renderResidentDirectory(event.target.value);
});

document.getElementById('membersRefresh')?.addEventListener('click', () => fetchResidentDirectory({force:true}));

document.getElementById('membersList')?.addEventListener('click', event => {
  const card = event.target.closest('[data-directory-index]');
  if (!card) return;
  const filtered = event.currentTarget._rvnwFilteredMembers || [];
  openDirectoryMember(filtered[Number(card.dataset.directoryIndex)]);
});

document.getElementById('directoryTelegramBtn')?.addEventListener('click', () => {
  const username = rvnwSelectedDirectoryMember?.telegram_username;
  if (!username) return;
  window.open(`https://t.me/${encodeURIComponent(username)}`, '_blank');
});

document.getElementById('directoryWebsiteBtn')?.addEventListener('click', () => {
  let url = safeText(rvnwSelectedDirectoryMember?.website);
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  window.open(url, '_blank');
});

// NK combined legal package acceptance + local PDF documents.
(() => {
  const check = document.getElementById('nkLegalPackageCheck');
  const btn = document.getElementById('nkLegalPackageBtn');

  const syncLegalButton = () => {
    const legal = getLegalAcceptances();
    const accepted = Boolean(legal['nk-legal-package']);
    if (accepted) {
      if (check) { check.checked = true; check.disabled = true; }
      if (btn) { btn.textContent = 'Документы подтверждены ✓'; btn.disabled = true; }
    } else if (btn && check) {
      btn.disabled = !check.checked;
    }
  };

  if (check && btn) {
    check.addEventListener('change', () => { btn.disabled = !check.checked; });
    btn.addEventListener('click', () => {
      const legal = getLegalAcceptances();
      legal['nk-legal-package'] = { date: new Date().toISOString(), version: 'v1' };
      localStorage.setItem('rvnwLegalAcceptances', JSON.stringify(legal));
      syncLegalButton();
      refreshActivationProgress();

      const resident = getTelegramResident();
      if (RVNW_LEGAL_WEBHOOK && resident.telegram_id) {
        fetch(RVNW_LEGAL_WEBHOOK, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            action: 'legal_accepted',
            telegram_id: resident.telegram_id,
            telegram_username: resident.telegram_username || '',
            legal_status: 'accepted',
            legal_version: 'v1',
            legal_accepted_at: new Date().toISOString()
          })
        }).catch(error => console.error('NK legal webhook error', error));
      }
      toast('Документы подтверждены ✓');
      setTimeout(() => showScreen('home'), 250);
    });
  }

  document.querySelectorAll('[data-doc-pdf]').forEach(row => row.addEventListener('click', () => {
    const pdf = row.dataset.docPdf;
    const title = row.dataset.docPreview || 'Документ';
    const frame = document.getElementById('legalDocFrame');
    const heading = document.getElementById('legalDocTitle');
    if (frame && pdf) frame.src = pdf + '#toolbar=0&navpanes=0&view=FitH';
    if (heading) heading.textContent = title;
    showScreen('legal-doc-viewer');
  }));

  syncLegalButton();
})();


// V46 — AVITO Zoom recording. Kept isolated from the rest of the app.
(() => {
  const recordingUrl = 'https://us06web.zoom.us/rec/share/kbk68eBWJVyO79gNtsq5f0wKVHMu5lDMved84WgR_MjzEeW5bFiSZiVchvo39HE7.PZTs1Kzm3wmFMrzZ?startTime=1786978687000';
  const accessCode = 'dkxx^c0!';
  const openBtn = document.getElementById('avitoRecordingOpen');
  const copyBtn = document.getElementById('avitoCopyCode');
  const watchedBtn = document.getElementById('avitoWatchedToggle');
  const watchedBadge = document.getElementById('avitoWatchedBadge');
  const watchedKey = 'nk_avito_recording_watched';

  const syncWatched = () => {
    const watched = localStorage.getItem(watchedKey) === '1';
    if (watchedBtn) {
      watchedBtn.classList.toggle('is-watched', watched);
      watchedBtn.textContent = watched ? '✓ Просмотрено' : 'Отметить как просмотрено';
    }
    if (watchedBadge) watchedBadge.hidden = !watched;
  };
  syncWatched();

  watchedBtn?.addEventListener('click', () => {
    const watched = localStorage.getItem(watchedKey) === '1';
    if (watched) localStorage.removeItem(watchedKey);
    else localStorage.setItem(watchedKey, '1');
    syncWatched();
  });

  openBtn?.addEventListener('click', () => {
    if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(recordingUrl);
    else window.open(recordingUrl, '_blank');
  });

  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(accessCode);
      toast('Код доступа скопирован');
    } catch {
      const area = document.createElement('textarea');
      area.value = accessCode;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); toast('Код доступа скопирован'); }
      catch { toast(`Код доступа: ${accessCode}`); }
      area.remove();
    }
  });
})();
