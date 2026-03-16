import { supabase, getAuthHeader, getFunctionsBaseUrl } from './glp-supabase-client.js';
import { EVENTS } from './event-taxonomy.js';

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function ensureProfile() {
  const { data: userResp, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userResp.user;
  if (!user) return null;

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
}

export async function logEvent(eventName, metadata = {}, pageName = window.location.pathname.split('/').pop() || '') {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id ?? null;
  const sessionId = sessionStorage.getItem('glp_app_session_id');
  const payload = { user_id: userId, session_id: sessionId, event_name: eventName, page_name: pageName, metadata };
  const { error } = await supabase.from('usage_events').insert(payload);
  if (error) console.error('usage_events insert failed', error);
}

export async function startAppSession({ platform = 'web', appVersion = 'tier1', userAgent = navigator.userAgent } = {}) {
  const existing = sessionStorage.getItem('glp_app_session_id');
  if (existing) return existing;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id ?? null;
  const { data, error } = await supabase
    .from('app_sessions')
    .insert({ user_id: userId, platform, app_version: appVersion, user_agent: userAgent })
    .select('id')
    .single();

  if (error) throw error;
  sessionStorage.setItem('glp_app_session_id', data.id);
  return data.id;
}

export async function completeOnboarding(payload) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const user = authData.user;
  if (!user) throw new Error('No authenticated user');

  const settingsPayload = {
    user_id: user.id,
    theme: payload.theme || 'sage',
    water_glass_ml: 200,
    contrast_mode: payload.contrastMode || 'standard',
  };

  const onboardingPayload = {
    user_id: user.id,
    current_weight_kg: payload.currentWeightKg,
    target_weight_kg: payload.targetWeightKg ?? null,
    dietary_style: payload.dietaryStyle ?? null,
    selected_proteins: payload.selectedProteins ?? [],
    selected_vegetables: payload.selectedVegetables ?? [],
    notes: payload.notes ?? null,
    completed_at: new Date().toISOString(),
  };

  const profilePatch = {
    id: user.id,
    display_name: payload.displayName ?? null,
    sex: payload.sex ?? null,
    height_cm: payload.heightCm ?? null,
    current_theme: payload.theme || 'sage',
    onboarding_complete: true,
    install_date: new Date().toISOString().slice(0, 10),
  };

  const mealPrefsPayload = {
    user_id: user.id,
    dietary_style: payload.dietaryStyle ?? null,
    proteins: payload.selectedProteins ?? [],
    vegetables: payload.selectedVegetables ?? [],
    fat_rules: payload.fatRules ?? {
      oils_max_tbsp: 1,
      peanut_butter_max_tbsp: 1,
      tahini_max_tbsp: 1,
      avocado_portion: '1/2 medium avocado',
    },
    starch_rules: payload.starchRules ?? { max_starch_servings_per_day: 1 },
    breakfast_rules: payload.breakfastRules ?? { required: true },
  };

  const [settingsRes, profileRes, onboardingRes, mealPrefsRes] = await Promise.all([
    supabase.from('user_settings').upsert(settingsPayload),
    supabase.from('profiles').upsert(profilePatch),
    supabase.from('onboarding_responses').upsert(onboardingPayload),
    supabase.from('meal_preferences').upsert(mealPrefsPayload),
  ]);

  for (const res of [settingsRes, profileRes, onboardingRes, mealPrefsRes]) {
    if (res.error) throw res.error;
  }

  await logEvent(EVENTS.ONBOARDING_COMPLETED, { theme: payload.theme || 'sage' }, 'onboarding.html');
}

export async function saveSettings(patch) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error('No authenticated user');
  const { error } = await supabase.from('user_settings').upsert({ user_id: user.id, ...patch });
  if (error) throw error;
  if (patch.theme) {
    await supabase.from('profiles').upsert({ id: user.id, current_theme: String(patch.theme).replace(/^theme-/, '') });
  }
  await logEvent(EVENTS.SETTINGS_SAVED, patch, 'settings.html');
}

export async function saveWeight(weightKg, source = 'manual', notes = null) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error('No authenticated user');
  const { error } = await supabase.from('weight_logs').insert({ user_id: user.id, weight_kg: weightKg, source, notes });
  if (error) throw error;
  await logEvent(EVENTS.WEIGHT_LOGGED, { weightKg, source }, 'index.html');
}

export async function saveDailyCheckin(checkin) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error('No authenticated user');

  const payload = {
    user_id: user.id,
    checkin_date: checkin.checkinDate || todayDate(),
    mood_state: checkin.moodState ?? null,
    energy_state: checkin.energyState ?? null,
    appetite_state: checkin.appetiteState ?? null,
    wellbeing_state: checkin.wellbeingState ?? null,
    notes: checkin.notes ?? null,
  };

  const { error } = await supabase.from('daily_checkins').upsert(payload, { onConflict: 'user_id,checkin_date' });
  if (error) throw error;
  await logEvent(EVENTS.CHECKIN_SAVED, { checkinDate: payload.checkin_date }, 'index.html');
}

export async function replaceSymptoms(entryDate, symptoms) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error('No authenticated user');

  await supabase.from('symptom_entries').delete().eq('user_id', user.id).eq('entry_date', entryDate);
  if (symptoms.length) {
    const rows = symptoms.map((s) => ({
      user_id: user.id,
      entry_date: entryDate,
      symptom_name: s.symptomName,
      severity_or_state: s.severityOrState,
      source: s.source || 'daily_checkin',
    }));
    const { error } = await supabase.from('symptom_entries').insert(rows);
    if (error) throw error;
  }
  await logEvent(EVENTS.SYMPTOM_SAVED, { count: symptoms.length, entryDate }, 'index.html');
}

export async function saveHydration(glassCount, glassSizeMl = 200) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error('No authenticated user');
  const { error } = await supabase.from('hydration_logs').insert({ user_id: user.id, glass_count: glassCount, glass_size_ml: glassSizeMl });
  if (error) throw error;
  await logEvent(EVENTS.HYDRATION_LOGGED, { glassCount, glassSizeMl }, 'index.html');
}

export async function uploadProgressPhoto(file, { takenAt = new Date().toISOString(), weightKgSnapshot = null, caption = null } = {}) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error('No authenticated user');

  const photoId = crypto.randomUUID();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${user.id}/${photoId}.${ext}`;

  await logEvent(EVENTS.PROGRESS_PHOTO_UPLOAD_STARTED, { ext }, 'progress.html');

  const { error: uploadError } = await supabase.storage.from('progress-photos').upload(path, file, {
    upsert: false,
    contentType: file.type || 'image/jpeg',
  });
  if (uploadError) throw uploadError;

  const { error: metadataError } = await supabase.from('progress_photos').insert({
    id: photoId,
    user_id: user.id,
    taken_at: takenAt,
    storage_path: path,
    weight_kg_snapshot: weightKgSnapshot,
    caption,
  });
  if (metadataError) throw metadataError;

  await logEvent(EVENTS.PROGRESS_PHOTO_UPLOADED, { photoId }, 'progress.html');
  return { photoId, path };
}

export async function listProgressPhotos() {
  const { data, error } = await supabase.from('progress_photos').select('*').eq('is_deleted', false).order('taken_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createSignedProgressPhotoUrl(storagePath, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from('progress-photos').createSignedUrl(storagePath, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function saveMealPreferences(payload) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error('No authenticated user');
  const { error } = await supabase.from('meal_preferences').upsert({ user_id: user.id, ...payload });
  if (error) throw error;
  await logEvent(EVENTS.MEAL_PREFERENCES_SAVED, { hasPayload: true }, 'meals.html');
}

export async function saveGeneratedMealPlan(plan) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error('No authenticated user');

  const { data: planHeader, error: planError } = await supabase.from('generated_meal_plans').insert({
    user_id: user.id,
    generator_version: plan.generatorVersion || 'v1',
    days_count: plan.days.length,
    preference_snapshot: plan.preferenceSnapshot,
    shopping_list_snapshot: plan.shoppingListSnapshot || [],
  }).select('id').single();
  if (planError) throw planError;

  const rows = plan.days.map((day, index) => ({
    plan_id: planHeader.id,
    day_number: index + 1,
    breakfast: day.breakfast,
    lunch: day.lunch,
    dinner: day.dinner,
    snacks: day.snacks || [],
    notes: day.notes || null,
  }));
  const { error: daysError } = await supabase.from('meal_plan_days').insert(rows);
  if (daysError) throw daysError;

  await logEvent(EVENTS.MEAL_PLAN_GENERATED, { planId: planHeader.id, daysCount: plan.days.length }, 'meals.html');
  return planHeader.id;
}

export async function startWorkoutSession(payload = {}) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error('No authenticated user');
  const { data, error } = await supabase.from('workout_sessions').insert({
    user_id: user.id,
    status: 'started',
    workout_day_key: payload.workoutDayKey || null,
    session_payload: payload.sessionPayload || {},
  }).select('*').single();
  if (error) throw error;
  await logEvent(EVENTS.WORKOUT_STARTED, { sessionId: data.id }, 'exercise.html');
  return data;
}

export async function completeWorkoutSession(sessionId, totalSetsCompleted) {
  const { error } = await supabase.from('workout_sessions').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_sets_completed: totalSetsCompleted,
  }).eq('id', sessionId);
  if (error) throw error;
  await logEvent(EVENTS.WORKOUT_COMPLETED, { sessionId, totalSetsCompleted }, 'exercise.html');
}

export async function addWorkoutSet(sessionId, exerciseName, setNumber, reps) {
  const { error } = await supabase.from('workout_sets').insert({ session_id: sessionId, exercise_name: exerciseName, set_number: setNumber, reps });
  if (error) throw error;
  await logEvent(EVENTS.WORKOUT_SET_COMPLETED, { sessionId, exerciseName, setNumber, reps }, 'exercise.html');
}

export async function getRestDayStatus(date = todayDate()) {
  const { data, error } = await supabase.from('rest_day_logs').select('*').eq('rest_date', date).maybeSingle();
  if (error) throw error;
  if (data) await logEvent(EVENTS.REST_DAY_DISPLAYED, { restDate: date }, 'exercise.html');
  return !!data;
}

export async function submitFeedback(category, message, screenContext = null, severity = null) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  const { error } = await supabase.from('feedback_submissions').insert({
    user_id: user?.id || null,
    category,
    message,
    screen_context: screenContext,
    severity,
  });
  if (error) throw error;
  await logEvent(EVENTS.FEEDBACK_SUBMITTED, { category, screenContext, severity }, 'settings.html');
}


export async function getProfile() {
  const { data: userResp, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userResp.user;
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(patch) {
  const { data: userResp, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userResp.user;
  if (!user) throw new Error('No authenticated user');
  const { error } = await supabase.from('profiles').upsert({ id: user.id, ...patch });
  if (error) throw error;
}

export async function getUserSettings() {
  const { data: userResp, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userResp.user;
  if (!user) return null;
  const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOnboarding() {
  const { data: userResp, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userResp.user;
  if (!user) return null;
  const { data, error } = await supabase.from('onboarding_responses').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getWeightLogs() {
  const { data, error } = await supabase.from('weight_logs').select('*').order('logged_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getLatestWeightLog() {
  const { data, error } = await supabase.from('weight_logs').select('*').order('logged_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getTodayCheckin(checkinDate = todayDate()) {
  const { data, error } = await supabase.from('daily_checkins').select('*').eq('checkin_date', checkinDate).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getSymptomsByDate(entryDate = todayDate()) {
  const { data, error } = await supabase.from('symptom_entries').select('*').eq('entry_date', entryDate).order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getLatestHydration() {
  const { data, error } = await supabase.from('hydration_logs').select('*').order('logged_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function softDeleteProgressPhoto(photoId) {
  const { error } = await supabase.from('progress_photos').update({ is_deleted: true }).eq('id', photoId);
  if (error) throw error;
}

export async function fetchAdminSummary() {
  const authHeader = await getAuthHeader();
  if (!authHeader) throw new Error('Missing auth token');
  const res = await fetch(`${getFunctionsBaseUrl()}/stats-summary`, { headers: { Authorization: authHeader } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function exportCsv(dataset) {
  const authHeader = await getAuthHeader();
  if (!authHeader) throw new Error('Missing auth token');
  const res = await fetch(`${getFunctionsBaseUrl()}/export-csv?dataset=${encodeURIComponent(dataset)}`, { headers: { Authorization: authHeader } });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${dataset}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}



export async function getMealPreferences() {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return null;
  const { data, error } = await supabase.from('meal_preferences').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLatestMealPlan() {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return null;
  const { data: header, error: headerError } = await supabase
    .from('generated_meal_plans')
    .select('*')
    .eq('user_id', user.id)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (headerError) throw headerError;
  if (!header) return null;
  const { data: days, error: daysError } = await supabase
    .from('meal_plan_days')
    .select('*')
    .eq('plan_id', header.id)
    .order('day_number', { ascending: true });
  if (daysError) throw daysError;
  return { ...header, days: days || [] };
}


export async function getWorkoutHistory(limit = 50) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('*')
    .eq('status', 'completed')
    .order('completed_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
